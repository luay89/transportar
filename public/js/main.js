/* Boot: load the company's config, apply its brand (white label), count the QR scan,
 * draw the shell, install prompt, offline cache, and the sample data for the demo. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, esc = App.esc, t = App.t, store = App.store;

  // ---------- demo data: four weeks of rides so every screen has something to show ----------
  App.seedDemo = function (key) {
    var TR = window.TR, clock = Date.now(), db = null;
    var core = TR.core.createCore({ load: function () { return db; }, save: function (s) { db = s; }, now: function () { return clock; }, cardEnabled: true, demoCard: true });
    var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    var call = function (m, p, b, a) { return core.handle(m, p, b || {}, a || '', {}); };
    call('GET', '/api/config');
    var admin = call('POST', '/api/admin/login', { password: 'admin123' }).body.token;
    var drv = { d1: call('POST', '/api/driver/login', { pin: '1111' }).body.token, d2: call('POST', '/api/driver/login', { pin: '2222' }).body.token };
    var places = {}; db.tenants.default.settings.places.forEach(function (p) { places[p.id] = p; });
    var P = function (id) { var p = places[id]; return { name: p.name, lat: p.lat, lng: p.lng, placeId: p.id }; };
    var people = [['Jordan Lee', '4145550111'], ['Priya Shah', '4145550112'], ['Marcus Hill', '4145550113'], ['Elena Ruiz', '4145550114'], ['Sam Carter', '4145550115'],
      ['Aisha Khan', '4145550116'], ['Tom Becker', '4145550117'], ['Grace Wu', '4145550118'], ['Omar Haddad', '4145550119'], ['Lily Novak', '4145550120'], ['Dan Kowalski', '4145550121'], ['Nora Fields', '4145550122']];
    var trips = [
      { w: 5, src: 'hilton', svc: 'airport', a: 'hilton', b: 'mke', v: 'sedan', pay: 'card' },
      { w: 4, src: 'flyer-ord', svc: 'airport', a: 'mkedt', b: 'ord', v: 'suv', pay: 'card', promo: 'FLY10' },
      { w: 4, src: 'card', svc: 'airport', a: 'mke', b: 'mkedt', v: 'sedan', pay: 'pos', flight: 'AA1432' },
      { w: 2, src: 'direct', svc: 'point', a: 'fiserv', b: 'brk', v: 'suv', pay: 'pos' },
      { w: 2, src: 'card', svc: 'event', a: 'mkedt', b: 'lkg', v: 'limo', pay: 'transfer', hours: 4 },
      { w: 1, src: 'direct', svc: 'hourly', a: 'mkedt', b: null, v: 'van', pay: 'transfer', hours: 3 },
      { w: 2, src: 'card', svc: 'point', a: 'mkedt', b: 'msn', v: 'suv', pay: 'card' },
      { w: 1, src: 'direct', svc: 'point', a: 'brk', b: 'grb', v: 'bus', pay: 'transfer' },
      { w: 2, src: 'direct', svc: 'airport', a: 'chidt', b: 'mdw', v: 'sedan', pay: 'pos' }
    ];
    var bag = []; trips.forEach(function (x) { for (var i = 0; i < x.w; i++) bag.push(x); });
    var hours = [5, 6, 7, 7, 8, 8, 9, 11, 13, 15, 16, 17, 17, 18, 18, 19, 20, 21, 22];
    var comments = ['Very professional, car was spotless.', 'On time and friendly.', 'Smooth ride to the airport.', '', '', 'Great music and water ready.'];
    var day0 = new Date(); day0.setHours(0, 0, 0, 0);
    for (var d = 27; d >= 0; d--) {
      var dayStart = day0.getTime() - d * 864e5, wd = new Date(dayStart).getDay();
      var count = 1 + Math.floor(rnd() * (wd === 5 || wd === 6 ? 4 : 3));
      for (var k = 0; k < count; k++) {
        var tp = pick(bag), who = pick(people), h = pick(hours);
        if (wd >= 5 && rnd() < 0.3) h = pick([20, 21, 22, 23]);
        var rideAt = dayStart + h * 3600e3 + Math.floor(rnd() * 4) * 15 * 60e3;
        if (d === 0 && rideAt > Date.now() - 2 * 3600e3) continue;
        clock = rideAt - (2 + rnd() * 30) * 3600e3;
        var corp = tp.svc === 'airport' && rnd() < 0.15;
        call('POST', '/api/scan', { src: tp.src });
        var r = call('POST', '/api/bookings', {
          service: tp.svc, vehicleId: tp.v, pickup: P(tp.a), dropoff: tp.b ? P(tp.b) : null, when: new Date(rideAt).toISOString(), hours: tp.hours,
          passengers: 1 + Math.floor(rnd() * 3), bags: Math.floor(rnd() * 3), name: who[0], phone: who[1], payMethod: corp ? 'invoice' : tp.pay,
          companyCode: corp ? 'ACME' : '', promoCode: tp.promo && rnd() < 0.5 ? tp.promo : '', flight: tp.flight, source: tp.src
        });
        if (r.status !== 200) continue;
        var code = r.body.code, tok = r.body.token;
        clock = rideAt - 3600e3;
        if (rnd() < 0.07) { call('POST', '/api/bookings/' + code + '/cancel', { t: tok }); continue; }
        var dId = ['sedan', 'suv'].indexOf(tp.v) >= 0 && (tp.v === 'sedan' || rnd() < 0.6) ? 'd1' : 'd2';
        call('POST', '/api/admin/bookings/' + code, { action: 'assign', driverId: dId }, admin);
        ['enroute', 'arrived', 'ontrip', 'completed'].forEach(function (s, i) { clock = rideAt - 1800e3 + i * 1500e3; call('POST', '/api/driver/jobs/' + code + '/status', { status: s }, drv[dId]); });
        if (tp.pay === 'card' && !corp) call('POST', '/api/bookings/' + code + '/pay-demo', { t: tok });
        else if (!corp && rnd() < 0.92) call('POST', '/api/driver/jobs/' + code + '/paid', {}, drv[dId]);
        if (rnd() < 0.7) { var s1 = rnd() < 0.8 ? 5 : 4; call('POST', '/api/bookings/' + code + '/rate', { t: tok, driver: s1, ride: rnd() < 0.85 ? 5 : 4, comment: pick(comments) }); }
      }
    }
    // offers the drivers declined or let expire, for the acceptance rate
    var T = db.tenants.default;
    T.drivers[0].stats.offered = (T.drivers[0].stats.offered || 0) + 6; T.drivers[0].stats.declined = (T.drivers[0].stats.declined || 0) + 2;
    T.drivers[1].stats.offered = (T.drivers[1].stats.offered || 0) + 4; T.drivers[1].stats.expired = (T.drivers[1].stats.expired || 0) + 1;
    T.drivers.forEach(function (d) { var st = d.stats; st.offered += T.bookings.filter(function (b) { return b.driverId === d.id; }).length; st.accepted = Math.max(0, (st.offered || 0) - (st.declined || 0) - (st.expired || 0)); });
    // QR scans that did not turn into bookings
    [['card', 48], ['hilton', 61], ['flyer-ord', 95]].forEach(function (x) { T.scans[x[0]] = (T.scans[x[0]] || 0) + x[1]; });

    // live right now
    clock = Date.now();
    T.drivers[0].location = { lat: 43.02, lng: -87.93, at: clock }; T.drivers[1].location = { lat: 42.99, lng: -87.9, at: clock };
    var live = call('POST', '/api/bookings', { service: 'airport', vehicleId: 'suv', pickup: P('mke'), dropoff: P('hilton'), when: new Date(clock + 25 * 60e3).toISOString(), passengers: 2, bags: 3,
      name: 'Grace Wu', phone: '4145550118', payMethod: 'card', flight: 'UA455', meetGreet: true, source: 'hilton' }).body;
    call('POST', '/api/admin/bookings/' + live.code, { action: 'assign', driverId: 'd2' }, admin);
    call('POST', '/api/driver/jobs/' + live.code + '/status', { status: 'enroute' }, drv.d2);
    call('POST', '/api/admin/bookings/' + live.code, { action: 'flight', flight: { number: 'UA455', status: 'active', estimatedArr: new Date(clock + 35 * 60e3).toISOString(), scheduledArr: new Date(clock + 20 * 60e3).toISOString() } }, admin);
    call('POST', '/api/bookings', { service: 'point', vehicleId: 'sedan', pickup: P('mkedt'), dropoff: P('fiserv'), when: 'now', passengers: 1, bags: 0, name: 'Tom Becker', phone: '4145550117', payMethod: 'pos', source: 'card' });
    call('POST', '/api/bookings', { service: 'airport', vehicleId: 'sedan', pickup: P('hilton'), dropoff: P('ord'), when: new Date(clock + 26 * 3600e3).toISOString(), passengers: 1, bags: 1,
      name: 'Marcus Hill', phone: '4145550113', payMethod: 'invoice', companyCode: 'ACME', repeat: { freq: 'weekly', count: 4 }, source: 'direct' });
    store.set(key, db);
  };

  // ---------- brand / white label ----------
  App.applyAccent = function (hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    var root = document.documentElement.style;
    root.setProperty('--brand', hex);
    root.setProperty('--brand-ink', lum > 0.55 ? '#16181c' : '#ffffff');
  };

  function shell() {
    var b = App.cfg.brand;
    document.title = b.name;
    document.documentElement.lang = App.lang;
    document.documentElement.dir = App.lang === 'ar' ? 'rtl' : 'ltr';
    App.applyAccent(b.accent);
    $('#brandName').textContent = b.name;
    $('#logoMark').innerHTML = b.logo ? '<img src="' + esc(b.logo) + '" alt="">' : App.icon('route');
    $('#logoMark').classList.toggle('img', !!b.logo);
    $('#navBook').textContent = t('navBook');
    $('#navTrips').textContent = t('navTrips');
    $('#installBtn').textContent = t('install');
    $('#langSel').value = App.lang;
    var dark = App.theme === 'dark' || (App.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var tb = $('#themeBtn');
    tb.innerHTML = App.icon(dark ? 'sun' : 'moon'); tb.title = t('themeToggle'); tb.setAttribute('aria-label', t('themeToggle'));
    tb.onclick = function () { App.applyTheme(dark ? 'light' : 'dark'); shell(); };
    $('#footer').innerHTML =
      '<div class="foot-brand"><strong>' + esc(b.name) + '</strong><span>' + esc(b.city) + '</span><span class="fine">' + esc(b.tagline) + '</span></div>' +
      '<div class="foot-contact"><span>' + t('callOrText') + ' <a href="tel:' + esc(b.phone.replace(/[^\d+]/g, '')) + '">' + esc(b.phone) + '</a></span><span>' + esc(b.email) + '</span></div>' +
      '<nav class="foot-links" aria-label="' + esc(t('moreLinks')) + '"><a href="#driver">' + t('driverLogin') + '</a><a href="#admin">' + t('ownerLogin') + '</a><a href="#company">' + t('businessLogin') + '</a><a href="#platform">' + t('platformLogin') + '</a></nav>';
    var demo = $('#demoBar');
    demo.hidden = App.API.mode !== 'demo';
    if (App.API.mode === 'demo') demo.innerHTML = '<span>' + t('demoNote') + '</span><button class="link" id="demoReset">' + t('demoReset') + '</button>';
    var rs = $('#demoReset');
    if (rs) rs.onclick = function () {
      App.confirm(t('demoReset'), t('demoResetHint'), t('demoReset'), function () {
        store.set(App.API.demoKey, null); App.seedDemo(App.API.demoKey);
        ['adminToken', 'driverToken', 'companyToken', 'platformToken', 'customerToken', 'trips', 'favorites', 'draft2'].forEach(function (k) { store.set(k, null); });
        App.setTenant(''); location.hash = 'book'; App.reloadConfig().then(App.route);
      });
    };
  }

  App.reloadConfig = function () {
    return App.API.call('GET', '/api/config').then(function (r) {
      if (r.status === 403) {
        $('#main').innerHTML = '<section class="block"><h1>' + t('suspendedTitle') + '</h1><p>' + t('suspendedBody') + '</p><a class="btn" href="#platform" id="backPlat">' + t('platformLogin') + '</a></section>';
        $('#backPlat').onclick = function () { App.setTenant(''); App.reloadConfig().then(App.route); };
        return null;
      }
      App.cfg = r.body;
      shell();
      return App.cfg;
    });
  };

  // ---------- install (PWA) ----------
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  function setupInstall() {
    var btn = $('#installBtn');
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!standalone && /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) && 'ontouchend' in document && App.API.mode === 'server') btn.hidden = false;
    btn.onclick = function () {
      if (deferred) { deferred.prompt(); deferred = null; btn.hidden = true; return; }
      App.openSheet('<h2>' + t('install') + '</h2><ol class="steps"><li>' + t('iosStep1') + '</li><li>' + t('iosStep2') + '</li><li>' + t('iosStep3') + '</li></ol><div class="sheet-actions"><button class="btn primary" data-close>' + t('gotIt') + '</button></div>');
    };
  }

  // ---------- boot ----------
  App.API.init().then(App.reloadConfig).then(function (cfg) {
    if (!cfg) return;
    App.applyCampaign();
    if (!App.session.get('scanned')) { App.session.set('scanned', '1'); App.API.call('POST', '/api/scan', { src: App.source }); }
    $('#langSel').onchange = function (e) { App.lang = e.target.value; store.set('lang', App.lang); shell(); App.route(); };
    setupInstall();
    App.route();
    window.addEventListener('hashchange', App.route);
    if ('serviceWorker' in navigator && App.API.mode === 'server') navigator.serviceWorker.register('/sw.js').catch(function () { /* no offline cache */ });
  });
})();
