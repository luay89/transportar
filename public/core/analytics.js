/* Business analytics: marketing (QR campaigns), demand by area and time, driver,
 * vehicle and service performance, plus plain-language insights. */
(function (root) {
  'use strict';
  var TR = root.TR = root.TR || {};
  var U = TR.util;

  function rideTime(b) { return b.when && b.when !== 'now' ? Date.parse(b.when) : b.createdAt; }
  function revenueOf(b) { return b.status === 'completed' || b.payStatus === 'paid' ? (b.price || 0) : 0; }

  function compute(state, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), days = opts.days || 30, from = now - days * 864e5;
    var tz = (state.settings.pricing || {}).timezone;
    var B = state.bookings.filter(function (b) { return b.createdAt >= from; });
    var live = B.filter(function (b) { return b.status !== 'cancelled'; });
    var camps = {}; (state.campaigns || []).forEach(function (c) { camps[c.id] = c; });

    // marketing
    var src = {};
    function S(id) {
      if (!src[id]) { var c = camps[id]; src[id] = { id: id, name: c ? c.name : id, channel: c ? c.channel : (id === 'direct' ? 'direct' : id), scans: 0, bookings: 0, completed: 0, revenue: 0 }; }
      return src[id];
    }
    Object.keys(state.scans || {}).forEach(function (k) { S(k).scans += state.scans[k]; });
    B.forEach(function (b) {
      var s = S(b.source || 'direct'); s.bookings++;
      if (b.status === 'completed') s.completed++;
      s.revenue += revenueOf(b);
    });
    var sources = Object.keys(src).map(function (k) {
      var s = src[k]; s.revenue = U.round2(s.revenue);
      s.conv = s.scans && s.id !== 'direct' ? Math.round(s.bookings / s.scans * 1000) / 10 : null;
      s.revPerScan = s.scans && s.id !== 'direct' ? U.round2(s.revenue / s.scans) : null;
      return s;
    }).sort(function (a, b) { return b.revenue - a.revenue || b.bookings - a.bookings; });
    var ch = {};
    sources.forEach(function (s) {
      var c = ch[s.channel] || (ch[s.channel] = { channel: s.channel, scans: 0, bookings: 0, revenue: 0 });
      c.scans += s.scans; c.bookings += s.bookings; c.revenue = U.round2(c.revenue + s.revenue);
    });
    var channels = Object.keys(ch).map(function (k) { return ch[k]; }).sort(function (a, b) { return b.revenue - a.revenue; });

    // demand
    var heat = []; for (var d = 0; d < 7; d++) { heat.push([]); for (var h = 0; h < 24; h++) heat[d].push(0); }
    var areas = {};
    live.forEach(function (b) {
      var lp = U.localParts(rideTime(b), tz); heat[lp.day][lp.hour]++;
      [['pickup', b.pickup], ['dropoff', b.dropoff]].forEach(function (x) {
        var n = x[1] && x[1].name; if (!n) return;
        var a = areas[n] || (areas[n] = { name: n, pickups: 0, dropoffs: 0, revenue: 0 });
        a[x[0] === 'pickup' ? 'pickups' : 'dropoffs']++;
        if (x[0] === 'pickup') a.revenue += revenueOf(b);
      });
    });
    var topAreas = Object.keys(areas).map(function (k) { var a = areas[k]; a.total = a.pickups + a.dropoffs; a.revenue = U.round2(a.revenue); return a; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 10);
    var byHour = []; for (var hh = 0; hh < 24; hh++) byHour.push(heat.reduce(function (s, r) { return s + r[hh]; }, 0));
    var byDay = heat.map(function (r) { return r.reduce(function (s, x) { return s + x; }, 0); });

    // daily series
    var daily = [];
    for (var i = days - 1; i >= 0; i--) {
      var start = new Date(now - i * 864e5); start.setHours(0, 0, 0, 0);
      var end = start.getTime() + 864e5;
      var inDay = B.filter(function (b) { return b.createdAt >= start.getTime() && b.createdAt < end; });
      daily.push({ date: start.toISOString().slice(0, 10), bookings: inDay.length, revenue: U.round2(inDay.reduce(function (s, b) { return s + revenueOf(b); }, 0)) });
    }

    // drivers
    var drivers = state.drivers.map(function (dr) {
      var mine = B.filter(function (b) { return b.driverId === dr.id; });
      var st = dr.stats || {};
      var offered = st.offered || 0;
      return {
        id: dr.id, name: dr.name, rides: mine.length, completed: mine.filter(function (b) { return b.status === 'completed'; }).length,
        revenue: U.round2(mine.reduce(function (s, b) { return s + revenueOf(b); }, 0)),
        rating: dr.ratingCount ? Math.round(dr.ratingSum / dr.ratingCount * 10) / 10 : null, ratings: dr.ratingCount || 0,
        acceptRate: offered ? Math.round((st.accepted || 0) / offered * 100) : null, declined: (st.declined || 0) + (st.expired || 0)
      };
    }).sort(function (a, b) { return b.revenue - a.revenue; });

    var vehicles = state.settings.vehicles.map(function (v) {
      var mine = live.filter(function (b) { return b.vehicleId === v.id; });
      return { id: v.id, name: v.name, rides: mine.length, revenue: U.round2(mine.reduce(function (s, b) { return s + revenueOf(b); }, 0)),
        avgFare: mine.length ? U.round2(mine.reduce(function (s, b) { return s + (b.price || 0); }, 0) / mine.length) : 0 };
    }).sort(function (a, b) { return b.revenue - a.revenue; });

    var services = {}; live.forEach(function (b) { services[b.service || 'point'] = (services[b.service || 'point'] || 0) + 1; });
    var ratings = state.bookings.filter(function (b) { return b.rating; });
    var totals = {
      bookings: B.length, completed: B.filter(function (b) { return b.status === 'completed'; }).length,
      cancelled: B.filter(function (b) { return b.status === 'cancelled'; }).length,
      revenue: U.round2(B.reduce(function (s, b) { return s + revenueOf(b); }, 0)),
      scans: sources.reduce(function (s, x) { return s + x.scans; }, 0),
      avgRating: ratings.length ? Math.round(ratings.reduce(function (s, b) { return s + b.rating.ride; }, 0) / ratings.length * 10) / 10 : null,
      customers: Object.keys(state.customers || {}).length,
      repeatCustomers: Object.keys(state.customers || {}).filter(function (k) { return state.customers[k].rides > 1; }).length
    };
    totals.avgFare = totals.completed ? U.round2(totals.revenue / totals.completed) : 0;

    return { days: days, totals: totals, sources: sources, channels: channels, heat: heat, byHour: byHour, byDay: byDay,
      topAreas: topAreas, daily: daily, drivers: drivers, vehicles: vehicles, services: services, insights: insights() };

    function insights() {
      var out = [];
      var bestSrc = sources.filter(function (s) { return s.id !== 'direct' && s.bookings; })[0];
      if (bestSrc) out.push({ k: 'bestSource', p: { name: bestSrc.name, n: bestSrc.bookings, rev: bestSrc.revenue } });
      var weak = sources.filter(function (s) { return s.scans >= 10 && s.conv != null && s.conv < 5; })[0];
      if (weak) out.push({ k: 'weakSource', p: { name: weak.name, scans: weak.scans, conv: weak.conv } });
      if (topAreas[0]) out.push({ k: 'topArea', p: { name: topAreas[0].name, n: topAreas[0].total } });
      var peakH = byHour.indexOf(Math.max.apply(null, byHour));
      var peakD = byDay.indexOf(Math.max.apply(null, byDay));
      if (live.length) out.push({ k: 'peakTime', p: { day: peakD, hour: peakH } });
      if (drivers[0] && drivers[0].revenue) out.push({ k: 'topDriver', p: { name: drivers[0].name, rev: drivers[0].revenue, n: drivers[0].completed } });
      var low = drivers.filter(function (x) { return x.rating != null && x.rating < 4 && x.ratings >= 3; })[0];
      if (low) out.push({ k: 'lowRating', p: { name: low.name, r: low.rating } });
      if (vehicles[0] && vehicles[0].revenue) out.push({ k: 'topVehicle', p: { name: vehicles[0].name, rev: vehicles[0].revenue } });
      var idle = vehicles.filter(function (v) { return !v.rides; })[0];
      if (idle && live.length >= 5) out.push({ k: 'idleVehicle', p: { name: idle.name } });
      if (totals.customers && totals.repeatCustomers / totals.customers < 0.2 && totals.customers >= 5) out.push({ k: 'lowRepeat', p: { pct: Math.round(totals.repeatCustomers / totals.customers * 100) } });
      return out;
    }
  }

  TR.analytics = { compute: compute };
  if (typeof module !== 'undefined' && module.exports) module.exports = TR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
