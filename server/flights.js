// Airport flight tracking. With FLIGHT_API_KEY (aviationstack.com) the server checks
// tracked flights every 10 minutes and moves the pickup time to the real arrival
// plus the company's grace period. Without a key, dispatchers update flights by hand.
function enabled() { return !!process.env.FLIGHT_API_KEY; }

async function lookup(number) {
  const url = `http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(process.env.FLIGHT_API_KEY)}&flight_iata=${encodeURIComponent(number)}`;
  const r = await fetch(url);
  const json = await r.json();
  const f = (json.data || []).find(x => x.arrival) || null;
  if (!f) return null;
  const a = f.arrival, d = f.departure || {};
  return {
    number,
    status: f.flight_status || 'scheduled',
    scheduledArr: a.scheduled || null,
    estimatedArr: a.actual || a.estimated || a.scheduled || null,
    delayMin: a.delay || 0,
    terminal: a.terminal || null,
    gate: a.gate || null,
    international: !!(d.iata && a.iata && d.timezone && a.timezone && d.timezone.split('/')[0] !== a.timezone.split('/')[0])
  };
}

module.exports = { enabled, lookup };
