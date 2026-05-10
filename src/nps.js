const NPS_BASE = 'https://developer.nps.gov/api/v1';

async function npsGet(path, params) {
  const url = new URL(`${NPS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NPS API ${path} returned ${res.status}`);
  return res.json();
}

export async function fetchAllParks(apiKey) {
  const parks = [];
  const limit = 100;
  let start = 0;

  while (true) {
    const data = await npsGet('/parks', {
      api_key: apiKey,
      limit,
      start,
      fields: 'addresses',
    });
    parks.push(...data.data);
    const total = parseInt(data.total, 10);
    if (parks.length >= total || data.data.length === 0) break;
    start += data.data.length;
  }

  return parks;
}

export async function fetchParkEvents(apiKey, parkCode) {
  const events = [];
  const limit = 50;
  let start = 0;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    const data = await npsGet('/events', {
      api_key: apiKey,
      parkCode,
      limit,
      start,
    });
    if (!data.data || data.data.length === 0) break;
    events.push(...data.data);
    const total = parseInt(data.total || '0', 10);
    if (events.length >= total) break;
    start += data.data.length;
  }

  return events;
}

export function findPark(parks, parkCode) {
  return parks.find(
    (p) => p.parkCode?.toLowerCase() === parkCode.toLowerCase(),
  );
}
