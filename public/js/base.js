/* Shared front-end plumbing: helpers, language, storage, API client (real server or
 * in-browser demo), vehicle illustrations, dialogs and the view router. */
(function () {
  'use strict';
  var App = window.App = {};
  var I18N = window.TRANSPORTAR_I18N;

  var $ = App.$ = function (s, r) { return (r || document).querySelector(s); };
  App.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = App.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };

  // ---------- storage (survives blocked localStorage) ----------
  var mem = {};
  var store = App.store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('tr.' + k); if (v != null) return JSON.parse(v); } catch (e) { /* blocked */ }
      return k in mem ? mem[k] : d;
    },
    set: function (k, v) {
      mem[k] = v;
      try { if (v == null) localStorage.removeItem('tr.' + k); else localStorage.setItem('tr.' + k, JSON.stringify(v)); } catch (e) { /* blocked */ }
    }
  };
  App.session = {
    get: function (k) { try { return sessionStorage.getItem('tr.' + k); } catch (e) { return mem['s.' + k] || null; } },
    set: function (k, v) { mem['s.' + k] = v; try { sessionStorage.setItem('tr.' + k, v); } catch (e) { /* blocked */ } }
  };

  // ---------- language ----------
  App.lang = store.get('lang') || (navigator.language || 'en').slice(0, 2);
  if (!I18N[App.lang]) App.lang = 'en';
  var t = App.t = function (k, vars) {
    var s = (I18N[App.lang] && I18N[App.lang][k]) || I18N.en[k];
    if (s == null) return k;
    if (vars) Object.keys(vars).forEach(function (x) { s = s.split('{' + x + '}').join(vars[x]); });
    return s;
  };
  App.has = function (k) { return I18N.en[k] != null; };
  App.locale = function () { return App.lang === 'ar' ? 'ar' : App.lang === 'es' ? 'es-US' : 'en-US'; };
  App.money = function (n) {
    if (n == null) return '—';
    var whole = Math.abs(n % 1) < 0.005;
    return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  };
  App.fmtTime = function (ts, opts) {
    if (!ts || ts === 'now') return t('asap');
    return new Date(ts).toLocaleString(App.locale(), Object.assign({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts || {}));
  };
  App.clock = function (ts) { return new Date(ts).toLocaleTimeString(App.locale(), { hour: 'numeric', minute: '2-digit' }); };
  App.date = function (ts) { return new Date(ts).toLocaleDateString(App.locale(), { year: 'numeric', month: 'short', day: 'numeric' }); };
  App.dayName = function (d) { return new Date(2024, 0, 7 + d).toLocaleDateString(App.locale(), { weekday: 'short' }); };
  App.hourName = function (h) { return new Date(2024, 0, 1, h).toLocaleTimeString(App.locale(), { hour: 'numeric' }); };
  // <input type="datetime-local"> value for a timestamp, in the viewer's clock
  App.localInput = function (ts) { var d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  // ---------- feedback ----------
  App.toast = function (msg, tone) {
    var el = $('#toast'); el.textContent = msg; el.className = 'toast ' + (tone || ''); el.hidden = false;
    clearTimeout(App.toast.t); App.toast.t = setTimeout(function () { el.hidden = true; }, 2800);
  };
  App.copy = function (text) {
    try { navigator.clipboard.writeText(text).then(function () { App.toast(t('copied')); }, function () { App.toast(text); }); }
    catch (e) { App.toast(text); }
  };
  App.errText = function (r) {
    var code = r && r.body && r.body.error;
    return code && App.has('err_' + code) ? t('err_' + code) : t('errGeneric');
  };
  App.openSheet = function (html, wide) {
    $('#sheetBody').innerHTML = html;
    $('#sheetBody').classList.toggle('wide', !!wide);
    $('#sheet').hidden = false;
    var f = $('#sheetBody input, #sheetBody button:not([data-close])'); if (f) f.focus();
  };
  App.closeSheet = function () { $('#sheet').hidden = true; };
  App.confirm = function (title, body, okLabel, fn, danger) {
    App.openSheet('<h2>' + esc(title) + '</h2>' + (body ? '<p>' + esc(body) + '</p>' : '') +
      '<div class="sheet-actions"><button class="btn ghost" data-close>' + t('back') + '</button><button class="btn primary' + (danger ? ' danger' : '') + '" id="sheetOk">' + esc(okLabel) + '</button></div>');
    $('#sheetOk').onclick = function () { App.closeSheet(); fn(); };
  };
  document.addEventListener('click', function (e) { if (e.target.closest('[data-close]') || e.target.id === 'sheet') App.closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') App.closeSheet(); });

  // ---------- tenant (company) selection for the multi-company platform ----------
  App.tenant = (function () {
    var q = new URLSearchParams(location.search).get('co');
    if (q) App.session.set('tenant', q.toLowerCase());
    return App.session.get('tenant') || '';
  })();
  App.setTenant = function (slug) { App.session.set('tenant', slug || ''); App.tenant = slug || ''; };

  // ---------- API: real server, or the same core running in this browser ----------
  var API = App.API = {
    mode: 'server',
    init: function () {
      return fetch('/api/config', { cache: 'no-store' }).then(function (r) {
        if (!r.ok || (r.headers.get('content-type') || '').indexOf('json') < 0) throw new Error('no api');
      }).catch(function () {
        API.mode = 'demo';
        var KEY = API.demoKey = 'demo-db-v3';
        if (!store.get(KEY) && App.seedDemo) App.seedDemo(KEY);
        API.core = window.TR.core.createCore({
          load: function () { return store.get(KEY) || null; },
          save: function (s) { store.set(KEY, s); },
          cardEnabled: true, demoCard: true
        });
      });
    },
    call: function (method, path, body, auth) {
      if (API.mode === 'demo') {
        var res = API.core.handle(method, path, body || {}, auth || '', { tenant: App.tenant || null });
        // demo has no network: keep the AI endpoint on the rule-based parser, no checkout
        return Promise.resolve(JSON.parse(JSON.stringify(res)));
      }
      var headers = { 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = 'Bearer ' + auth;
      if (App.tenant) headers['X-Tenant'] = App.tenant;
      return fetch(path, { method: method, headers: headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .catch(function () { return { status: 0, body: { error: 'offline' } }; });
    }
  };

  // ---------- polling + router ----------
  var timer = null;
  App.poll = function (fn, ms) { clearInterval(timer); timer = null; fn(); if (ms) timer = setInterval(fn, ms); };
  App.stopPoll = function () { clearInterval(timer); timer = null; };
  App.views = {};
  App.route = function () {
    App.stopPoll(); App.closeSheet();
    if (App.onLeave) { App.onLeave(); App.onLeave = null; }
    var h = location.hash.slice(1) || 'book';
    var name = h.split('-')[0], arg = h.slice(name.length + 1);
    App.$$('.nav a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('href') === '#' + name ? 'page' : 'false'); });
    document.body.dataset.view = name;
    (App.views[name] || App.views.book)(arg);
    window.scrollTo(0, 0);
  };

  // ---------- vehicle illustrations (side view, faces the reading direction) ----------
  var BODY = {
    sedan: { d: 'M6 34 8 26q2-3 8-4l18-2 12-9q3-2 8-2h24q5 0 8 3l10 8 12 2q6 1 7 6v6q0 2-2 2H8q-2 0-2-2z',
      win: ['M40 20 49 12.5q1.5-1 4-1h11V20z', 'M67 11.5h13q3 0 5 2l6 6.5H67z'], wheels: [28, 94] },
    suv: { d: 'M5 34V22q0-3 4-3.5L22 17l8-10q1.5-2 5-2h57q4 0 6 3l6 9 6 1q5 1 5 6v10q0 2-2 2H7q-2 0-2-2z',
      win: ['M33 16 39 8h19v8z', 'M61 8h19v8H61z', 'M83 8h11q2 0 3 2l4 6H83z'], wheels: [26, 94] },
    van: { d: 'M4 34V7q0-4 5-4h77q6 0 10 5l10 10 6 2q4 1 4 6v8q0 2-2 2H6q-2 0-2-2z',
      win: ['M10 8h18v9H10z', 'M32 8h18v9H32z', 'M54 8h18v9H54z', 'M78 8h10q3 0 5 3l7 7H78z'], wheels: [24, 96] },
    limo: { d: 'M2 34l1-7q1-3 6-3.5L24 22l8-7q2-1.5 5-1.5h55q3 0 5 1.5l7 7 9 1.5q5 1 5 5.5v5q0 2-2 2H4q-2 0-2-2z',
      win: ['M34 21l4-4.5h12V21z', 'M53 16.5h14V21H53z', 'M70 16.5h14V21H70z', 'M87 16.5h7l5 4.5H87z'], wheels: [20, 100] },
    bus: { d: 'M3 34V6q0-4 4-4h103q6 0 7 6v26q0 2-2 2H5q-2 0-2-2z',
      win: ['M8 7h15v11H8z', 'M26 7h15v11H26z', 'M44 7h15v11H44z', 'M62 7h15v11H62z', 'M80 7h15v11H80z', 'M98 7h13v15H98z'], wheels: [22, 98] }
  };
  App.vehicleArt = function (v) {
    if (v && v.image) return '<img class="veh-photo" src="' + esc(v.image) + '" alt="' + esc(v.name) + '" loading="lazy">';
    var b = BODY[v && v.icon] || BODY.sedan;
    return '<svg class="veh" viewBox="0 0 120 46" aria-hidden="true"><path class="veh-body" d="' + b.d + '"/>' +
      b.win.map(function (w) { return '<path class="veh-win" d="' + w + '"/>'; }).join('') +
      b.wheels.map(function (x) { return '<circle class="veh-tire" cx="' + x + '" cy="36" r="7.5"/><circle class="veh-hub" cx="' + x + '" cy="36" r="3"/>'; }).join('') + '</svg>';
  };
  App.ICONS = Object.keys(BODY);

  // ---------- line icons (24×24, drawn with currentColor) ----------
  var IC = {
    car: '<path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 17v-4l2-5h14l2 5v4h-2M5 13h14"/>',
    plane: '<path d="M10.5 21 12 16l6 2 1-2-6-4V6.5a1.5 1.5 0 0 0-3 0V12l-6 4 1 2 6-2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.5"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bag: '<rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M9 11v5M15 11v5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    wand: '<path d="m4 20 11-11M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z"/>',
    phone: '<path d="M5 3.5h3.5l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5V18a2 2 0 0 1-2 2A16 16 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>',
    headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20a3 3 0 0 1-3 2h-3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    nav: '<path d="M3 11 21 3l-8 18-2-8z"/>',
    wallet: '<path d="M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12v3"/><circle cx="16" cy="13.5" r="1.2"/>',
    bank: '<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>',
    building: '<rect x="4" y="3" width="11" height="18" rx="1"/><path d="M15 9h4a1 1 0 0 1 1 1v11M8 7h3M8 11h3M8 15h3M4 21h17"/>',
    gift: '<rect x="3.5" y="8" width="17" height="5" rx="1"/><path d="M5 13v7h14v-7M12 8v12M12 8S10.5 3.5 8 4.5 9 8 12 8zM12 8s1.5-4.5 4-3.5S15 8 12 8z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    chart: '<path d="M4 20V4M4 20h16"/><rect x="7" y="12" width="3" height="5" rx=".5"/><rect x="12" y="8" width="3" height="9" rx=".5"/><rect x="17" y="5" width="3" height="12" rx=".5"/>',
    qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM20.5 14v.01M17 20.5h3.5V17"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.5 5.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    heart: '<path d="M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.4 12 20 12 20z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    home: '<path d="m3 11 9-7 9 7M5 9.5V20h14V9.5"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'
  };
  App.icon = function (name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (IC[name] || IC.sparkle) + '</svg>';
  };

  // ---------- light / dark ----------
  App.theme = store.get('theme') || 'auto';
  App.applyTheme = function (th) {
    App.theme = th; store.set('theme', th);
    if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
  };
  App.applyTheme(App.theme);

  App.statusPill = function (s) { return '<span class="pill st-' + s + '">' + t('st_' + s) + '</span>'; };
  App.payPill = function (b) { return '<span class="pill pay-' + b.payStatus + '">' + t('pay_' + b.payStatus) + '</span>'; };
  App.payName = function (m) { return t('pm_' + m); };
  App.serviceName = function (s) { return t('svc_' + (s || 'point')); };
  App.lineLabel = function (l) {
    var p = Object.assign({}, l.p || {});
    if (p.rate != null) p.rate = App.money(p.rate);
    return t('ln_' + l.k, p);
  };
  App.breakdownHtml = function (bd, total) {
    if (!bd) return '';
    return '<table class="breakdown"><tbody>' +
      bd.lines.map(function (l) { return '<tr><td>' + esc(App.lineLabel(l)) + '</td><td class="num">' + App.money(l.amount) + '</td></tr>'; }).join('') +
      (bd.discounts && bd.discounts.length ? '<tr class="sub"><td>' + t('subtotal') + '</td><td class="num">' + App.money(bd.subtotal) + '</td></tr>' +
        bd.discounts.map(function (d) { return '<tr class="disc"><td>' + esc(t('dc_' + d.k, d.p || {})) + '</td><td class="num">−' + App.money(d.amount).replace('−', '') + '</td></tr>'; }).join('') : '') +
      '<tr class="tot"><td>' + t('total') + '</td><td class="num">' + App.money(total) + '</td></tr></tbody></table>';
  };
  App.loginBox = function (title, label, type, mode, hint, extraField) {
    return '<section class="login"><span class="login-ic">' + App.icon('lock') + '</span><p class="eyebrow">' + esc(App.cfg.brand.name) + '</p><h1>' + title + '</h1>' +
      '<form id="loginForm">' + (extraField || '') + '<label class="fld" for="secret"><span>' + label + '</span><input id="secret" type="' + type + '" inputmode="' + mode + '" autocomplete="current-password" required></label>' +
      '<p class="form-error" id="loginErr" hidden></p><button class="btn primary" type="submit">' + t('signIn') + '</button></form>' +
      (hint ? '<p class="fine">' + hint + '</p>' : '') + '</section>';
  };
  App.loginErr = function (r) { var e = $('#loginErr'); e.hidden = false; e.textContent = r.status === 429 ? t('errTooMany') : t('errLogin'); };
  App.trips = function () { return store.get('trips', []); };
  App.rememberTrip = function (code, token) {
    var list = App.trips().filter(function (x) { return x.code !== code; });
    list.unshift({ code: code, token: token, at: Date.now() });
    store.set('trips', list.slice(0, 60));
  };
})();
