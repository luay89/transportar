/* Driver app: PIN sign-in, online/offline, live location, ride offers with a
 * countdown, step-by-step trip status, navigation, payment collected, today's pay. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, $$ = App.$$, esc = App.esc, t = App.t, store = App.store;
  var NEXT = { accepted: 'enroute', enroute: 'arrived', arrived: 'ontrip', ontrip: 'completed' };
  var watchId = null, lastSent = 0, seenOffers = {}, tab = 'offers', skew = 0, countdown = null, mapCtl = null;

  function call(method, path, body) { return App.API.call(method, path, body, store.get('driverToken')); }

  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext, ctx = new C();
      [0, 0.18].forEach(function (d) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.15);
        o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.16);
      });
    } catch (e) { /* no audio */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  function stopWatch() { if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null; }
  function startWatch() {
    if (!navigator.geolocation) return App.toast(t('gpsUnavailable'), 'bad');
    stopWatch();
    watchId = navigator.geolocation.watchPosition(function (p) {
      if (Date.now() - lastSent < 15000) return;
      lastSent = Date.now();
      call('POST', '/api/driver/location', { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading });
    }, function () { App.toast(t('gpsDenied'), 'bad'); stopWatch(); }, { enableHighAccuracy: true, maximumAge: 10000 });
  }

  App.views.driver = function () {
    if (!store.get('driverToken')) {
      $('#main').innerHTML = App.loginBox(t('driverTitle'), t('pin'), 'password', 'numeric', App.API.mode === 'demo' ? t('demoDriver') : '');
      $('#loginForm').onsubmit = function (e) {
        e.preventDefault();
        App.API.call('POST', '/api/driver/login', { pin: $('#secret').value }).then(function (r) {
          if (r.status !== 200) return App.loginErr(r);
          store.set('driverToken', r.body.token); App.views.driver();
        });
      };
      return;
    }
    $('#main').innerHTML = '<section class="driver"><div id="drv"><p class="muted">' + t('loading') + '</p></div><div class="map" id="dmap" hidden></div><div id="drvList"></div></section>';
    mapCtl = null;
    App.onLeave = function () { clearInterval(countdown); };
    App.poll(load, 4000);
  };

  function load() {
    if (!$('#sheet').hidden) return;
    call('GET', '/api/driver/jobs').then(function (r) {
      if (r.status === 401) { store.set('driverToken', null); stopWatch(); return App.views.driver(); }
      if (r.status !== 200 || !$('#drv')) return;
      skew = r.body.serverNow - Date.now();
      var fresh = r.body.offers.concat(r.body.open).filter(function (x) { return !seenOffers[x.code]; });
      if (fresh.length && load.first) beep();
      load.first = true;
      r.body.offers.concat(r.body.open).forEach(function (x) { seenOffers[x.code] = 1; });
      draw(r.body);
    });
  }

  function navUrl(p) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + (p.lat != null ? p.lat + ',' + p.lng : encodeURIComponent(p.name));
  }

  function rideCard(b, kind) {
    var when = b.when === 'now' ? '<span class="pill st-pending">' + t('asap') + '</span>' : esc(App.fmtTime(b.when));
    var head = '<div class="job-head"><span class="mono">' + esc(b.code) + '</span>' + App.statusPill(b.status) + '<strong class="num">' + App.money(b.price) + '</strong></div>';
    var route = '<ol class="route-list"><li><i class="pin a">A</i>' + esc(b.pickup.name) + '</li><li><i class="pin b">B</i>' + esc(b.dropoff.asDirected ? t('asDirected') : b.dropoff.name) + '</li></ol>';
    var meta = '<p class="job-meta">' + when + ' · ' + esc(b.vehicle ? b.vehicle.name : '') + ' · ' + t('paxN', { n: b.passengers }) + ' · ' + t('bagsN', { n: b.bags }) +
      (b.miles ? ' · ' + t('milesN', { n: Math.round(b.miles) }) : '') + (b.hours ? ' · ' + t('hoursN', { n: b.hours }) : '') + '</p>' +
      '<p class="job-meta">' + App.serviceName(b.service) + (b.tripType === 'round' ? ' · ' + t('roundTrip') : '') + (b.flight && b.flight.number ? ' · ✈ ' + esc(b.flight.number) : '') +
      (b.meetGreet ? ' · ' + t('meetGreetShort') : '') + (b.childSeats ? ' · ' + t('childSeatsN', { n: b.childSeats }) : '') + '</p>' +
      (b.notes ? '<p class="note">' + esc(b.notes) + '</p>' : '');
    var actions = '';
    if (kind === 'offer') {
      actions = '<div class="offer-bar"><div class="countdown" data-exp="' + b.offerExpires + '"><i></i><span></span></div>' +
        (b.offerEta != null ? '<span class="fine">' + t('etaToPickup', { n: b.offerEta }) + '</span>' : '') + '</div>' +
        '<div class="row"><button class="btn ghost" data-dec="' + esc(b.code) + '">' + t('decline') + '</button><button class="btn primary grow" data-acc="' + esc(b.code) + '">' + t('accept') + '</button></div>';
    } else if (kind === 'open') {
      actions = '<div class="row"><button class="btn primary grow" data-acc="' + esc(b.code) + '">' + t('accept') + '</button></div>';
    } else if (kind === 'mine' && NEXT[b.status]) {
      var target = b.status === 'ontrip' ? b.dropoff : b.pickup;
      actions = '<div class="cust"><span>' + esc(b.customer.name) + '</span>' + (b.customer.phone ? '<a class="btn sm" href="tel:' + esc(b.customer.phone.replace(/[^\d+]/g, '')) + '">' + t('call') + '</a>' : '') + '</div>' +
        '<div class="row"><a class="btn" target="_blank" rel="noopener" href="' + esc(navUrl(target)) + '">' + t('navigate') + '</a>' +
        '<button class="btn primary grow" data-next="' + esc(b.code) + '" data-to="' + NEXT[b.status] + '">' + t('go_' + NEXT[b.status]) + '</button></div>';
    }
    if (kind === 'mine' && b.payStatus !== 'paid' && b.status !== 'cancelled' && (b.payMethod === 'pos' || b.payMethod === 'transfer')) {
      actions += '<div class="row"><span class="fine grow">' + App.payName(b.payMethod) + ' ' + App.payPill(b) + '</span><button class="btn sm" data-paid="' + esc(b.code) + '">' + t('markCollected', { total: App.money(b.price) }) + '</button></div>';
    } else if (kind === 'mine') actions += '<p class="fine">' + App.payName(b.payMethod) + ' ' + App.payPill(b) + '</p>';
    return '<article class="job ' + kind + '">' + head + route + meta + actions + '</article>';
  }

  function draw(d) {
    var me = d.me;
    var active = d.mine.filter(function (b) { return NEXT[b.status]; });
    var done = d.mine.filter(function (b) { return !NEXT[b.status]; });
    var incoming = d.offers.length + d.open.length;
    if (tab === 'offers' && !incoming && active.length) tab = 'mine';
    var sharing = me.sharing;
    if (App.API.mode === 'server' && sharing && me.online && watchId == null) startWatch();
    App.driverOfferSeconds = me.offerSeconds;

    var list;
    if (tab === 'offers') list = incoming ? d.offers.map(function (b) { return rideCard(b, 'offer'); }).join('') + d.open.map(function (b) { return rideCard(b, 'open'); }).join('')
      : '<div class="empty"><p>' + (me.online ? t('noOffers') : t('goOnlineHint')) + '</p></div>';
    else if (tab === 'mine') list = active.length ? active.map(function (b) { return rideCard(b, 'mine'); }).join('') : '<div class="empty"><p>' + t('noActive') + '</p></div>';
    else list = done.length ? done.map(function (b) { return rideCard(b, 'done'); }).join('') : '<div class="empty"><p>' + t('noRides') + '</p></div>';

    $('#drv').innerHTML =
      '<header class="drv-head"><div class="avatar" aria-hidden="true">' + esc(me.name.slice(0, 1)) + '</div><div><h1>' + esc(me.name) + '</h1><p class="fine">' + esc(me.plate) +
        (me.rating ? ' · ★ ' + me.rating + ' (' + me.ratings + ')' : '') + '</p></div><button class="btn ghost sm" id="dOut">' + t('logout') + '</button></header>' +
      '<div class="drv-switches">' +
        '<button class="switch' + (me.online ? ' on' : '') + '" id="onl" aria-pressed="' + me.online + '"><i></i><span>' + (me.online ? t('online') : t('offline')) + '</span></button>' +
        '<button class="switch' + (sharing ? ' on' : '') + '" id="gps" aria-pressed="' + sharing + '"' + (me.online ? '' : ' disabled') + '><i></i><span>' + t('shareLocation') + '</span></button>' +
      '</div>' +
      '<div class="kpis three">' + App.kpi(t('todayRides'), me.today.rides, '', 'car') + App.kpi(t('todayEarnings'), App.money(me.today.earnings), '', 'wallet') + App.kpi(t('rating'), me.rating ? '★ ' + me.rating : '—', '', 'star') + '</div>' +
      '';
    $('#drvList').innerHTML = '<div class="tabs" role="tablist">' +
        tabBtn('offers', t('tabOffers'), incoming) + tabBtn('mine', t('tabMine'), active.length) + tabBtn('done', t('tabDone')) +
      '</div><div class="jobs">' + list + '</div>';

    var mapEl = $('#dmap');
    mapEl.hidden = !active[0];
    if (active[0]) {
      var a = active[0], pts = { pickup: a.pickup, dropoff: a.dropoff.asDirected ? null : a.dropoff, drivers: me.location ? [{ name: me.name, location: me.location }] : [] };
      if (mapCtl) mapCtl.update(pts); else mapCtl = App.mapView(mapEl, pts);
    } else mapCtl = null;
    $('#dOut').onclick = function () { stopWatch(); call('POST', '/api/driver/online', { online: false }); store.set('driverToken', null); App.views.driver(); };
    $('#onl').onclick = function () {
      call('POST', '/api/driver/online', { online: !me.online }).then(function () { if (me.online) stopWatch(); load(); });
    };
    $('#gps').onclick = function () {
      if (sharing) { stopWatch(); call('POST', '/api/driver/location', {}).then(load); return; }
      if (App.API.mode === 'demo') {
        // No GPS in the preview: place the driver near the next pickup (or downtown) so the map and ETA work.
        var p = active[0] ? active[0].pickup : App.cfg.places[1];
        call('POST', '/api/driver/location', { lat: p.lat - 0.03, lng: p.lng + 0.02 }).then(function () { App.toast(t('demoGps')); load(); });
        return;
      }
      startWatch(); App.toast(t('sharingOn'));
    };
    $$('.tabs button').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; draw(d); }; });
    $$('[data-acc]').forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        call('POST', '/api/driver/jobs/' + b.dataset.acc + '/accept').then(function (r) {
          if (r.status === 200) { App.toast(t('accepted'), 'good'); tab = 'mine'; } else App.toast(t('errTaken'), 'bad');
          load();
        });
      };
    });
    $$('[data-dec]').forEach(function (b) { b.onclick = function () { call('POST', '/api/driver/jobs/' + b.dataset.dec + '/decline').then(load); }; });
    $$('[data-next]').forEach(function (b) {
      b.onclick = function () {
        var go = function () { call('POST', '/api/driver/jobs/' + b.dataset.next + '/status', { status: b.dataset.to }).then(load); };
        if (b.dataset.to === 'completed') App.confirm(t('completeQ'), '', t('go_completed'), go); else go();
      };
    });
    $$('[data-paid]').forEach(function (b) {
      b.onclick = function () { App.confirm(t('collectQ'), '', t('confirm'), function () { call('POST', '/api/driver/jobs/' + b.dataset.paid + '/paid').then(load); }); };
    });
    tickCountdowns();
    clearInterval(countdown); countdown = setInterval(tickCountdowns, 1000);
  }

  function tabBtn(id, label, n) {
    return '<button role="tab" data-tab="' + id + '" aria-selected="' + (tab === id) + '">' + label + (n ? ' <b class="badge">' + n + '</b>' : '') + '</button>';
  }
  function tickCountdowns() {
    $$('.countdown').forEach(function (el) {
      var left = Math.max(0, Math.round((+el.dataset.exp - Date.now() - skew) / 1000));
      var total = (App.driverOfferSeconds || 60);
      el.querySelector('span').textContent = t('secondsLeft', { n: left });
      el.querySelector('i').style.setProperty('--w', Math.min(100, left / total * 100) + '%');
      el.classList.toggle('low', left <= 10);
    });
  }
})();
