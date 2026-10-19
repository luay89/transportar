/* Maps: a real street map (Leaflet + OpenStreetMap) when the app runs on its own
 * server, and a schematic map when tiles can't load (offline, previews). */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  function pts(o) {
    var out = [];
    if (o.pickup && o.pickup.lat != null) out.push(o.pickup);
    if (o.dropoff && o.dropoff.lat != null && !(o.pickup && o.dropoff.lat === o.pickup.lat && o.dropoff.lng === o.pickup.lng)) out.push(o.dropoff);
    if (o.driver && o.driver.lat != null) out.push(o.driver);
    (o.drivers || []).forEach(function (d) { if (d.location) out.push(d.location); });
    return out;
  }

  // ---------- schematic SVG ----------
  function schematic(o) {
    var places = App.cfg ? App.cfg.places : [];
    var P0 = pts(o);
    var all = P0.length >= 2 ? P0 : places.concat(P0);
    if (!all.length) return '<div class="map-empty">' + App.t('mapEmpty') + '</div>';
    var lats = all.map(function (p) { return p.lat; }), lngs = all.map(function (p) { return p.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats), minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var padLat = Math.max((maxLat - minLat) * 0.3, 0.04), padLng = Math.max((maxLng - minLng) * 0.3, 0.06);
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
    var k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180), W = 600, H = 320;
    var sx = (maxLng - minLng) * k, sy = maxLat - minLat, s = Math.min(W / sx, H / sy);
    var ox = (W - sx * s) / 2, oy = (H - sy * s) / 2;
    var XY = function (p) { return [(ox + (p.lng - minLng) * k * s).toFixed(1), (H - (oy + (p.lat - minLat) * s)).toFixed(1)]; };
    var inView = function (p) { return p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng; };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="map-svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="' + esc(App.t('routeMap')) + '">' +
      '<rect width="' + W + '" height="' + H + '" class="m-bg"/>' +
      // a soft lake edge, a couple of parks and a calm street grid
      '<path class="m-water" d="M' + (W - 120) + ' 0 C' + (W - 60) + ' 70 ' + (W - 150) + ' 150 ' + (W - 90) + ' 220 S' + (W - 70) + ' 300 ' + (W - 40) + ' ' + H + ' H' + W + ' V0Z"/>' +
      '<ellipse class="m-park" cx="' + (W * 0.22) + '" cy="' + (H * 0.28) + '" rx="56" ry="30"/><ellipse class="m-park" cx="' + (W * 0.55) + '" cy="' + (H * 0.78) + '" rx="44" ry="24"/>';
    for (var gx = 30; gx < W; gx += 60) out += '<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + H + '" class="m-street' + (gx % 180 === 30 ? ' main' : '') + '"/>';
    for (var gy = 20; gy < H; gy += 60) out += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" class="m-street' + (gy % 180 === 20 ? ' main' : '') + '"/>';
    // Place labels skip spots already taken by a pin or another label, so nothing overlaps.
    var taken = [o.pickup, o.dropoff].filter(function (p) { return p && p.lat != null; }).map(function (p) { var c = XY(p); return [c[0], c[1] - 18]; });
    var clear = function (c) { return taken.every(function (q) { return Math.abs(q[0] - c[0]) > 90 || Math.abs(q[1] - c[1]) > 22; }); };
    places.filter(inView).forEach(function (p) {
      var c = XY(p);
      if (!clear(c)) { out += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" class="dot"/>'; return; }
      taken.push(c);
      out += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" class="dot"/><text x="' + (+c[0] + 7) + '" y="' + (+c[1] + 4) + '" class="lbl">' + esc(p.name.replace(/\s*\(.*\)/, '')) + '</text>';
    });
    if (o.pickup && o.dropoff && o.pickup.lat != null && o.dropoff.lat != null) {
      // a gentle curve reads as a road, not a ruler line
      var A = XY(o.pickup).map(Number), B = XY(o.dropoff).map(Number);
      var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, dx = B[0] - A[0], dy = B[1] - A[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
      var bend = Math.min(60, len * 0.18), cx = (mx - dy / len * bend).toFixed(1), cy = (my + dx / len * bend).toFixed(1);
      var d = 'M' + A[0] + ' ' + A[1] + ' Q' + cx + ' ' + cy + ' ' + B[0] + ' ' + B[1];
      out += '<path d="' + d + '" class="route-glow"/><path d="' + d + '" class="route-base"/><path d="' + d + '" class="route"/>';
    }
    var pin = function (c, letter, cls) {
      var x = +c[0], y = +c[1];
      return '<g class="' + cls + '"><ellipse cx="' + x + '" cy="' + (y + 1) + '" rx="7" ry="2.5" class="pin-shadow"/>' +
        '<path d="M' + x + ' ' + y + ' c-2 -6 -12 -11 -12 -20 a12 12 0 1 1 24 0 c0 9 -10 14 -12 20z"/><text x="' + x + '" y="' + (y - 16) + '">' + letter + '</text></g>';
    };
    if (o.pickup && o.pickup.lat != null) out += pin(XY(o.pickup), 'A', 'pin-a');
    if (o.dropoff && o.dropoff.lat != null) out += pin(XY(o.dropoff), 'B', 'pin-b');
    var car = function (c, extra) {
      return '<g class="pin-car' + (extra || '') + '"><circle cx="' + c[0] + '" cy="' + c[1] + '" r="18" class="pulse"/><circle cx="' + c[0] + '" cy="' + c[1] + '" r="11"/>' +
        '<g transform="translate(' + (c[0] - 7) + ' ' + (c[1] - 7) + ') scale(.58)" class="car-glyph"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 17v-4l2-5h14l2 5v4h-2M5 13h14"/></g></g>';
    };
    (o.drivers || []).forEach(function (d) {
      if (!d.location) return;
      var c = XY(d.location);
      out += car(c, d.busy ? ' busy' : ' free') + '<text x="' + (+c[0] + 15) + '" y="' + (+c[1] + 4) + '" class="lbl strong">' + esc(d.name) + '</text>';
    });
    if (o.driver && o.driver.lat != null) out += car(XY(o.driver), ' me');
    return out + '</svg>';
  }

  // ---------- Leaflet ----------
  function dotIcon(cls, label) {
    return window.L.divIcon({ className: '', html: '<span class="lf-pin ' + cls + '"><b>' + (label || '') + '</b></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
  }

  App.mapView = function (el, opts) {
    var useLeaflet = App.API.mode === 'server' && window.L && navigator.onLine !== false;
    if (!useLeaflet) {
      el.innerHTML = schematic(opts);
      return { update: function (o) { el.innerHTML = schematic(o); } };
    }
    el.innerHTML = '';
    var box = document.createElement('div'); box.className = 'lf-map'; el.appendChild(box);
    var L = window.L;
    var map = L.map(box, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    var layer = L.layerGroup().addTo(map);
    var fitted = '';
    function update(o) {
      layer.clearLayers();
      var ll = function (p) { return [p.lat, p.lng]; };
      if (o.pickup && o.pickup.lat != null) L.marker(ll(o.pickup), { icon: dotIcon('a', 'A') }).addTo(layer);
      if (o.dropoff && o.dropoff.lat != null) L.marker(ll(o.dropoff), { icon: dotIcon('b', 'B') }).addTo(layer);
      if (o.pickup && o.dropoff && o.pickup.lat != null && o.dropoff.lat != null) L.polyline([ll(o.pickup), ll(o.dropoff)], { className: 'lf-route', weight: 4, dashArray: '10 8' }).addTo(layer);
      if (o.driver && o.driver.lat != null) L.marker(ll(o.driver), { icon: dotIcon('car') }).addTo(layer);
      (o.drivers || []).forEach(function (d) {
        if (d.location) L.marker(ll(d.location), { icon: dotIcon('car' + (d.busy ? ' busy' : ''), '') }).bindTooltip(esc(d.name), { permanent: true, direction: 'right', className: 'lf-label' }).addTo(layer);
      });
      var P = pts(o), key = P.map(function (p) { return p.lat.toFixed(3) + p.lng.toFixed(3); }).join('|');
      if (key !== fitted) {
        fitted = key;
        if (P.length >= 2) map.fitBounds(L.latLngBounds(P.map(ll)), { padding: [36, 36], maxZoom: 14 });
        else if (P.length === 1) map.setView(ll(P[0]), 12);
        else if (App.cfg.places.length) map.fitBounds(L.latLngBounds(App.cfg.places.map(ll)), { padding: [24, 24] });
      }
    }
    update(opts);
    setTimeout(function () { map.invalidateSize(); }, 50);
    return { update: update, map: map };
  };
})();
