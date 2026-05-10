import { createEvents, type EventAttributes } from 'ics';
import type { NpsEvent } from './nps';

const PARK_HOURS_TYPES = new Set([
  'park hours',
  'hours of operation',
  'operating hours',
]);

function stripHtml(html: string): string {
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

function parse12h(timeStr: string): { hour: number; minute: number } | null {
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

type DateArray = [number, number, number] | [number, number, number, number, number];

function parseDate(dateStr: string): DateArray | null {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts as [number, number, number];
}

// NPS encodes RRULE and EXDATE together with a pipe: "FREQ=...;INTERVAL=1|EXDATE=2026-04-15,..."
// Split them apart and return each piece cleanly.
function parseRecurrenceRule(ruleStr: string): {
  rrule: string | null;
  exdates: [number, number, number][];
} {
  if (!ruleStr) return { rrule: null, exdates: [] };

  const pipeIdx = ruleStr.indexOf('|');
  const rrulePart = pipeIdx === -1 ? ruleStr : ruleStr.slice(0, pipeIdx);
  const exdatePart = pipeIdx === -1 ? '' : ruleStr.slice(pipeIdx + 1);

  const rrule =
    rrulePart
      .split(';')
      .filter((p) => !p.startsWith('DTSTART=') && !p.startsWith('COUNT=0'))
      .join(';')
      .replace(/;+$/, '') || null;

  const exdates: [number, number, number][] = [];
  if (exdatePart.startsWith('EXDATE=')) {
    for (const d of exdatePart.slice('EXDATE='.length).split(',')) {
      const parts = d.trim().split('-').map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        exdates.push(parts as [number, number, number]);
      }
    }
  }

  return { rrule, exdates };
}

function buildDescription(event: NpsEvent, eventsPageUrl: string): string {
  const parts: string[] = [];
  const body = stripHtml(event.description);
  if (body) parts.push(body);
  if (event.feeinfo) parts.push(`Fee info: ${stripHtml(event.feeinfo)}`);
  if (event.regresinfo) parts.push(`Registration: ${stripHtml(event.regresinfo)}`);
  if (event.regresurl) parts.push(`Register: ${event.regresurl}`);
  if (event.infourl) parts.push(`More info: ${event.infourl}`);
  parts.push(`All events: ${eventsPageUrl}`);
  return parts.join('\n\n');
}

function isTruthy(val: boolean | string | undefined): boolean {
  return val === true || val === 'true';
}

function toIcsEvents(npsEvent: NpsEvent, eventsPageUrl: string): EventAttributes[] {
  const types = (npsEvent.types || []).map((t) => t.toLowerCase());
  if (types.some((t) => PARK_HOURS_TYPES.has(t))) return [];

  const dateArr = parseDate(npsEvent.datestart || npsEvent.date);
  if (!dateArr) return [];

  const endDateArr = parseDate(npsEvent.dateend) ?? dateArr;
  const description = buildDescription(npsEvent, eventsPageUrl);
  const url = npsEvent.infourl || npsEvent.regresurl || eventsPageUrl;
  const uid = `${npsEvent.id || npsEvent.eventid}@nps-ical`;

  const base: Partial<EventAttributes> = {
    title: npsEvent.title || 'NPS Event',
    description,
    url,
    location: npsEvent.location || npsEvent.parkfullname || '',
    categories: npsEvent.types || [],
    // Use floating time — NPS doesn't expose per-park IANA timezone identifiers.
    startInputType: 'local',
    startOutputType: 'local',
    endInputType: 'local',
    endOutputType: 'local',
  };

  if (isTruthy(npsEvent.isrecurring)) {
    const { rrule, exdates } = parseRecurrenceRule(npsEvent.recurrencerule);
    if (rrule) base.recurrenceRule = rrule;
    if (exdates.length > 0) base.exclusionDates = exdates;
  }

  const times = (npsEvent.times || []).filter((t) => t.timestart && !isTruthy(t.sunrisestart));

  if (isTruthy(npsEvent.isallday) || times.length === 0) {
    return [{ ...base, uid, start: dateArr, end: endDateArr } as EventAttributes];
  }

  return times.map((slot, i): EventAttributes => {
    const s = parse12h(slot.timestart);
    const e = parse12h(slot.timeend);
    return {
      ...base,
      uid: times.length > 1 ? `${uid}-${i}` : uid,
      start: s ? ([...dateArr.slice(0, 3), s.hour, s.minute] as DateArray) : dateArr,
      end: e ? ([...endDateArr.slice(0, 3), e.hour, e.minute] as DateArray) : endDateArr,
    } as EventAttributes;
  });
}

export function generateICS(parkCode: string, parkName: string, npsEvents: NpsEvent[]): string {
  const eventsPageUrl = `https://www.nps.gov/${parkCode}/planyourvisit/events.htm`;
  const calName = `${parkName} Events`;

  const icsEvents = npsEvents.flatMap((e) => toIcsEvents(e, eventsPageUrl));

  // Properties the ics library already emits: CALSCALE, METHOD, X-PUBLISHED-TTL:PT1H
  // We inject ours after VERSION:2.0 and override the TTL.
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
  if (error || !value) throw new Error(`ICS generation failed: ${error}`);

  return value
    .replace(/(VERSION:2\.0\r?\n)/, `$1${extraProps}\r\n`)
    .replace('X-PUBLISHED-TTL:PT1H', 'X-PUBLISHED-TTL:PT12H');
}
