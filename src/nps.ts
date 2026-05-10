const NPS_BASE = 'https://developer.nps.gov/api/v1';

export interface NpsAddress {
  type: string;
  city: string;
  stateCode: string;
  postalCode: string;
  line1: string;
  line2: string;
  line3: string;
}

export interface NpsPark {
  id: string;
  url: string;
  fullName: string;
  parkCode: string;
  description: string;
  latitude: string;
  longitude: string;
  states: string;
  addresses: NpsAddress[];
  name: string;
  designation: string;
}

export interface NpsEventTime {
  timestart: string;
  timeend: string;
  sunrisestart: boolean | string;
  sunsetend: boolean | string;
}

export interface NpsEvent {
  id: string;
  eventid: string;
  title: string;
  description: string;
  location: string;
  datestart: string;
  dateend: string;
  date: string;
  dates: string[];
  times: NpsEventTime[];
  isallday: boolean | string;
  isrecurring: boolean | string;
  isfree: boolean | string;
  isregresrequired: boolean | string;
  types: string[];
  category: string;
  feeinfo: string;
  regresinfo: string;
  regresurl: string;
  infourl: string;
  parkfullname: string;
  sitecode: string;
  recurrencerule: string;
  recurrencedatestart: string;
  recurrencedateend: string;
  tags: string[];
}

interface NpsApiResponse<T> {
  total: string;
  data: T[];
}

async function npsGet<T>(path: string, params: Record<string, string | number>): Promise<NpsApiResponse<T>> {
  const url = new URL(`${NPS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NPS API ${path} returned ${res.status}`);
  return res.json() as Promise<NpsApiResponse<T>>;
}

export async function fetchAllParks(apiKey: string): Promise<NpsPark[]> {
  const parks: NpsPark[] = [];
  const limit = 100;
  let start = 0;

  while (true) {
    const data = await npsGet<NpsPark>('/parks', { api_key: apiKey, limit, start, fields: 'addresses' });
    parks.push(...data.data);
    if (parks.length >= parseInt(data.total, 10) || data.data.length === 0) break;
    start += data.data.length;
  }

  return parks;
}

export async function fetchParkEvents(apiKey: string, parkCode: string): Promise<NpsEvent[]> {
  const events: NpsEvent[] = [];
  const limit = 50;
  let start = 0;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    const data = await npsGet<NpsEvent>('/events', { api_key: apiKey, parkCode, limit, start });
    if (!data.data || data.data.length === 0) break;
    events.push(...data.data);
    if (events.length >= parseInt(data.total || '0', 10)) break;
    start += data.data.length;
  }

  return events;
}

export function findPark(parks: NpsPark[], parkCode: string): NpsPark | undefined {
  return parks.find((p) => p.parkCode?.toLowerCase() === parkCode.toLowerCase());
}
