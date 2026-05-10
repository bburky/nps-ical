import { createEvents, type EventAttributes } from 'ics';
import tzlookup from 'tz-lookup';
import type { NpsEvent } from './nps';

export function timezoneForCoords(lat: string | number, lon: string | number): string | null {
  const la = typeof lat === 'string' ? parseFloat(lat) : lat;
  const lo = typeof lon === 'string' ? parseFloat(lon) : lon;
  if (!isFinite(la) || !isFinite(lo)) return null;
  try {
    return tzlookup(la, lo) ?? null;
  } catch {
    return null;
  }
}

const PARK_HOURS_TYPES = new Set([
  'park hours',
  'hours of operation',
  'operating hours',
]);

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
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

function buildDescription(event: NpsEvent, eventsPageUrl: string, eventDetailsUrl: string): string {
  const parts: string[] = [];
  const body = stripHtml(event.description);
  if (body) parts.push(body);
  if (event.feeinfo) parts.push(`Fee info: ${stripHtml(event.feeinfo)}`);
  if (event.regresinfo) parts.push(`Registration: ${stripHtml(event.regresinfo)}`);
  if (event.regresurl) parts.push(`Register: ${event.regresurl}`);
  if (event.infourl) parts.push(`More info: ${event.infourl}`);
  parts.push(`Event details: ${eventDetailsUrl}`);
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

  const isRecurring = isTruthy(npsEvent.isrecurring);
  // For recurring events dateend is the series end date (already captured in RRULE UNTIL),
  // not the end of each occurrence. Each occurrence ends on the same day it starts.
  const occurrenceEndDate = isRecurring ? dateArr : (parseDate(npsEvent.dateend) ?? dateArr);

  const eventId = npsEvent.id || npsEvent.eventid;
  const eventDetailsUrl = `https://www.nps.gov/planyourvisit/event-details.htm?id=${eventId}`;
  const description = buildDescription(npsEvent, eventsPageUrl, eventDetailsUrl);
  const url = npsEvent.infourl || npsEvent.regresurl || eventDetailsUrl;
  const uid = `${npsEvent.id || npsEvent.eventid}@nps-ical`;

  const base: Partial<EventAttributes> = {
    title: npsEvent.title || 'NPS Event',
    description,
    url,
    location: npsEvent.location || npsEvent.parkfullname || '',
    categories: npsEvent.types || [],
    // Emit local (floating) datetimes; generateICS injects TZID via post-processing.
    startInputType: 'local',
    startOutputType: 'local',
    endInputType: 'local',
    endOutputType: 'local',
  };

  let exdates: [number, number, number][] = [];
  if (isRecurring) {
    const { rrule, exdates: parsed } = parseRecurrenceRule(npsEvent.recurrencerule);
    if (rrule) base.recurrenceRule = rrule;
    exdates = parsed;
  }

  const times = (npsEvent.times || []).filter((t) => t.timestart && !isTruthy(t.sunrisestart));

  if (isTruthy(npsEvent.isallday) || times.length === 0) {
    if (exdates.length > 0) base.exclusionDates = exdates;
    return [{ ...base, uid, start: dateArr, end: occurrenceEndDate } as EventAttributes];
  }

  return times.map((slot, i): EventAttributes => {
    const s = parse12h(slot.timestart);
    const e = parse12h(slot.timeend);
    const startArr: DateArray = s ? ([...dateArr.slice(0, 3), s.hour, s.minute] as DateArray) : dateArr;
    const endArr: DateArray = e ? ([...occurrenceEndDate.slice(0, 3), e.hour, e.minute] as DateArray) : occurrenceEndDate;
    // EXDATE must be DATE-TIME to match the floating DTSTART type; include the slot's start time.
    const slotExdates: DateArray[] = s && exdates.length > 0
      ? exdates.map(([y, m, d]) => [y, m, d, s.hour, s.minute] as [number, number, number, number, number])
      : exdates;
    return {
      ...base,
      ...(slotExdates.length > 0 ? { exclusionDates: slotExdates } : {}),
      uid: times.length > 1 ? `${uid}-${i}` : uid,
      start: startArr,
      end: endArr,
    } as EventAttributes;
  });
}

export function generateICS(parkCode: string, parkName: string, npsEvents: NpsEvent[], timezone?: string | null): string {
  const eventsPageUrl = `https://www.nps.gov/${parkCode}/planyourvisit/calendar.htm`;
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

  let output = value
    .replace(/(VERSION:2\.0\r?\n)/, `$1${extraProps}\r\n`)
    .replace('X-PUBLISHED-TTL:PT1H', 'X-PUBLISHED-TTL:PT12H');

  if (timezone) {
    // Convert floating DTSTART/DTEND to timezone-aware (TZID parameter).
    output = output
      .replace(/^DTSTART:(\d{8}T\d{6})/gm, `DTSTART;TZID=${timezone}:$1`)
      .replace(/^DTEND:(\d{8}T\d{6})/gm, `DTEND;TZID=${timezone}:$1`);

    // Fix EXDATE: ics library emits UTC (Z suffix) for date-time arrays.
    // Unfold any continuation lines, strip Z, and add TZID to match DTSTART.
    output = output.replace(
      /^EXDATE:((?:[^\r\n]*)(?:\r\n[ \t][^\r\n]*)*)/gm,
      (_, folded: string) => {
        const unfolded = folded.replace(/\r\n[ \t]/g, '');
        const stripped = unfolded.replace(/(\d{8}T\d{6})Z/g, '$1');
        return `EXDATE;TZID=${timezone}:${stripped}`;
      }
    );
  }

  return output;
}
