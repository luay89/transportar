/* Owner dashboard: live dispatch board and map, bookings, analytics with insights,
 * QR campaigns, drivers, fleet and pricing rules, places, promos and loyalty,
 * corporate accounts, customers, and white-label settings. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, $$ = App.$$, esc = App.esc, t = App.t, store = App.store;
  var A = { tab: 'dispatch', st: null, an: null, days: 30, sel: null, filter: 'active', q: '', map: null };
  var TAB_IC = { dispatch: 'radar', bookings: 'list', analytics: 'chart', marketing: 'qr', drivers: 'users', fleet: 'car', places: 'pin', promos: 'gift', companies: 'building', customers: 'heart', settings: 'settings' };
  var TABS = ['dispatch', 'bookings', 'analytics', 'marketing', 'drivers', 'fleet', 'places', 'promos', 'companies', 'customers', 'settings'];
  var LIVE = { dispatch: 1, bookings: 1 };
  var CHANNELS = ['card', 'sticker', 'flyer', 'hotel', 'vehicle', 'social', 'event', 'other'];

  function call(method, path, body) { return App.API.call(method, path, body, store.get('adminToken')); }

  // ---------- small form helpers ----------
  function fld(id, label, val, type, extra) {
    return '<label class="fld" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '></label>';
  }
  function sel(id, label, opts, val) {
    return '<label class="fld" for="' + id + '"><span>' + label + '</span><select id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function chk(id, label, on) { return '<label class="toggle"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '> ' + label + '</label>'; }
  function v(id) { var e = $('#' + id); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; }
  function n(id) { var x = parseFloat(v(id)); return isNaN(x) ? 0 : x; }
  function panel(title, body, action) { return '<section class="panel"><div class="panel-head"><h3>' + title + '</h3>' + (action || '') + '</div>' + body + '</section>'; }
  function table(head, rows, empty) {
    if (!rows.length) return '<p class="muted">' + (empty || t('nothingYet')) + '</p>';
    return '<div class="table-wrap"><table class="tbl"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function done(r, msg) {
    if (r.status === 200) { App.toast(msg || t('saved'), 'good'); App.closeSheet(); return reload(); }
    App.toast(App.errText(r), 'bad');
  }
  function placeOpts(blank) { return (blank ? [['', '—']] : []).concat(A.st.settings.places.map(function (p) { return [p.id, p.name]; })); }
  function vehOpts(blank) { return (blank ? [['', '—']] : []).concat(A.st.settings.vehicles.map(function (x) { return [x.id, x.name]; })); }
  function svcOpts(blank) { return (blank ? [['', '—']] : []).concat(['point', 'airport', 'hourly', 'event'].map(function (s) { return [s, App.serviceName(s)]; })); }

  // Shrink an uploaded photo/logo so it fits in the data file.
  function readImage(file, max, type, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL(type, 0.82));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  }

  // ---------- QR ----------
  App.bookUrl = function (campaignId) {
    var q = '?c=' + encodeURIComponent(campaignId);
    if (App.tenant && App.tenant !== 'default' && !App.cfg.brand.domain) q += '&co=' + encodeURIComponent(App.tenant);
    var base = App.cfg.brand.domain && App.API.mode === 'server' ? 'https://' + App.cfg.brand.domain + '/' : location.origin + location.pathname;
    return base + q;
  };
  function qrModules(text) {
    if (typeof window.qrcode !== 'function') return null;
    var qr = window.qrcode(0, 'M'); qr.addData(text); qr.make(); return qr;
  }
  function qrSvg(text) {
    var qr = qrModules(text); if (!qr) return '<p class="muted">' + t('qrUnavailable') + '</p>';
    var nn = qr.getModuleCount(), q = 3, d = '';
    for (var r = 0; r < nn; r++) for (var k = 0; k < nn; k++) if (qr.isDark(r, k)) d += 'M' + (k + q) + ' ' + (r + q) + 'h1v1h-1z';
    return '<svg class="qr" viewBox="0 0 ' + (nn + q * 2) + ' ' + (nn + q * 2) + '" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#111316"/></svg>';
  }
  function qrCanvas(text, cell) {
    var qr = qrModules(text); if (!qr) return null;
    var nn = qr.getModuleCount(), q = 4, size = (nn + q * 2) * cell, c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#111316';
    for (var r = 0; r < nn; r++) for (var k = 0; k < nn; k++) if (qr.isDark(r, k)) g.fillRect((k + q) * cell, (r + q) * cell, cell, cell);
    return c;
  }
  // Print-ready business card (3.5 × 2 in at 300 dpi) or a 3 × 3 in sticker.
  function downloadPrint(c, kind) {
    var B = App.cfg.brand, accent = B.accent || '#0f8b7f', url = App.bookUrl(c.id), qr = qrCanvas(url, 12);
    var W = kind === 'sticker' ? 900 : 1050, H = kind === 'sticker' ? 900 : 600;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#16181c'; g.fillRect(0, 0, W, H);
    g.fillStyle = accent;
    if (kind === 'sticker') {
      g.font = '800 64px Overpass, Arial, sans-serif'; g.textAlign = 'center'; g.fillText(t('scanToBook').toUpperCase(), W / 2, 110);
      g.fillStyle = '#fff'; g.fillRect(170, 160, 560, 560); g.imageSmoothingEnabled = false; g.drawImage(qr, 190, 180, 520, 520);
      g.font = '700 48px Overpass, Arial, sans-serif'; g.fillText(B.name, W / 2, 800); g.font = '400 34px Overpass, Arial, sans-serif'; g.fillStyle = '#c9ccd3'; g.fillText(B.phone, W / 2, 855);
    } else {
      for (var x = 60; x < 600; x += 70) g.fillRect(x, 540, 40, 8);
      g.fillStyle = '#fff'; g.font = '800 60px Overpass, Arial, sans-serif'; g.fillText(B.name, 60, 150);
      g.fillStyle = '#c9ccd3'; g.font = '400 32px Overpass, Arial, sans-serif'; g.fillText(c.welcome || B.tagline, 60, 210);
      g.fillStyle = '#fff'; g.font = '600 36px Overpass, Arial, sans-serif'; g.fillText(B.phone, 60, 330);
      g.fillStyle = accent; g.font = '800 30px Overpass, Arial, sans-serif'; g.fillText(t('scanToBook').toUpperCase(), 60, 470);
      g.fillStyle = '#fff'; g.fillRect(650, 100, 360, 360); g.imageSmoothingEnabled = false; g.drawImage(qr, 670, 120, 320, 320);
    }
    var a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = kind + '-' + c.id + '.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- view ----------
  App.views.admin = function (arg) {
    if (!store.get('adminToken')) {
      $('#main').innerHTML = App.loginBox(t('adminTitle'), t('password'), 'password', 'text', App.API.mode === 'demo' ? t('demoAdmin') : '');
      $('#loginForm').onsubmit = function (e) {
        e.preventDefault();
        App.API.call('POST', '/api/admin/login', { password: $('#secret').value }).then(function (r) {
          if (r.status !== 200) return App.loginErr(r);
          store.set('adminToken', r.body.token); App.views.admin(arg);
        });
      };
      return;
    }
    A.tab = TABS.indexOf(arg) >= 0 ? arg : 'dispatch';
    A.map = null;
    var hr = new Date().getHours(), greet = t(hr < 12 ? 'greetMorning' : hr < 18 ? 'greetAfternoon' : 'greetEvening');
    var today = new Date().toLocaleDateString(App.lang === 'ar' ? 'ar' : App.lang, { weekday: 'long', month: 'long', day: 'numeric' });
    $('#main').innerHTML = '<section class="ops admin"><header class="ops-head greet"><div class="greet-mark">' + App.icon(hr >= 6 && hr < 18 ? 'sun' : 'moon') + '</div>' +
      '<div class="grow"><p class="eyebrow">' + esc(today) + '</p><h1>' + greet + '</h1><p class="muted">' + esc(App.cfg.brand.name) + ' · ' + t('adminTitle') + '</p></div>' +
      '<div class="row"><a class="btn ghost sm" href="#book" target="_blank" rel="noopener">' + App.icon('globe') + t('openBooking') + '</a><button class="btn ghost sm" id="aOut">' + App.icon('logout') + t('logout') + '</button></div></header>' +
      '<div class="adm-layout"><nav class="subnav side" aria-label="' + esc(t('adminTitle')) + '">' + TABS.map(function (x) {
        return '<a href="#admin-' + x + '"' + (x === A.tab ? ' aria-current="page"' : '') + '>' + App.icon(TAB_IC[x]) + '<span>' + t('tab_' + x) + '</span></a>';
      }).join('') + '</nav><div id="adm"><p class="muted">' + t('loading') + '</p></div></div></section>';
    $('#aOut').onclick = function () { store.set('adminToken', null); App.views.admin(); };
    var cur = $('.subnav [aria-current]'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (LIVE[A.tab]) App.poll(function () { if ($('#sheet').hidden) reload(); }, 5000); else reload();
  };

  function reload() {
    return call('GET', '/api/admin/state').then(function (r) {
      if (r.status === 401) { store.set('adminToken', null); return App.views.admin(A.tab); }
      if (r.status !== 200 || !$('#adm')) return;
      A.st = r.body;
      var needAn = A.tab === 'analytics' || A.tab === 'marketing';
      if (!needAn) return render();
      return call('POST', '/api/admin/analytics', { days: A.tab === 'marketing' ? 365 : A.days }).then(function (r2) { A.an = r2.body; render(); });
    });
  }
  function render() { R[A.tab](); }
  var R = {};

  // ================= dispatch board =================
  R.dispatch = function () {
    var S = A.st, now = S.serverNow;
    var pending = S.bookings.filter(function (b) { return b.status === 'pending'; });
    var active = S.bookings.filter(function (b) { return ['accepted', 'enroute', 'arrived', 'ontrip'].indexOf(b.status) >= 0; });
    var dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    var today = S.bookings.filter(function (b) { return b.createdAt >= dayStart.getTime() && b.status !== 'cancelled'; });
    var online = S.drivers.filter(function (d) { return d.active && d.online; });
    if (!A.sel || !S.bookings.some(function (b) { return b.code === A.sel; })) A.sel = (pending[0] || active[0] || {}).code || null;
    var selB = S.bookings.find(function (b) { return b.code === A.sel; });
    var keepMap = $('#amap');

    var card = function (b) {
      var off = b.offer && b.offer.driverId ? S.drivers.find(function (d) { return d.id === b.offer.driverId; }) : null;
      var drv = S.drivers.find(function (d) { return d.id === b.driverId; });
      var info = b.status === 'pending'
        ? (off ? '<span class="pill st-offered">' + t('offeredTo', { name: esc(off.name), s: Math.max(0, Math.round((b.offer.expires - now) / 1000)) }) + '</span>'
          : '<span class="pill st-pending">' + (b.offer && b.offer.broadcast ? t('openToAll') : t('waitingManual')) + '</span>')
        : (drv ? '<span class="fine">' + esc(drv.name) + '</span>' : '');
      return '<li><button class="disp-card' + (b.code === A.sel ? ' on' : '') + '" data-sel="' + esc(b.code) + '"><span class="mono">' + esc(b.code) + '</span>' + App.statusPill(b.status) +
        '<strong class="num">' + App.money(b.price) + '</strong><span class="r">' + esc(b.pickup.name) + ' → ' + esc(b.dropoff.asDirected ? t('asDirected') : b.dropoff.name) + '</span>' +
        '<span class="fine">' + esc(App.fmtTime(b.when)) + ' · ' + esc(b.vehicle ? b.vehicle.name : '') + '</span>' + info + '</button></li>';
    };
    var detail = '';
    if (selB) {
      var cands = selB.candidates || [];
      detail = '<div class="panel"><div class="panel-head"><h3>' + esc(selB.code) + ' · ' + esc(selB.customer.name) + '</h3><button class="btn sm" data-open="' + esc(selB.code) + '">' + t('details') + '</button></div>' +
        (selB.status === 'pending' ? '<p class="fine">' + t('candidatesHint') + '</p>' + (cands.length ? '<ol class="cands">' + cands.map(function (c, i) {
          return '<li><b>' + (i + 1) + '</b><span>' + esc(c.name) + (c.rating ? ' · ★ ' + c.rating : '') + '</span><span class="fine">' + (c.eta != null ? t('etaMin', { n: c.eta }) + ' · ' + t('milesN', { n: c.miles }) : t('noGps')) + '</span>' +
            '<button class="btn sm" data-assign="' + esc(selB.code) + '" data-drv="' + esc(c.driverId) + '">' + t('assign') + '</button></li>';
        }).join('') + '</ol>' : '<p class="note bad">' + t('noCandidates') + '</p>') +
          '<div class="row"><button class="btn sm ghost" data-redispatch="' + esc(selB.code) + '">' + t('redispatch') + '</button></div>' : '') + '</div>';
    }
    $('#adm').innerHTML =
      '<div class="kpis four">' + App.kpi(t('kPending'), pending.length, '', 'hourglass') + App.kpi(t('kActive'), active.length, '', 'car') + App.kpi(t('kOnline'), online.length + ' / ' + S.drivers.length, '', 'users') +
        App.kpi(t('kToday'), today.length, App.money(today.reduce(function (s, b) { return s + (b.price || 0); }, 0)), 'calendar') + '</div>' +
      '<div class="dispatch-grid"><div class="col">' +
        panel(t('needsDriver') + ' <b class="badge">' + pending.length + '</b>', pending.length ? '<ul class="disp-list">' + pending.map(card).join('') + '</ul>' : '<p class="muted">' + t('allAssigned') + '</p>') +
        panel(t('onTheRoad'), active.length ? '<ul class="disp-list">' + active.map(card).join('') + '</ul>' : '<p class="muted">' + t('nothingYet') + '</p>') +
      '</div><div class="col"><div class="map tall" id="amap"></div>' + detail +
        panel(t('tab_drivers'), '<ul class="drv-list">' + S.drivers.map(function (d) {
          var state = !d.active ? 'off' : !d.online ? 'off' : d.busy ? 'busy' : 'free';
          return '<li><i class="dot ' + state + '"></i><span>' + esc(d.name) + '</span><span class="fine">' + esc(d.vehicles.map(function (id) { var x = S.settings.vehicles.find(function (y) { return y.id === id; }); return x ? x.name : id; }).join(', ')) + '</span><span class="pill">' + t('ds_' + state) + '</span>' +
            (d.location ? '<span class="fine">' + t('gpsAgo', { n: Math.max(0, Math.round((now - d.location.at) / 60000)) }) + '</span>' : '<span class="fine">' + t('noGps') + '</span>') + '</li>';
        }).join('') + '</ul>') +
      '</div></div>';
    var pts = { pickup: selB ? selB.pickup : null, dropoff: selB && !selB.dropoff.asDirected ? selB.dropoff : null,
      drivers: S.drivers.filter(function (d) { return d.location; }).map(function (d) { return { name: d.name, location: d.location, busy: d.busy }; }) };
    if (keepMap && A.map) { $('#amap').replaceWith(keepMap); A.map.update(pts); if (A.map.map) A.map.map.invalidateSize(); }
    else A.map = App.mapView($('#amap'), pts);
    bindBookingActions();
    $$('[data-sel]').forEach(function (b) { b.onclick = function () { A.sel = b.dataset.sel; render(); }; });
  };

  function bindBookingActions() {
    $$('[data-assign]').forEach(function (b) { b.onclick = function () { call('POST', '/api/admin/bookings/' + b.dataset.assign, { action: 'assign', driverId: b.dataset.drv }).then(function (r) { done(r, t('assigned')); }); }; });
    $$('[data-redispatch]').forEach(function (b) { b.onclick = function () { call('POST', '/api/admin/bookings/' + b.dataset.redispatch, { action: 'redispatch' }).then(function (r) { done(r, t('redispatched')); }); }; });
    $$('[data-open]').forEach(function (b) { b.onclick = function () { bookingSheet(b.dataset.open); }; });
  }

  // ================= bookings =================
  R.bookings = function () {
    var S = A.st, F = { active: ['pending', 'accepted', 'enroute', 'arrived', 'ontrip'], done: ['completed'], cancelled: ['cancelled'], all: null };
    var q = A.q.toLowerCase();
    var list = S.bookings.filter(function (b) {
      if (F[A.filter] && F[A.filter].indexOf(b.status) < 0) return false;
      if (A.filter === 'unpaid' && (b.payStatus === 'paid' || b.status === 'cancelled')) return false;
      return !q || [b.code, b.customer.name, b.customer.phone, b.pickup.name, b.dropoff.name].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var drvName = function (id) { var d = S.drivers.find(function (x) { return x.id === id; }); return d ? d.name : '—'; };
    $('#adm').innerHTML = '<div class="toolbar"><div class="chips">' + ['active', 'done', 'unpaid', 'cancelled', 'all'].map(function (f) {
        return '<button class="chip" data-f="' + f + '" aria-pressed="' + (A.filter === f) + '">' + t('f_' + f) + '</button>';
      }).join('') + '</div><input id="bq" type="search" placeholder="' + esc(t('searchPh')) + '" value="' + esc(A.q) + '"></div>' +
      panel(t('tab_bookings') + ' <b class="badge">' + list.length + '</b>', table(
        [t('booking'), t('when'), t('customer'), t('route'), t('vehicle'), t('driver'), t('total'), t('payment'), t('status')],
        list.slice(0, 200).map(function (b) {
          return '<tr class="click" data-open="' + esc(b.code) + '"><td class="mono">' + esc(b.code) + (b.seriesId ? ' <span class="pill">↻</span>' : '') + '</td><td>' + esc(App.fmtTime(b.when)) + '</td><td>' + esc(b.customer.name) +
            (b.company ? '<br><small>' + esc(b.company) + '</small>' : '') + '</td><td>' + esc(b.pickup.name) + '<br><small>→ ' + esc(b.dropoff.asDirected ? t('asDirected') : b.dropoff.name) + '</small></td><td>' +
            esc(b.vehicle ? b.vehicle.name : '') + '</td><td>' + esc(drvName(b.driverId)) + '</td><td class="num">' + App.money(b.price) + '</td><td>' + App.payName(b.payMethod) + '<br>' + App.payPill(b) + '</td><td>' + App.statusPill(b.status) + '</td></tr>';
        }), t('noRides')));
    $$('[data-f]').forEach(function (b) { b.onclick = function () { A.filter = b.dataset.f; render(); }; });
    var bq = $('#bq');
    bq.oninput = function () { A.q = bq.value; var pos = bq.selectionStart; render(); var nb = $('#bq'); nb.focus(); nb.setSelectionRange(pos, pos); };
    $$('tr[data-open]').forEach(function (r) { r.onclick = function () { bookingSheet(r.dataset.open); }; });
  };

  function bookingSheet(code) {
    var S = A.st, b = S.bookings.find(function (x) { return x.code === code; });
    if (!b) return;
    var drvOpts = [['', t('unassigned')]].concat(S.drivers.filter(function (d) { return d.active; }).map(function (d) { return [d.id, d.name + (d.vehicles.indexOf(b.vehicleId) < 0 ? ' (' + t('otherVehicle') + ')' : '')]; }));
    var f = b.flight || {};
    App.openSheet('<h2>' + esc(b.code) + ' ' + App.statusPill(b.status) + '</h2>' +
      '<dl class="summary">' +
        '<dt>' + t('customer') + '</dt><dd>' + esc(b.customer.name) + ' · <a href="tel:' + esc(b.customer.phone) + '">' + esc(b.customer.phone) + '</a>' + (b.customer.email ? ' · ' + esc(b.customer.email) : '') + '</dd>' +
        '<dt>' + t('service') + '</dt><dd>' + App.serviceName(b.service) + (b.tripType === 'round' ? ' · ' + t('roundTrip') : '') + ' · ' + esc(b.vehicle ? b.vehicle.name : '') + '</dd>' +
        '<dt>' + t('route') + '</dt><dd>' + esc(b.pickup.name) + ' → ' + esc(b.dropoff.asDirected ? t('asDirected') : b.dropoff.name) + (b.miles ? ' · ' + t('milesN', { n: Math.round(b.miles) }) : '') + '</dd>' +
        '<dt>' + t('when') + '</dt><dd>' + esc(App.fmtTime(b.when)) + (b.returnWhen ? ' · ' + t('returnTime') + ' ' + esc(App.fmtTime(b.returnWhen)) : '') + '</dd>' +
        '<dt>' + t('passengers') + '</dt><dd>' + b.passengers + ' · ' + t('bagsN', { n: b.bags }) + (b.childSeats ? ' · ' + t('childSeatsN', { n: b.childSeats }) : '') + (b.meetGreet ? ' · ' + t('meetGreetShort') : '') + '</dd>' +
        '<dt>' + t('source') + '</dt><dd>' + esc(b.source) + (b.promoCode ? ' · ' + esc(b.promoCode) : '') + (b.referral ? ' · ' + t('referral') : '') + '</dd>' +
        (b.notes ? '<dt>' + t('notes') + '</dt><dd>' + esc(b.notes) + '</dd>' : '') +
        (b.rating ? '<dt>' + t('rating') + '</dt><dd>★ ' + b.rating.driver + ' / ★ ' + b.rating.ride + (b.rating.comment ? ' · “' + esc(b.rating.comment) + '”' : '') + '</dd>' : '') +
      '</dl>' + App.breakdownHtml(b.breakdown, b.price) +
      '<div class="grid2">' + sel('bDrv', t('driver'), drvOpts, b.driverId || '') + sel('bSt', t('status'), window.TR.core.FLOW.map(function (s) { return [s, t('st_' + s)]; }), b.status) + '</div>' +
      '<div class="grid2">' + fld('bPrice', t('priceOverride'), b.price, 'number', ' step="0.01" min="0"') +
        '<div class="fld"><span>' + App.payName(b.payMethod) + ' ' + App.payPill(b) + '</span><button class="btn" id="bPaid">' + (b.payStatus === 'paid' ? t('markUnpaid') : t('markPaid')) + '</button></div></div>' +
      (b.service === 'airport' ? '<fieldset class="fs"><legend>✈ ' + t('flight') + '</legend><div class="grid3">' + fld('fNum', t('flightNo'), f.number || '') +
        sel('fSt', t('flightStatus'), ['scheduled', 'active', 'landed', 'delayed', 'cancelled'].map(function (s) { return [s, t('fl_' + s)]; }), f.status || 'scheduled') +
        fld('fArr', t('lands'), f.estimatedArr ? App.localInput(f.estimatedArr) : '', 'datetime-local') + '</div>' + chk('fIntl', t('international'), f.international) +
        '<p class="fine">' + t('flightPolicyHint', { d: S.settings.flight.graceDomestic, i: S.settings.flight.graceIntl }) + '</p><button class="btn sm" id="fSave">' + t('updateFlight') + '</button></fieldset>' : '') +
      '<div class="sheet-actions">' + (b.status !== 'cancelled' && b.status !== 'completed' ? '<button class="btn ghost danger" id="bCancel">' + t('cancelRide') + '</button>' : '') +
        '<button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="bSave">' + t('save') + '</button></div>', true);
    var post = function (body) { return call('POST', '/api/admin/bookings/' + code, body); };
    $('#bSave').onclick = function () {
      var jobs = [];
      if (v('bDrv') !== (b.driverId || '')) jobs.push({ action: 'assign', driverId: v('bDrv') || null });
      if (v('bSt') !== b.status) jobs.push({ action: 'status', status: v('bSt') });
      if (v('bPrice') !== '' && n('bPrice') !== b.price) jobs.push({ action: 'price', price: n('bPrice') });
      var run = function (i) { if (i >= jobs.length) return done({ status: 200 }); post(jobs[i]).then(function (r) { if (r.status !== 200) return done(r); run(i + 1); }); };
      run(0);
    };
    $('#bPaid').onclick = function () { post({ action: b.payStatus === 'paid' ? 'unpaid' : 'paid' }).then(function (r) { done(r); }); };
    var c = $('#bCancel'); if (c) c.onclick = function () { App.confirm(t('cancelQ'), '', t('cancelRide'), function () { post({ action: 'cancel' }).then(function (r) { done(r); }); }, true); };
    var fs = $('#fSave');
    if (fs) fs.onclick = function () {
      var arr = v('fArr') ? new Date(v('fArr')).toISOString() : null;
      post({ action: 'flight', flight: { number: v('fNum').toUpperCase(), status: v('fSt'), estimatedArr: arr, scheduledArr: f.scheduledArr || arr, international: v('fIntl') } }).then(function (r) { done(r, t('flightUpdated')); });
    };
  }

  // ================= analytics =================
  var tip;
  function bindTips(root) {
    tip = tip || (function () { var d = document.createElement('div'); d.className = 'chart-tip'; d.hidden = true; document.body.appendChild(d); return d; })();
    $$('[data-tip]', root).forEach(function (el) {
      var show = function (e) {
        tip.innerHTML = el.dataset.tip; tip.hidden = false;
        var r = el.getBoundingClientRect(), x = e && e.clientX != null ? e.clientX : r.left + r.width / 2;
        tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, x - tip.offsetWidth / 2)) + 'px';
        tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
      };
      el.addEventListener('mousemove', show); el.addEventListener('focus', show);
      el.addEventListener('mouseleave', function () { tip.hidden = true; }); el.addEventListener('blur', function () { tip.hidden = true; });
    });
  }
  function barChart(rows, valKey, fmt, labelFn) {
    var max = Math.max.apply(null, rows.map(function (r) { return r[valKey]; }).concat([1]));
    var W = 640, H = 180, pad = 22, bw = (W - pad) / rows.length;
    var out = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 24) + '" role="img" aria-label="' + esc(t('dailyRevenue')) + '">';
    [0.5, 1].forEach(function (g) { var y = H - (H - 10) * g; out += '<line class="gridline" x1="' + pad + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text class="axis" x="0" y="' + (y + 4) + '">' + fmt(max * g).replace('$', '') + '</text>'; });
    out += '<line class="baseline" x1="' + pad + '" x2="' + W + '" y1="' + H + '" y2="' + H + '"/>';
    rows.forEach(function (r, i) {
      var h = Math.max(r[valKey] ? 2 : 0, (H - 10) * r[valKey] / max), x = pad + i * bw + bw * 0.15, w = Math.max(2, bw * 0.7);
      out += '<g tabindex="0" data-tip="' + esc('<b>' + labelFn(r) + '</b><br>' + fmt(r[valKey]) + (r.bookings != null ? ' · ' + t('bookingsN', { n: r.bookings }) : '')) + '">' +
        '<rect class="hit" x="' + (pad + i * bw) + '" y="0" width="' + bw + '" height="' + H + '"/>' +
        (h ? '<path class="bar" d="M' + x + ' ' + H + 'V' + (H - h + Math.min(4, h)) + 'q0 -' + Math.min(4, h) + ' ' + Math.min(4, w / 2) + ' -' + Math.min(4, h) + 'H' + (x + w - Math.min(4, w / 2)) + 'q' + Math.min(4, w / 2) + ' 0 ' + Math.min(4, w / 2) + ' ' + Math.min(4, h) + 'V' + H + 'z"/>' : '') + '</g>';
      if (rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0) out += '<text class="axis" text-anchor="middle" x="' + (pad + i * bw + bw / 2) + '" y="' + (H + 18) + '">' + esc(labelFn(r, true)) + '</text>';
    });
    return out + '</svg>';
  }
  function hbars(rows, label, val, fmt) {
    var max = Math.max.apply(null, rows.map(val).concat([1]));
    return '<ul class="hbars">' + rows.map(function (r) {
      return '<li tabindex="0" data-tip="' + esc('<b>' + esc(label(r)) + '</b><br>' + fmt(val(r))) + '"><span class="lbl">' + esc(label(r)) + '</span><span class="track"><i style="--w:' + (val(r) / max * 100) + '%"></i></span><span class="num">' + fmt(val(r)) + '</span></li>';
    }).join('') + '</ul>';
  }
  function heatmap(heat) {
    var max = Math.max.apply(null, heat.map(function (r) { return Math.max.apply(null, r); }).concat([1]));
    var out = '<div class="heat" role="table" aria-label="' + esc(t('demandHeat')) + '"><div class="heat-row head"><span></span>';
    for (var h = 0; h < 24; h++) out += '<span class="hl">' + (h % 3 === 0 ? esc(App.hourName(h)) : '') + '</span>';
    out += '</div>';
    heat.forEach(function (row, d) {
      out += '<div class="heat-row"><span class="dl">' + esc(App.dayName(d)) + '</span>';
      row.forEach(function (x, hh) {
        var lvl = x ? Math.min(5, Math.ceil(x / max * 5)) : 0;
        out += '<span class="cell h' + lvl + '" tabindex="-1" data-tip="' + esc('<b>' + App.dayName(d) + ' ' + App.hourName(hh) + '</b><br>' + t('bookingsN', { n: x })) + '"></span>';
      });
      out += '</div>';
    });
    return out + '<div class="heat-legend"><span>' + t('fewer') + '</span>' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<span class="cell h' + i + '"></span>'; }).join('') + '<span>' + t('more') + '</span></div></div>';
  }
  function insightText(x) {
    var p = Object.assign({}, x.p);
    if (x.k === 'peakTime') { p.day = App.dayName(p.day); p.hour = App.hourName(p.hour); }
    ['rev'].forEach(function (k) { if (p[k] != null) p[k] = App.money(p[k]); });
    return t('ins_' + x.k, p);
  }

  R.analytics = function () {
    var a = A.an, T = a.totals;
    var dayLabel = function (r, short) { var d = new Date(r.date + 'T12:00:00'); return short ? d.getDate() + '' : App.date(d.getTime()); };
    $('#adm').innerHTML = '<div class="toolbar"><div class="chips">' + [7, 30, 90].map(function (d) { return '<button class="chip" data-days="' + d + '" aria-pressed="' + (A.days === d) + '">' + t('lastDays', { n: d }) + '</button>'; }).join('') + '</div>' +
        (A.st.features.ai && App.API.mode === 'server' ? '<button class="btn sm" id="aiIns">✦ ' + t('aiInsights') + '</button>' : '') + '</div>' +
      '<div class="kpis five">' + App.kpi(t('revenue'), App.money(T.revenue), '', 'wallet') + App.kpi(t('bookings'), T.bookings, t('completedN', { n: T.completed }), 'list') + App.kpi(t('avgFare'), App.money(T.avgFare), '', 'tag') +
        App.kpi(t('qrScans'), T.scans, '', 'qr') + App.kpi(t('avgRating'), T.avgRating ? '★ ' + T.avgRating : '—', t('repeatN', { n: T.repeatCustomers, total: T.customers }), 'star') + '</div>' +
      '<div id="aiBox"></div>' +
      panel('✦ ' + t('insights'), a.insights.length ? '<ul class="insights">' + a.insights.map(function (x) { return '<li class="ins-' + x.k + '">' + esc(insightText(x)) + '</li>'; }).join('') + '</ul>' : '<p class="muted">' + t('notEnoughData') + '</p>') +
      panel(t('dailyRevenue'), barChart(a.daily, 'revenue', App.money, dayLabel)) +
      '<div class="two">' + panel(t('demandHeat'), heatmap(a.heat)) + panel(t('topAreas'), a.topAreas.length ? hbars(a.topAreas, function (r) { return r.name; }, function (r) { return r.total; }, String) : '<p class="muted">' + t('nothingYet') + '</p>') + '</div>' +
      panel(t('marketingPerf'), sourceTable(a.sources)) +
      '<div class="two">' + panel(t('tab_drivers'), table([t('driver'), t('rides'), t('revenue'), t('rating'), t('acceptRate')], a.drivers.map(function (d) {
          return '<tr><td>' + esc(d.name) + '</td><td class="num">' + d.completed + '/' + d.rides + '</td><td class="num">' + App.money(d.revenue) + '</td><td class="num">' + (d.rating ? '★ ' + d.rating + ' <small>(' + d.ratings + ')</small>' : '—') + '</td><td class="num">' + (d.acceptRate != null ? d.acceptRate + '%' : '—') + '</td></tr>';
        })) ) +
        panel(t('vehiclePerf'), table([t('vehicle'), t('rides'), t('revenue'), t('avgFare')], a.vehicles.map(function (x) {
          return '<tr><td>' + esc(x.name) + '</td><td class="num">' + x.rides + '</td><td class="num">' + App.money(x.revenue) + '</td><td class="num">' + App.money(x.avgFare) + '</td></tr>';
        }))) + '</div>' +
      panel(t('serviceMix'), hbars(Object.keys(a.services).map(function (k) { return { k: k, n: a.services[k] }; }), function (r) { return App.serviceName(r.k); }, function (r) { return r.n; }, String));
    bindTips($('#adm'));
    $$('[data-days]').forEach(function (b) { b.onclick = function () { A.days = +b.dataset.days; reload(); }; });
    var ai = $('#aiIns');
    if (ai) ai.onclick = function () {
      ai.disabled = true; $('#aiBox').innerHTML = '<p class="muted">' + t('thinking') + '</p>';
      call('POST', '/api/admin/ai-insights', { days: A.days, lang: App.lang }).then(function (r) {
        ai.disabled = false;
        $('#aiBox').innerHTML = r.status === 200 ? panel('✦ ' + t('aiInsights'), '<div class="ai-text">' + esc(r.body.text).replace(/\n/g, '<br>') + '</div>') : '<p class="note bad">' + App.errText(r) + '</p>';
      });
    };
  };
  function sourceTable(sources) {
    return table([t('campaign'), t('channel'), t('qrScans'), t('bookings'), t('conversion'), t('revenue'), t('revPerScan')], sources.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td>' + esc(t('ch_' + s.channel) === 'ch_' + s.channel ? s.channel : t('ch_' + s.channel)) + '</td><td class="num">' + s.scans + '</td><td class="num">' + s.bookings + '</td><td class="num">' + (s.conv != null ? s.conv + '%' : '—') +
        '</td><td class="num">' + App.money(s.revenue) + '</td><td class="num">' + (s.revPerScan != null ? App.money(s.revPerScan) : '—') + '</td></tr>';
    }));
  }

  // ================= marketing (QR campaigns) =================
  R.marketing = function () {
    var S = A.st, stats = {};
    A.an.sources.forEach(function (s) { stats[s.id] = s; });
    $('#adm').innerHTML = '<div class="toolbar"><p class="fine grow">' + t('qrHelp') + '</p><button class="btn primary sm" id="newCamp">+ ' + t('newCampaign') + '</button></div>' +
      '<div class="camp-grid">' + S.campaigns.map(function (c) {
        var s = stats[c.id] || { scans: 0, bookings: 0, revenue: 0, conv: null }, url = App.bookUrl(c.id), p = c.presets || {};
        var presets = [p.service && App.serviceName(p.service), p.pickupId && placeName(p.pickupId), p.dropoffId && '→ ' + placeName(p.dropoffId), p.vehicleId && vehName(p.vehicleId), p.promo && '🏷 ' + p.promo].filter(Boolean);
        return '<article class="camp"><div class="bizcard"><div><strong>' + esc(App.cfg.brand.name) + '</strong><span>' + esc(c.welcome || App.cfg.brand.tagline) + '</span><span class="ph">' + esc(App.cfg.brand.phone) + '</span><em>' + t('scanToBook') + '</em></div>' + qrSvg(url) + '</div>' +
          '<div class="camp-body"><h3>' + esc(c.name) + ' <span class="pill">' + esc(t('ch_' + c.channel)) + '</span></h3>' +
          (presets.length ? '<p class="fine">' + t('opensWith') + ' ' + esc(presets.join(' · ')) + '</p>' : '<p class="fine">' + t('noPresets') + '</p>') +
          '<div class="camp-stats"><div><small>' + t('qrScans') + '</small><b>' + s.scans + '</b></div><div><small>' + t('bookings') + '</small><b>' + s.bookings + '</b></div><div><small>' + t('conversion') + '</small><b>' + (s.conv != null ? s.conv + '%' : '—') + '</b></div><div><small>' + t('revenue') + '</small><b>' + App.money(s.revenue) + '</b></div></div>' +
          '<input class="mono url" readonly value="' + esc(url) + '" aria-label="' + esc(t('link')) + '">' +
          '<div class="row"><button class="btn sm" data-copyurl="' + esc(url) + '">' + t('copyLink') + '</button>' +
            (App.API.mode === 'server' ? '<button class="btn sm" data-dl="card" data-c="' + esc(c.id) + '">' + t('dlCard') + '</button><button class="btn sm" data-dl="sticker" data-c="' + esc(c.id) + '">' + t('dlSticker') + '</button>' : '') +
            '<button class="btn sm ghost" data-edit="' + esc(c.id) + '">' + t('edit') + '</button></div></div></article>';
      }).join('') + '</div>' + panel(t('marketingPerf') + ' · ' + t('allTime'), sourceTable(A.an.sources));
    $('#newCamp').onclick = function () { campSheet(null); };
    $$('[data-copyurl]').forEach(function (b) { b.onclick = function () { App.copy(b.dataset.copyurl); }; });
    $$('[data-edit]').forEach(function (b) { b.onclick = function () { campSheet(S.campaigns.find(function (c) { return c.id === b.dataset.edit; })); }; });
    $$('[data-dl]').forEach(function (b) { b.onclick = function () { downloadPrint(S.campaigns.find(function (c) { return c.id === b.dataset.c; }), b.dataset.dl); }; });
  };
  function placeName(id) { var p = A.st.settings.places.find(function (x) { return x.id === id; }); return p ? p.name : id; }
  function vehName(id) { var x = A.st.settings.vehicles.find(function (y) { return y.id === id; }); return x ? x.name : id; }
  function campSheet(c) {
    var p = (c && c.presets) || {};
    App.openSheet('<h2>' + (c ? t('editCampaign') : t('newCampaign')) + '</h2>' +
      '<div class="grid2">' + fld('cName', t('campaignName'), c ? c.name : '', 'text', ' required placeholder="' + esc(t('campaignPh')) + '"') + sel('cCh', t('channel'), CHANNELS.map(function (x) { return [x, t('ch_' + x)]; }), c ? c.channel : 'card') + '</div>' +
      fld('cWel', t('welcomeMsg'), c ? c.welcome : '', 'text', ' placeholder="' + esc(t('welcomePh')) + '"') +
      '<fieldset class="fs"><legend>' + t('presets') + '</legend><p class="fine">' + t('presetsHint') + '</p><div class="grid2">' +
        sel('pSvc', t('service'), svcOpts(true), p.service || '') + sel('pVeh', t('vehicle'), vehOpts(true), p.vehicleId || '') +
        sel('pPick', t('pickup'), placeOpts(true), p.pickupId || '') + sel('pDrop', t('dropoff'), placeOpts(true), p.dropoffId || '') +
        sel('pPromo', t('promoCode'), [['', '—']].concat(A.st.promos.map(function (x) { return [x.code, x.code]; })), p.promo || '') + '</div></fieldset>' +
      '<div class="sheet-actions">' + (c ? '<button class="btn ghost danger" id="cDel">' + t('delete') + '</button>' : '') + '<button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="cSave">' + t('save') + '</button></div>', true);
    $('#cSave').onclick = function () {
      if (!v('cName')) return App.toast(t('err_campaign'), 'bad');
      var presets = {}; [['service', 'pSvc'], ['vehicleId', 'pVeh'], ['pickupId', 'pPick'], ['dropoffId', 'pDrop'], ['promo', 'pPromo']].forEach(function (x) { if (v(x[1])) presets[x[0]] = v(x[1]); });
      call('POST', '/api/admin/campaigns', { id: c ? c.id : '', name: v('cName'), channel: v('cCh'), welcome: v('cWel'), presets: presets }).then(function (r) { done(r); App.reloadConfig && App.reloadConfig(); });
    };
    var d = $('#cDel');
    if (d) d.onclick = function () { App.confirm(t('deleteQ', { name: c.name }), t('deleteCampHint'), t('delete'), function () { call('DELETE', '/api/admin/campaigns/' + c.id).then(function (r) { done(r); }); }, true); };
  }

  // ================= drivers =================
  R.drivers = function () {
    var S = A.st;
    $('#adm').innerHTML = panel(t('tab_drivers'), table([t('name'), t('phone'), 'PIN', t('plate'), t('vehicles'), t('status'), t('rating'), t('acceptRate'), ''], S.drivers.map(function (d) {
      var st = d.stats || {}, rate = st.offered ? Math.round((st.accepted || 0) / st.offered * 100) + '%' : '—';
      return '<tr><td>' + esc(d.name) + '</td><td>' + esc(d.phone) + '</td><td class="mono">' + esc(d.pin) + '</td><td class="mono">' + esc(d.plate) + '</td><td>' + esc(d.vehicles.map(vehName).join(', ')) + '</td>' +
        '<td><span class="pill">' + (!d.active ? t('inactive') : d.online ? (d.busy ? t('ds_busy') : t('ds_free')) : t('ds_off')) + '</span></td><td class="num">' + (d.rating ? '★ ' + d.rating : '—') + '</td><td class="num">' + rate + '</td>' +
        '<td><button class="btn sm ghost" data-ed="' + esc(d.id) + '">' + t('edit') + '</button></td></tr>';
    })), '<button class="btn primary sm" id="addDrv">+ ' + t('addDriver') + '</button>') +
      '<p class="fine">' + t('driverAppHint') + ' <a href="#driver">#driver</a></p>';
    $('#addDrv').onclick = function () { driverSheet(null); };
    $$('[data-ed]').forEach(function (b) { b.onclick = function () { driverSheet(S.drivers.find(function (d) { return d.id === b.dataset.ed; })); }; });
  };
  function driverSheet(d) {
    var S = A.st;
    App.openSheet('<h2>' + (d ? esc(d.name) : t('addDriver')) + '</h2><div class="grid2">' + fld('dName', t('name'), d ? d.name : '') + fld('dPhone', t('phone'), d ? d.phone : '', 'tel') +
      fld('dPin', t('pinHint'), d ? d.pin : '', 'text', ' inputmode="numeric" pattern="\\d{4,8}"') + fld('dPlate', t('plate'), d ? d.plate : '') + '</div>' +
      '<fieldset class="fs"><legend>' + t('vehicles') + '</legend><div class="checks">' + S.settings.vehicles.map(function (x) { return chk('dv-' + x.id, esc(x.name), d && d.vehicles.indexOf(x.id) >= 0); }).join('') + '</div></fieldset>' +
      chk('dAct', t('active'), !d || d.active) +
      '<div class="sheet-actions">' + (d ? '<button class="btn ghost danger" id="dDel">' + t('delete') + '</button>' : '') + '<button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="dSave">' + t('save') + '</button></div>', true);
    $('#dSave').onclick = function () {
      call('POST', '/api/admin/drivers', { id: d ? d.id : '', name: v('dName'), phone: v('dPhone'), pin: v('dPin'), plate: v('dPlate'), active: v('dAct'),
        vehicles: S.settings.vehicles.filter(function (x) { return v('dv-' + x.id); }).map(function (x) { return x.id; }) }).then(function (r) { done(r); });
    };
    var del = $('#dDel');
    if (del) del.onclick = function () { App.confirm(t('deleteQ', { name: d.name }), t('deleteDriverHint'), t('delete'), function () { call('DELETE', '/api/admin/drivers/' + d.id).then(function (r) { done(r); }); }, true); };
  }

  // ================= fleet & pricing =================
  R.fleet = function () {
    var S = A.st.settings, P = S.pricing;
    $('#adm').innerHTML = panel(t('fleet'), '<div class="fleet-grid">' + S.vehicles.map(function (x, i) {
        return '<button class="fleet-card' + (x.active ? '' : ' off') + '" data-veh="' + i + '"><div class="art">' + App.vehicleArt(x) + '</div><strong>' + esc(x.name) + '</strong><span class="fine">' +
          t('seatsN', { n: x.seats }) + ' · ' + t('bagsN', { n: x.bags }) + '</span><span class="fine">' + App.money(x.base) + ' + ' + App.money(x.perMile) + '/mi · ' + App.money(x.hourly) + '/h</span>' + (x.active ? '' : '<span class="pill">' + t('inactive') + '</span>') + '</button>';
      }).join('') + '<button class="fleet-card add" data-veh="new"><span>+</span>' + t('addVehicle') + '</button></div>') +
      panel(t('pricingRules'), '<p class="fine">' + t('pricingHint') + '</p>' +
        '<div class="grid4">' + fld('nightPct', t('nightPct'), P.nightPct, 'number') + fld('nightStart', t('nightStart'), P.nightStart, 'number', ' min="0" max="23"') + fld('nightEnd', t('nightEnd'), P.nightEnd, 'number', ' min="0" max="23"') +
          fld('weekendPct', t('weekendPct'), P.weekendPct, 'number') + fld('eventPct', t('eventPct'), P.eventPct, 'number') + fld('roundTripDiscountPct', t('roundPct'), P.roundTripDiscountPct, 'number') +
          fld('paxIncluded', t('paxIncluded'), P.paxIncluded, 'number') + fld('extraPassengerFee', t('extraPax'), P.extraPassengerFee, 'number') + fld('childSeatFee', t('childSeatFee'), P.childSeatFee, 'number') +
          fld('meetGreetFee', t('meetGreetFee'), P.meetGreetFee, 'number') + fld('timezone', t('timezone'), P.timezone) + '</div>' +
        '<fieldset class="fs"><legend>' + t('peakHours') + '</legend><div id="peaks">' + (P.peaks || []).map(peakRow).join('') + '</div><button class="btn sm ghost" id="addPeak">+ ' + t('addPeak') + '</button></fieldset>' +
        '<p class="fine">' + t('zoneFeeHint') + ' <a href="#admin-places">' + t('tab_places') + '</a></p>' +
        '<div class="row end"><button class="btn primary" id="savePricing">' + t('save') + '</button></div>');
    $$('[data-veh]').forEach(function (b) { b.onclick = function () { vehicleSheet(b.dataset.veh === 'new' ? null : +b.dataset.veh); }; });
    $('#addPeak').onclick = function () { $('#peaks').insertAdjacentHTML('beforeend', peakRow({ days: [1, 2, 3, 4, 5], from: 7, to: 9, pct: 10 })); };
    $('#peaks').onclick = function (e) { var x = e.target.closest('[data-rmpeak]'); if (x) x.closest('.peak').remove(); };
    $('#savePricing').onclick = function () {
      var out = {};
      ['nightPct', 'nightStart', 'nightEnd', 'weekendPct', 'eventPct', 'roundTripDiscountPct', 'paxIncluded', 'extraPassengerFee', 'childSeatFee', 'meetGreetFee'].forEach(function (k) { out[k] = n(k); });
      out.timezone = v('timezone') || 'America/Chicago';
      out.peaks = $$('.peak').map(function (row) {
        return { days: $$('[data-day]', row).filter(function (c) { return c.checked; }).map(function (c) { return +c.dataset.day; }),
          from: +$('[data-k=from]', row).value, to: +$('[data-k=to]', row).value, pct: +$('[data-k=pct]', row).value };
      }).filter(function (p) { return p.days.length && p.pct; });
      call('PUT', '/api/admin/settings', { pricing: out }).then(function (r) { done(r); });
    };
  };
  function peakRow(p) {
    var days = ''; for (var d = 0; d < 7; d++) days += '<label class="daychk"><input type="checkbox" data-day="' + d + '"' + (p.days.indexOf(d) >= 0 ? ' checked' : '') + '><span>' + esc(App.dayName(d)) + '</span></label>';
    return '<div class="peak"><div class="days">' + days + '</div><label>' + t('from') + ' <input type="number" data-k="from" min="0" max="23" value="' + p.from + '"></label><label>' + t('to') + ' <input type="number" data-k="to" min="1" max="24" value="' + p.to + '"></label>' +
      '<label>+<input type="number" data-k="pct" value="' + p.pct + '">%</label><button class="link" data-rmpeak>' + t('remove') + '</button></div>';
  }
  function vehicleSheet(i) {
    var list = A.st.settings.vehicles, x = i == null ? { id: '', name: '', icon: 'sedan', image: '', seats: 4, bags: 3, base: 30, perMile: 3.5, minFare: 70, hourly: 80, minHours: 2, active: true, desc: '', features: [] } : list[i];
    var img = x.image;
    App.openSheet('<h2>' + (i == null ? t('addVehicle') : esc(x.name)) + '</h2>' +
      '<div class="veh-edit"><div class="art" id="vArt">' + App.vehicleArt(x) + '</div><div><label class="btn sm"><input type="file" id="vImg" accept="image/*" hidden>' + t('uploadPhoto') + '</label> <button class="link" id="vNoImg">' + t('remove') + '</button>' +
        sel('vIcon', t('illustration'), App.ICONS.map(function (k) { return [k, k]; }), x.icon) + '</div></div>' +
      '<div class="grid2">' + fld('vName', t('name'), x.name) + fld('vDesc', t('description'), x.desc) + '</div>' + fld('vFeat', t('featuresComma'), (x.features || []).join(', ')) +
      '<div class="grid4">' + fld('vSeats', t('seats'), x.seats, 'number') + fld('vBags', t('bags'), x.bags, 'number') + fld('vBase', t('baseFare'), x.base, 'number', ' step="0.5"') + fld('vMile', t('perMile'), x.perMile, 'number', ' step="0.1"') +
        fld('vMin', t('minFare'), x.minFare, 'number') + fld('vHour', t('perHour'), x.hourly, 'number') + fld('vMinH', t('minHours'), x.minHours, 'number') + '</div>' + chk('vAct', t('activeVehicle'), x.active) +
      '<div class="sheet-actions">' + (i != null ? '<button class="btn ghost danger" id="vDel">' + t('delete') + '</button>' : '') + '<button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="vSave">' + t('save') + '</button></div>', true);
    var art = function () { $('#vArt').innerHTML = App.vehicleArt({ image: img, icon: v('vIcon'), name: v('vName') }); };
    $('#vImg').onchange = function (e) { var f = e.target.files[0]; if (f) readImage(f, 800, 'image/jpeg', function (d) { img = d; art(); }); };
    $('#vNoImg').onclick = function () { img = ''; art(); };
    $('#vIcon').onchange = art;
    var save = function (arr) { call('PUT', '/api/admin/settings', { vehicles: arr }).then(function (r) { done(r); if (App.reloadConfig) App.reloadConfig(); }); };
    $('#vSave').onclick = function () {
      if (!v('vName')) return App.toast(t('err_vehicle'), 'bad');
      var nv = { id: x.id || v('vName'), name: v('vName'), icon: v('vIcon'), image: img, desc: v('vDesc'), features: v('vFeat'), seats: n('vSeats'), bags: n('vBags'), base: n('vBase'),
        perMile: n('vMile'), minFare: n('vMin'), hourly: n('vHour'), minHours: n('vMinH'), active: v('vAct') };
      var arr = list.slice(); if (i == null) arr.push(nv); else arr[i] = nv;
      save(arr);
    };
    var del = $('#vDel');
    if (del) del.onclick = function () { App.confirm(t('deleteQ', { name: x.name }), '', t('delete'), function () { save(list.filter(function (_, k) { return k !== i; })); }, true); };
  }

  // ================= places & zones =================
  R.places = function () {
    var S = A.st.settings;
    var row = function (p) {
      return '<tr class="place"><td><input data-k="name" value="' + esc(p.name) + '" aria-label="' + esc(t('name')) + '"></td><td><select data-k="type">' + ['airport', 'hotel', 'venue', 'area'].map(function (k) { return '<option value="' + k + '"' + (p.type === k ? ' selected' : '') + '>' + t('pt_' + k) + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-k="lat" type="number" step="any" value="' + esc(p.lat) + '" aria-label="lat"></td><td><input data-k="lng" type="number" step="any" value="' + esc(p.lng) + '" aria-label="lng"></td><td><input data-k="fee" type="number" step="1" value="' + esc(p.fee || 0) + '" aria-label="' + esc(t('zoneFee')) + '"></td>' +
        '<td><input data-k="aliases" value="' + esc((p.aliases || []).join(', ')) + '" aria-label="' + esc(t('aliases')) + '"></td><td><button class="link" data-rm>' + t('remove') + '</button><input type="hidden" data-k="id" value="' + esc(p.id || '') + '"></td></tr>';
    };
    $('#adm').innerHTML = panel(t('tab_places'), '<p class="fine">' + t('placesHint') + '</p><div class="table-wrap"><table class="tbl edit"><thead><tr><th>' + t('name') + '</th><th>' + t('type') + '</th><th>Lat</th><th>Lng</th><th>' + t('zoneFee') + '</th><th>' + t('aliases') + '</th><th></th></tr></thead><tbody id="plBody">' +
      S.places.map(row).join('') + '</tbody></table></div><div class="row"><button class="btn sm ghost" id="addPl">+ ' + t('addPlace') + '</button><span class="grow"></span><button class="btn primary" id="savePl">' + t('save') + '</button></div>');
    $('#addPl').onclick = function () { $('#plBody').insertAdjacentHTML('beforeend', row({ name: '', type: 'area', lat: '', lng: '', fee: 0, aliases: [] })); };
    $('#plBody').onclick = function (e) { if (e.target.closest('[data-rm]')) e.target.closest('tr').remove(); };
    $('#savePl').onclick = function () {
      var places = $$('#plBody tr').map(function (tr) { var o = {}; $$('[data-k]', tr).forEach(function (i) { o[i.dataset.k] = i.value; }); return o; })
        .filter(function (p) { return p.name && p.lat !== '' && p.lng !== ''; });
      call('PUT', '/api/admin/settings', { places: places }).then(function (r) { done(r); if (App.reloadConfig) App.reloadConfig(); });
    };
  };

  // ================= promos & loyalty =================
  R.promos = function () {
    var S = A.st, P = S.settings.pricing;
    $('#adm').innerHTML = panel(t('promoCodes'), table([t('code'), t('discount'), t('limits'), t('used'), t('status'), ''], S.promos.map(function (p) {
        var lim = [p.firstRideOnly && t('firstRideOnly'), p.services && p.services.length && p.services.map(App.serviceName).join('/'), p.maxUses && t('maxUsesN', { n: p.maxUses }), p.expires && t('expires') + ' ' + p.expires].filter(Boolean).join(' · ');
        return '<tr><td class="mono">' + esc(p.code) + '</td><td>' + (p.type === 'pct' ? p.value + '%' : App.money(p.value)) + '</td><td>' + esc(lim || '—') + '</td><td class="num">' + (p.used || 0) + '</td><td><span class="pill">' + (p.active ? t('active') : t('inactive')) + '</span></td>' +
          '<td><button class="btn sm ghost" data-promo="' + esc(p.code) + '">' + t('edit') + '</button></td></tr>';
      }), t('noPromos')), '<button class="btn primary sm" id="addPromo">+ ' + t('addPromo') + '</button>') +
      panel(t('loyalty'), '<p class="fine">' + t('loyaltyHint') + '</p><div class="grid3">' + fld('pointsPerDollar', t('pointsPerDollar'), P.pointsPerDollar, 'number', ' step="0.5"') + fld('pointValueCents', t('pointValue'), P.pointValueCents, 'number', ' step="0.5"') +
          fld('maxPointsPct', t('maxPointsPct'), P.maxPointsPct, 'number') + '</div>' +
        '<fieldset class="fs"><legend>' + t('tiers') + '</legend>' + (P.tiers || []).map(function (x, i) {
          return '<div class="grid3 tier-row">' + fld('tn' + i, t('tierName'), x.name) + fld('tr' + i, t('afterRides'), x.rides, 'number') + fld('tp' + i, t('tierDiscount'), x.pct, 'number') + '</div>';
        }).join('') + '</fieldset>' +
        '<fieldset class="fs"><legend>' + t('referrals') + '</legend><div class="grid2">' + fld('refereeDiscount', t('refereeDiscount'), P.refereeDiscount, 'number') + fld('referrerCredit', t('referrerCredit'), P.referrerCredit, 'number') + '</div></fieldset>' +
        '<div class="row end"><button class="btn primary" id="saveLoyal">' + t('save') + '</button></div>');
    $('#addPromo').onclick = function () { promoSheet(null); };
    $$('[data-promo]').forEach(function (b) { b.onclick = function () { promoSheet(S.promos.find(function (p) { return p.code === b.dataset.promo; })); }; });
    $('#saveLoyal').onclick = function () {
      var out = {}; ['pointsPerDollar', 'pointValueCents', 'maxPointsPct', 'refereeDiscount', 'referrerCredit'].forEach(function (k) { out[k] = n(k); });
      out.tiers = (P.tiers || []).map(function (_, i) { return { name: v('tn' + i), rides: n('tr' + i), pct: n('tp' + i) }; }).filter(function (x) { return x.name; });
      call('PUT', '/api/admin/settings', { pricing: out }).then(function (r) { done(r); if (App.reloadConfig) App.reloadConfig(); });
    };
  };
  function promoSheet(p) {
    p = p || { code: '', type: 'pct', value: 10, maxUses: 0, expires: '', services: [], firstRideOnly: false, active: true };
    App.openSheet('<h2>' + (p.code ? esc(p.code) : t('addPromo')) + '</h2><div class="grid3">' + fld('prCode', t('code'), p.code, 'text', ' autocapitalize="characters"' + (p.code ? ' readonly' : '')) +
      sel('prType', t('type'), [['pct', t('percentOff')], ['amount', t('amountOff')]], p.type) + fld('prVal', t('value'), p.value, 'number') +
      fld('prMax', t('maxUses'), p.maxUses, 'number') + fld('prExp', t('expires'), p.expires, 'date') + '</div>' +
      '<fieldset class="fs"><legend>' + t('onlyFor') + '</legend><div class="checks">' + ['point', 'airport', 'hourly', 'event'].map(function (s) { return chk('ps-' + s, App.serviceName(s), p.services.indexOf(s) >= 0); }).join('') + '</div></fieldset>' +
      chk('prFirst', t('firstRideOnly'), p.firstRideOnly) + chk('prAct', t('active'), p.active) +
      '<div class="sheet-actions">' + (p.code ? '<button class="btn ghost danger" id="prDel">' + t('delete') + '</button>' : '') + '<button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="prSave">' + t('save') + '</button></div>', true);
    $('#prSave').onclick = function () {
      call('POST', '/api/admin/promos', { code: v('prCode'), type: v('prType'), value: n('prVal'), maxUses: n('prMax'), expires: v('prExp'), firstRideOnly: v('prFirst'), active: v('prAct'),
        services: ['point', 'airport', 'hourly', 'event'].filter(function (s) { return v('ps-' + s); }) }).then(function (r) { done(r); });
    };
    var d = $('#prDel'); if (d) d.onclick = function () { call('DELETE', '/api/admin/promos/' + p.code).then(function (r) { done(r); }); };
  }

  // ================= corporate accounts =================
  R.companies = function () {
    var S = A.st;
    $('#adm').innerHTML = panel(t('tab_companies'), '<p class="fine">' + t('companiesHint') + ' <a href="#company">#company</a></p>' + table([t('name'), t('code'), t('discount'), t('billingEmail'), t('status'), ''], S.companies.map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td class="mono">' + esc(c.code) + '</td><td class="num">' + c.discountPct + '%</td><td>' + esc(c.billingEmail) + '</td><td><span class="pill">' + (c.active ? t('active') : t('inactive')) + '</span></td>' +
        '<td class="row"><button class="btn sm" data-rep="' + esc(c.id) + '">' + t('invoices') + '</button><button class="btn sm ghost" data-co="' + esc(c.id) + '">' + t('edit') + '</button></td></tr>';
    }), t('noCompanies')), '<button class="btn primary sm" id="addCo">+ ' + t('addCompany') + '</button>');
    $('#addCo').onclick = function () { companySheet(null); };
    $$('[data-co]').forEach(function (b) { b.onclick = function () { companySheet(S.companies.find(function (c) { return c.id === b.dataset.co; })); }; });
    $$('[data-rep]').forEach(function (b) { b.onclick = function () { reportSheet(b.dataset.rep); }; });
  };
  function companySheet(c) {
    App.openSheet('<h2>' + (c ? esc(c.name) : t('addCompany')) + '</h2><div class="grid2">' + fld('coName', t('name'), c ? c.name : '') + fld('coCode2', t('companyLabel'), c ? c.code : '', 'text', ' autocapitalize="characters"') +
      fld('coMail', t('billingEmail'), c ? c.billingEmail : '', 'email') + fld('coPct', t('discountPct'), c ? c.discountPct : 0, 'number') + fld('coPw', c ? t('newPasswordOpt') : t('password'), '', 'password') + '</div>' + chk('coAct', t('active'), !c || c.active) +
      '<div class="sheet-actions">' + (c ? '<button class="btn ghost danger" id="coDel">' + t('delete') + '</button>' : '') + '<button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="coSave">' + t('save') + '</button></div>', true);
    $('#coSave').onclick = function () {
      call('POST', '/api/admin/companies', { id: c ? c.id : '', name: v('coName'), code: v('coCode2'), billingEmail: v('coMail'), discountPct: n('coPct'), password: v('coPw'), active: v('coAct') }).then(function (r) { done(r); });
    };
    var d = $('#coDel'); if (d) d.onclick = function () { App.confirm(t('deleteQ', { name: c.name }), '', t('delete'), function () { call('DELETE', '/api/admin/companies/' + c.id).then(function (r) { done(r); }); }, true); };
  }
  function reportSheet(id) {
    call('GET', '/api/admin/companies/' + id + '/report').then(function (r) {
      if (r.status !== 200) return;
      App.openSheet('<div id="rep"></div><div class="sheet-actions"><button class="btn ghost" data-close>' + t('close') + '</button></div>', true);
      App.renderCompanyReport($('#rep'), r.body, null);
      // invoice controls per month
      $$('#rep tbody tr').forEach(function (tr, i) {
        var m = r.body.months[i]; if (!m || tr.closest('table') !== $('#rep table')) return;
        var td = document.createElement('td');
        td.innerHTML = '<button class="btn sm" data-inv="sent">' + t('markSent') + '</button> <button class="btn sm" data-inv="paid">' + t('markPaid') + '</button>';
        tr.appendChild(td);
        $$('[data-inv]', td).forEach(function (b) {
          b.onclick = function () { call('POST', '/api/admin/companies/' + id + '/invoice', { month: m.month, status: b.dataset.inv }).then(function (x) { if (x.status === 200) { App.toast(t('saved'), 'good'); reportSheet(id); } }); };
        });
      });
    });
  }

  // ================= customers =================
  R.customers = function () {
    var S = A.st;
    $('#adm').innerHTML = panel(t('tab_customers') + ' <b class="badge">' + S.customers.length + '</b>', table([t('name'), t('phone'), t('tier'), t('rides'), t('spent'), t('points'), t('referralCode'), ''], S.customers.map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.phone) + '</td><td><span class="pill tier">' + esc(c.tier ? c.tier.name : '') + '</span></td><td class="num">' + c.rides + '</td><td class="num">' + App.money(c.spent) + '</td><td class="num">' + c.points + '</td>' +
        '<td class="mono">' + esc(c.referralCode || '') + '</td><td><button class="btn sm ghost" data-pts="' + esc(c.key) + '">' + t('adjustPoints') + '</button></td></tr>';
    }), t('noCustomers')));
    $$('[data-pts]').forEach(function (b) {
      b.onclick = function () {
        var c = S.customers.find(function (x) { return x.key === b.dataset.pts; });
        App.openSheet('<h2>' + esc(c.name) + '</h2>' + fld('ptsVal', t('points'), c.points, 'number', ' min="0"') + '<div class="sheet-actions"><button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="ptsSave">' + t('save') + '</button></div>');
        $('#ptsSave').onclick = function () { call('POST', '/api/admin/customers', { key: c.key, points: n('ptsVal') }).then(function (r) { done(r); }); };
      };
    });
  };

  // ================= settings & white label =================
  R.settings = function () {
    var S = A.st.settings, B = S.brand, Pm = S.payment, Dp = S.dispatch, Fl = S.flight;
    var logo = B.logo;
    $('#adm').innerHTML =
      panel(t('brandWhiteLabel'), '<p class="fine">' + t('whiteLabelHint') + '</p>' +
        '<div class="brand-edit"><div class="logo-box" id="logoBox">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '<span>' + esc(B.name.slice(0, 1)) + '</span>') + '</div><div><label class="btn sm"><input type="file" id="logoIn" accept="image/*" hidden>' + t('uploadLogo') + '</label> <button class="link" id="logoRm">' + t('remove') + '</button></div>' +
          '<label class="fld color"><span>' + t('accentColor') + '</span><input type="color" id="bAccent" value="' + esc(B.accent || '#0f8b7f') + '"></label></div>' +
        '<div class="grid2">' + fld('bName', t('companyName'), B.name) + fld('bTag', t('tagline'), B.tagline) + fld('bPhone', t('phone'), B.phone, 'tel') + fld('bMail', t('email'), B.email, 'email') +
          fld('bCity', t('serviceArea'), B.city) + fld('bDomain', t('customDomain'), B.domain, 'text', ' placeholder="book.yourcompany.com"') + '</div>' +
        '<p class="fine">' + t('domainHint') + '</p><div class="row end"><button class="btn primary" id="saveBrand">' + t('save') + '</button></div>') +
      '<div class="two">' + panel(t('servicesOffered'), '<div class="checks">' + ['point', 'airport', 'hourly', 'event'].map(function (s) { return chk('sv-' + s, App.serviceName(s), S.services[s]); }).join('') + '</div>' +
          '<div class="row end"><button class="btn primary sm" id="saveSvc">' + t('save') + '</button></div>') +
        panel(t('dispatchRules'), sel('dMode', t('dispatchMode'), [['auto', t('dm_auto')], ['broadcast', t('dm_broadcast')], ['manual', t('dm_manual')]], Dp.mode) +
          '<div class="grid3">' + fld('dSec', t('offerSeconds'), Dp.offerSeconds, 'number', ' min="15"') + fld('dMax', t('maxMiles'), Dp.maxMiles, 'number') + fld('dShare', t('shareWithin'), Dp.shareWithinMiles, 'number') + '</div>' +
          '<p class="fine">' + t('dispatchHint') + '</p><div class="row end"><button class="btn primary sm" id="saveDisp">' + t('save') + '</button></div>') + '</div>' +
      panel(t('paymentMethods'), '<div class="checks">' + chk('pmPos', t('pm_pos'), Pm.pos) + chk('pmTr', t('pm_transfer'), Pm.transfer) + chk('pmCard', t('pm_card'), Pm.card) + chk('pmInv', t('pm_invoice'), Pm.invoice) + '</div>' +
        (A.st.features.card ? '' : '<p class="fine">' + t('cardNeedsStripe') + '</p>') +
        '<div class="grid3">' + fld('pmBank', t('bankName'), Pm.bankName) + fld('pmAcct', t('accountName'), Pm.accountName) + fld('pmRout', t('routing'), Pm.routing) + fld('pmNum', t('account'), Pm.account) + fld('pmZelle', 'Zelle', Pm.zelle) + fld('pmNote', t('payNote'), Pm.note) + '</div>' +
        '<div class="row end"><button class="btn primary sm" id="savePay">' + t('save') + '</button></div>') +
      '<div class="two">' + panel('✈ ' + t('flightPolicy'), chk('flAuto', t('flightAuto'), Fl.autoAdjust) + '<div class="grid2">' + fld('flDom', t('graceDomestic'), Fl.graceDomestic, 'number') + fld('flIntl', t('graceIntl'), Fl.graceIntl, 'number') + '</div>' +
          '<p class="fine">' + (A.st.features.flights ? t('flightsLive') : t('flightsManual')) + '</p><div class="row end"><button class="btn primary sm" id="saveFl">' + t('save') + '</button></div>') +
        panel(t('security'), fld('newPw', t('newAdminPassword'), '', 'password', ' minlength="6" autocomplete="new-password"') + '<div class="row end"><button class="btn primary sm" id="savePw">' + t('save') + '</button></div>') + '</div>';
    var paintLogo = function () { $('#logoBox').innerHTML = logo ? '<img src="' + esc(logo) + '" alt="">' : '<span>' + esc(v('bName').slice(0, 1)) + '</span>'; };
    $('#logoIn').onchange = function (e) { var f = e.target.files[0]; if (f) readImage(f, 256, 'image/png', function (d) { logo = d; paintLogo(); }); };
    $('#logoRm').onclick = function () { logo = ''; paintLogo(); };
    $('#bAccent').oninput = function () { if (App.applyAccent) App.applyAccent($('#bAccent').value); };
    var put = function (body, after) { call('PUT', '/api/admin/settings', body).then(function (r) { done(r); if (App.reloadConfig) App.reloadConfig(); if (after) after(); }); };
    $('#saveBrand').onclick = function () { put({ brand: { name: v('bName'), tagline: v('bTag'), phone: v('bPhone'), email: v('bMail'), city: v('bCity'), domain: v('bDomain').toLowerCase(), accent: v('bAccent'), logo: logo } }); };
    $('#saveSvc').onclick = function () { var o = {}; ['point', 'airport', 'hourly', 'event'].forEach(function (s) { o[s] = v('sv-' + s); }); put({ services: o }); };
    $('#saveDisp').onclick = function () { put({ dispatch: { mode: v('dMode'), offerSeconds: Math.max(15, n('dSec')), maxMiles: n('dMax'), shareWithinMiles: n('dShare') } }); };
    $('#savePay').onclick = function () { put({ payment: { pos: v('pmPos'), transfer: v('pmTr'), card: v('pmCard'), invoice: v('pmInv'), bankName: v('pmBank'), accountName: v('pmAcct'), routing: v('pmRout'), account: v('pmNum'), zelle: v('pmZelle'), note: v('pmNote') } }); };
    $('#saveFl').onclick = function () { put({ flight: { autoAdjust: v('flAuto'), graceDomestic: n('flDom'), graceIntl: n('flIntl') } }); };
    $('#savePw').onclick = function () { if (v('newPw').length < 6) return App.toast(t('err_password'), 'bad'); put({ adminPassword: v('newPw') }, function () { $('#newPw').value = ''; }); };
  };
})();
