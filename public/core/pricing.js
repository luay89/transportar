/* Automatic pricing: distance, zones, vehicle, time of day, passengers, extras,
 * round trips, then promo / member / company discounts and loyalty points.
 * Every rule lives in tenant settings so the owner edits it from the dashboard. */
(function (root) {
  'use strict';
  var TR = root.TR = root.TR || {};
  var U = TR.util;

  var SERVICES = ['point', 'airport', 'hourly', 'event'];

  function defaults() {
    return {
      timezone: 'America/Chicago',
      nightPct: 15, nightStart: 22, nightEnd: 5,
      weekendPct: 0,
      peaks: [{ days: [1, 2, 3, 4, 5], from: 7, to: 9, pct: 10 }, { days: [1, 2, 3, 4, 5], from: 16, to: 19, pct: 10 }],
      eventPct: 20,
      roundTripDiscountPct: 10,
      paxIncluded: 4, extraPassengerFee: 0,
      childSeatFee: 15, meetGreetFee: 25,
      pointsPerDollar: 1, pointValueCents: 5, maxPointsPct: 50,
      tiers: [{ name: 'Member', rides: 0, pct: 0 }, { name: 'Gold', rides: 5, pct: 5 }, { name: 'VIP', rides: 15, pct: 10 }],
      referrerCredit: 10, refereeDiscount: 10,
      gratuityPct: 0
    };
  }

  function findPlace(places, p) {
    if (!p) return null;
    return places.find(function (x) { return (p.placeId && x.id === p.placeId) || x.name === p.name; }) || null;
  }

  function surchargePct(R, ts) {
    var lp = U.localParts(ts, R.timezone), out = [];
    var night = R.nightStart > R.nightEnd ? (lp.hour >= R.nightStart || lp.hour < R.nightEnd) : (lp.hour >= R.nightStart && lp.hour < R.nightEnd);
    if (R.nightPct && night) out.push({ k: 'night', pct: R.nightPct });
    if (R.weekendPct && (lp.day === 0 || lp.day === 6)) out.push({ k: 'weekend', pct: R.weekendPct });
    (R.peaks || []).forEach(function (p) {
      if (p.pct && (p.days || []).indexOf(lp.day) >= 0 && lp.hour >= p.from && lp.hour < p.to) out.push({ k: 'peak', pct: p.pct });
    });
    return out;
  }

  function tierFor(R, rides) {
    var t = null;
    (R.tiers || []).forEach(function (x) { if (rides >= x.rides && (!t || x.rides >= t.rides)) t = x; });
    return t;
  }

  /* settings: tenant settings; inp: trip request; ctx: { promo, tierPct, companyPct, points } */
  function quote(settings, inp, ctx) {
    ctx = ctx || {};
    var R = Object.assign(defaults(), settings.pricing || {});
    var v = settings.vehicles.find(function (x) { return x.id === inp.vehicleId; });
    if (!v) return { error: 'vehicle' };
    var service = SERVICES.indexOf(inp.service) >= 0 ? inp.service : 'point';
    var lines = [], m = U.roadMiles(inp.pickup, inp.dropoff);
    var when = inp.when && inp.when !== 'now' ? Date.parse(inp.when) : Date.now();
    var hours = U.clamp(U.num(inp.hours, 0), 0, 24);
    var hourlyMode = service === 'hourly' || (service === 'event' && hours > 0);
    var fare = 0;

    if (hourlyMode) {
      var h = Math.max(hours || 0, v.minHours || 2);
      fare = (v.hourly || 0) * h;
      lines.push({ k: 'hourly', p: { h: h, rate: v.hourly || 0 }, amount: fare });
    } else {
      if (m == null) return { miles: null, needsQuote: true, total: null, lines: [], discounts: [] };
      fare = (v.base || 0) + (v.perMile || 0) * m;
      lines.push({ k: 'base', amount: v.base || 0 });
      lines.push({ k: 'distance', p: { mi: U.round2(m), rate: v.perMile || 0 }, amount: (v.perMile || 0) * m });
      if (fare < (v.minFare || 0)) { lines.push({ k: 'minFare', amount: v.minFare - fare }); fare = v.minFare; }
    }
    if (service === 'event' && R.eventPct) { var ev = fare * R.eventPct / 100; lines.push({ k: 'event', p: { pct: R.eventPct }, amount: ev }); fare += ev; }

    surchargePct(R, when).forEach(function (s) {
      var a = fare * s.pct / 100; lines.push({ k: s.k, p: { pct: s.pct }, amount: a });
    });
    var legFare = lines.reduce(function (s, l) { return s + l.amount; }, 0);

    // zone / airport fees per end of the trip
    [inp.pickup, inp.dropoff].forEach(function (p) {
      var pl = findPlace(settings.places, p);
      if (pl && pl.fee) lines.push({ k: 'zone', p: { name: pl.name }, amount: pl.fee });
    });
    var pax = Math.max(1, U.num(inp.passengers, 1));
    if (R.extraPassengerFee && pax > R.paxIncluded) lines.push({ k: 'pax', p: { n: pax - R.paxIncluded }, amount: (pax - R.paxIncluded) * R.extraPassengerFee });
    var seats = U.clamp(U.num(inp.childSeats, 0), 0, 4);
    if (seats && R.childSeatFee) lines.push({ k: 'childSeat', p: { n: seats }, amount: seats * R.childSeatFee });
    if (inp.meetGreet && R.meetGreetFee) lines.push({ k: 'meetGreet', amount: R.meetGreetFee });

    if (inp.tripType === 'round') {
      var oneWay = lines.reduce(function (s, l) { return s + l.amount; }, 0);
      lines.push({ k: 'return', amount: oneWay });
      if (R.roundTripDiscountPct) lines.push({ k: 'roundDisc', p: { pct: R.roundTripDiscountPct }, amount: -oneWay * R.roundTripDiscountPct / 100 });
    }
    lines.forEach(function (l) { l.amount = U.round2(l.amount); });
    var subtotal = U.round2(lines.reduce(function (s, l) { return s + l.amount; }, 0));

    var discounts = [], running = subtotal;
    var promo = ctx.promo;
    if (promo) {
      var pa = promo.type === 'pct' ? running * promo.value / 100 : Math.min(promo.value, running);
      if (pa > 0) { discounts.push({ k: 'promo', p: { code: promo.code }, amount: U.round2(pa) }); running -= pa; }
    }
    var groupPct = ctx.companyPct ? ctx.companyPct : ctx.tierPct;
    if (groupPct) {
      var ga = running * groupPct / 100;
      discounts.push({ k: ctx.companyPct ? 'company' : 'member', p: { pct: groupPct, name: ctx.tierName || ctx.companyName || '' }, amount: U.round2(ga) });
      running -= ga;
    }
    if (ctx.referral) {
      var ra = Math.min(R.refereeDiscount, running);
      if (ra > 0) { discounts.push({ k: 'referral', p: { code: ctx.referral }, amount: U.round2(ra) }); running -= ra; }
    }
    var pointsUsed = 0;
    if (ctx.usePoints && ctx.points > 0 && R.pointValueCents) {
      var maxDollars = running * (R.maxPointsPct || 50) / 100;
      pointsUsed = Math.floor(Math.min(ctx.points, maxDollars * 100 / R.pointValueCents));
      var pd = pointsUsed * R.pointValueCents / 100;
      if (pd > 0) { discounts.push({ k: 'points', p: { n: pointsUsed }, amount: U.round2(pd) }); running -= pd; }
    }
    var total = U.round2(Math.max(0, running));
    return {
      service: service, miles: m == null ? null : Math.round(m * 10) / 10,
      minutes: m == null ? null : Math.round(m / 32 * 60 + 5),
      lines: lines, subtotal: subtotal, discounts: discounts, total: total,
      pointsUsed: pointsUsed, pointsEarned: Math.floor(total * (R.pointsPerDollar || 0)), legFare: U.round2(legFare)
    };
  }

  // Validates a promo code against a trip; returns { promo } or { error }.
  function checkPromo(promos, codeIn, inp, now, customer) {
    var c = U.str(codeIn, 30).toUpperCase();
    if (!c) return {};
    var p = (promos || []).find(function (x) { return x.code === c && x.active !== false; });
    if (!p) return { error: 'promo_invalid' };
    if (p.expires && Date.parse(p.expires) < now) return { error: 'promo_expired' };
    if (p.maxUses && (p.used || 0) >= p.maxUses) return { error: 'promo_used_up' };
    if (p.services && p.services.length && p.services.indexOf(inp.service || 'point') < 0) return { error: 'promo_service' };
    if (p.vehicles && p.vehicles.length && p.vehicles.indexOf(inp.vehicleId) < 0) return { error: 'promo_vehicle' };
    if (p.firstRideOnly && customer && customer.rides > 0) return { error: 'promo_first' };
    return { promo: p };
  }

  TR.pricing = { quote: quote, defaults: defaults, checkPromo: checkPromo, tierFor: tierFor, findPlace: findPlace, SERVICES: SERVICES };
  if (typeof module !== 'undefined' && module.exports) module.exports = TR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
