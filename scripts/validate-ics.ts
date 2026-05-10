/**
 * Validates ICS output using ical.js (Mozilla's strict RFC 5545 parser).
 *
 * Usage:
 *   npm run validate               # validates generated test data
 *   npm run validate -- file.ics   # also validates an external file
 */
import ICAL from 'ical.js';
import { readFileSync } from 'node:fs';
import { generateICS } from '../src/ical';
import type { NpsEvent } from '../src/nps';

// ── test fixtures ─────────────────────────────────────────────────────────────

const BASE_EVENT: NpsEvent = {
  id: 'TEST-001', eventid: 'TEST-001',
  title: 'Test Event', description: '<p>A test event.</p>',
  location: 'Visitor Center', parkfullname: 'Test Park',
  datestart: '2026-06-01', dateend: '2026-06-01', date: '2026-06-01', dates: [],
  times: [{ timestart: '10:00 AM', timeend: '12:00 PM', sunrisestart: false, sunsetend: false }],
  isallday: false, isrecurring: false, isfree: true, isregresrequired: false,
  types: ['Ranger Program'], category: 'Regular Event',
  feeinfo: '', regresinfo: '', regresurl: '', infourl: '',
  sitecode: 'test', sitetype: 'park',
  recurrencerule: '', recurrencedatestart: '', recurrencedateend: '',
  tags: [],
};

const FIXTURES: Array<{ label: string; events: NpsEvent[] }> = [
  {
    label: 'simple timed event',
    events: [BASE_EVENT],
  },
  {
    label: 'all-day event',
    events: [{ ...BASE_EVENT, id: 'TEST-002', isallday: true, times: [] }],
  },
  {
    label: 'recurring event with EXDATE (NPS pipe format)',
    events: [{
      ...BASE_EVENT, id: 'TEST-003', isrecurring: true,
      recurrencerule: 'DTSTART=20260601T040000Z;UNTIL=20261201T050000Z;FREQ=DAILY;WKST=SU;INTERVAL=1|EXDATE=2026-07-04,2026-09-07',
    }],
  },
  {
    label: 'recurring event without EXDATE',
    events: [{
      ...BASE_EVENT, id: 'TEST-004', isrecurring: true,
      recurrencerule: 'DTSTART=20260601T040000Z;UNTIL=20261201T060000Z;FREQ=MONTHLY;BYSETPOS=2;WKST=SU;BYDAY=SA;INTERVAL=1',
    }],
  },
  {
    label: 'park hours event (should be filtered out → empty calendar)',
    events: [{ ...BASE_EVENT, id: 'TEST-005', types: ['Park Hours'] }],
  },
  {
    label: 'multiple time slots',
    events: [{
      ...BASE_EVENT, id: 'TEST-006',
      times: [
        { timestart: '10:00 AM', timeend: '11:00 AM', sunrisestart: false, sunsetend: false },
        { timestart: '02:00 PM', timeend: '03:00 PM', sunrisestart: false, sunsetend: false },
      ],
    }],
  },
];

// ── validator ─────────────────────────────────────────────────────────────────

function validate(label: string, icsText: string): boolean {
  try {
    const jCal = ICAL.parse(icsText);
    const comp = new ICAL.Component(jCal);
    const vevents = comp.getAllSubcomponents('vevent');

    for (const vevent of vevents) {
      const rruleProp = vevent.getFirstProperty('rrule');
      if (rruleProp) {
        // Constructing ICAL.Recur will throw on invalid RRULE values
        const recur = rruleProp.getFirstValue() as ICAL.Recur;
        if (!recur.freq) throw new Error('RRULE missing FREQ');
        const interval = recur.interval;
        if (interval !== undefined && (!Number.isInteger(interval) || interval < 1)) {
          throw new Error(`RRULE INTERVAL must be a positive integer, got: ${interval}`);
        }
      }
    }

    console.log(`  ✓ ${label} (${vevents.length} event${vevents.length !== 1 ? 's' : ''})`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${(err as Error).message}`);
    return false;
  }
}

// ── run ───────────────────────────────────────────────────────────────────────

let failed = 0;

console.log('Generated ICS fixtures:');
for (const { label, events } of FIXTURES) {
  const ics = generateICS('test', 'Test Park', events);
  if (!validate(label, ics)) failed++;
}

// Optional: validate an external file passed as CLI argument
const [, , ...args] = process.argv;
if (args.length > 0) {
  console.log('\nExternal files:');
  for (const filePath of args) {
    try {
      const text = readFileSync(filePath, 'utf8');
      if (!validate(filePath, text)) failed++;
    } catch (err) {
      console.error(`  ✗ ${filePath}: ${(err as Error).message}`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll checks passed.`);
}
