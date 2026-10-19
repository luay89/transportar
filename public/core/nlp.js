/* Rule-based ride request parser (English, Arabic, Spanish). Used when no AI key is
 * configured, and as a safety net when the AI call fails. Returns a booking draft. */
(function (root) {
  'use strict';
  var TR = root.TR = root.TR || {};
  var U = TR.util;

  var NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20,
    'واحد': 1, 'اثنين': 2, 'اثنان': 2, 'ثلاثة': 3, 'ثلاث': 3, 'أربعة': 4, 'اربعة': 4, 'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'عشرة': 10,
    uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10 };
  var WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    'الأحد': 0, 'الاحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6,
    domingo: 0, lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5, 'sábado': 6, sabado: 6 };
  var VEHICLE_WORDS = [
    [/party ?bus|\bbus\b|باص|حافلة|autob[uú]s/i, 'bus'],
    [/limo|limousine|ليموزين|ليموزن/i, 'limo'],
    [/sprinter|\bvan\b|فان|minivan|furgoneta/i, 'van'],
    [/\bsuv\b|escalade|suburban|navigator|يوكن|جيب/i, 'suv'],
    [/sedan|سيدان|\bcar\b|سيارة صغيرة/i, 'sedan']
  ];
  var FROM_RE = /(from|pick ?(?:me )?up (?:at|from)?|من|desde|\bde\b)\s*$/i;
  var TO_RE = /(\bto\b|towards|drop(?: me)?(?: off)? at|إلى|الى|لـ|ل\s|\ba\b|hasta|hacia)\s*$/i;

  function normDigits(s) { return s.replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); }
  function numFrom(tok) { return /^\d+$/.test(tok) ? Number(tok) : NUMS[tok.toLowerCase()] || null; }

  function placeHits(text, places) {
    var low = text.toLowerCase(), hits = [];
    places.forEach(function (p) {
      var keys = [p.name, p.name.replace(/\s*\(.*\)/, '')].concat(p.aliases || []);
      var code = (p.name.match(/\(([A-Z]{3})\)/) || [])[1];
      if (code) keys.push(code);
      keys.forEach(function (k) {
        k = String(k).toLowerCase().trim(); if (k.length < 3) return;
        var i = low.indexOf(k);
        if (i >= 0 && !hits.some(function (h) { return h.place === p; })) hits.push({ place: p, i: i, len: k.length });
      });
    });
    return hits.sort(function (a, b) { return a.i - b.i; });
  }

  function parseTime(text, now, tz) {
    var t = text.toLowerCase(), dayOffset = null, explicitNow = false;
    var today = U.zonedDate(now, tz);
    if (/\b(now|asap|right away|ahora)\b|الآن|حالا|فورا/.test(t)) explicitNow = true;
    if (/tomorrow|mañana(?! de)|manana|غدا|غداً|بكرة|بكره/.test(t)) dayOffset = 1;
    else if (/today|tonight|this (evening|afternoon|morning)|hoy|esta noche|اليوم|الليلة/.test(t)) dayOffset = 0;
    Object.keys(WEEKDAYS).forEach(function (w) {
      if (dayOffset == null && t.indexOf(w) >= 0) dayOffset = ((WEEKDAYS[w] - today.wd) + 7) % 7 || 7;
    });
    var inH = t.match(/in (\d+) (hours?|minutes?|mins?)|بعد (\d+) (ساعات|ساعة|دقيقة|دقائق)|en (\d+) (horas?|minutos?)/);
    if (inH) {
      var n = Number(inH[1] || inH[3] || inH[5]), unit = inH[2] || inH[4] || inH[6];
      return new Date(now + n * (/h|ساع|hora/.test(unit) ? 3600e3 : 60e3)).toISOString();
    }
    var hour = null, minute = 0, ap = '', m;
    if ((m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|صباحا|صباحاً|مساء|مساءً|ظهرا|de la mañana|de la tarde|de la noche)/))) { hour = +m[1]; minute = +(m[2] || 0); ap = m[3]; }
    else if ((m = t.match(/(\d{1,2}):(\d{2})/))) { hour = +m[1]; minute = +m[2]; }
    else if ((m = t.match(/(?:\bat|a las|الساعة|الساعه)\s*(\d{1,2})/))) { hour = +m[1]; }
    if (hour != null) {
      if (/pm|p\.m\.|مساء|tarde|noche/.test(ap) && hour < 12) hour += 12;
      else if (/ظهرا/.test(ap) && hour < 6) hour += 12;
      else if (/am|a\.m\.|صباح|mañana/.test(ap) && hour === 12) hour = 0;
      else if (!ap && hour < 12 && /tonight|evening|الليلة|مساء|noche|tarde/.test(t)) hour += 12;
      if (hour > 23) hour = null;
    }
    if (explicitNow && hour == null) return 'now';
    if (hour == null && dayOffset == null) return null;
    var ts = U.zoned(today.y, today.m, today.d + (dayOffset || 0), hour == null ? 9 : hour, minute, tz);
    if (dayOffset == null && ts < now) ts += 24 * 3600e3;
    return new Date(ts).toISOString();
  }

  function parse(text, settings, now) {
    var raw = normDigits(String(text || '')).slice(0, 600), t = raw.toLowerCase();
    var out = { source: 'rules' };
    var hits = placeHits(raw, settings.places || []);
    var assigned = {};
    hits.forEach(function (h) {
      var before = raw.slice(Math.max(0, h.i - 25), h.i);
      if (TO_RE.test(before) && !assigned.dropoff) assigned.dropoff = h.place;
      else if (FROM_RE.test(before) && !assigned.pickup) assigned.pickup = h.place;
    });
    hits.forEach(function (h) {
      if (assigned.pickup === h.place || assigned.dropoff === h.place) return;
      if (!assigned.pickup) assigned.pickup = h.place; else if (!assigned.dropoff) assigned.dropoff = h.place;
    });
    var asPlace = function (p) { return { name: p.name, lat: p.lat, lng: p.lng, placeId: p.id }; };
    if (assigned.pickup) out.pickup = asPlace(assigned.pickup);
    if (assigned.dropoff) out.dropoff = asPlace(assigned.dropoff);
    if (!out.pickup || !out.dropoff) { // free-text addresses: "from 123 Main St to ..."
      var fm = raw.match(/(?:from|من|desde)\s+(.+?)\s+(?:to|إلى|الى|a|hasta)\s+(.+?)(?:\s+(?:at|on|for|tomorrow|today|tonight|في|غدا|غداً|بكرة|الساعة|لـ|para|mañana|el|now|الآن)(?=\s|$)|[,.]|$)/i);
      if (fm) {
        if (!out.pickup) out.pickup = { name: fm[1].trim() };
        if (!out.dropoff) out.dropoff = { name: fm[2].trim() };
      }
    }

    var pm = t.match(/(\d+|\b[a-z؀-ۿ]+)\s*(people|persons|passengers|pax|adults|guests|of us|ppl|أشخاص|اشخاص|ركاب|راكب|شخص|أفراد|personas|pasajeros)/);
    if (pm && numFrom(pm[1])) out.passengers = numFrom(pm[1]);
    var bm = t.match(/(\d+|\b[a-z؀-ۿ]+)\s*(bags|suitcases|luggage|pieces|حقائب|حقيبة|شنط|شنطة|maletas)/);
    if (bm && numFrom(bm[1])) out.bags = numFrom(bm[1]);
    var hm = t.match(/(\d+)\s*(hours|hrs|hour|ساعات|ساعة|horas)/);
    if (hm && !/in \d+ hours|بعد \d+ ساع|en \d+ horas/.test(t)) out.hours = Number(hm[1]);

    VEHICLE_WORDS.some(function (vw) { if (vw[0].test(raw)) { out.vehicleId = vw[1]; return true; } return false; });
    if (out.vehicleId && !(settings.vehicles || []).some(function (v) { return v.id === out.vehicleId && v.active; })) delete out.vehicleId;
    if (!out.vehicleId && out.passengers) {
      var fit = (settings.vehicles || []).filter(function (v) { return v.active && v.seats >= out.passengers; }).sort(function (a, b) { return a.seats - b.seats; })[0];
      if (fit) out.vehicleId = fit.id;
    }

    var isAirport = /airport|flight|terminal|مطار|رحلة جوية|aeropuerto|vuelo/.test(t) ||
      [assigned.pickup, assigned.dropoff].some(function (p) { return p && p.type === 'airport'; });
    if (/wedding|prom|concert|game|event|party|gala|زفاف|عرس|حفل|مناسبة|boda|fiesta|evento|concierto/.test(t)) out.service = 'event';
    else if (out.hours) out.service = 'hourly';
    else if (isAirport) out.service = 'airport';
    else out.service = 'point';
    if (/round ?trip|and back|return trip|ذهاب و ?عودة|ذهاب وإياب|ida y vuelta/.test(t)) out.tripType = 'round';

    var fl = raw.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/);
    if (fl && (out.service === 'airport' || /flight|رحلة|vuelo/i.test(raw))) out.flight = fl[1] + fl[2];
    var when = parseTime(raw, now, (settings.pricing || {}).timezone);
    if (when) out.when = when;
    var found = ['pickup', 'dropoff', 'when', 'passengers', 'vehicleId'].filter(function (k) { return out[k] != null; }).length;
    out.confidence = Math.round(found / 5 * 100) / 100;
    return out;
  }

  TR.nlp = { parse: parse, parseTime: parseTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = TR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
