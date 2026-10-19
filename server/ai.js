// AI booking assistant and business insights, powered by Claude.
// Turned on by setting ANTHROPIC_API_KEY; without it the app uses the rule-based parser.
let client = null;
const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';

function enabled() {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (client) return true;
  try {
    const mod = require('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod;
    client = new Anthropic();
    return true;
  } catch (e) {
    console.warn('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed. Run npm install.');
    return false;
  }
}

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pickup: { type: ['string', 'null'], description: 'Pickup: a known place id, or a free-text address' },
    dropoff: { type: ['string', 'null'], description: 'Drop-off: a known place id, or a free-text address' },
    when: { type: ['string', 'null'], description: 'ISO 8601 date-time with offset, or "now", or null if not stated' },
    passengers: { type: ['integer', 'null'] },
    bags: { type: ['integer', 'null'] },
    vehicleId: { type: ['string', 'null'], description: 'One of the vehicle ids, or null' },
    service: { type: 'string', enum: ['point', 'airport', 'hourly', 'event'] },
    tripType: { type: 'string', enum: ['oneway', 'round'] },
    hours: { type: ['integer', 'null'] },
    flight: { type: ['string', 'null'], description: 'Airline flight number like AA1234' },
    notes: { type: ['string', 'null'], description: 'Anything else the driver should know' },
    reply: { type: 'string', description: 'One short sentence to the customer, in the language they wrote in, confirming what was understood or asking for what is missing' }
  },
  required: ['pickup', 'dropoff', 'when', 'passengers', 'bags', 'vehicleId', 'service', 'tripType', 'hours', 'flight', 'notes', 'reply']
};

async function call(system, user, schema, effort) {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: effort || 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    system,
    messages: [{ role: 'user', content: user }]
  });
  if (res.stop_reason === 'refusal') throw new Error('refused');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return schema ? JSON.parse(text) : text;
}

// Natural language -> booking draft. `config` is the company's public config.
async function parseRequest(text, config, now) {
  const tz = (config.pricing && config.pricing.timezone) || 'America/Chicago';
  const system = `You turn a customer's ride request into a booking draft for ${config.brand.name}, a chauffeur company (${config.brand.city}).
Current time: ${new Date(now).toISOString()} (business timezone ${tz}; interpret times the customer gives in that timezone).
Known places (use the id when the customer means one of them):
${config.places.map(p => `- ${p.id}: ${p.name} [${p.type}]`).join('\n')}
Vehicles (choose the smallest that fits the passengers and luggage unless the customer names one):
${config.vehicles.map(v => `- ${v.id}: ${v.name}, ${v.seats} seats, ${v.bags} bags`).join('\n')}
Services: point (point to point), airport (to or from an airport), hourly (as-directed by the hour), event (weddings, proms, concerts, games).
Leave a field null when the customer did not say it. Never invent addresses.`;
  const out = await call(system, String(text).slice(0, 1500), DRAFT_SCHEMA, 'low');
  const asPlace = v => {
    if (!v) return null;
    const p = config.places.find(x => x.id === v);
    return p ? { name: p.name, lat: p.lat, lng: p.lng, placeId: p.id } : { name: String(v).slice(0, 160) };
  };
  const draft = { source: 'ai', service: out.service, tripType: out.tripType, reply: out.reply };
  if (out.pickup) draft.pickup = asPlace(out.pickup);
  if (out.dropoff) draft.dropoff = asPlace(out.dropoff);
  if (out.when && (out.when === 'now' || !isNaN(Date.parse(out.when)))) draft.when = out.when === 'now' ? 'now' : new Date(out.when).toISOString();
  ['passengers', 'bags', 'hours'].forEach(k => { if (Number.isInteger(out[k]) && out[k] > 0) draft[k] = out[k]; });
  if (out.vehicleId && config.vehicles.some(v => v.id === out.vehicleId)) draft.vehicleId = out.vehicleId;
  if (out.flight) draft.flight = String(out.flight).toUpperCase().replace(/\s/g, '').slice(0, 10);
  if (out.notes) draft.notes = String(out.notes).slice(0, 300);
  return draft;
}

// Analytics JSON -> short written briefing for the owner.
async function insights(analytics, brandName, lang) {
  const language = { ar: 'Arabic', es: 'Spanish' }[lang] || 'English';
  const system = `You are the operations analyst for ${brandName}, a chauffeur company. Write a briefing for the owner in ${language}.
Use only the numbers in the data. Cover: which marketing channels and QR campaigns bring bookings and revenue, busiest areas and times, driver performance and ratings, vehicle use, and 3 concrete actions for next month.
Plain sentences, short sections with headings, no tables, under 300 words.`;
  return call(system, JSON.stringify(analytics), null, 'medium');
}

module.exports = { enabled, parseRequest, insights };
