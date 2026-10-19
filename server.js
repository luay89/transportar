// Transportar server (Node 18+). Serves the PWA from ./public and the JSON API from /api.
// One server hosts many companies: each is picked by its own domain, subdomain or X-Tenant header.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

['util', 'pricing', 'dispatch', 'nlp', 'analytics', 'core'].forEach(f => require(`./public/core/${f}.js`));
const TR = globalThis.TR;
const ai = require('./server/ai');
const stripe = require('./server/stripe');
const flights = require('./server/flights');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const DEMO_PAYMENTS = process.env.DEMO_PAYMENTS === '1' && !stripe.enabled();

// ---- passwords: scrypt with a per-password salt
function hash(pw) {
  const salt = crypto.randomBytes(12).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verify(pw, stored) {
  if (!stored) return false;
  if (stored.startsWith('plain:')) return stored === 'plain:' + pw;
  const [, salt, h] = stored.split(':');
  const a = crypto.scryptSync(pw, salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- storage
let state;
try { state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { state = null; }
state = TR.core.migrate(state, Date.now(), hash);
if (process.env.ADMIN_PASSWORD) state.tenants.default.settings.adminPassword = hash(process.env.ADMIN_PASSWORD);
else if (verify('admin123', state.tenants.default.settings.adminPassword)) console.warn('Owner password is still "admin123". Set ADMIN_PASSWORD before going live.');
if (process.env.PLATFORM_PASSWORD) state.platform.password = hash(process.env.PLATFORM_PASSWORD);
else if (verify('platform123', state.platform.password)) console.warn('Platform password is still "platform123". Set PLATFORM_PASSWORD before going live.');

let writeTimer = null;
function save(next) {
  state = next;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  }, 200);
}

const core = TR.core.createCore({
  load: () => state, save, hash, verify,
  lockPassword: !!process.env.ADMIN_PASSWORD,
  cardEnabled: stripe.enabled() || DEMO_PAYMENTS, demoCard: DEMO_PAYMENTS,
  aiEnabled: ai.enabled(), flightsEnabled: flights.enabled(),
  onError: e => console.error(e)
});

// ---- helpers
const attempts = new Map();
function limited(ip, max = 20) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  a.push(now); attempts.set(ip, a);
  return a.length > max;
}
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' }, headers));
  res.end(body);
}
function json(res, status, body) { send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); }
function ctxOf(req) { return { tenant: String(req.headers['x-tenant'] || '').toLowerCase() || null, host: req.headers.host }; }
function originOf(req) { return (process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/$/, ''); }
function findBooking(t, code, tok) { const b = t.bookings.find(x => x.code === code); return b && b.token === tok ? b : null; }

// ---- integrations that need the network (async), outside the pure core
const special = {
  async 'POST /api/assist'(req, body) {
    if (!ai.enabled()) return null;
    if (limited('ai:' + req.socket.remoteAddress, 60)) return { status: 429, body: { error: 'too_many' } };
    const cfg = core.handle('GET', '/api/config', {}, '', ctxOf(req)).body;
    try { return { status: 200, body: { draft: await ai.parseRequest(body.text, cfg, Date.now()) } }; }
    catch (e) { console.error('AI parse failed, using rules:', e.message); return null; }
  },
  async 'POST /api/admin/ai-insights'(req, body, auth) {
    const a = core.handle('POST', '/api/admin/analytics', { days: body.days }, auth, ctxOf(req));
    if (a.status !== 200) return a;
    if (!ai.enabled()) return { status: 400, body: { error: 'ai_off' } };
    const brand = core.handle('GET', '/api/config', {}, '', ctxOf(req)).body.brand.name;
    try { return { status: 200, body: { text: await ai.insights(a.body, brand, body.lang) } }; }
    catch (e) { return { status: 502, body: { error: 'ai_failed' } }; }
  },
  async 'POST /api/bookings/:code/checkout'(req, body, auth, code) {
    if (!stripe.enabled()) return null;
    let info = null;
    core.withTenant(ctxOf(req), (t, slug) => {
      const b = findBooking(t, code, body.t);
      if (b && b.payMethod === 'card' && b.payStatus !== 'paid' && b.price) info = { booking: JSON.parse(JSON.stringify(b)), brand: t.settings.brand, currency: t.settings.currency, slug };
    });
    if (!info) return { status: 409, body: { error: 'state' } };
    try {
      const s = await stripe.createCheckout({ booking: info.booking, brand: info.brand, currency: info.currency, origin: originOf(req), tenant: info.slug });
      core.withTenant(ctxOf(req), t => { const b = t.bookings.find(x => x.code === code); if (b) b.checkoutId = s.id; });
      return { status: 200, body: { url: s.url } };
    } catch (e) { return { status: 502, body: { error: 'payment_provider', message: e.message } }; }
  },
  async 'POST /api/bookings/:code/checkout-confirm'(req, body, auth, code) {
    if (!stripe.enabled()) return null;
    let sid = null;
    core.withTenant(ctxOf(req), t => { const b = findBooking(t, code, body.t); if (b) sid = b.checkoutId; });
    if (!sid) return { status: 200, body: { paid: false } };
    const s = await stripe.getSession(sid).catch(() => null);
    const paid = s && s.payment_status === 'paid';
    if (paid) core.withTenant(ctxOf(req), t => { const b = t.bookings.find(x => x.code === code); if (b) core.helpers.markPaid(t, b, Date.now(), s.payment_intent); });
    return { status: 200, body: { paid } };
  }
};

