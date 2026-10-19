// End-to-end API test against a real server process with a throwaway data file.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const PORT = 3999;
const DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 'db.json');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DATA_FILE, ADMIN_PASSWORD: 'secret-test', PLATFORM_PASSWORD: 'platform-test', DEMO_PAYMENTS: '1', ANTHROPIC_API_KEY: '', STRIPE_SECRET_KEY: '', FLIGHT_API_KEY: '' },
  stdio: ['ignore', 'ignore', 'inherit']
});
const base = `http://127.0.0.1:${PORT}`;
const call = (m, p, body, tk, tenant) => fetch(base + p, {
  method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}), ...(tenant ? { 'X-Tenant': tenant } : {}) },
  body: m === 'GET' ? undefined : JSON.stringify(body || {})
}).then(async r => ({ status: r.status, body: await r.json() }));
const step = (name) => console.log('✓ ' + name);

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/config'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const cfg = (await call('GET', '/api/config')).body;
  assert.ok(cfg.vehicles.length >= 5 && cfg.features.card && !cfg.features.ai);
  const place = id => cfg.places.find(p => p.id === id);
  step('config');

  // AI assistant (rules fallback)
  const as = await call('POST', '/api/assist', { text: 'SUV from MKE to downtown Chicago tomorrow at 5pm for 4 people' });
  assert.equal(as.body.draft.pickup.placeId, 'mke'); assert.equal(as.body.draft.dropoff.placeId, 'chidt'); assert.equal(as.body.draft.passengers, 4);
  step('assistant parses a sentence');

  // drivers go online with locations: Mike next to MKE, Sara a few miles away
  const d1 = (await call('POST', '/api/driver/login', { pin: '1111' })).body.token;
  const d2 = (await call('POST', '/api/driver/login', { pin: '2222' })).body.token;
  await call('POST', '/api/driver/location', { lat: 42.95, lng: -87.9 }, d1);
  await call('POST', '/api/driver/location', { lat: 43.03, lng: -87.95 }, d2);

  // quote with promo and round trip
  const q = await call('POST', '/api/quote', { vehicleId: 'suv', service: 'airport', pickup: place('mke'), dropoff: place('ord'), promoCode: 'FLY10' });
  assert.ok(q.body.quote.total > 99); assert.equal(q.body.quote.discounts[0].k, 'promo'); assert.ok(q.body.perVehicle.van > q.body.perVehicle.sedan);
  const bad = await call('POST', '/api/quote', { vehicleId: 'suv', pickup: place('mke'), dropoff: place('ord'), promoCode: 'NOPE' });
  assert.equal(bad.body.errors.promo, 'promo_invalid');
  step('pricing, promo codes');

  // booking from a QR campaign -> smart dispatch offers it to the closest driver
  const bk = await call('POST', '/api/bookings', { vehicleId: 'suv', service: 'airport', pickup: place('mke'), dropoff: place('ord'), name: 'Test Rider', phone: '+1 414 555 0000',
    passengers: 3, payMethod: 'card', source: 'hilton', promoCode: 'FLY10', flight: 'AA1234', when: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal(bk.status, 200, JSON.stringify(bk.body));
  const code = bk.body.code, tok = bk.body.token, cust = bk.body.customerToken;
  let j1 = (await call('GET', '/api/driver/jobs', null, d1)).body, j2 = (await call('GET', '/api/driver/jobs', null, d2)).body;
  assert.equal(j1.offers[0].code, code, 'closest driver gets the offer'); assert.equal(j2.open.length + j2.offers.length, 0, 'others wait');
  await call('POST', `/api/driver/jobs/${code}/decline`, {}, d1);
  j2 = (await call('GET', '/api/driver/jobs', null, d2)).body;
  assert.equal(j2.offers[0].code, code, 'declined offer moves to next driver');
  assert.equal((await call('POST', `/api/driver/jobs/${code}/accept`, {}, d2)).status, 200);
  step('smart dispatch: offer, decline, next driver accepts');

  for (const s of ['enroute', 'arrived', 'ontrip', 'completed']) assert.equal((await call('POST', `/api/driver/jobs/${code}/status`, { status: s }, d2)).status, 200);
  assert.equal((await call('POST', `/api/bookings/${code}/pay-demo`, { t: tok })).status, 200);
  const view = (await call('POST', '/api/bookings/' + code, { t: tok })).body.booking;
  assert.equal(view.status, 'completed'); assert.equal(view.payStatus, 'paid'); assert.ok(view.receiptNo);
  assert.equal((await call('POST', `/api/bookings/${code}/rate`, { t: tok, driver: 5, ride: 4, comment: 'Great' })).status, 200);
  const me = (await call('POST', '/api/me', { customerToken: cust })).body;
  assert.equal(me.profile.rides, 1); assert.ok(me.profile.points > 0); assert.ok(me.profile.referralCode);
  step('trip lifecycle, card payment, receipt, rating, loyalty points');

  // referral: a friend uses the code on a first ride
  const rq = await call('POST', '/api/quote', { vehicleId: 'sedan', pickup: place('mkedt'), dropoff: place('mke'), promoCode: me.profile.referralCode });
  assert.equal(rq.body.quote.discounts[0].k, 'referral');
  step('referral code');

  // recurring weekly rides for a corporate account billed by invoice
  const series = await call('POST', '/api/bookings', { vehicleId: 'sedan', service: 'point', pickup: place('mkedt'), dropoff: place('mke'), name: 'Ana Employee', phone: '4145550002',
    payMethod: 'invoice', companyCode: 'ACME', when: new Date(Date.now() + 864e5).toISOString(), repeat: { freq: 'weekly', count: 4 } });
  assert.equal(series.status, 200, JSON.stringify(series.body)); assert.equal(series.body.series.length, 4);
  assert.ok(series.body.booking.breakdown.discounts.some(d => d.k === 'company'));
  const co = (await call('POST', '/api/company/login', { code: 'ACME', password: 'acme123' })).body.token;
  const rep = (await call('GET', '/api/company/state', null, co)).body;
  assert.equal(rep.rides.length, 4);
  step('recurring rides, corporate account and portal');

  // owner dashboard
  assert.equal((await call('POST', '/api/admin/login', { password: 'admin123' })).status, 401);
  const at = (await call('POST', '/api/admin/login', { password: 'secret-test' })).body.token;
  await call('POST', '/api/scan', { src: 'hilton' });
  const an = (await call('POST', '/api/admin/analytics', { days: 30 }, at)).body;
  const hil = an.sources.find(s => s.id === 'hilton');
  assert.equal(hil.scans, 1); assert.equal(hil.bookings, 1); assert.ok(hil.revenue > 0);
  assert.ok(an.drivers.find(d => d.name === 'Sara K.').rating === 5);
  const st = (await call('GET', '/api/admin/state', null, at)).body;
  const pend = st.bookings.find(b => b.status === 'pending');
  assert.ok(pend.candidates.length >= 1);
  await call('POST', '/api/admin/campaigns', { name: 'Marriott desk', channel: 'hotel', presets: { pickupId: 'mkedt', service: 'airport' } }, at);
  await call('POST', '/api/admin/promos', { code: 'VIP20', type: 'pct', value: 20 }, at);
  assert.ok((await call('GET', '/api/config')).body.campaigns.some(c => c.id === 'marriott-desk'));
  step('owner analytics, campaigns, promos');

  // flight delay moves the pickup time
  const fb = await call('POST', '/api/bookings', { vehicleId: 'sedan', service: 'airport', pickup: place('ord'), dropoff: place('chidt'), name: 'Flyer', phone: '3125550000',
    payMethod: 'pos', flight: 'UA100', when: new Date(Date.now() + 5 * 3600e3).toISOString() });
  const arr = new Date(Date.now() + 7 * 3600e3).toISOString();
  await call('POST', '/api/admin/bookings/' + fb.body.code, { action: 'flight', flight: { status: 'delayed', estimatedArr: arr, delayMin: 120 } }, at);
  const fv = (await call('POST', '/api/bookings/' + fb.body.code, { t: fb.body.token })).body.booking;
  assert.equal(Date.parse(fv.when), Date.parse(arr) + 15 * 60e3);
  step('flight delay adjusts pickup');

  // SaaS: platform creates a second company; data is isolated
  const pt = (await call('POST', '/api/platform/login', { password: 'platform-test' })).body.token;
  assert.equal((await call('POST', '/api/platform/tenants', { name: 'Lone Star Limo', slug: 'lonestar', ownerPassword: 'owner-pass', domain: 'rides.lonestar.example', accent: '#3a7bd5' }, pt)).status, 200);
  const lcfg = (await call('GET', '/api/config', null, null, 'lonestar')).body;
  assert.equal(lcfg.brand.name, 'Lone Star Limo'); assert.equal(lcfg.brand.accent, '#3a7bd5');
  const lat = (await call('POST', '/api/admin/login', { password: 'owner-pass' }, null, 'lonestar')).body.token;
  assert.equal((await call('GET', '/api/admin/state', null, lat, 'lonestar')).body.bookings.length, 0);
  assert.equal((await call('GET', '/api/admin/state', null, lat)).status, 401, 'owner token is bound to its company');
  const byHost = await new Promise((ok, no) => require('http').get({ host: '127.0.0.1', port: PORT, path: '/api/config', headers: { Host: 'rides.lonestar.example' } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => ok(JSON.parse(d)));
  }).on('error', no));
  assert.equal(byHost.brand.name, 'Lone Star Limo');
  const plist = (await call('GET', '/api/platform/state', null, pt)).body.tenants;
  assert.equal(plist.length, 2);
  step('multi-company SaaS, white-label domain');

  await new Promise(r => setTimeout(r, 400));
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  assert.ok(saved.tenants.default.bookings.length >= 6 && saved.tenants.lonestar);
  assert.ok(saved.tenants.default.settings.adminPassword.startsWith('scrypt:'));
  step('persisted to disk, passwords hashed');
  console.log('All smoke tests passed');
  srv.kill();
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
