/* Customer booking: QR presets, AI assistant, service types, round trips, recurring
 * rides, live pricing per vehicle, codes, loyalty points and payment choice. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, $$ = App.$$, esc = App.esc, t = App.t, store = App.store;

  var BLANK = { service: 'point', tripType: 'oneway', vehicleId: null, pickup: null, dropoff: null, whenMode: 'now', when: '', returnWhen: '', hours: 3,
    passengers: 1, bags: 0, childSeats: 0, meetGreet: false, flight: '', repeat: { freq: '', count: 4 }, name: '', phone: '', email: '', notes: '',
    payMethod: 'pos', promoCode: '', companyCode: '', usePoints: false };
  var draft = Object.assign({}, BLANK, store.get('draft2', {}));
  var activeField = 'pickup', lastQuote = null, quoteTimer = null, mapCtl = null;
  function save() { store.set('draft2', draft); }

  // ---------- QR campaign presets ----------
  App.applyCampaign = function () {
    var params = new URLSearchParams(location.search);
    var id = (params.get('c') || params.get('src') || '').toLowerCase();
    var cfg = App.cfg;
    var c = id && cfg.campaigns.find(function (x) { return x.id === id; });
    if (id) App.session.set('src', id);
    App.source = App.session.get('src') || 'direct';
    App.campaign = c || cfg.campaigns.find(function (x) { return x.id === App.source; }) || null;
    if (!c || App.session.get('preset-' + id)) return;
    App.session.set('preset-' + id, '1');
    var p = c.presets || {}, place = function (pid) { var x = cfg.places.find(function (pl) { return pl.id === pid; }); return x ? { name: x.name, lat: x.lat, lng: x.lng, placeId: x.id } : null; };
    if (p.service) draft.service = p.service;
    if (p.vehicleId) draft.vehicleId = p.vehicleId;
    if (p.pickupId) draft.pickup = place(p.pickupId);
    if (p.dropoffId) draft.dropoff = place(p.dropoffId);
    if (p.promo) draft.promoCode = p.promo;
    save();
  };

  function vehicle(id) { return App.cfg.vehicles.find(function (v) { return v.id === id; }); }
  function resolvePlace(text, prev) {
    text = String(text || '').trim();
    if (!text) return null;
    if (prev && prev.name === text) return prev;
    var low = text.toLowerCase();
    var hit = App.cfg.places.find(function (p) { return p.name.toLowerCase() === low || (p.aliases || []).indexOf(low) >= 0; });
    return hit ? { name: hit.name, lat: hit.lat, lng: hit.lng, placeId: hit.id } : { name: text };
  }
  function geocode(field) {
    var p = draft[field];
    if (App.API.mode !== 'server' || !p || p.lat != null || p.name.length < 5) return;
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(p.name))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res[0] && draft[field] && draft[field].name === p.name) { draft[field] = { name: p.name, lat: +res[0].lat, lng: +res[0].lon }; save(); refresh(); }
      }).catch(function () { /* dispatch confirms the price */ });
  }

  function tripBody() {
    var later = draft.whenMode === 'later' && draft.when;
    return {
      service: draft.service, vehicleId: draft.vehicleId, pickup: draft.pickup, dropoff: draft.service === 'hourly' && !draft.dropoff ? null : draft.dropoff,
      when: later ? new Date(draft.when).toISOString() : 'now',
      tripType: draft.service === 'hourly' ? 'oneway' : draft.tripType,
      returnWhen: draft.tripType === 'round' && draft.returnWhen ? new Date(draft.returnWhen).toISOString() : null,
      hours: draft.service === 'hourly' || draft.service === 'event' ? draft.hours : 0,
      passengers: draft.passengers, bags: draft.bags, childSeats: draft.childSeats, meetGreet: draft.meetGreet,
      flight: draft.service === 'airport' ? draft.flight : '', promoCode: draft.promoCode, companyCode: draft.companyCode,
      usePoints: draft.usePoints, customerToken: store.get('customerToken')
    };
  }

  var SVC_IC = { point: 'route', airport: 'plane', hourly: 'clock', event: 'star' };
  var PAY_IC = { card: 'card', pos: 'wallet', transfer: 'bank', invoice: 'building' };

  // A calm, gently moving scene: the sun, the city, the road and a car on its way.
  function heroArt() {
    var city = [[18, 70], [42, 96], [64, 58], [86, 120], [112, 82], [136, 104], [160, 64], [262, 88], [286, 124], [312, 76], [338, 100], [362, 66]];
    return '<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMax slice">' +
      '<defs><linearGradient id="haSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ha-sky1"/><stop offset="1" class="ha-sky2"/></linearGradient></defs>' +
      '<rect width="400" height="250" fill="url(#haSky)"/>' +
      '<circle cx="300" cy="74" r="40" class="ha-glow"/><circle cx="300" cy="74" r="26" class="ha-sun"/>' +
      '<g class="ha-cloud c1"><rect x="40" y="40" width="78" height="20" rx="10"/><rect x="58" y="30" width="40" height="20" rx="10"/></g>' +
      '<g class="ha-cloud c2"><rect x="196" y="62" width="62" height="16" rx="8"/><rect x="210" y="54" width="30" height="16" rx="8"/></g>' +
      '<g class="ha-city">' + city.map(function (b) { return '<rect x="' + b[0] + '" y="' + (190 - b[1]) + '" width="20" height="' + b[1] + '" rx="3"/>'; }).join('') + '</g>' +
      '<g class="ha-win">' + city.map(function (b, i) { return i % 3 ? '' : '<rect x="' + (b[0] + 6) + '" y="' + (190 - b[1] + 10) + '" width="4" height="4"/><rect x="' + (b[0] + 11) + '" y="' + (190 - b[1] + 22) + '" width="4" height="4"/>'; }).join('') + '</g>' +
      '<path class="ha-hill" d="M0 196 C80 170 150 186 210 180 S330 164 400 182 V250 H0Z"/>' +
      '<path class="ha-road" d="M0 222 C120 206 260 236 400 214 V250 H0Z"/>' +
      '<path class="ha-lane" d="M0 236 C120 220 260 250 400 228"/>' +
      '<g class="ha-car"><g class="ha-bob"><path class="ha-body" d="M150 214 l8 -14 h44 l12 14 h14 a6 6 0 0 1 6 6 v6 h-90 v-6 a6 6 0 0 1 6 -6z"/>' +
        '<path class="ha-glass" d="M163 213 l6 -10 h14 v10z M188 213 v-10 h12 l8 10z"/><circle class="ha-lamp" cx="236" cy="220" r="2.5"/></g>' +
        '<circle class="ha-tire" cx="166" cy="227" r="8"/><circle class="ha-tire" cx="218" cy="227" r="8"/><circle class="ha-hub" cx="166" cy="227" r="3"/><circle class="ha-hub" cx="218" cy="227" r="3"/></g>' +
      '<g class="ha-pin"><path d="M352 150 c-9 0 -15 7 -15 15 c0 11 15 25 15 25 s15 -14 15 -25 c0 -8 -6 -15 -15 -15z"/><circle cx="352" cy="165" r="5" class="ha-pin-dot"/></g>' +
      '</svg></div>';
  }

  // ---------- render ----------
  App.views.book = function () {
    var cfg = App.cfg, V = cfg.vehicles;
    if (!draft.vehicleId || !vehicle(draft.vehicleId)) draft.vehicleId = V[0] && V[0].id;
    if (!cfg.services[draft.service]) draft.service = 'point';
    var pays = ['card', 'pos', 'transfer'].filter(function (m) { return cfg.payment[m]; });
    if (pays.indexOf(draft.payMethod) < 0 && draft.payMethod !== 'invoice') draft.payMethod = pays[0];
    var favs = store.get('favorites', []);
    var camp = App.campaign;
    var SV = ['point', 'airport', 'hourly', 'event'].filter(function (s) { return cfg.services[s]; });

    $('#main').innerHTML =
      '<section class="hero"><div class="hero-text">' +
        (camp && camp.welcome ? '<p class="welcome">' + App.icon('sparkle') + esc(camp.welcome) + '</p>' : '') +
        '<p class="eyebrow">' + App.icon('pin') + esc(cfg.brand.city) + '</p><h1>' + esc(cfg.brand.tagline) + '</h1>' +
        '<p class="lede">' + t('heroLede') + '</p>' +
        '<ul class="perks"><li>' + App.icon('check') + t('perkPrice') + '</li><li>' + App.icon('check') + t('perkTrack') + '</li><li>' + App.icon('check') + t('perkPay') + '</li></ul>' +
      '</div>' + heroArt() + '</section>' +
      '<ul class="trust" aria-label="' + esc(t('safetyTitle')) + '">' + [['shield', 'trustLicensed'], ['user', 'trustVetted'], ['lock', 'trustSecure'], ['headset', 'trustSupport']].map(function (x) {
        return '<li><span class="trust-ic">' + App.icon(x[0]) + '</span><span><b>' + t(x[1]) + '</b><small>' + t(x[1] + 'Sub') + '</small></span></li>';
      }).join('') + '</ul>' +
      '<section class="assist" aria-labelledby="assistH"><div class="assist-head"><h2 id="assistH"><span class="h-ic ai">' + App.icon('wand') + '</span>' + t('assistTitle') + '</h2><span class="pill ai">' + (cfg.features.ai ? 'AI' : t('assistSmart')) + '</span></div>' +
        '<p class="fine">' + t('assistHint') + '</p>' +
        '<div class="assist-row"><textarea id="assistText" rows="2" placeholder="' + esc(t('assistPh')) + '"></textarea>' +
        '<button type="button" class="btn primary" id="assistGo">' + t('assistGo') + '</button></div><p class="assist-reply" id="assistReply" hidden></p></section>' +
      (favs.length ? '<section class="favs"><span class="chips-lbl">' + t('bookAgain') + '</span>' + favs.map(function (f, i) {
        return '<button type="button" class="chip fav" data-fav="' + i + '">' + App.icon('heart') + ' ' + esc(f.label) + '</button>';
      }).join('') + '</section>' : '') +
      '<form id="bookForm" novalidate>' +
      '<section class="block"><h2><span class="step">1</span>' + t('serviceQ') + '</h2>' +
        '<div class="svc-tabs" role="radiogroup">' + SV.map(function (s) {
          return '<button type="button" role="radio" data-svc="' + s + '" aria-checked="' + (draft.service === s) + '"><span class="svc-ic">' + App.icon(SVC_IC[s]) + '</span><b>' + t('svc_' + s) + '</b><small>' + t('svcd_' + s) + '</small></button>';
        }).join('') + '</div>' +
        '<div class="seg narrow" id="tripTypeSeg" role="radiogroup"><button type="button" role="radio" data-trip="oneway">' + t('oneWay') + '</button><button type="button" role="radio" data-trip="round">' + t('roundTrip') + '</button></div>' +
      '</section>' +
      '<section class="block"><h2><span class="step">2</span>' + t('whereTo') + '</h2>' +
        '<div class="route-grid"><div class="route-fields">' +
          '<label class="fld" for="pickup"><span>' + t('pickup') + '</span><span class="row"><input id="pickup" list="placeList" autocomplete="off" placeholder="' + esc(t('pickupPh')) + '">' +
            '<button type="button" class="icon-btn" id="locate" title="' + esc(t('useLocation')) + '" aria-label="' + esc(t('useLocation')) + '">' + App.icon('nav') + '</button></span></label>' +
          '<button type="button" class="swap" id="swap" aria-label="' + esc(t('swap')) + '">⇅</button>' +
          '<label class="fld" for="dropoff"><span id="dropLbl">' + t('dropoff') + '</span><input id="dropoff" list="placeList" autocomplete="off" placeholder="' + esc(t('dropoffPh')) + '"></label>' +
          '<div class="chips" id="chips"></div>' +
          '<datalist id="placeList">' + cfg.places.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('') + '</datalist>' +
          '<div class="airport-extras" id="airportBox"><label class="fld" for="flight"><span>' + t('flightNo') + '</span><input id="flight" placeholder="AA 1234" autocomplete="off"></label>' +
            '<label class="toggle"><input type="checkbox" id="meetGreet"> ' + t('meetGreet', { fee: App.money(cfg.pricing.meetGreetFee) }) + '</label><p class="fine">' + t('flightHint') + '</p></div>' +
          '<div class="fld" id="hoursBox"><span>' + t('hours') + '</span>' + stepper('hours', draft.hours) + '</div>' +
        '</div><div class="map" id="map"></div></div>' +
      '</section>' +
      '<section class="block"><h2><span class="step">3</span>' + t('when') + '</h2><div class="trip-opts">' +
        '<div class="fld"><span>' + t('pickupTime') + '</span><div class="seg" role="radiogroup"><button type="button" role="radio" data-when="now">' + t('now') + '</button><button type="button" role="radio" data-when="later">' + t('schedule') + '</button></div>' +
          '<input type="datetime-local" id="whenAt"></div>' +
        '<label class="fld" for="returnAt" id="returnBox"><span>' + t('returnTime') + '</span><input type="datetime-local" id="returnAt"></label>' +
        '<div class="fld" id="repeatBox"><span>' + t('repeat') + '</span><div class="row"><select id="repeatFreq">' +
          ['', 'weekly', 'biweekly', 'weekdays', 'monthly'].map(function (f) { return '<option value="' + f + '">' + t('rep_' + (f || 'none')) + '</option>'; }).join('') +
          '</select><select id="repeatCount" aria-label="' + esc(t('repeatCount')) + '">' + [2, 3, 4, 6, 8, 10, 12].map(function (n) { return '<option value="' + n + '">' + t('times', { n: n }) + '</option>'; }).join('') + '</select></div></div>' +
      '</div></section>' +
      '<section class="block"><h2><span class="step">4</span>' + t('whoTravels') + '</h2><div class="trip-opts">' +
        '<div class="fld"><span>' + t('passengers') + '</span>' + stepper('passengers', draft.passengers) + '</div>' +
        '<div class="fld"><span>' + t('luggage') + '</span>' + stepper('bags', draft.bags) + '</div>' +
        '<div class="fld"><span>' + t('childSeats', { fee: App.money(cfg.pricing.childSeatFee) }) + '</span>' + stepper('childSeats', draft.childSeats) + '</div>' +
      '</div></section>' +
      '<section class="block"><h2><span class="step">5</span>' + t('chooseVehicle') + '</h2><div class="vehicles" role="radiogroup">' +
        V.map(function (v) {
          return '<button type="button" role="radio" class="vcard" data-veh="' + esc(v.id) + '">' +
            '<div class="vart">' + App.vehicleArt(v) + '</div>' +
            '<div class="vtop"><span class="vname">' + esc(v.name) + '</span><span class="vprice" data-price="' + esc(v.id) + '">' + t('from') + ' ' + App.money(v.minFare) + '</span></div>' +
            (v.desc ? '<span class="vdesc">' + esc(v.desc) + '</span>' : '') +
            '<span class="vmeta"><span>' + App.icon('users') + v.seats + '</span><span>' + App.icon('bag') + v.bags + '</span></span>' +
            (v.features && v.features.length ? '<span class="vfeat">' + v.features.map(function (f) { return '<i>' + esc(f) + '</i>'; }).join('') + '</span>' : '') +
            '<span class="vwarn" data-warn="' + esc(v.id) + '" hidden>' + t('tooSmall') + '</span></button>';
        }).join('') + '</div></section>' +
      '<section class="block"><h2><span class="step">6</span>' + t('yourDetails') + '</h2><div class="grid2">' +
        field('name', t('fullName'), 'text', 'name') + field('phone', t('phone'), 'tel', 'tel') +
        field('email', t('emailOpt'), 'email', 'email') + field('notes', t('notes'), 'text', 'off') +
      '</div></section>' +
      '<section class="block"><h2><span class="step">7</span>' + t('payment') + '</h2>' +
        '<div class="grid2"><label class="fld" for="promoCode"><span>' + t('promoLabel') + '</span><input id="promoCode" autocomplete="off" autocapitalize="characters"><small class="fld-msg" id="promoMsg"></small></label>' +
        '<label class="fld" for="companyCode"><span>' + t('companyLabel') + '</span><input id="companyCode" autocomplete="off" autocapitalize="characters"><small class="fld-msg" id="companyMsg"></small></label></div>' +
        '<div class="member" id="memberBox" hidden></div>' +
        '<div class="pay-opts" role="radiogroup" id="payOpts"></div>' +
      '</section>' +
      '<p class="form-error" id="formError" role="alert" hidden></p>' +
      '<p class="secure-note">' + App.icon('lock') + t('secureNote') + '</p>' +
      '<div class="bar"><button type="button" class="bar-price" id="barPrice" aria-expanded="false"><small>' + t('estimate') + '</small><strong id="price">—</strong><small id="miles"></small></button>' +
        '<button class="btn primary" type="submit">' + t('reviewRide') + '</button></div>' +
      '<div class="bar-breakdown" id="barBreakdown" hidden></div>' +
      '</form>';

    function stepper(id, val) {
      return '<div class="stepper"><button type="button" data-step="' + id + '" data-d="-1" aria-label="−">−</button><output id="' + id + '">' + val + '</output><button type="button" data-step="' + id + '" data-d="1" aria-label="+">+</button></div>';
    }
    function field(id, label, type, ac) {
      return '<label class="fld" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="' + type + '" autocomplete="' + ac + '"></label>';
    }

    mapCtl = App.mapView($('#map'), { pickup: draft.pickup, dropoff: draft.dropoff });
    syncInputs(); syncVisibility(); bind(); refresh();
  };

  function syncInputs() {
    $('#pickup').value = draft.pickup ? draft.pickup.name : '';
    $('#dropoff').value = draft.dropoff ? draft.dropoff.name : '';
    $('#flight').value = draft.flight; $('#meetGreet').checked = draft.meetGreet;
    $('#whenAt').value = draft.when; $('#returnAt').value = draft.returnWhen;
    $('#repeatFreq').value = draft.repeat.freq; $('#repeatCount').value = String(draft.repeat.count);
    ['name', 'phone', 'email', 'notes', 'promoCode', 'companyCode'].forEach(function (k) { $('#' + k).value = draft[k] || ''; });
    ['hours', 'passengers', 'bags', 'childSeats'].forEach(function (k) { $('#' + k).textContent = draft[k]; });
  }

  function syncVisibility() {
    var s = draft.service;
    $$('[data-svc]').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.svc === s); });
    $$('[data-trip]').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.trip === draft.tripType); });
    $$('[data-when]').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.when === draft.whenMode); });
    $$('.vcard').forEach(function (c) { c.setAttribute('aria-checked', c.dataset.veh === draft.vehicleId); });
    $('#tripTypeSeg').hidden = s === 'hourly';
    $('#airportBox').hidden = s !== 'airport';
    $('#hoursBox').hidden = !(s === 'hourly' || s === 'event');
    $('#dropLbl').textContent = s === 'hourly' ? t('dropoffOpt') : t('dropoff');
    $('#whenAt').hidden = draft.whenMode !== 'later';
    $('#returnBox').hidden = !(draft.tripType === 'round' && s !== 'hourly');
    $('#repeatBox').hidden = draft.whenMode !== 'later';
    $('#repeatCount').hidden = !draft.repeat.freq;
    var places = App.cfg.places.filter(function (p) { return s === 'airport' ? p.type === 'airport' || p.type === 'hotel' : true; }).slice(0, 9);
    $('#chips').innerHTML = '<span class="chips-lbl">' + t('popular') + '</span>' + places.map(function (p) {
      return '<button type="button" class="chip" data-place="' + esc(p.id) + '"><i class="ptype t-' + p.type + '"></i>' + esc(p.name) + '</button>';
    }).join('');
    $$('.vcard').forEach(function (c) {
      var v = vehicle(c.dataset.veh), small = v && (draft.passengers > v.seats);
      $('[data-warn="' + c.dataset.veh + '"]').hidden = !small; c.classList.toggle('dim', !!small);
    });
    var pays = ['card', 'pos', 'transfer'].filter(function (m) { return App.cfg.payment[m]; });
    if (lastQuote && lastQuote.company && App.cfg.payment.invoice) pays.push('invoice');
    if (pays.indexOf(draft.payMethod) < 0) draft.payMethod = pays[0];
    $('#payOpts').innerHTML = pays.map(function (m) {
      return '<button type="button" role="radio" class="pay" data-pay="' + m + '" aria-checked="' + (draft.payMethod === m) + '"><span class="pay-ic">' + App.icon(PAY_IC[m] || 'card') + '</span><b>' + t('pm_' + m) + '</b><span>' + t('pmd_' + m) + '</span></button>';
    }).join('');
  }

  function bind() {
    var form = $('#bookForm');
    form.addEventListener('click', function (e) {
      var el = e.target.closest('button'); if (!el) return;
      var d = el.dataset;
      if (d.svc) { draft.service = d.svc; if (d.svc === 'airport' && draft.vehicleId === 'bus') draft.vehicleId = 'suv'; }
      else if (d.trip) draft.tripType = d.trip;
      else if (d.when) { draft.whenMode = d.when; if (d.when === 'later' && !draft.when) { draft.when = App.localInput(Date.now() + 2 * 3600e3).slice(0, 14) + '00'; $('#whenAt').value = draft.when; } }
      else if (d.veh) draft.vehicleId = d.veh;
      else if (d.pay) draft.payMethod = d.pay;
      else if (d.step) {
        var k = d.step, lim = { hours: [1, 24], passengers: [1, 60], bags: [0, 40], childSeats: [0, 4] }[k];
        draft[k] = Math.max(lim[0], Math.min(lim[1], draft[k] + Number(d.d)));
        $('#' + k).textContent = draft[k];
        if (k === 'passengers') autoVehicle();
      } else if (d.place) {
        var p = App.cfg.places.find(function (x) { return x.id === d.place; });
        draft[activeField] = { name: p.name, lat: p.lat, lng: p.lng, placeId: p.id };
        $('#' + activeField).value = p.name;
        activeField = activeField === 'pickup' ? 'dropoff' : 'pickup';
      } else if (el.id === 'swap') {
        var tmp = draft.pickup; draft.pickup = draft.dropoff; draft.dropoff = tmp; syncInputs();
      } else if (el.id === 'locate') return locate();
      else if (el.id === 'barPrice') { var bb = $('#barBreakdown'); bb.hidden = !bb.hidden; el.setAttribute('aria-expanded', String(!bb.hidden)); return; }
      else return;
      save(); syncVisibility(); refresh();
    });
    ['pickup', 'dropoff'].forEach(function (f) {
      var inp = $('#' + f);
      inp.addEventListener('focus', function () { activeField = f; });
      inp.addEventListener('input', function () { draft[f] = resolvePlace(inp.value, draft[f]); save(); refresh(); });
      inp.addEventListener('change', function () { geocode(f); });
    });
    var bindVal = function (id, key, after) { $('#' + id).addEventListener('input', function (e) { draft[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; save(); if (after) after(); }); };
    bindVal('name', 'name'); bindVal('phone', 'phone'); bindVal('email', 'email'); bindVal('notes', 'notes');
    bindVal('flight', 'flight'); bindVal('meetGreet', 'meetGreet', refresh);
    bindVal('whenAt', 'when', refresh); bindVal('returnAt', 'returnWhen', refresh);
    bindVal('promoCode', 'promoCode', refresh); bindVal('companyCode', 'companyCode', refresh);
    $('#meetGreet').addEventListener('change', function (e) { draft.meetGreet = e.target.checked; save(); refresh(); });
    $('#repeatFreq').addEventListener('change', function (e) { draft.repeat.freq = e.target.value; save(); syncVisibility(); });
    $('#repeatCount').addEventListener('change', function (e) { draft.repeat.count = +e.target.value; save(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); review(); });
    $('#assistGo').addEventListener('click', assist);
    $('#assistText').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); assist(); } });
    $$('[data-fav]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = store.get('favorites', [])[+b.dataset.fav];
        Object.assign(draft, { pickup: f.pickup, dropoff: f.dropoff, vehicleId: f.vehicleId, service: f.service || 'point' });
        save(); syncInputs(); syncVisibility(); refresh();
        $('#whenAt').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  function autoVehicle() {
    var v = vehicle(draft.vehicleId);
    if (v && v.seats >= draft.passengers) return;
    var fit = App.cfg.vehicles.filter(function (x) { return x.seats >= draft.passengers; }).sort(function (a, b) { return a.seats - b.seats; })[0];
    if (fit) draft.vehicleId = fit.id;
  }

  function locate() {
    if (!navigator.geolocation) return App.toast(t('locationOff'));
    App.toast(t('locating'));
    navigator.geolocation.getCurrentPosition(function (pos) {
      draft.pickup = { name: t('myLocation') + ' (' + pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4) + ')', lat: pos.coords.latitude, lng: pos.coords.longitude };
      save(); syncInputs(); refresh();
    }, function () { App.toast(t('locationOff')); }, { enableHighAccuracy: true, timeout: 10000 });
  }

  // ---------- AI / smart assistant ----------
  function assist() {
    var text = $('#assistText').value.trim(); if (!text) return;
    var btn = $('#assistGo'); btn.disabled = true; btn.textContent = t('assistWorking');
    App.API.call('POST', '/api/assist', { text: text }).then(function (r) {
      btn.disabled = false; btn.textContent = t('assistGo');
      if (r.status !== 200) return App.toast(App.errText(r));
      var d = r.body.draft, filled = [];
      ['pickup', 'dropoff', 'passengers', 'bags', 'vehicleId', 'service', 'tripType', 'hours', 'flight', 'notes'].forEach(function (k) {
        if (d[k] != null && d[k] !== '') { draft[k] = d[k]; filled.push(k); }
      });
      if (d.when && d.when !== 'now') { draft.whenMode = 'later'; draft.when = App.localInput(Date.parse(d.when)); filled.push('when'); }
      else if (d.when === 'now') draft.whenMode = 'now';
      if (draft.service === 'airport' && draft.vehicleId === 'bus') draft.vehicleId = 'suv';
      autoVehicle(); save(); syncInputs(); syncVisibility(); refresh();
      var missing = ['pickup', 'dropoff', 'when'].filter(function (k) { return filled.indexOf(k) < 0 && !(k === 'dropoff' && draft.service === 'hourly'); });
      var rep = $('#assistReply'); rep.hidden = false;
      rep.textContent = d.reply || (filled.length ? t('assistFilled', { n: filled.length }) + (missing.length ? ' ' + t('assistMissing', { list: missing.map(function (k) { return t('f_' + k); }).join(', ') }) : '') : t('assistNothing'));
      $$('.flash').forEach(function (x) { x.classList.remove('flash'); });
      filled.forEach(function (k) { var el = $('#' + ({ when: 'whenAt', vehicleId: 'bookForm .vcard[aria-checked=true]' }[k] || k)); if (el) el.classList.add('flash'); });
    });
  }

  // ---------- live pricing ----------
  function refresh() {
    if (mapCtl) mapCtl.update({ pickup: draft.pickup, dropoff: draft.dropoff });
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(function () {
      App.API.call('POST', '/api/quote', tripBody()).then(function (r) {
        if (!$('#bookForm')) return;
        if (r.status !== 200) { lastQuote = null; return; }
        lastQuote = r.body; paintQuote();
      });
    }, 180);
  }

  function paintQuote() {
    var r = lastQuote, q = r.quote;
    Object.keys(r.perVehicle || {}).forEach(function (id) {
      var el = $('[data-price="' + id + '"]'); if (!el) return;
      var v = vehicle(id), total = r.perVehicle[id];
      el.textContent = total != null ? App.money(total) : t('from') + ' ' + App.money(v.minFare);
      el.classList.toggle('exact', total != null);
    });
    var price = $('#price');
    price.textContent = q && q.total != null ? App.money(q.total) : (draft.pickup && (draft.dropoff || draft.service === 'hourly') ? t('quoteLater') : '—');
    $('#miles').textContent = q && q.miles != null ? t('milesAway', { n: q.miles, m: q.minutes }) : '';
    $('#barBreakdown').innerHTML = q && q.total != null ? App.breakdownHtml(q, q.total) : '';
    var pm = $('#promoMsg'), cm = $('#companyMsg');
    var pe = r.errors && r.errors.promo;
    pm.textContent = draft.promoCode ? (pe ? t('err_' + pe) : t('codeApplied')) : '';
    pm.className = 'fld-msg ' + (pe ? 'bad' : 'good');
    cm.textContent = draft.companyCode ? (r.errors && r.errors.company ? t('err_company_invalid') : t('companyOk', { name: r.company })) : '';
    cm.className = 'fld-msg ' + (r.errors && r.errors.company ? 'bad' : 'good');
    var mb = $('#memberBox'), m = r.member;
    mb.hidden = !m;
    if (m) {
      mb.innerHTML = '<div><b>' + t('hiMember', { name: esc(m.name.split(' ')[0]) }) + '</b> <span class="pill tier">' + esc(m.tier ? m.tier.name : '') + '</span>' +
        '<small>' + t('pointsBalance', { n: m.points, v: App.money(m.pointsValue) }) + '</small></div>' +
        (m.points > 0 ? '<label class="toggle"><input type="checkbox" id="usePoints"' + (draft.usePoints ? ' checked' : '') + '> ' + t('usePoints') + '</label>' : '');
      var up = $('#usePoints'); if (up) up.onchange = function () { draft.usePoints = up.checked; save(); refresh(); };
    }
    var hadInvoice = !!$('[data-pay="invoice"]');
    if (hadInvoice !== !!(r.company && App.cfg.payment.invoice)) syncVisibility();
  }

  function validate() {
    var v = vehicle(draft.vehicleId);
    if (!v) return t('errVehicle');
    if (!draft.pickup) return t('errPickup');
    if (!draft.dropoff && draft.service !== 'hourly') return t('errRoute');
    if (draft.whenMode === 'later' && (!draft.when || Date.parse(draft.when) < Date.now())) return t('errWhen');
    if (draft.tripType === 'round' && draft.service !== 'hourly' && (!draft.returnWhen || (draft.when && Date.parse(draft.returnWhen) <= Date.parse(draft.when)))) return t('errReturn');
    if (draft.repeat.freq && draft.whenMode !== 'later') return t('err_repeat_needs_date');
    if (draft.passengers > v.seats) return t('errSeats', { n: v.seats });
    if (!draft.name.trim()) return t('errName');
    if (draft.phone.replace(/\D/g, '').length < 7) return t('errPhone');
    if (lastQuote && lastQuote.errors && lastQuote.errors.promo) return t('err_' + lastQuote.errors.promo);
    return null;
  }

  function review() {
    var e = validate(), box = $('#formError');
    box.hidden = !e; box.textContent = e || '';
    if (e) { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    var v = vehicle(draft.vehicleId), q = lastQuote && lastQuote.quote;
    var rep = draft.whenMode === 'later' && draft.repeat.freq;
    App.openSheet(
      '<h2>' + t('reviewTitle') + '</h2>' +
      '<dl class="summary">' +
        '<dt>' + t('service') + '</dt><dd>' + App.serviceName(draft.service) + (draft.tripType === 'round' && draft.service !== 'hourly' ? ' · ' + t('roundTrip') : '') + '</dd>' +
        '<dt>' + t('vehicle') + '</dt><dd>' + esc(v.name) + '</dd>' +
        '<dt>' + t('pickup') + '</dt><dd>' + esc(draft.pickup.name) + '</dd>' +
        '<dt>' + t('dropoff') + '</dt><dd>' + esc(draft.dropoff ? draft.dropoff.name : t('asDirected')) + '</dd>' +
        '<dt>' + t('when') + '</dt><dd>' + esc(draft.whenMode === 'later' ? App.fmtTime(draft.when) : t('asap')) +
          (rep ? '<br><small>' + t('rep_' + draft.repeat.freq) + ' · ' + t('times', { n: draft.repeat.count }) + '</small>' : '') + '</dd>' +
        (draft.tripType === 'round' && draft.returnWhen ? '<dt>' + t('returnTime') + '</dt><dd>' + esc(App.fmtTime(draft.returnWhen)) + '</dd>' : '') +
        (draft.service === 'airport' && draft.flight ? '<dt>' + t('flightNo') + '</dt><dd>' + esc(draft.flight.toUpperCase()) + '</dd>' : '') +
        '<dt>' + t('passengers') + '</dt><dd>' + draft.passengers + ' · ' + t('bagsN', { n: draft.bags }) + '</dd>' +
        '<dt>' + t('payment') + '</dt><dd>' + App.payName(draft.payMethod) + '</dd>' +
      '</dl>' + (q && q.total != null ? App.breakdownHtml(q, q.total) : '<p class="note">' + t('quoteLater') + '</p>') +
      (rep ? '<p class="fine">' + t('repeatNote') + '</p>' : '') +
      '<label class="toggle"><input type="checkbox" id="saveFav" checked> ' + t('saveFavorite') + '</label>' +
      '<p class="fine">' + t('reviewFine') + '</p>' +
      '<div class="sheet-actions"><button class="btn ghost" data-close>' + t('edit') + '</button><button class="btn primary" id="sendRide">' + (draft.payMethod === 'card' ? t('confirmPay') : t('confirmSend')) + '</button></div>', true);
    $('#sendRide').addEventListener('click', function (ev) {
      ev.target.disabled = true;
      var body = Object.assign(tripBody(), { name: draft.name, phone: draft.phone, email: draft.email, notes: draft.notes, payMethod: draft.payMethod,
        source: App.source, lang: App.lang, saveFavorite: $('#saveFav').checked, repeat: rep ? draft.repeat : null });
      App.API.call('POST', '/api/bookings', body).then(function (r) {
        if (r.status !== 200) { ev.target.disabled = false; App.toast(App.errText(r), 'bad'); return; }
        store.set('customerToken', r.body.customerToken);
        (r.body.series || [{ code: r.body.code, token: r.body.token }]).slice().reverse().forEach(function (s) { App.rememberTrip(s.code, s.token); });
        if ($('#saveFav').checked) {
          var favs = store.get('favorites', []), label = draft.pickup.name.split(',')[0] + ' → ' + (draft.dropoff ? draft.dropoff.name.split(',')[0] : t('asDirected'));
          if (!favs.some(function (f) { return f.label === label; })) { favs.unshift({ label: label, pickup: draft.pickup, dropoff: draft.dropoff, vehicleId: draft.vehicleId, service: draft.service }); store.set('favorites', favs.slice(0, 6)); }
        }
        Object.assign(draft, { pickup: null, dropoff: null, notes: '', whenMode: 'now', when: '', returnWhen: '', flight: '', meetGreet: false, repeat: { freq: '', count: 4 }, promoCode: '', usePoints: false, tripType: 'oneway' });
        save(); App.closeSheet();
        if (body.payMethod === 'card' && App.cfg.features.card && !App.cfg.features.demoCard) App.startCheckout(r.body.code, r.body.token);
        else location.hash = 'track-' + r.body.code;
      });
    });
  }
})();