async function handleApi(req, res, url, raw) {
  if (url.pathname === '/api/stripe/webhook') {
    const evt = stripe.verifyWebhook(raw, req.headers['stripe-signature']);
    if (!evt) return json(res, 400, { error: 'signature' });
    if (evt.type === 'checkout.session.completed' && evt.data.object.payment_status === 'paid') {
      const md = evt.data.object.metadata || {};
      core.withTenant({ tenant: md.tenant }, t => { const b = t.bookings.find(x => x.code === md.code); if (b) core.helpers.markPaid(t, b, Date.now(), evt.data.object.payment_intent); });
    }
    return json(res, 200, { received: true });
  }
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'json' }); }
  if (/\/login$/.test(url.pathname) && limited(req.socket.remoteAddress)) return json(res, 429, { error: 'too_many' });
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');

  const m = url.pathname.match(/^\/api\/bookings\/(TR-\d+)\/(checkout|checkout-confirm)$/);
  const key = m ? `${req.method} /api/bookings/:code/${m[2]}` : `${req.method} ${url.pathname}`;
  if (special[key]) {
    const out = await special[key](req, body, auth, m && m[1]);
    if (out) return json(res, out.status, out.body);
  }
  const out = core.handle(req.method, url.pathname, body, auth, ctxOf(req));
  json(res, out.status, out.body);
}

function manifest(req) {
  const cfg = core.handle('GET', '/api/config', {}, '', ctxOf(req)).body;
  const b = cfg.brand || {};
  return JSON.stringify({
    name: b.name, short_name: (b.name || 'Rides').slice(0, 12), description: b.tagline,
    start_url: '/?src=pwa', scope: '/', display: 'standalone', orientation: 'any',
    background_color: '#121418', theme_color: '#121418',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [{ name: 'Book a ride', url: '/#book' }, { name: 'Driver app', url: '/#driver' }, { name: 'Owner dashboard', url: '/#admin' }]
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => handleApi(req, res, url, raw).catch(e => { console.error(e); json(res, 500, { error: 'server' }); }));
    return;
  }
  if (url.pathname === '/manifest.webmanifest') return send(res, 200, manifest(req), { 'Content-Type': TYPES['.webmanifest'], 'Cache-Control': 'no-cache' });

  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  const ext = path.extname(file);
  const cache = ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300';
  fs.readFile(file, (e, data) => {
    if (e) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
  });
});

// ---- background jobs
setInterval(() => core.tick(), 10 * 1000).unref();
async function pollFlights() {
  if (!flights.enabled()) return;
  const now = Date.now(), todo = [];
  core.withTenant({}, (t, slug, root) => {
    Object.keys(root.tenants).forEach(k => root.tenants[k].bookings.forEach(b => {
      const at = b.when === 'now' ? now : Date.parse(b.when);
      if (b.flight && b.flight.number && ['pending', 'accepted'].includes(b.status) && at > now - 6 * 3600e3 && at < now + 36 * 3600e3) todo.push({ tenant: k, code: b.code, number: b.flight.number });
    }));
  });
  for (const job of todo) {
    const info = await flights.lookup(job.number).catch(() => null);
    if (info) core.withTenant({ tenant: job.tenant }, t => { const b = t.bookings.find(x => x.code === job.code); if (b) core.helpers.applyFlight(t, b, info, Date.now()); });
  }
}
setInterval(pollFlights, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Transportar running on http://localhost:${PORT}`);
  console.log(`AI assistant: ${ai.enabled() ? 'Claude' : 'rules'} · Card payments: ${stripe.enabled() ? 'Stripe' : DEMO_PAYMENTS ? 'demo' : 'off'} · Flight tracking: ${flights.enabled() ? 'on' : 'manual'}`);
});
