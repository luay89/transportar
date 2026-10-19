/* Shared helpers. Every core file attaches to the global TR namespace so the same
 * code runs in Node (server.js) and in the browser demo. */
(function (root) {
  'use strict';
  var TR = root.TR = root.TR || {};

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function str(x, max) { return String(x == null ? '' : x).trim().slice(0, max || 200); }
  function num(x, d) { var n = Number(x); return isFinite(n) ? n : (d || 0); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function token(len) {
    var a = new Uint8Array(len || 18);
    var c = root.crypto && root.crypto.getRandomValues ? root.crypto : require('crypto').webcrypto;
    c.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function code(len) { // human friendly: no 0/O/1/I
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '', t = token(len);
    for (var i = 0; i < len; i++) s += A[parseInt(t.substr(i * 2, 2), 16) % A.length];
    return s;
  }
  function phoneKey(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d;
  }
  function miles(a, b) {
    if (!a || !b || !isNum(a.lat) || !isNum(b.lat) || !isNum(a.lng) || !isNum(b.lng)) return null;
    var r = function (x) { return x * Math.PI / 180; };
    var dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * 3958.8 * Math.asin(Math.sqrt(h));
  }
  var ROAD_FACTOR = 1.3; // straight-line miles -> typical road miles
  function roadMiles(a, b) { var m = miles(a, b); return m == null ? null : m * ROAD_FACTOR; }
  function slug(s) { return str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pick(o, keys) { var r = {}; keys.forEach(function (k) { if (o && o[k] !== undefined) r[k] = o[k]; }); return r; }

  // Local time parts for a timestamp in the business timezone (falls back to the host clock).
  function localParts(ts, tz) {
    var d = new Date(ts);
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
      var p = {}; f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      var days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { day: days[p.weekday], hour: Number(p.hour) % 24, minute: Number(p.minute) };
    } catch (e) { return { day: d.getDay(), hour: d.getHours(), minute: d.getMinutes() }; }
  }

  // Minutes the timezone is ahead of UTC at a given instant (e.g. -300 for Chicago in summer).
  function tzOffset(ts, tz) {
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var p = {}; f.formatToParts(new Date(ts)).forEach(function (x) { p[x.type] = x.value; });
      return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000) / 60000;
    } catch (e) { return -new Date(ts).getTimezoneOffset(); }
  }
  // Wall-clock time in a timezone -> UTC timestamp.
  function zoned(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo, d, h, mi);
    var off = tzOffset(guess, tz);
    var ts = guess - off * 60000;
    var off2 = tzOffset(ts, tz);
    return off2 === off ? ts : guess - off2 * 60000;
  }
  // Calendar date (y, m, d, weekday) of a timestamp in a timezone.
  function zonedDate(ts, tz) {
    var t = ts + tzOffset(ts, tz) * 60000, d = new Date(t);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }

  TR.util = { tzOffset: tzOffset, zoned: zoned, zonedDate: zonedDate, isNum: isNum, str: str, num: num, clamp: clamp, round2: round2, token: token, code: code, phoneKey: phoneKey,
    miles: miles, roadMiles: roadMiles, slug: slug, clone: clone, pick: pick, localParts: localParts, ROAD_FACTOR: ROAD_FACTOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = TR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
