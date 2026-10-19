// Online card payments with Stripe Checkout (cards, Apple Pay, Google Pay, Link).
// Turned on by STRIPE_SECRET_KEY. Uses Stripe's REST API directly, no SDK needed.
const crypto = require('crypto');

function enabled() { return !!process.env.STRIPE_SECRET_KEY; }

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await r.json();
  if (!r.ok) throw new Error((json.error && json.error.message) || 'stripe_error');
  return json;
}

// { a: { b: 1 }, c: [ { d: 2 } ] } -> { 'a[b]': 1, 'c[0][d]': 2 }
function flatten(obj, prefix, out) {
  out = out || {};
  Object.keys(obj).forEach(k => {
    const key = prefix ? `${prefix}[${k}]` : k;
    const v = obj[k];
    if (v && typeof v === 'object') flatten(v, key, out);
    else if (v !== undefined && v !== null) out[key] = String(v);
  });
  return out;
}

async function createCheckout({ booking, brand, currency, origin, tenant }) {
  return stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: booking.customer.email || undefined,
    client_reference_id: booking.code,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: (currency || 'USD').toLowerCase(),
        unit_amount: Math.round(booking.price * 100),
        product_data: { name: `${brand.name} ride ${booking.code}`, description: `${booking.pickup.name} → ${booking.dropoff.name}` }
      }
    }],
    metadata: { tenant, code: booking.code },
    payment_intent_data: { metadata: { tenant, code: booking.code } },
    success_url: `${origin}/#track-${booking.code}`,
    cancel_url: `${origin}/#track-${booking.code}`
  });
}

function getSession(id) { return stripe('GET', '/checkout/sessions/' + encodeURIComponent(id)); }

// Verifies the Stripe-Signature header (v1 scheme, 5 minute tolerance).
function verifyWebhook(raw, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return null;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const given = Buffer.from(parts.v1 || '', 'hex');
  if (given.length !== 32 || !crypto.timingSafeEqual(given, Buffer.from(expected, 'hex'))) return null;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return null;
  return JSON.parse(raw);
}

module.exports = { enabled, createCheckout, getSession, verifyWebhook };
