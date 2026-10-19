/* Transportar core: multi-company state, bookings, customers, loyalty, promos,
 * corporate accounts, campaigns, drivers and the JSON API. Pure and synchronous:
 * the Node server and the in-browser demo both call handle() with the same input. */
(function (root) {
  'use strict';
  var TR = root.TR = root.TR || {};
  var U = TR.util, P = TR.pricing, D = TR.dispatch;

  var FLOW = ['pending', 'accepted', 'enroute', 'arrived', 'ontrip', 'completed'];
  var SESSION_TTL = 30 * 24 * 3600 * 1000;
  var PAY_METHODS = ['pos', 'transfer', 'card', 'invoice'];

  // ---------------------------------------------------------------- defaults
  function defaultVehicles() {
    return [
      { id: 'sedan', name: 'Executive Sedan', icon: 'sedan', image: '', seats: 3, bags: 3, base: 25, perMile: 3.2, minFare: 60, hourly: 75, minHours: 2, active: true,
        desc: 'Mercedes S-Class, Cadillac CT5 or similar', features: ['Leather seats', 'Wi-Fi', 'Bottled water', 'Phone chargers'] },
      { id: 'suv', name: 'Premium SUV', icon: 'suv', image: '', seats: 6, bags: 6, base: 35, perMile: 3.9, minFare: 99, hourly: 95, minHours: 2, active: true,
        desc: 'Cadillac Escalade, Chevy Suburban or similar', features: ['Leather seats', 'Wi-Fi', 'Extra luggage room', 'Child seats on request'] },
      { id: 'van', name: 'Sprinter Van', icon: 'van', image: '', seats: 14, bags: 14, base: 60, perMile: 5.5, minFare: 180, hourly: 130, minHours: 3, active: true,
        desc: 'Mercedes Sprinter executive van', features: ['Stand-up headroom', 'USB at every seat', 'Group luggage space'] },
      { id: 'limo', name: 'Stretch Limo', icon: 'limo', image: '', seats: 8, bags: 4, base: 80, perMile: 6, minFare: 250, hourly: 150, minHours: 3, active: true,
        desc: 'Lincoln stretch limousine', features: ['Mood lighting', 'Bar area', 'Sound system'] },
      { id: 'bus', name: 'Party Bus', icon: 'bus', image: '', seats: 20, bags: 10, base: 120, perMile: 8, minFare: 400, hourly: 220, minHours: 4, active: true,
        desc: 'Sprinter party bus', features: ['Dance floor lighting', 'Premium sound', 'Wraparound seating'] }
    ];
  }
  function defaultPlaces() {
    return [
      { id: 'mke', name: 'Milwaukee Airport (MKE)', type: 'airport', lat: 42.9472, lng: -87.8966, fee: 10, aliases: ['mitchell', 'milwaukee airport', 'مطار ميلووكي'] },
      { id: 'mkedt', name: 'Downtown Milwaukee', type: 'area', lat: 43.0389, lng: -87.9065, fee: 0, aliases: ['milwaukee downtown', 'وسط ميلووكي'] },
      { id: 'ord', name: "Chicago O'Hare (ORD)", type: 'airport', lat: 41.9742, lng: -87.9073, fee: 15, aliases: ["o'hare", 'ohare', 'o hare', 'أوهير', 'مطار شيكاغو'] },
      { id: 'mdw', name: 'Chicago Midway (MDW)', type: 'airport', lat: 41.7868, lng: -87.7522, fee: 15, aliases: ['midway', 'ميدواي'] },
      { id: 'chidt', name: 'Downtown Chicago', type: 'area', lat: 41.8781, lng: -87.6298, fee: 0, aliases: ['chicago downtown', 'the loop', 'وسط شيكاغو'] },
      { id: 'hilton', name: 'Hilton Milwaukee City Center', type: 'hotel', lat: 43.0387, lng: -87.9180, fee: 0, aliases: ['hilton'] },
      { id: 'fiserv', name: 'Fiserv Forum', type: 'venue', lat: 43.0451, lng: -87.9172, fee: 0, aliases: ['bucks game', 'fiserv'] },
      { id: 'msn', name: 'Madison, WI', type: 'area', lat: 43.0731, lng: -89.4012, fee: 0, aliases: ['madison', 'ماديسون'] },
      { id: 'brk', name: 'Brookfield, WI', type: 'area', lat: 43.0606, lng: -88.1065, fee: 0, aliases: ['brookfield'] },
      { id: 'lkg', name: 'Lake Geneva, WI', type: 'area', lat: 42.5917, lng: -88.4334, fee: 0, aliases: ['lake geneva'] },
      { id: 'grb', name: 'Green Bay, WI', type: 'area', lat: 44.5133, lng: -88.0133, fee: 0, aliases: ['green bay', 'lambeau'] }
    ];
  }

  function defaultTenant(name, now, hash) {
    return {
      createdAt: now, plan: 'pro', status: 'active', seq: 1000, receiptSeq: 5000,
      settings: {
        brand: { name: name || 'Transportar', tagline: 'Scan. Ride. Arrive.', phone: '+1 (414) 555-0142', email: 'rides@transportar.example',
          city: 'Milwaukee · Chicago · Wisconsin', logo: '', accent: '#0f8b7f', domain: '' },
        currency: 'USD',
        vehicles: defaultVehicles(),
        places: defaultPlaces(),
        services: { point: true, airport: true, hourly: true, event: true },
        payment: { pos: true, transfer: true, card: true, invoice: true, bankName: 'Example Bank', accountName: 'Transportar LLC', routing: '000000000',
          account: '0000000000', zelle: 'pay@transportar.example', note: 'Put your booking code in the transfer memo.' },
        pricing: P.defaults(),
        dispatch: D.defaults(),
        flight: { autoAdjust: true, graceDomestic: 15, graceIntl: 45 },
        adminPassword: hash('admin123')
      },
      drivers: [
        { id: 'd1', name: 'Mike R.', phone: '+1 (414) 555-0101', pin: '1111', plate: 'WI ABC-123', vehicles: ['sedan', 'suv'], active: true, online: true,
          location: null, ratingSum: 0, ratingCount: 0, stats: {} },
        { id: 'd2', name: 'Sara K.', phone: '+1 (414) 555-0102', pin: '2222', plate: 'WI XYZ-789', vehicles: ['van', 'limo', 'bus', 'suv'], active: true, online: true,
          location: null, ratingSum: 0, ratingCount: 0, stats: {} }
      ],
      bookings: [],
      scans: {},
      campaigns: [
        { id: 'card', name: 'Business cards', channel: 'card', presets: {}, createdAt: now },
        { id: 'hilton', name: 'Hilton lobby stand', channel: 'hotel', presets: { pickupId: 'hilton', service: 'airport', dropoffId: 'mke' }, welcome: 'Welcome, Hilton guests', createdAt: now },
        { id: 'flyer-ord', name: "O'Hare flyer", channel: 'flyer', presets: { service: 'airport', dropoffId: 'ord', vehicleId: 'suv', promo: 'FLY10' }, createdAt: now }
      ],
      promos: [
        { code: 'WELCOME10', type: 'pct', value: 10, maxUses: 0, used: 0, expires: '', services: [], vehicles: [], firstRideOnly: true, active: true },
        { code: 'FLY10', type: 'amount', value: 10, maxUses: 500, used: 0, expires: '', services: ['airport'], vehicles: [], firstRideOnly: false, active: true }
      ],
      customers: {},
      companies: [
        { id: 'c1', name: 'Acme Corp', code: 'ACME', password: hash('acme123'), billingEmail: 'ap@acme.example', discountPct: 8, active: true, invoices: {} }
      ]
    };
  }

  function defaultRoot(now, hash) {
    return { version: 2, platform: { password: hash('platform123') }, tenants: { default: Object.assign(defaultTenant('Transportar', now, hash), { slug: 'default' }) }, sessions: {} };
  }

  // Bring older data files up to date without losing anything.
  function migrate(root, now, hash) {
    if (!root || typeof root !== 'object') return defaultRoot(now, hash);
    if (!root.tenants) {
      var old = root, t = defaultTenant(old.settings && old.settings.brand && old.settings.brand.name, now, hash);
      t.seq = old.seq || t.seq;
      ['bookings', 'drivers', 'scans'].forEach(function (k) { if (old[k]) t[k] = old[k]; });
      if (old.settings) {
        ['brand', 'currency', 'places'].forEach(function (k) { if (old.settings[k]) t.settings[k] = Object.assign(Array.isArray(old.settings[k]) ? [] : {}, t.settings[k], old.settings[k]); });
        if (old.settings.vehicles) t.settings.vehicles = old.settings.vehicles.map(function (v) {
          var d = defaultVehicles().find(function (x) { return x.id === v.id; }) || {};
          return Object.assign({ hourly: 90, minHours: 2, desc: '', features: [], image: '' }, d, v);
        });
        if (old.settings.payment) Object.assign(t.settings.payment, old.settings.payment);
        if (old.settings.adminPassword) t.settings.adminPassword = hash(old.settings.adminPassword);
      }
      root = { version: 2, platform: { password: hash('platform123') }, tenants: { default: Object.assign(t, { slug: 'default' }) }, sessions: {} };
    }
    Object.keys(root.tenants).forEach(function (slug) {
      var t = root.tenants[slug], d = defaultTenant('', now, hash);
      t.slug = slug;
      ['campaigns', 'promos', 'companies'].forEach(function (k) { if (!t[k]) t[k] = []; });
      ['customers', 'scans'].forEach(function (k) { if (!t[k]) t[k] = {}; });
      t.settings.pricing = Object.assign(P.defaults(), t.settings.pricing || {});
      t.settings.dispatch = Object.assign(D.defaults(), t.settings.dispatch || {});
      t.settings.flight = Object.assign(d.settings.flight, t.settings.flight || {});
      t.settings.services = Object.assign(d.settings.services, t.settings.services || {});
      t.settings.brand = Object.assign(d.settings.brand, t.settings.brand || {});
      t.drivers.forEach(function (x) { x.stats = x.stats || {}; x.ratingSum = x.ratingSum || 0; x.ratingCount = x.ratingCount || 0; if (x.online == null) x.online = true; });
      t.bookings.forEach(function (b) { b.service = b.service || 'point'; b.tripType = b.tripType || 'oneway'; b.history = b.history || []; });
      t.receiptSeq = t.receiptSeq || 5000;
    });
    root.sessions = root.sessions || {};
    root.platform = root.platform || { password: hash('platform123') };
    root.version = 2;
    return root;
  }

  // ---------------------------------------------------------------- views
  function err(status, code, extra) { return { status: status, body: Object.assign({ error: code }, extra || {}) }; }
  function ok(body) { return { status: 200, body: body }; }
  function setStatus(b, status, now, note) { b.status = status; b.history.push({ status: status, at: now, note: note || undefined }); }
  function vehicleOf(t, id) { return t.settings.vehicles.find(function (v) { return v.id === id; }); }
  function driverOf(t, id) { return t.drivers.find(function (d) { return d.id === id; }); }
  function rating(d) { return d && d.ratingCount ? Math.round(d.ratingSum / d.ratingCount * 10) / 10 : null; }

  function publicConfig(t, opts) {
    var S = t.settings, R = S.pricing;
    var pay = U.clone(S.payment);
    pay.card = !!(pay.card && opts.cardEnabled);
    return {
      tenant: t.slug, brand: S.brand, currency: S.currency, services: S.services,
      vehicles: S.vehicles.filter(function (v) { return v.active; }),
      places: S.places.map(function (p) { return U.pick(p, ['id', 'name', 'type', 'lat', 'lng', 'fee', 'aliases']); }),
      payment: pay,
      pricing: U.pick(R, ['childSeatFee', 'meetGreetFee', 'roundTripDiscountPct', 'tiers', 'pointValueCents', 'pointsPerDollar', 'refereeDiscount', 'referrerCredit', 'timezone']),
      campaigns: t.campaigns.map(function (c) { return U.pick(c, ['id', 'presets', 'welcome', 'channel']); }),
      features: { card: pay.card, ai: !!opts.aiEnabled, flights: !!opts.flightsEnabled, demoCard: !!opts.demoCard },
      dispatch: { shareWithinMiles: S.dispatch.shareWithinMiles }
    };
  }

  function customerView(t, b, nowTs) {
    var v = vehicleOf(t, b.vehicleId);
    var out = U.clone(b);
    delete out.token; delete out.customerToken; delete out.offer;
    out.vehicle = v ? { id: v.id, name: v.name, icon: v.icon, image: v.image } : null;
    var d = driverOf(t, b.driverId);
    if (d) {
      out.driver = { name: d.name, phone: d.phone, plate: d.plate, rating: rating(d), location: null };
      // Share the driver's live position while they come to you; optionally only when close.
      var within = t.settings.dispatch.shareWithinMiles || 0;
      if (d.location && ['enroute', 'arrived', 'ontrip'].indexOf(b.status) >= 0 && nowTs - d.location.at < 15 * 60e3) {
        var mi = U.roadMiles(d.location, b.status === 'ontrip' ? b.dropoff : b.pickup);
        if (!within || b.status !== 'enroute' || (mi != null && mi <= within)) out.driver.location = d.location;
        if (mi != null) out.eta = Math.round(mi / 30 * 60 + 2);
      }
    }
    var c = b.companyId && t.companies.find(function (x) { return x.id === b.companyId; });
    if (c) out.company = c.name;
    return out;
  }

  function customerProfile(t, cu) {
    var R = t.settings.pricing, tier = P.tierFor(R, cu.rides || 0);
    var next = (R.tiers || []).filter(function (x) { return x.rides > (cu.rides || 0); }).sort(function (a, b) { return a.rides - b.rides; })[0];
    return { name: cu.name, phone: cu.phone, email: cu.email, rides: cu.rides || 0, spent: U.round2(cu.spent || 0), points: cu.points || 0,
      pointsValue: U.round2((cu.points || 0) * R.pointValueCents / 100), tier: tier, nextTier: next ? { name: next.name, ridesLeft: next.rides - (cu.rides || 0), pct: next.pct } : null,
      referralCode: cu.referralCode, favorites: cu.favorites || [] };
  }

  // ---------------------------------------------------------------- customers
  function findCustomerByToken(t, tok) {
    if (!tok) return null;
    var k = Object.keys(t.customers).find(function (key) { return (t.customers[key].tokens || []).indexOf(tok) >= 0; });
    return k ? t.customers[k] : null;
  }
  function upsertCustomer(t, name, phone, email, now) {
    var key = U.phoneKey(phone);
    var cu = t.customers[key];
    if (!cu) {
      var ref;
      do { ref = U.code(6); } while (Object.keys(t.customers).some(function (k) { return t.customers[k].referralCode === ref; }));
      cu = t.customers[key] = { key: key, name: name, phone: phone, email: email, createdAt: now, rides: 0, spent: 0, points: 0, referralCode: ref, tokens: [], favorites: [] };
    }
    cu.name = name || cu.name; cu.phone = phone || cu.phone; if (email) cu.email = email;
    return cu;
  }

  // Shared by quote and booking so the price a customer sees is the price they pay.
  function priceTrip(t, trip, body, cu, nowTs) {
    var ctx = {}, errors = {};
    var pr = P.checkPromo(t.promos, body.promoCode, trip, nowTs, cu);
    if (pr.error) {
      // A promo box may also hold a friend's referral code
      var refCode = U.str(body.promoCode, 20).toUpperCase();
      var referrer = refCode && Object.keys(t.customers).map(function (k) { return t.customers[k]; }).find(function (x) { return x.referralCode === refCode; });
      if (referrer && (!cu || (cu !== referrer && !cu.rides))) ctx.referral = refCode;
      else if (referrer) errors.promo = 'referral_own';
      else errors.promo = pr.error;
    } else if (pr.promo) ctx.promo = pr.promo;
    var company = body.companyCode && t.companies.find(function (c) { return c.active && c.code === U.str(body.companyCode, 20).toUpperCase(); });
    if (body.companyCode && !company) errors.company = 'company_invalid';
    if (company) { ctx.companyPct = company.discountPct; ctx.companyName = company.name; }
    if (cu) {
      var tier = P.tierFor(t.settings.pricing, cu.rides || 0);
      if (tier && tier.pct) { ctx.tierPct = tier.pct; ctx.tierName = tier.name; }
      ctx.points = cu.points || 0; ctx.usePoints = !!body.usePoints;
    }
    var q = P.quote(t.settings, trip, ctx);
    return { q: q, errors: errors, company: company, ctx: ctx };
  }

  function tripFrom(t, body) {
    var place = function (p) {
      if (!p || !U.str(p.name)) return null;
      var out = { name: U.str(p.name, 160) };
      if (U.isNum(p.lat) && U.isNum(p.lng)) { out.lat = p.lat; out.lng = p.lng; }
      var known = P.findPlace(t.settings.places, p);
      if (known) { out.placeId = known.id; out.type = known.type; if (out.lat == null) { out.lat = known.lat; out.lng = known.lng; } }
      return out;
    };
    var service = P.SERVICES.indexOf(body.service) >= 0 ? body.service : 'point';
    return {
      service: service, vehicleId: U.str(body.vehicleId, 30), pickup: place(body.pickup), dropoff: place(body.dropoff),
      when: body.when && body.when !== 'now' && !isNaN(Date.parse(body.when)) ? new Date(body.when).toISOString() : 'now',
      tripType: body.tripType === 'round' ? 'round' : 'oneway',
      returnWhen: body.tripType === 'round' && body.returnWhen && !isNaN(Date.parse(body.returnWhen)) ? new Date(body.returnWhen).toISOString() : null,
      hours: service === 'hourly' || service === 'event' ? U.clamp(parseInt(body.hours, 10) || 0, 0, 24) : 0,
      passengers: U.clamp(parseInt(body.passengers, 10) || 1, 1, 99), bags: U.clamp(parseInt(body.bags, 10) || 0, 0, 99),
      childSeats: U.clamp(parseInt(body.childSeats, 10) || 0, 0, 4), meetGreet: !!body.meetGreet && service === 'airport',
      flight: service === 'airport' && body.flight ? { number: U.str(body.flight, 10).toUpperCase().replace(/\s/g, ''), status: 'scheduled' } : null
    };
  }

  // ---------------------------------------------------------------- flights
  function applyFlight(t, b, info, nowTs) {
    if (!b.flight) b.flight = { number: info.number || '' };
    Object.assign(b.flight, U.pick(info, ['status', 'scheduledArr', 'estimatedArr', 'delayMin', 'terminal', 'gate', 'international']), { updatedAt: nowTs });
    var F = t.settings.flight;
    var fromAirport = b.pickup && b.pickup.type === 'airport';
    if (F.autoAdjust && fromAirport && ['pending', 'accepted'].indexOf(b.status) >= 0) {
      var arr = Date.parse(info.estimatedArr || info.scheduledArr || '');
      if (!isNaN(arr)) {
        var grace = info.international ? F.graceIntl : F.graceDomestic;
        var pickupAt = new Date(arr + grace * 60e3).toISOString();
        if (pickupAt !== b.when) {
          b.history.push({ status: 'flight', at: nowTs, note: (b.when === 'now' ? '' : b.when) + ' → ' + pickupAt });
          b.originalWhen = b.originalWhen || b.when;
          b.when = pickupAt;
        }
      }
    }
  }

  // ---------------------------------------------------------------- lifecycle
  function complete(t, b, nowTs) {
    var cu = t.customers[b.customerKey];
    if (cu && !b.counted) {
      b.counted = true;
      cu.rides = (cu.rides || 0) + 1;
      cu.spent = U.round2((cu.spent || 0) + (b.price || 0));
      cu.points = (cu.points || 0) + (b.pointsEarned || 0);
      if (b.referral && cu.rides === 1) {
        var R = t.settings.pricing;
        var referrer = Object.keys(t.customers).map(function (k) { return t.customers[k]; }).find(function (x) { return x.referralCode === b.referral; });
        if (referrer) referrer.points = (referrer.points || 0) + Math.round(R.referrerCredit * 100 / (R.pointValueCents || 5));
      }
    }
    void nowTs;
  }
  function markPaid(t, b, nowTs, ref) {
    if (b.payStatus === 'paid') return;
    b.payStatus = 'paid'; b.paidAt = nowTs; if (ref) b.payRef = ref;
    t.receiptSeq += 1; b.receiptNo = 'R-' + t.receiptSeq;
  }

  // ---------------------------------------------------------------- API
  function createCore(opts) {
    var now = opts.now || function () { return Date.now(); };
    var hash = opts.hash || function (pw) { return 'plain:' + pw; };
    var verify = opts.verify || function (pw, stored) { return stored === 'plain:' + pw; };

    function load() { var r = opts.load(); return migrate(r, now(), hash); }

    function session(rootState, auth, role, slug) {
      var s = auth && rootState.sessions[auth];
      if (!s || s.role !== role || now() - s.at > SESSION_TTL) return null;
      if (role !== 'platform' && s.tenant !== slug) return null;
      return s;
    }
    function newSession(rootState, data) { var tk = U.token(); data.at = now(); rootState.sessions[tk] = data; return tk; }

    function resolveTenant(rootState, ctx) {
      ctx = ctx || {};
      var slug = ctx.tenant && rootState.tenants[ctx.tenant] ? ctx.tenant : null;
      if (!slug && ctx.host) {
        var host = String(ctx.host).toLowerCase().split(':')[0];
        slug = Object.keys(rootState.tenants).find(function (k) { return rootState.tenants[k].settings.brand.domain === host; }) ||
          (rootState.tenants[host.split('.')[0]] ? host.split('.')[0] : null);
      }
      return slug || 'default';
    }

    function route(R, method, path, body, auth, ctx) {
      var m, nowTs = now();
      body = body || {};

      // ---------------- platform (SaaS owner) ----------------
      if (path.indexOf('/api/platform/') === 0) {
        if (method === 'POST' && path === '/api/platform/login') {
          if (!verify(U.str(body.password, 100), R.platform.password)) return err(401, 'login');
          return ok({ token: newSession(R, { role: 'platform' }) });
        }
        if (!session(R, auth, 'platform')) return err(401, 'auth');
        if (method === 'GET' && path === '/api/platform/state') {
          return ok({ tenants: Object.keys(R.tenants).map(function (k) {
            var t = R.tenants[k], since = nowTs - 30 * 864e5;
            var recent = t.bookings.filter(function (b) { return b.createdAt >= since; });
            return { slug: k, name: t.settings.brand.name, plan: t.plan, status: t.status, domain: t.settings.brand.domain, accent: t.settings.brand.accent,
              createdAt: t.createdAt, drivers: t.drivers.length, vehicles: t.settings.vehicles.length, bookings30: recent.length,
              revenue30: U.round2(recent.reduce(function (s, b) { return s + (b.payStatus === 'paid' ? b.price || 0 : 0); }, 0)) };
          }) });
        }
        if (method === 'POST' && path === '/api/platform/tenants') {
          var slug = U.slug(body.slug || body.name);
          if (!slug || slug.length < 2) return err(400, 'slug');
          if (R.tenants[slug]) return err(409, 'slug_taken');
          if (U.str(body.ownerPassword).length < 6) return err(400, 'password');
          var nt = defaultTenant(U.str(body.name, 60) || slug, nowTs, hash);
          nt.slug = slug; nt.plan = U.str(body.plan, 20) || 'starter';
          nt.settings.adminPassword = hash(U.str(body.ownerPassword, 100));
          nt.settings.brand.domain = U.str(body.domain, 100).toLowerCase();
          if (/^#[0-9a-f]{6}$/i.test(body.accent || '')) nt.settings.brand.accent = body.accent;
          nt.bookings = []; nt.customers = {}; nt.scans = {};
          nt.campaigns = [{ id: 'card', name: 'Business cards', channel: 'card', presets: {}, createdAt: nowTs }];
          nt.companies = []; nt.promos = [];
          R.tenants[slug] = nt;
          return ok({ ok: true, slug: slug });
        }
        if (method === 'POST' && (m = path.match(/^\/api\/platform\/tenants\/([a-z0-9-]+)$/))) {
          var tt = R.tenants[m[1]]; if (!tt) return err(404, 'not_found');
          if (body.status) tt.status = body.status === 'suspended' ? 'suspended' : 'active';
          if (body.plan) tt.plan = U.str(body.plan, 20);
          if (body.name) tt.settings.brand.name = U.str(body.name, 60);
          if (body.domain != null) tt.settings.brand.domain = U.str(body.domain, 100).toLowerCase();
          if (body.ownerPassword && U.str(body.ownerPassword).length >= 6) tt.settings.adminPassword = hash(U.str(body.ownerPassword, 100));
          return ok({ ok: true });
        }
        if (method === 'POST' && path === '/api/platform/password') {
          if (U.str(body.password).length < 8) return err(400, 'password');
          R.platform.password = hash(U.str(body.password, 100));
          return ok({ ok: true });
        }
        return err(404, 'not_found');
      }

      var slug0 = resolveTenant(R, ctx), t = R.tenants[slug0], S = t.settings;
      if (t.status === 'suspended') return err(403, 'suspended');
      D.tick(t, nowTs);

      // ---------------- public ----------------
      if (method === 'GET' && path === '/api/config') return ok(publicConfig(t, opts));

      if (method === 'POST' && path === '/api/scan') {
        var src = U.str(body.src, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'direct';
        t.scans[src] = (t.scans[src] || 0) + 1;
        return ok({ ok: true });
      }

      if (method === 'POST' && path === '/api/assist') {
        return ok({ draft: TR.nlp.parse(body.text, S, nowTs) });
      }

      if (method === 'POST' && path === '/api/quote') {
        var trip = tripFrom(t, body), cuQ = findCustomerByToken(t, body.customerToken);
        var per = {};
        S.vehicles.filter(function (v) { return v.active; }).forEach(function (v) {
          per[v.id] = P.quote(S, Object.assign({}, trip, { vehicleId: v.id }), {}).total;
        });
        if (!trip.vehicleId) return ok({ perVehicle: per });
        var pq = priceTrip(t, trip, body, cuQ, nowTs);
        if (pq.q.error) return err(400, pq.q.error);
        return ok({ quote: pq.q, perVehicle: per, errors: pq.errors, company: pq.company ? pq.company.name : null,
          member: cuQ ? customerProfile(t, cuQ) : null });
      }

      if (method === 'POST' && path === '/api/bookings') {
        var tr = tripFrom(t, body);
        var v = vehicleOf(t, tr.vehicleId);
        if (!v || !v.active) return err(400, 'vehicle');
        if (!S.services[tr.service]) return err(400, 'service');
        if (!tr.pickup) return err(400, 'route');
        if (!tr.dropoff && tr.service !== 'hourly') return err(400, 'route');
        if (!tr.dropoff) tr.dropoff = { name: tr.pickup.name, lat: tr.pickup.lat, lng: tr.pickup.lng, placeId: tr.pickup.placeId, type: tr.pickup.type, asDirected: true };
        if ((tr.service === 'hourly') && !tr.hours) tr.hours = v.minHours || 2;
        var name = U.str(body.name, 80), phone = U.str(body.phone, 30);
        if (!name || U.phoneKey(phone).length < 7) return err(400, 'contact');
        if (tr.passengers > v.seats) return err(400, 'seats');
        if (tr.when !== 'now' && Date.parse(tr.when) < nowTs - 5 * 60e3) return err(400, 'when');
        if (tr.tripType === 'round' && !tr.returnWhen) return err(400, 'return_when');
        var pay = PAY_METHODS.indexOf(body.payMethod) >= 0 ? body.payMethod : 'pos';
        if (pay === 'card' && !(S.payment.card && opts.cardEnabled)) return err(400, 'payment');
        if (pay !== 'card' && !S.payment[pay]) return err(400, 'payment');

        var cu = upsertCustomer(t, name, phone, U.str(body.email, 120), nowTs);
        var tokenOk = findCustomerByToken(t, body.customerToken) === cu;
        var priced = priceTrip(t, tr, Object.assign({}, body, { usePoints: tokenOk && body.usePoints }), cu, nowTs);
        if (priced.errors.promo) return err(400, priced.errors.promo);
        if (priced.errors.company) return err(400, priced.errors.company);
        if (pay === 'invoice' && !priced.company) return err(400, 'invoice_needs_company');
        if (priced.q.error) return err(400, priced.q.error);

        var cuTok = tokenOk ? body.customerToken : U.token();
        if (!tokenOk) { cu.tokens.push(cuTok); if (cu.tokens.length > 10) cu.tokens.shift(); }

        // Recurring rides: same trip on a weekly / every-2-weeks / monthly / weekday schedule
        var rep = body.repeat || {}, count = rep.freq ? U.clamp(parseInt(rep.count, 10) || 1, 1, 26) : 1;
        if (count > 1 && tr.when === 'now') return err(400, 'repeat_needs_date');
        var seriesId = count > 1 ? 'S' + U.code(6) : null, created = [];
        var start = tr.when === 'now' ? null : Date.parse(tr.when), at = start;
        for (var i = 0; i < count; i++) {
          if (i > 0) {
            var dd = new Date(at);
            if (rep.freq === 'monthly') dd.setMonth(dd.getMonth() + 1);
            else if (rep.freq === 'weekdays') { do { dd.setDate(dd.getDate() + 1); } while (dd.getDay() === 0 || dd.getDay() === 6); }
            else dd.setDate(dd.getDate() + (rep.freq === 'biweekly' ? 14 : 7));
            at = dd.getTime();
          }
          var trip_i = Object.assign({}, tr, { when: at ? new Date(at).toISOString() : 'now' });
          var pi = i === 0 ? priced : priceTrip(t, trip_i, Object.assign({}, body, { usePoints: false, promoCode: '' }), cu, nowTs);
          t.seq += 1;
          var b = Object.assign(trip_i, {
            code: 'TR-' + t.seq, token: U.token(), createdAt: nowTs, notes: U.str(body.notes, 300),
            customer: { name: name, phone: phone, email: U.str(body.email, 120) }, customerKey: cu.key,
            payMethod: pay, payStatus: 'unpaid',
            price: pi.q.total, breakdown: { lines: pi.q.lines, discounts: pi.q.discounts, subtotal: pi.q.subtotal }, miles: pi.q.miles,
            pointsUsed: pi.q.pointsUsed || 0, pointsEarned: pi.q.pointsEarned || 0,
            promoCode: i === 0 && priced.ctx.promo ? priced.ctx.promo.code : null, referral: i === 0 ? priced.ctx.referral || null : null,
            companyId: priced.company ? priced.company.id : null,
            status: 'pending', driverId: null, history: [], seriesId: seriesId,
            source: U.str(body.source, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'direct', lang: U.str(body.lang, 5)
          });
          setStatus(b, 'pending', nowTs);
          t.bookings.unshift(b);
          D.offerNext(t, b, nowTs);
          created.push(b);
        }
        if (priced.ctx.promo) priced.ctx.promo.used = (priced.ctx.promo.used || 0) + 1;
        if (created[0].pointsUsed) cu.points = Math.max(0, cu.points - created[0].pointsUsed);
        if (body.saveFavorite) addFavorite(cu, created[0]);
        var first = created[0];
        return ok({ code: first.code, token: first.token, customerToken: cuTok, booking: customerView(t, first, nowTs),
          series: created.map(function (x) { return { code: x.code, token: x.token, when: x.when }; }) });
      }

      if ((m = path.match(/^\/api\/bookings\/(TR-\d+)(\/[a-z-]+)?$/))) {
        var bk = t.bookings.find(function (x) { return x.code === m[1]; });
        if (!bk || body.t !== bk.token) return err(404, 'not_found');
        var action = m[2];
        if (method === 'POST' && action === '/cancel') {
          var targets = body.series && bk.seriesId ? t.bookings.filter(function (x) { return x.seriesId === bk.seriesId && ['pending', 'accepted'].indexOf(x.status) >= 0; }) : [bk];
          if (bk.status !== 'pending' && bk.status !== 'accepted') return err(409, 'too_late');
          targets.forEach(function (x) { setStatus(x, 'cancelled', nowTs, 'customer'); });
        } else if (method === 'POST' && action === '/transfer-sent') {
          if (bk.payMethod !== 'transfer' || bk.payStatus === 'paid') return err(409, 'state');
          bk.payStatus = 'transfer_sent'; bk.transferRef = U.str(body.ref, 60);
        } else if (method === 'POST' && action === '/rate') {
          if (bk.status !== 'completed') return err(409, 'state');
          if (bk.rating) return err(409, 'already_rated');
          var dr = U.clamp(parseInt(body.driver, 10) || 0, 1, 5), rr = U.clamp(parseInt(body.ride, 10) || 0, 1, 5);
          bk.rating = { driver: dr, ride: rr, comment: U.str(body.comment, 500), at: nowTs };
          var rd = driverOf(t, bk.driverId);
          if (rd) { rd.ratingSum += dr; rd.ratingCount += 1; }
        } else if (method === 'POST' && action === '/pay-demo') {
          if (!opts.demoCard || bk.payMethod !== 'card') return err(409, 'state');
          markPaid(t, bk, nowTs, 'demo-card');
        } else if (method === 'POST' && action === '/favorite') {
          var cf = t.customers[bk.customerKey]; if (cf) addFavorite(cf, bk);
        } else if (!(method === 'POST' && !action)) return err(404, 'not_found');
        var view = customerView(t, bk, nowTs);
        if (bk.seriesId) view.seriesCodes = t.bookings.filter(function (x) { return x.seriesId === bk.seriesId; }).map(function (x) { return { code: x.code, when: x.when, status: x.status }; }).reverse();
        return ok({ booking: view });
      }

      if (method === 'POST' && path === '/api/me') {
        var me = findCustomerByToken(t, body.customerToken);
        if (!me) return err(404, 'not_found');
        if (body.removeFavorite != null) me.favorites.splice(parseInt(body.removeFavorite, 10), 1);
        return ok({ profile: customerProfile(t, me), bookings: t.bookings.filter(function (b) { return b.customerKey === me.key; }).slice(0, 50).map(function (b) {
          return { code: b.code, token: b.token, when: b.when, status: b.status, pickup: b.pickup.name, dropoff: b.dropoff.name, price: b.price, rated: !!b.rating };
        }) });
      }

      // ---------------- corporate portal ----------------
      if (method === 'POST' && path === '/api/company/login') {
        var co = t.companies.find(function (c) { return c.active && c.code === U.str(body.code, 20).toUpperCase(); });
        if (!co || !verify(U.str(body.password, 100), co.password)) return err(401, 'login');
        return ok({ token: newSession(R, { role: 'company', tenant: slug0, id: co.id }), name: co.name });
      }
      if (path.indexOf('/api/company/') === 0) {
        var cs = session(R, auth, 'company', slug0);
        var comp = cs && t.companies.find(function (c) { return c.id === cs.id; });
        if (!comp) return err(401, 'auth');
        if (method === 'GET' && path === '/api/company/state') return ok(companyReport(t, comp));
        return err(404, 'not_found');
      }

      // ---------------- driver ----------------
      if (method === 'POST' && path === '/api/driver/login') {
        var dl = t.drivers.find(function (x) { return x.active && x.pin === U.str(body.pin, 12); });
        if (!dl) return err(401, 'login');
        return ok({ token: newSession(R, { role: 'driver', tenant: slug0, id: dl.id }), driver: { id: dl.id, name: dl.name } });
      }
      if (path.indexOf('/api/driver/') === 0) {
        var ds = session(R, auth, 'driver', slug0);
        var me2 = ds && t.drivers.find(function (x) { return x.id === ds.id && x.active; });
        if (!me2) return err(401, 'auth');
        var dview = function (x) { var o = customerView(t, x, nowTs); delete o.driver; if (x.driverId !== me2.id) { o.customer = { name: x.customer.name.split(' ')[0] }; } return o; };

        if (method === 'GET' && path === '/api/driver/jobs') {
          var dayStart = new Date(nowTs); dayStart.setHours(0, 0, 0, 0);
          var mine = t.bookings.filter(function (x) { return x.driverId === me2.id; });
          var visible = t.bookings.filter(function (x) { return D.visibleTo(t, x, me2); });
          return ok({
            me: { name: me2.name, plate: me2.plate, vehicles: me2.vehicles, online: !!me2.online, sharing: !!me2.location, location: me2.location, offerSeconds: S.dispatch.offerSeconds, rating: rating(me2), ratings: me2.ratingCount,
              today: { rides: mine.filter(function (x) { return x.status === 'completed' && (x.history.slice(-1)[0] || {}).at >= dayStart.getTime(); }).length,
                earnings: U.round2(mine.filter(function (x) { return x.status === 'completed' && (x.history.slice(-1)[0] || {}).at >= dayStart.getTime(); }).reduce(function (s, x) { return s + (x.price || 0); }, 0)) } },
            offers: visible.filter(function (x) { return x.offer && x.offer.driverId === me2.id; }).map(function (x) { var o = dview(x); o.offerExpires = x.offer.expires; o.offerEta = x.offer.eta; return o; }),
            open: visible.filter(function (x) { return !(x.offer && x.offer.driverId === me2.id); }).map(dview),
            mine: mine.slice(0, 40).map(dview),
            serverNow: nowTs
          });
        }
        if (method === 'POST' && path === '/api/driver/online') {
          me2.online = !!body.online;
          if (!me2.online) me2.location = null;
          return ok({ ok: true });
        }
        if (method === 'POST' && path === '/api/driver/location') {
          me2.location = U.isNum(body.lat) && U.isNum(body.lng) ? { lat: body.lat, lng: body.lng, at: nowTs, heading: U.isNum(body.heading) ? body.heading : null } : null;
          return ok({ ok: true });
        }
        if (method === 'POST' && (m = path.match(/^\/api\/driver\/jobs\/(TR-\d+)\/(accept|decline|status|paid)$/))) {
          var job = t.bookings.find(function (x) { return x.code === m[1]; });
          if (!job) return err(404, 'not_found');
          me2.stats = me2.stats || {};
          if (m[2] === 'accept') {
            if (job.status !== 'pending' || job.driverId || !D.visibleTo(t, job, me2)) return err(409, 'taken');
            job.driverId = me2.id;
            if (job.offer && job.offer.driverId === me2.id) me2.stats.accepted = (me2.stats.accepted || 0) + 1;
            setStatus(job, 'accepted', nowTs);
          } else if (m[2] === 'decline') {
            me2.stats.declined = (me2.stats.declined || 0) + 1;
            D.decline(t, job, me2.id, nowTs);
          } else {
            if (job.driverId !== me2.id) return err(403, 'not_yours');
            if (m[2] === 'paid') markPaid(t, job, nowTs, 'driver-' + (job.payMethod || 'pos'));
            else {
              var next = FLOW.indexOf(body.status);
              if (next <= FLOW.indexOf(job.status) || job.status === 'cancelled') return err(409, 'state');
              setStatus(job, body.status, nowTs);
              if (body.status === 'completed') complete(t, job, nowTs);
            }
          }
          return ok({ ok: true });
        }
        return err(404, 'not_found');
      }

      // ---------------- owner admin ----------------
      if (method === 'POST' && path === '/api/admin/login') {
        if (!verify(U.str(body.password, 100), S.adminPassword)) return err(401, 'login');
        return ok({ token: newSession(R, { role: 'admin', tenant: slug0 }) });
      }
      if (path.indexOf('/api/admin/') === 0) {
        if (!session(R, auth, 'admin', slug0)) return err(401, 'auth');

        if (method === 'GET' && path === '/api/admin/state') {
          var settings = U.clone(S); delete settings.adminPassword;
          return ok({
            settings: settings, features: publicConfig(t, opts).features, tenant: slug0, plan: t.plan,
            drivers: t.drivers.map(function (d) { var o = U.clone(d); o.rating = rating(d); o.busy = t.bookings.some(function (b) { return b.driverId === d.id && D.ACTIVE.indexOf(b.status) > 0; }); return o; }),
            bookings: t.bookings.slice(0, 500).map(function (x) {
              var o = customerView(t, x, nowTs); o.driverId = x.driverId; o.offer = x.offer || null; o.customerKey = x.customerKey;
              if (x.status === 'pending') o.candidates = D.rank(t, x, nowTs).slice(0, 4);
              return o;
            }),
            scans: t.scans, campaigns: t.campaigns, promos: t.promos,
            companies: t.companies.map(function (c) { var o = U.clone(c); delete o.password; return o; }),
            customers: Object.keys(t.customers).map(function (k) { var c = t.customers[k]; var p = customerProfile(t, c); p.key = k; p.createdAt = c.createdAt; return p; })
              .sort(function (a, b) { return b.spent - a.spent; }).slice(0, 300),
            serverNow: nowTs
          });
        }
        if (method === 'POST' && path === '/api/admin/analytics') {
          return ok(TR.analytics.compute(t, { now: nowTs, days: U.clamp(parseInt(body.days, 10) || 30, 1, 365) }));
        }
        if (method === 'POST' && (m = path.match(/^\/api\/admin\/bookings\/(TR-\d+)$/))) {
          var ab = t.bookings.find(function (x) { return x.code === m[1]; });
          if (!ab) return err(404, 'not_found');
          var a = body.action;
          if (a === 'assign') {
            var drv = driverOf(t, body.driverId);
            ab.driverId = drv ? drv.id : null;
            if (drv && ab.status === 'pending') setStatus(ab, 'accepted', nowTs, 'dispatcher');
            if (!drv && ab.status === 'accepted') { setStatus(ab, 'pending', nowTs, 'dispatcher'); ab.offer = { tried: [] }; D.offerNext(t, ab, nowTs); }
          } else if (a === 'redispatch') { ab.offer = { tried: [] }; D.offerNext(t, ab, nowTs); }
          else if (a === 'paid') markPaid(t, ab, nowTs, 'office');
          else if (a === 'unpaid') { ab.payStatus = 'unpaid'; }
          else if (a === 'cancel') setStatus(ab, 'cancelled', nowTs, 'dispatcher');
          else if (a === 'price' && U.isNum(body.price) && body.price >= 0) ab.price = U.round2(body.price);
          else if (a === 'status' && FLOW.indexOf(body.status) >= 0) { setStatus(ab, body.status, nowTs, 'dispatcher'); if (body.status === 'completed') complete(t, ab, nowTs); }
          else if (a === 'flight') applyFlight(t, ab, body.flight || {}, nowTs);
          else return err(400, 'action');
          return ok({ ok: true });
        }
        if (method === 'PUT' && path === '/api/admin/settings') {
          if (body.brand) { S.brand = Object.assign(S.brand, U.pick(body.brand, ['name', 'tagline', 'phone', 'email', 'city', 'logo', 'accent', 'domain'])); if (S.brand.logo && S.brand.logo.length > 400000) S.brand.logo = ''; }
          if (body.payment) S.payment = Object.assign(S.payment, body.payment);
          if (body.services) S.services = Object.assign(S.services, body.services);
          if (body.pricing) S.pricing = Object.assign(S.pricing, body.pricing);
          if (body.dispatch) S.dispatch = Object.assign(S.dispatch, U.pick(body.dispatch, ['mode', 'offerSeconds', 'maxMiles', 'shareWithinMiles']));
          if (body.flight) S.flight = Object.assign(S.flight, body.flight);
          if (Array.isArray(body.vehicles)) S.vehicles = body.vehicles.map(function (v) {
            return { id: U.slug(v.id) || 'v' + U.code(5).toLowerCase(), name: U.str(v.name, 60), icon: U.str(v.icon, 20) || 'sedan',
              image: String(v.image || '').length < 600000 ? String(v.image || '') : '', desc: U.str(v.desc, 160),
              features: (Array.isArray(v.features) ? v.features : String(v.features || '').split(',')).map(function (f) { return U.str(f, 40); }).filter(Boolean).slice(0, 8),
              seats: +v.seats || 1, bags: +v.bags || 0, base: +v.base || 0, perMile: +v.perMile || 0, minFare: +v.minFare || 0,
              hourly: +v.hourly || 0, minHours: +v.minHours || 1, active: v.active !== false };
          });
          if (Array.isArray(body.places)) S.places = body.places.filter(function (p) { return U.str(p.name); }).map(function (p) {
            return { id: U.slug(p.id) || 'p' + U.code(5).toLowerCase(), name: U.str(p.name, 120), type: ['airport', 'hotel', 'venue', 'area'].indexOf(p.type) >= 0 ? p.type : 'area',
              lat: +p.lat, lng: +p.lng, fee: +p.fee || 0, aliases: (Array.isArray(p.aliases) ? p.aliases : String(p.aliases || '').split(',')).map(function (x) { return U.str(x, 40); }).filter(Boolean) };
          });
          if (body.adminPassword && U.str(body.adminPassword).length >= 6 && !opts.lockPassword) S.adminPassword = hash(U.str(body.adminPassword, 100));
          return ok({ ok: true });
        }
        if (method === 'POST' && path === '/api/admin/drivers') {
          var nd = body.id && driverOf(t, body.id);
          var pin = U.str(body.pin, 12);
          if (!U.str(body.name) || !/^\d{4,8}$/.test(pin)) return err(400, 'driver');
          if (t.drivers.some(function (x) { return x.pin === pin && x !== nd; })) return err(409, 'pin_taken');
          if (!nd) { nd = { id: 'd' + U.code(6).toLowerCase(), location: null, ratingSum: 0, ratingCount: 0, stats: {}, online: false }; t.drivers.push(nd); }
          Object.assign(nd, { name: U.str(body.name, 60), phone: U.str(body.phone, 30), pin: pin, plate: U.str(body.plate, 20),
            vehicles: Array.isArray(body.vehicles) ? body.vehicles.map(function (x) { return U.str(x, 30); }) : [], active: body.active !== false });
          return ok({ ok: true, id: nd.id });
        }
        if (method === 'DELETE' && (m = path.match(/^\/api\/admin\/drivers\/(\w+)$/))) {
          t.drivers = t.drivers.filter(function (x) { return x.id !== m[1]; });
          t.bookings.forEach(function (x) {
            if (x.driverId === m[1] && FLOW.indexOf(x.status) < 5 && x.status !== 'cancelled') { x.driverId = null; setStatus(x, 'pending', nowTs); x.offer = { tried: [] }; D.offerNext(t, x, nowTs); }
          });
          return ok({ ok: true });
        }
        if (method === 'POST' && path === '/api/admin/campaigns') {
          var cid = U.slug(body.id || body.name);
          if (!cid) return err(400, 'campaign');
          var cpg = t.campaigns.find(function (c) { return c.id === cid; });
          if (!cpg) { cpg = { id: cid, createdAt: nowTs }; t.campaigns.push(cpg); }
          Object.assign(cpg, { name: U.str(body.name, 80) || cid, channel: U.slug(body.channel) || 'card', welcome: U.str(body.welcome, 80),
            presets: U.pick(body.presets || {}, ['service', 'vehicleId', 'pickupId', 'dropoffId', 'promo']) });
          return ok({ ok: true, id: cid });
        }
        if (method === 'DELETE' && (m = path.match(/^\/api\/admin\/campaigns\/([a-z0-9-]+)$/))) {
          t.campaigns = t.campaigns.filter(function (c) { return c.id !== m[1]; });
          return ok({ ok: true });
        }
        if (method === 'POST' && path === '/api/admin/promos') {
          var pc = U.str(body.code, 30).toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (pc.length < 3 || !(+body.value > 0)) return err(400, 'promo');
          var pr2 = t.promos.find(function (x) { return x.code === pc; });
          if (!pr2) { pr2 = { code: pc, used: 0 }; t.promos.push(pr2); }
          Object.assign(pr2, { type: body.type === 'amount' ? 'amount' : 'pct', value: Math.min(+body.value, body.type === 'amount' ? 10000 : 100),
            maxUses: parseInt(body.maxUses, 10) || 0, expires: U.str(body.expires, 30), services: Array.isArray(body.services) ? body.services : [],
            vehicles: Array.isArray(body.vehicles) ? body.vehicles : [], firstRideOnly: !!body.firstRideOnly, active: body.active !== false });
          return ok({ ok: true });
        }
        if (method === 'DELETE' && (m = path.match(/^\/api\/admin\/promos\/([A-Z0-9]+)$/))) {
          t.promos = t.promos.filter(function (x) { return x.code !== m[1]; });
          return ok({ ok: true });
        }
        if (method === 'POST' && path === '/api/admin/companies') {
          var cc = U.str(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!U.str(body.name) || cc.length < 3) return err(400, 'company');
          var cmp = body.id && t.companies.find(function (x) { return x.id === body.id; });
          if (t.companies.some(function (x) { return x.code === cc && x !== cmp; })) return err(409, 'code_taken');
          if (!cmp) { if (U.str(body.password).length < 6) return err(400, 'password'); cmp = { id: 'c' + U.code(6).toLowerCase(), invoices: {} }; t.companies.push(cmp); }
          Object.assign(cmp, { name: U.str(body.name, 80), code: cc, billingEmail: U.str(body.billingEmail, 120), discountPct: U.clamp(+body.discountPct || 0, 0, 50), active: body.active !== false });
          if (U.str(body.password).length >= 6) cmp.password = hash(U.str(body.password, 100));
          return ok({ ok: true, id: cmp.id });
        }
        if (method === 'POST' && (m = path.match(/^\/api\/admin\/companies\/(\w+)\/invoice$/))) {
          var ic = t.companies.find(function (x) { return x.id === m[1]; });
          if (!ic || !/^\d{4}-\d{2}$/.test(body.month || '')) return err(400, 'invoice');
          ic.invoices = ic.invoices || {};
          ic.invoices[body.month] = { status: body.status === 'paid' ? 'paid' : 'sent', at: nowTs };
          if (body.status === 'paid') t.bookings.forEach(function (b) {
            if (b.companyId === ic.id && b.payMethod === 'invoice' && b.status === 'completed' && monthOf(b) === body.month) markPaid(t, b, nowTs, 'invoice-' + body.month);
          });
          return ok({ ok: true });
        }
        if (method === 'GET' && (m = path.match(/^\/api\/admin\/companies\/(\w+)\/report$/))) {
          var rc = t.companies.find(function (x) { return x.id === m[1]; });
          return rc ? ok(companyReport(t, rc)) : err(404, 'not_found');
        }
        if (method === 'DELETE' && (m = path.match(/^\/api\/admin\/companies\/(\w+)$/))) {
          t.companies = t.companies.filter(function (x) { return x.id !== m[1]; });
          return ok({ ok: true });
        }
        if (method === 'POST' && path === '/api/admin/customers') {
          var ck = t.customers[body.key];
          if (!ck) return err(404, 'not_found');
          if (U.isNum(body.points)) ck.points = Math.max(0, Math.round(body.points));
          return ok({ ok: true });
        }
        return err(404, 'not_found');
      }
      return err(404, 'not_found');
    }

    function monthOf(b) { var ts = b.when && b.when !== 'now' ? Date.parse(b.when) : b.createdAt; return new Date(ts).toISOString().slice(0, 7); }

    function companyReport(t, comp) {
      var rides = t.bookings.filter(function (b) { return b.companyId === comp.id; });
      var months = {};
      rides.forEach(function (b) {
        if (b.status === 'cancelled') return;
        var mo = monthOf(b), x = months[mo] || (months[mo] = { month: mo, rides: 0, total: 0, unpaid: 0 });
        x.rides++; x.total = U.round2(x.total + (b.price || 0)); if (b.payStatus !== 'paid') x.unpaid = U.round2(x.unpaid + (b.price || 0));
      });
      return {
        company: { id: comp.id, name: comp.name, code: comp.code, billingEmail: comp.billingEmail, discountPct: comp.discountPct, invoices: comp.invoices || {} },
        months: Object.keys(months).sort().reverse().map(function (k) { var x = months[k]; x.invoice = (comp.invoices || {})[k] || null; return x; }),
        rides: rides.slice(0, 300).map(function (b) {
          return { code: b.code, when: b.when === 'now' ? new Date(b.createdAt).toISOString() : b.when, employee: b.customer.name, phone: b.customer.phone,
            pickup: b.pickup.name, dropoff: b.dropoff.name, vehicle: (vehicleOf(t, b.vehicleId) || {}).name, price: b.price, status: b.status, payStatus: b.payStatus, payMethod: b.payMethod };
        })
      };
    }

    function addFavorite(cu, b) {
      cu.favorites = cu.favorites || [];
      var fav = { pickup: b.pickup, dropoff: b.dropoff, vehicleId: b.vehicleId, service: b.service, label: b.pickup.name.split(',')[0] + ' → ' + b.dropoff.name.split(',')[0] };
      if (!cu.favorites.some(function (f) { return f.label === fav.label && f.vehicleId === fav.vehicleId; })) cu.favorites.unshift(fav);
      cu.favorites = cu.favorites.slice(0, 8);
    }

    function prune(R) {
      Object.keys(R.sessions).forEach(function (k) { if (now() - R.sessions[k].at > SESSION_TTL) delete R.sessions[k]; });
    }

    function run(fn) {
      var R = load();
      var before = JSON.stringify(R);
      var res;
      try { res = fn(R); } catch (e) { if (opts.onError) opts.onError(e); return err(500, 'server'); }
      prune(R);
      if (JSON.stringify(R) !== before) opts.save(R);
      return res;
    }

    return {
      handle: function (method, path, body, auth, ctx) {
        return run(function (R) { return route(R, method, path, body, auth, ctx); });
      },
      // Server integrations (card payments, flight tracking, AI) work on one company's data.
      withTenant: function (ctx, fn) {
        return run(function (R) { var slug = resolveTenant(R, ctx); return fn(R.tenants[slug], slug, R); });
      },
      tick: function () { return run(function (R) { Object.keys(R.tenants).forEach(function (k) { D.tick(R.tenants[k], now()); }); return true; }); },
      helpers: { markPaid: markPaid, applyFlight: applyFlight, customerView: customerView, publicConfig: publicConfig }
    };
  }

  TR.core = { createCore: createCore, defaultRoot: defaultRoot, defaultTenant: defaultTenant, migrate: migrate, FLOW: FLOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = TR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
