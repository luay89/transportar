/* Customer after booking: live trip status and driver position, flight status,
 * online payment, receipt, rating, recurring series; account with loyalty and
 * referrals; corporate portal. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, $$ = App.$$, esc = App.esc, t = App.t, store = App.store;
  var mapCtl = null, confirmed = {};

  App.startCheckout = function (code, token) {
    App.toast(t('toPayment'));
    App.API.call('POST', '/api/bookings/' + code + '/checkout', { t: token }).then(function (r) {
      if (r.status === 200 && r.body.url) location.href = r.body.url;
      else { App.toast(App.errText(r), 'bad'); location.hash = 'track-' + code; }
    });
  };

  App.views.track = function (code) {
    // A shared link carries the trip key after a dot, so family can follow along on their own phone.
    var dot = code.indexOf('.');
    if (dot > 0) {
      var tok = code.slice(dot + 1); code = code.slice(0, dot);
      if (!App.trips().some(function (x) { return x.code === code; })) { App.rememberTrip(code, tok); var L = App.trips(); L[0].shared = true; store.set('trips', L); }
      history.replaceState(null, '', '#track-' + code);
    }
    var rec = App.trips().find(function (x) { return x.code === code; });
    if (!rec) { $('#main').innerHTML = '<section class="block"><h2>' + t('notFound') + '</h2><p><a class="btn primary" href="#book">' + t('navBook') + '</a></p></section>'; return; }
    $('#main').innerHTML = '<section class="track" id="track"><p class="muted">' + t('loading') + '</p></section>';
    mapCtl = null;
    App.poll(function () {
      if (!$('#sheet').hidden) return;
      App.API.call('POST', '/api/bookings/' + code, { t: rec.token }).then(function (r) {
        if (r.status !== 200 || !$('#track')) return;
        var b = r.body.booking;
        if (b.payMethod === 'card' && b.payStatus !== 'paid' && App.cfg.features.card && !App.cfg.features.demoCard && !confirmed[code]) {
          confirmed[code] = true;
          App.API.call('POST', '/api/bookings/' + code + '/checkout-confirm', { t: rec.token });
        }
        draw(b, rec);
      });
    }, 5000);
  };

  function draw(b, rec) {
    var keep = { ref: $('#txRef') ? $('#txRef').value : '', comment: $('#rateComment') ? $('#rateComment').value : '', stars: App.rateDraft || {} };
    var hist = {}; b.history.forEach(function (h) { if (h.status !== 'flight') hist[h.status] = h.at; });
    var steps = window.TR.core.FLOW.map(function (s) {
      var done = hist[s] != null && b.status !== 'cancelled', cur = s === b.status;
      return '<li class="' + (done ? 'done' : '') + (cur ? ' cur' : '') + '"><span>' + t('st_' + s) + '</span><time>' + (hist[s] ? App.clock(hist[s]) : '') + '</time></li>';
    }).join('');
    var d = b.driver, P = App.cfg.payment;
    var payBody;
    if (b.payStatus === 'paid') payBody = '<p>' + t('paidThanks') + '</p><a class="btn" href="#receipt-' + esc(b.code) + '">' + t('viewReceipt') + '</a>';
    else if (b.payMethod === 'card') payBody = '<p>' + t('cardInstructions') + '</p><button class="btn primary" id="payNow">' + t('payNow', { total: App.money(b.price) }) + '</button>' +
      '<p class="wallets"><span>Visa</span><span>Mastercard</span><span>Amex</span><span> Pay</span><span>G Pay</span></p>';
    else if (b.payMethod === 'pos') payBody = '<p>' + t('posInstructions') + '</p>';
    else if (b.payMethod === 'invoice') payBody = '<p>' + t('invoiceInstructions', { company: esc(b.company || '') }) + '</p>';
    else payBody = '<p>' + t('transferInstructions', { total: App.money(b.price) }) + '</p><dl class="bank">' +
      bankRow(t('bankName'), P.bankName) + bankRow(t('accountName'), P.accountName) + bankRow(t('routing'), P.routing) + bankRow(t('account'), P.account) +
      (P.zelle ? bankRow('Zelle', P.zelle) : '') + bankRow(t('memo'), b.code) + '</dl>' + (P.note ? '<p class="fine">' + esc(P.note) + '</p>' : '') +
      (b.payStatus === 'unpaid' ? '<div class="row"><input id="txRef" placeholder="' + esc(t('txRefPh')) + '" value="' + esc(keep.ref) + '"><button class="btn" id="txSent">' + t('iSentIt') + '</button></div>' : '');

    var f = b.flight;
    var flightCard = f && f.number ? '<div class="flight-card"><div><small>' + t('flight') + '</small><strong class="mono">' + esc(f.number) + '</strong></div>' +
      '<div><small>' + t('flightStatus') + '</small><span class="pill fl-' + esc(f.status || 'scheduled') + '">' + t('fl_' + (f.status || 'scheduled')) + '</span></div>' +
      (f.estimatedArr ? '<div><small>' + t('lands') + '</small><strong>' + App.clock(f.estimatedArr) + '</strong></div>' : '') +
      (b.originalWhen ? '<p class="fine">' + t('pickupMoved', { time: App.fmtTime(b.when) }) + '</p>' : '<p class="fine">' + t('flightWatch') + '</p>') + '</div>' : '';

    var rating = '';
    if (b.status === 'completed' && !b.rating) {
      rating = '<div class="rate-box" id="rateBox"><h3>' + t('rateTitle') + '</h3>' + stars('driver', t('rateDriver'), keep.stars.driver) + stars('ride', t('rateRide'), keep.stars.ride) +
        '<textarea id="rateComment" rows="2" placeholder="' + esc(t('rateCommentPh')) + '">' + esc(keep.comment) + '</textarea><button class="btn primary" id="rateSend">' + t('rateSend') + '</button></div>';
    } else if (b.rating) rating = '<p class="note good">' + t('rated', { n: b.rating.ride }) + '</p>';

    var FLOW = window.TR.core.FLOW, idx = Math.max(0, FLOW.indexOf(b.status));
    var pct = b.status === 'cancelled' ? 100 : Math.max(6, Math.round(idx / (FLOW.length - 1) * 100));
    var ST_IC = { pending: 'radar', accepted: 'check', enroute: 'car', arrived: 'pin', ontrip: 'route', completed: 'flag', cancelled: 'flag' };
    var ring = b.eta != null && b.status === 'enroute'
      ? '<div class="eta-ring" style="--p:' + Math.max(8, Math.min(100, 100 - b.eta * 4)) + '"><strong>' + b.eta + '</strong><small>' + t('minutes', { n: '' }).trim() + '</small></div>' : '';
    var brandPhone = (App.cfg.brand.phone || '').replace(/[^\d+]/g, '');
    var safety = b.status === 'cancelled' ? '' : '<div class="safety"><h3><span class="h-ic">' + App.icon('shield') + '</span>' + t('safetyTitle') + '</h3><ul>' +
      (d ? '<li><span class="s-ic ok">' + App.icon('check') + '</span><span><b>' + t('verifiedDriver') + '</b><small>' + t('verifiedSub') + '</small></span></li>' : '') +
      '<li><button type="button" id="shareTrip"><span class="s-ic">' + App.icon('share') + '</span><span><b>' + t('shareTrip') + '</b><small>' + t('shareTripSub') + '</small></span></button></li>' +
      (brandPhone ? '<li><a href="tel:' + esc(brandPhone) + '"><span class="s-ic">' + App.icon('headset') + '</span><span><b>' + t('needHelp') + '</b><small>' + t('needHelpSub') + '</small></span></a></li>' : '') +
      '</ul></div>';

    $('#track').innerHTML =
      '<header class="track-head"><div><p class="eyebrow">' + App.serviceName(b.service) + (b.tripType === 'round' ? ' · ' + t('roundTrip') : '') + '</p><h1 class="code">' + esc(b.code) + '</h1></div>' + App.statusPill(b.status) + '</header>' +
      '<div class="status-hero st-h-' + esc(b.status) + '"><span class="sh-ic">' + App.icon(ST_IC[b.status] || 'car') + '</span>' +
        '<div class="sh-text"><strong>' + t('st_' + b.status) + '</strong><p>' + t('msg_' + b.status) + '</p>' +
        '<div class="sh-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="--w:' + pct + '%"></i></div></div>' + ring + '</div>' +
      '<div class="track-grid"><div class="col">' +
        (b.status === 'cancelled' ? '<p class="note bad">' + t('cancelledNote') + '</p>' : '<ol class="timeline">' + steps + '</ol>') +
        flightCard +
        (d ? '<div class="driver-card"><div class="avatar" aria-hidden="true">' + esc(d.name.slice(0, 1)) + '<span class="verified">' + App.icon('check') + '</span></div><div><small>' + t('yourDriver') + '</small><strong>' + esc(d.name) + (d.rating ? ' <span class="stars-sm">★ ' + d.rating + '</span>' : '') + '</strong><span class="plate">' + esc(d.plate) + '</span></div>' +
          (b.eta != null && b.status === 'enroute' ? '<div class="eta"><small>' + t('eta') + '</small><strong>' + t('minutes', { n: b.eta }) + '</strong></div>' : '') +
          '<a class="btn" href="tel:' + esc(d.phone.replace(/[^\d+]/g, '')) + '">' + App.icon('phone') + t('call') + '</a></div>' +
          (['enroute', 'arrived', 'ontrip'].indexOf(b.status) >= 0 && !d.location ? '<p class="fine">' + t('locationSoon') + '</p>' : '')
          : '') +
        '<div class="map" id="tmap"></div>' +
        safety + rating +
      '</div><div class="col">' +
        '<dl class="summary">' +
          '<dt>' + t('vehicle') + '</dt><dd>' + esc(b.vehicle ? b.vehicle.name : b.vehicleId) + '</dd>' +
          '<dt>' + t('pickup') + '</dt><dd>' + esc(b.pickup.name) + '</dd>' +
          '<dt>' + t('dropoff') + '</dt><dd>' + esc(b.dropoff.asDirected ? t('asDirected') : b.dropoff.name) + '</dd>' +
          '<dt>' + t('when') + '</dt><dd>' + esc(App.fmtTime(b.when)) + '</dd>' +
          (b.returnWhen ? '<dt>' + t('returnTime') + '</dt><dd>' + esc(App.fmtTime(b.returnWhen)) + '</dd>' : '') +
          (b.hours ? '<dt>' + t('hours') + '</dt><dd>' + b.hours + '</dd>' : '') +
          '<dt>' + t('passengers') + '</dt><dd>' + b.passengers + ' · ' + t('bagsN', { n: b.bags }) + '</dd>' +
        '</dl>' +
        (b.price != null ? App.breakdownHtml(b.breakdown, b.price) : '<p class="note">' + t('quoteLater') + '</p>') +
        (b.pointsEarned ? '<p class="fine">' + t('willEarn', { n: b.pointsEarned }) + '</p>' : '') +
        '<div class="pay-box"><h3>' + App.payName(b.payMethod) + ' ' + App.payPill(b) + '</h3>' + payBody + '</div>' +
        (b.seriesCodes ? '<div class="series"><h3>' + t('seriesTitle') + '</h3><ul>' + b.seriesCodes.map(function (s) {
          return '<li><a href="#track-' + esc(s.code) + '">' + esc(s.code) + '</a><span>' + esc(App.fmtTime(s.when)) + '</span>' + App.statusPill(s.status) + '</li>';
        }).join('') + '</ul></div>' : '') +
        '<div class="row">' + (!rec.shared && (b.status === 'pending' || b.status === 'accepted') ? '<button class="btn ghost danger" id="cancelRide">' + t('cancelRide') + '</button>' : '') +
          '<button class="btn ghost" id="favRide">' + App.icon('heart') + ' ' + t('saveFavorite') + '</button></div>' +
      '</div></div>';

    var pts = { pickup: b.pickup, dropoff: b.dropoff.asDirected ? null : b.dropoff, driver: d && d.location };
    mapCtl = App.mapView($('#tmap'), pts);

    $$('[data-copy]', $('#track')).forEach(function (el) { el.onclick = function () { App.copy(el.dataset.copy); }; });
    var share = $('#shareTrip');
    if (share) share.onclick = function () {
      var url = location.href.split('#')[0] + '#track-' + b.code + '.' + rec.token, text = t('shareText', { code: b.code });
      if (navigator.share) navigator.share({ title: App.cfg.brand.name, text: text, url: url }).catch(function () { /* closed */ });
      else App.copy(text + ' ' + url);
    };
    var pay = $('#payNow');
    if (pay) pay.onclick = function () { if (App.cfg.features.demoCard) demoCard(b, rec); else App.startCheckout(b.code, rec.token); };
    var sent = $('#txSent');
    if (sent) sent.onclick = function () {
      App.API.call('POST', '/api/bookings/' + b.code + '/transfer-sent', { t: rec.token, ref: $('#txRef').value }).then(function (r) {
        if (r.status === 200) { App.toast(t('transferNoted')); draw(r.body.booking, rec); }
      });
    };
    var cancel = $('#cancelRide');
    if (cancel) cancel.onclick = function () {
      App.openSheet('<h2>' + t('cancelQ') + '</h2>' + (b.seriesId ? '<label class="toggle"><input type="checkbox" id="cancelSeries"> ' + t('cancelSeries') + '</label>' : '') +
        '<div class="sheet-actions"><button class="btn ghost" data-close>' + t('keepRide') + '</button><button class="btn primary danger" id="yesCancel">' + t('cancelRide') + '</button></div>');
      $('#yesCancel').onclick = function () {
        App.API.call('POST', '/api/bookings/' + b.code + '/cancel', { t: rec.token, series: $('#cancelSeries') && $('#cancelSeries').checked }).then(function (r) {
          App.closeSheet();
          if (r.status === 200) draw(r.body.booking, rec); else App.toast(t('errTooLate'), 'bad');
        });
      };
    };
    $('#favRide').onclick = function () {
      var favs = store.get('favorites', []), label = b.pickup.name.split(',')[0] + ' → ' + (b.dropoff.asDirected ? t('asDirected') : b.dropoff.name.split(',')[0]);
      if (!favs.some(function (x) { return x.label === label; })) favs.unshift({ label: label, pickup: b.pickup, dropoff: b.dropoff.asDirected ? null : b.dropoff, vehicleId: b.vehicleId, service: b.service });
      store.set('favorites', favs.slice(0, 6));
      App.API.call('POST', '/api/bookings/' + b.code + '/favorite', { t: rec.token });
      App.toast(t('favSaved'));
    };
    var rb = $('#rateBox');
    if (rb) {
      App.rateDraft = keep.stars;
      rb.onclick = function (e) {
        var s = e.target.closest('[data-star]'); if (!s) return;
        App.rateDraft[s.dataset.kind] = +s.dataset.star;
        $$('[data-kind="' + s.dataset.kind + '"]').forEach(function (x) { x.setAttribute('aria-pressed', String(+x.dataset.star <= +s.dataset.star)); });
      };
      $('#rateSend').onclick = function () {
        var r0 = App.rateDraft;
        if (!r0.driver || !r0.ride) return App.toast(t('rateNeedStars'));
        App.API.call('POST', '/api/bookings/' + b.code + '/rate', { t: rec.token, driver: r0.driver, ride: r0.ride, comment: $('#rateComment').value }).then(function (r) {
          if (r.status === 200) { App.rateDraft = {}; App.toast(t('rateThanks')); draw(r.body.booking, rec); }
        });
      };
    }
  }
  function stars(kind, label, val) {
    var out = '<div class="stars"><span>' + label + '</span><div role="group" aria-label="' + esc(label) + '">';
    for (var i = 1; i <= 5; i++) out += '<button type="button" data-star="' + i + '" data-kind="' + kind + '" aria-pressed="' + (val >= i) + '" aria-label="' + i + '">★</button>';
    return out + '</div></div>';
  }
  function bankRow(k, v) { return '<dt>' + esc(k) + '</dt><dd><span class="mono">' + esc(v) + '</span> <button class="link" data-copy="' + esc(v) + '">' + t('copy') + '</button></dd>'; }

  // Demo checkout: shows what the card step looks like without charging anything.
  function demoCard(b, rec) {
    App.openSheet('<h2>' + t('payNow', { total: App.money(b.price) }) + '</h2><p class="fine">' + t('demoCardNote') + '</p>' +
      '<div class="wallet-row"><button class="btn wallet" data-w="apple"> Pay</button><button class="btn wallet" data-w="google">G Pay</button></div>' +
      '<p class="or">' + t('orCard') + '</p>' +
      '<label class="fld" for="ccNum"><span>' + t('cardNumber') + '</span><input id="ccNum" inputmode="numeric" value="4242 4242 4242 4242"></label>' +
      '<div class="grid2"><label class="fld" for="ccExp"><span>MM/YY</span><input id="ccExp" value="12/30"></label><label class="fld" for="ccCvc"><span>CVC</span><input id="ccCvc" value="123"></label></div>' +
      '<div class="sheet-actions"><button class="btn ghost" data-close>' + t('back') + '</button><button class="btn primary" id="ccPay">' + t('payNow', { total: App.money(b.price) }) + '</button></div>');
    var go = function () {
      App.API.call('POST', '/api/bookings/' + b.code + '/pay-demo', { t: rec.token }).then(function (r) {
        App.closeSheet();
        if (r.status === 200) { App.toast(t('paidThanks'), 'good'); draw(r.body.booking, rec); }
      });
    };
    $('#ccPay').onclick = go; $$('[data-w]').forEach(function (x) { x.onclick = go; });
  }

  // ---------- receipt ----------
  App.views.receipt = function (code) {
    var rec = App.trips().find(function (x) { return x.code === code; });
    if (!rec) { $('#main').innerHTML = '<p class="muted">' + t('notFound') + '</p>'; return; }
    App.API.call('POST', '/api/bookings/' + code, { t: rec.token }).then(function (r) {
      if (r.status !== 200) return;
      var b = r.body.booking, B = App.cfg.brand;
      $('#main').innerHTML = '<article class="receipt">' +
        '<header><div>' + (B.logo ? '<img class="r-logo" src="' + esc(B.logo) + '" alt="">' : '') + '<h1>' + esc(B.name) + '</h1><p>' + esc(B.phone) + ' · ' + esc(B.email) + '</p></div>' +
        '<div class="r-meta"><p class="eyebrow">' + t('receipt') + '</p><strong class="mono">' + esc(b.receiptNo || '—') + '</strong><span>' + (b.paidAt ? App.date(b.paidAt) : t('pay_unpaid')) + '</span></div></header>' +
        '<dl class="summary">' +
          '<dt>' + t('booking') + '</dt><dd class="mono">' + esc(b.code) + '</dd>' +
          '<dt>' + t('customer') + '</dt><dd>' + esc(b.customer.name) + (b.company ? ' · ' + esc(b.company) : '') + '</dd>' +
          '<dt>' + t('service') + '</dt><dd>' + App.serviceName(b.service) + ' · ' + esc(b.vehicle ? b.vehicle.name : '') + '</dd>' +
          '<dt>' + t('pickup') + '</dt><dd>' + esc(b.pickup.name) + '</dd>' +
          '<dt>' + t('dropoff') + '</dt><dd>' + esc(b.dropoff.asDirected ? t('asDirected') : b.dropoff.name) + '</dd>' +
          '<dt>' + t('when') + '</dt><dd>' + esc(App.fmtTime(b.when)) + '</dd>' +
          (b.driver ? '<dt>' + t('driver') + '</dt><dd>' + esc(b.driver.name) + ' · ' + esc(b.driver.plate) + '</dd>' : '') +
          '<dt>' + t('payment') + '</dt><dd>' + App.payName(b.payMethod) + ' · ' + t('pay_' + b.payStatus) + '</dd>' +
        '</dl>' + App.breakdownHtml(b.breakdown, b.price) +
        '<p class="fine">' + t('receiptThanks') + '</p>' +
        '<div class="row no-print"><a class="btn ghost" href="#track-' + esc(b.code) + '">' + t('back') + '</a>' + (App.API.mode === 'server' ? '<button class="btn primary" id="printR">' + t('printReceipt') + '</button>' : '') + '</div></article>';
      var pr = $('#printR'); if (pr) pr.onclick = function () { window.print(); };
    });
  };

  // ---------- my account ----------
  App.views.trips = function () {
    var ct = store.get('customerToken');
    var main = $('#main');
    main.innerHTML = '<section class="account" id="acct"><p class="muted">' + t('loading') + '</p></section>';
    if (!ct) return drawLocal();
    App.API.call('POST', '/api/me', { customerToken: ct }).then(function (r) {
      if (r.status !== 200) return drawLocal();
      var p = r.body.profile, tiers = App.cfg.pricing.tiers || [];
      var next = p.nextTier, cur = p.tier;
      var span = next ? (next.ridesLeft + p.rides - (cur ? cur.rides : 0)) : 1, prog = next ? Math.round((p.rides - (cur ? cur.rides : 0)) / span * 100) : 100;
      $('#acct').innerHTML =
        '<header class="track-head"><div><p class="eyebrow">' + t('navTrips') + '</p><h1>' + esc(p.name) + '</h1></div><span class="pill tier big">' + esc(cur ? cur.name : '') + '</span></header>' +
        '<div class="kpis">' + kpi(t('points'), p.points, t('worth', { v: App.money(p.pointsValue) })) + kpi(t('ridesTaken'), p.rides) + kpi(t('memberPerk'), cur && cur.pct ? cur.pct + '%' : '—', t('offEveryRide')) + '</div>' +
        '<div class="two"><div class="panel"><h3>' + t('tierProgress') + '</h3>' +
          (next ? '<div class="progress"><i style="--w:' + prog + '%"></i></div><p class="fine">' + t('ridesToTier', { n: next.ridesLeft, tier: esc(next.name), pct: next.pct }) + '</p>' : '<p>' + t('topTier') + '</p>') +
          '<ul class="tiers">' + tiers.map(function (x) { return '<li class="' + (cur && x.name === cur.name ? 'on' : '') + '"><b>' + esc(x.name) + '</b><span>' + t('tierRule', { n: x.rides, pct: x.pct }) + '</span></li>'; }).join('') + '</ul></div>' +
        '<div class="panel"><h3>' + t('referTitle') + '</h3><p>' + t('referBody', { give: App.money(App.cfg.pricing.refereeDiscount), get: App.money(App.cfg.pricing.referrerCredit) }) + '</p>' +
          '<div class="refcode"><strong class="mono">' + esc(p.referralCode) + '</strong><button class="btn" id="copyRef">' + t('copy') + '</button></div></div></div>' +
        (p.favorites.length ? '<div class="panel"><h3>' + t('favorites') + '</h3><ul class="mini">' + p.favorites.map(function (f, i) {
          return '<li><span>★</span><span>' + esc(f.label) + '</span><button class="link" data-rmfav="' + i + '">' + t('remove') + '</button></li>';
        }).join('') + '</ul></div>' : '') +
        '<div class="panel"><h3>' + t('rideHistory') + '</h3><ul class="trip-list">' + r.body.bookings.map(function (b) {
          App.rememberTripQuiet(b.code, b.token);
          return '<li><a href="#track-' + esc(b.code) + '"><span class="mono">' + esc(b.code) + '</span><span>' + esc(b.pickup) + ' → ' + esc(b.dropoff) + '</span><span>' + esc(App.fmtTime(b.when)) + '</span>' + App.statusPill(b.status) + '</a></li>';
        }).join('') + '</ul></div>';
      $('#copyRef').onclick = function () { App.copy(p.referralCode); };
      $$('[data-rmfav]').forEach(function (x) { x.onclick = function () { App.API.call('POST', '/api/me', { customerToken: ct, removeFavorite: +x.dataset.rmfav }).then(App.views.trips); }; });
    });
    function drawLocal() {
      var list = App.trips();
      $('#acct').innerHTML = '<h1>' + t('navTrips') + '</h1>' + (list.length ? '<ul class="trip-list">' + list.map(function (x) { return '<li><a href="#track-' + esc(x.code) + '"><span class="mono">' + esc(x.code) + '</span><span>' + esc(App.fmtTime(x.at)) + '</span></a></li>'; }).join('') + '</ul>'
        : '<p class="muted">' + t('noTrips') + '</p><a class="btn primary" href="#book">' + t('navBook') + '</a>');
    }
  };
  App.rememberTripQuiet = function (code, token) { if (!App.trips().some(function (x) { return x.code === code; })) App.rememberTrip(code, token); };
  function kpi(label, val, sub, icon) {
    return '<div class="kpi' + (icon ? ' has-ic' : '') + '">' + (icon ? '<span class="kpi-ic">' + App.icon(icon) + '</span>' : '') + '<small>' + label + '</small><strong>' + val + '</strong>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>';
  }
  App.kpi = kpi;

  // ---------- corporate portal ----------
  App.views.company = function () {
    var tk = store.get('companyToken');
    if (!tk) {
      $('#main').innerHTML = App.loginBox(t('companyTitle'), t('password'), 'password', 'text', App.API.mode === 'demo' ? t('demoCompany') : '',
        '<label class="fld" for="coCode"><span>' + t('companyLabel') + '</span><input id="coCode" autocapitalize="characters" required></label>');
      $('#loginForm').onsubmit = function (e) {
        e.preventDefault();
        App.API.call('POST', '/api/company/login', { code: $('#coCode').value, password: $('#secret').value }).then(function (r) {
          if (r.status !== 200) return App.loginErr(r);
          store.set('companyToken', r.body.token); App.views.company();
        });
      };
      return;
    }
    App.API.call('GET', '/api/company/state', null, tk).then(function (r) {
      if (r.status === 401) { store.set('companyToken', null); return App.views.company(); }
      App.renderCompanyReport($('#main'), r.body, function () { store.set('companyToken', null); App.views.company(); });
    });
  };
  App.renderCompanyReport = function (el, d, onLogout) {
    var c = d.company;
    el.innerHTML = '<section class="ops"><header class="ops-head"><div><p class="eyebrow">' + t('companyTitle') + '</p><h1>' + esc(c.name) + '</h1><p class="fine">' + t('companyTerms', { code: esc(c.code), pct: c.discountPct }) + '</p></div>' +
      (onLogout ? '<button class="btn ghost" id="coOut">' + t('logout') + '</button>' : '') + '</header>' +
      '<div class="panel"><h3>' + t('monthlyInvoices') + '</h3>' + (d.months.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + t('month') + '</th><th>' + t('rides') + '</th><th>' + t('total') + '</th><th>' + t('unpaid') + '</th><th>' + t('status') + '</th></tr></thead><tbody>' +
        d.months.map(function (m) {
          return '<tr><td>' + esc(m.month) + '</td><td class="num">' + m.rides + '</td><td class="num">' + App.money(m.total) + '</td><td class="num">' + App.money(m.unpaid) + '</td><td>' +
            (m.invoice ? '<span class="pill ' + (m.invoice.status === 'paid' ? 'pay-paid' : 'st-pending') + '">' + t('inv_' + m.invoice.status) + '</span>' : '<span class="pill">' + t('inv_open') + '</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">' + t('noRides') + '</p>') + '</div>' +
      '<div class="panel"><div class="panel-head"><h3>' + t('rideLog') + '</h3>' + (App.API.mode === 'server' ? '<button class="btn sm" id="csv">' + t('downloadCsv') + '</button>' : '') + '</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + t('booking') + '</th><th>' + t('when') + '</th><th>' + t('employee') + '</th><th>' + t('route') + '</th><th>' + t('vehicle') + '</th><th>' + t('total') + '</th><th>' + t('status') + '</th></tr></thead><tbody>' +
        d.rides.map(function (b) {
          return '<tr><td class="mono">' + esc(b.code) + '</td><td>' + esc(App.fmtTime(b.when)) + '</td><td>' + esc(b.employee) + '</td><td>' + esc(b.pickup) + '<br><small>→ ' + esc(b.dropoff) + '</small></td><td>' + esc(b.vehicle) + '</td><td class="num">' + App.money(b.price) + '</td><td>' + App.statusPill(b.status) + '</td></tr>';
        }).join('') + '</tbody></table></div></div></section>';
    if (onLogout) $('#coOut').onclick = onLogout;
    var csv = $('#csv');
    if (csv) csv.onclick = function () {
      var rows = [['code', 'date', 'employee', 'phone', 'pickup', 'dropoff', 'vehicle', 'price', 'status', 'payment']].concat(d.rides.map(function (b) {
        return [b.code, b.when, b.employee, b.phone, b.pickup, b.dropoff, b.vehicle, b.price, b.status, b.payStatus];
      }));
      var text = rows.map(function (r) { return r.map(function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = c.code + '-rides.csv'; a.click();
    };
  };
})();
