/* Smart dispatch: ranks drivers for a ride by vehicle fit, availability, distance,
 * ETA and rating, then offers the ride to the best driver first. If that driver
 * declines or the offer times out, it moves to the next one, and finally opens
 * the ride to every eligible driver. */
(function (root) {
  'use strict';
  var TR = root.TR = root.TR || {};
  var U = TR.util;

  var ACTIVE = ['accepted', 'enroute', 'arrived', 'ontrip'];
  var AVG_MPH = 30, FRESH_MS = 15 * 60 * 1000, BUSY_WINDOW_MS = 2 * 3600 * 1000, FAR_FUTURE_MS = 3 * 3600 * 1000;

  function defaults() { return { mode: 'auto', offerSeconds: 60, maxMiles: 40, shareWithinMiles: 0 }; }

  function when(b, now) { return b.when && b.when !== 'now' ? Date.parse(b.when) : now; }

  function busy(state, d, b, now) {
    var t = when(b, now);
    return state.bookings.some(function (x) {
      if (x === b || x.driverId !== d.id) return false;
      if (ACTIVE.indexOf(x.status) < 0) return false;
      if (x.status !== 'accepted') return t - now < BUSY_WINDOW_MS; // on a ride right now
      return Math.abs(when(x, now) - t) < BUSY_WINDOW_MS;
    });
  }

  function ratingOf(d) { return d.ratingCount ? d.ratingSum / d.ratingCount : null; }

  function rank(state, b, now) {
    var cfg = Object.assign(defaults(), state.settings.dispatch || {});
    var soon = when(b, now) - now < FAR_FUTURE_MS;
    return state.drivers.filter(function (d) {
      return d.active && d.vehicles.indexOf(b.vehicleId) >= 0 && (!soon || d.online) && !busy(state, d, b, now);
    }).map(function (d) {
      var fresh = d.location && now - d.location.at < FRESH_MS;
      var mi = fresh ? U.roadMiles(d.location, b.pickup) : null;
      var eta = mi == null ? null : Math.round(mi / AVG_MPH * 60 + 3);
      var r = ratingOf(d);
      var score = (eta == null ? (soon ? 90 : 30) : eta) - (r ? (r - 4) * 5 : 0);
      return { driverId: d.id, name: d.name, miles: mi == null ? null : Math.round(mi * 10) / 10, eta: eta, rating: r ? Math.round(r * 10) / 10 : null, score: score,
        far: mi != null && mi > cfg.maxMiles };
    }).filter(function (c) { return !c.far; }).sort(function (a, b2) { return a.score - b2.score; });
  }

  function offerNext(state, b, now) {
    var cfg = Object.assign(defaults(), state.settings.dispatch || {});
    b.offer = b.offer || { tried: [] };
    if (cfg.mode !== 'auto' || b.status !== 'pending' || b.driverId) { b.offer.driverId = null; b.offer.broadcast = cfg.mode === 'broadcast'; return; }
    if (when(b, now) - now > FAR_FUTURE_MS) { b.offer.driverId = null; b.offer.broadcast = true; return; }
    var next = rank(state, b, now).find(function (c) { return b.offer.tried.indexOf(c.driverId) < 0; });
    if (next) {
      var nd = state.drivers.find(function (x) { return x.id === next.driverId; });
      nd.stats = nd.stats || {}; nd.stats.offered = (nd.stats.offered || 0) + 1;
      b.offer.driverId = next.driverId; b.offer.expires = now + cfg.offerSeconds * 1000; b.offer.eta = next.eta; b.offer.broadcast = false; }
    else { b.offer.driverId = null; b.offer.broadcast = true; }
  }

  function decline(state, b, driverId, now) {
    b.offer = b.offer || { tried: [] };
    if (b.offer.tried.indexOf(driverId) < 0) b.offer.tried.push(driverId);
    if (b.offer.driverId === driverId) offerNext(state, b, now);
  }

  // Expire stale offers; called on every request and on a server timer.
  function tick(state, now) {
    var changed = false;
    state.bookings.forEach(function (b) {
      if (b.status === 'pending' && b.offer && b.offer.driverId && b.offer.expires < now) {
        var od = state.drivers.find(function (x) { return x.id === b.offer.driverId; });
        if (od) { od.stats = od.stats || {}; od.stats.expired = (od.stats.expired || 0) + 1; }
        b.offer.tried.push(b.offer.driverId); offerNext(state, b, now); changed = true;
      }
    });
    return changed;
  }

  // Can this driver see this pending ride in "New requests"?
  function visibleTo(state, b, d) {
    if (b.status !== 'pending' || b.driverId || d.vehicles.indexOf(b.vehicleId) < 0) return false;
    var mode = (state.settings.dispatch || {}).mode || 'auto';
    if (mode === 'manual') return false;
    if (mode === 'broadcast' || !b.offer || b.offer.broadcast) return true;
    return b.offer.driverId === d.id;
  }

  TR.dispatch = { rank: rank, offerNext: offerNext, decline: decline, tick: tick, visibleTo: visibleTo, defaults: defaults, ratingOf: ratingOf, ACTIVE: ACTIVE };
  if (typeof module !== 'undefined' && module.exports) module.exports = TR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
