import { createEvents } from 'ics';

const PARK_HOURS_TYPES = new Set([
  'park hours',
  'hours of operation',
  'operating hours',
]);

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse "10:00 AM" → { hour, minute }
function parse12h(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

// Parse "2024-01-15" → [2024, 1, 15]
function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts;
}

// Strip DTSTART from NPS recurrencerule so we can pass it to ics as RRULE
function toRRule(ruleStr) {
  if (!ruleStr) return null;
  return ruleStr
    .split(';')
    .filter((p) => !p.startsWith('DTSTART=') && !p.startsWith('COUNT=0'))
    .join(';')
    .replace(/;$/, '');
}

function buildDescription(event, eventsPageUrl) {
  const parts = [];
  const body = stripHtml(event.description);
  if (body) parts.push(body);
  if (event.feeinfo) parts.push(`Fee info: ${stripHtml(event.feeinfo)}`);
  if (event.regresinfo) parts.push(`Registration: ${stripHtml(event.regresinfo)}`);
  if (event.regresurl) parts.push(`Register: ${event.regresurl}`);
  if (event.infourl) parts.push(`More info: ${event.infourl}`);
  parts.push(`All events: ${eventsPageUrl}`);
  return parts.join('\n\n');
}

// Convert one NPS event into one or more ics event objects (one per time slot).
function toIcsEvents(npsEvent, eventsPageUrl) {
  const types = (npsEvent.types || []).map((t) => t.toLowerCase());
  if (types.some((t) => PARK_HOURS_TYPES.has(t))) return [];

  const dateArr = parseDate(npsEvent.datestart || npsEvent.date);
  if (!dateArr) return [];

  const endDateArr = parseDate(npsEvent.dateend) || dateArr;
  const description = buildDescription(npsEvent, eventsPageUrl);
  const url = npsEvent.infourl || npsEvent.regresurl || eventsPageUrl;
  const uid = `${npsEvent.id || npsEvent.eventid}@nps-ical`;
  const title = npsEvent.title || 'NPS Event';
  const location = npsEvent.location || npsEvent.parkfullname || '';
  const categories = npsEvent.types || [];

  const rrule = npsEvent.isrecurring ? toRRule(npsEvent.recurrencerule) : null;

  const base = { title, description, url, location, categories };
  if (rrule) base.recurrenceRule = rrule;

  const times = (npsEvent.times || []).filter(
    (t) => t.timestart && !t.sunrisestart,
  );

  // Use floating time (no timezone suffix) — NPS doesn't expose per-park IANA zones.
  // Calendar apps will display these in the user's local timezone, which is the
  // best approximation available without knowing each park's exact timezone.
  const localTime = {
    startInputType: 'local',
    startOutputType: 'local',
    endInputType: 'local',
    endOutputType: 'local',
  };

  if (npsEvent.isallday || times.length === 0) {
    return [{ ...base, ...localTime, uid, start: dateArr, end: endDateArr }];
  }

  return times.map((slot, i) => {
    const s = parse12h(slot.timestart);
    const e = parse12h(slot.timeend);
    return {
      ...base,
      ...localTime,
      uid: times.length > 1 ? `${uid}-${i}` : uid,
      start: s ? [...dateArr, s.hour, s.minute] : dateArr,
      end: e ? [...endDateArr, e.hour, e.minute] : endDateArr,
    };
  });
}

export function generateICS(parkCode, parkName, npsEvents) {
  const eventsPageUrl = `https://www.nps.gov/${parkCode}/planyourvisit/events.htm`;
  const calName = `${parkName} Events`;

  const icsEvents = npsEvents.flatMap((e) => toIcsEvents(e, eventsPageUrl));

  // Properties added by the ics library: CALSCALE, METHOD, X-PUBLISHED-TTL:PT1H
  // We inject our own additions after VERSION:2.0 and then fix the TTL.
  const extraProps = [
    `X-WR-CALNAME:${calName}`,
    `X-WR-CALDESC:Upcoming events at ${parkName}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
  ].join('\r\n');

  if (icsEvents.length === 0) {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `PRODID:-//NPS iCal//${parkName}//EN`,
      extraProps,
      'X-PUBLISHED-TTL:PT12H',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  const { error, value } = createEvents(icsEvents);
  if (error) throw new Error(`ICS generation failed: ${error}`);

  return value
    .replace(/(VERSION:2\.0\r?\n)/, `$1${extraProps}\r\n`)
    .replace('X-PUBLISHED-TTL:PT1H', 'X-PUBLISHED-TTL:PT12H');
}
