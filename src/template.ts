import type { NpsPark, NpsAddress } from './nps';

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  PR: 'Puerto Rico', VI: 'Virgin Islands', GU: 'Guam', AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
};

function esc(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getCity(park: NpsPark): string {
  const physical = (park.addresses || []).find((a: NpsAddress) => a.type === 'Physical');
  const addr = physical ?? park.addresses?.[0];
  return addr?.city || '';
}

function expandStates(codesStr: string): string {
  return (codesStr || '')
    .split(',')
    .map((c) => STATE_NAMES[c.trim()] || '')
    .filter(Boolean)
    .join(' ');
}

function buildSearchText(park: NpsPark, city: string): string {
  // Include both name and fullName (which has designation) so either term matches
  return [park.fullName, park.name, park.designation, park.states, expandStates(park.states), city]
    .join(' ')
    .toLowerCase();
}

function renderPark(park: NpsPark): string {
  const city = getCity(park);
  const codes = (park.states || '').split(',').map((s) => s.trim()).filter(Boolean);
  const locationParts = [codes.join(', ')];
  if (city) locationParts.push(city);

  const designationBadge = park.designation
    ? `<span class="park-type">${esc(park.designation)}</span>`
    : '';

  const icsPath = `/${esc(park.parkCode)}.ics`;

  return `<li class="park" data-search="${esc(buildSearchText(park, city))}">
  <div class="park-info">
    <span class="park-name">${esc(park.name)}</span>${designationBadge}
    <div class="park-loc">${esc(locationParts.join(' · '))}</div>
  </div>
  <div class="park-links">
    <a href="${esc(park.url)}" target="_blank" rel="noopener" class="official-link"><span class="link-text">Official site</span> 🏞️</a>
    <div class="cal-links">
      <a href="${icsPath}" data-webcal="${icsPath}" class="cal-btn" title="Subscribe in Apple Calendar"><span class="link-text">Apple</span><svg width="16" height="16" aria-hidden="true"><use href="#icon-apple-cal"/></svg></a>
      <a href="${icsPath}" data-gcal="${icsPath}" class="cal-btn" target="_blank" rel="noopener" title="Subscribe in Google Calendar"><span class="link-text">Google</span><svg width="16" height="16" aria-hidden="true"><use href="#icon-google-cal"/></svg></a>
      <a href="${icsPath}" class="cal-btn"><span class="link-text">iCal</span> 📅</a>
    </div>
  </div>
</li>`;
}

// SVG symbols defined once, referenced with <use> per park row
const SVG_DEFS = `<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
  <defs>
    <symbol id="icon-apple-cal" viewBox="0 0 24 24">
      <rect x="2" y="4" width="20" height="18" rx="2" fill="white" stroke="#d0d0d0" stroke-width="1"/>
      <path d="M4,4 Q2,4 2,6 L2,10 L22,10 L22,6 Q22,4 20,4 Z" fill="#FF3B30"/>
      <rect x="7" y="2" width="2" height="4" rx="1" fill="#888"/>
      <rect x="15" y="2" width="2" height="4" rx="1" fill="#888"/>
      <text x="12" y="19.5" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="8" font-weight="600" fill="#1a1a1a">7</text>
    </symbol>
    <symbol id="icon-google-cal" viewBox="0 0 24 24">
      <rect x="2" y="4" width="20" height="18" rx="2" fill="white" stroke="#d0d0d0" stroke-width="1"/>
      <path d="M4,4 Q2,4 2,6 L2,10 L22,10 L22,6 Q22,4 20,4 Z" fill="#4285F4"/>
      <rect x="7" y="2" width="2" height="4" rx="1" fill="#888"/>
      <rect x="15" y="2" width="2" height="4" rx="1" fill="#888"/>
      <text x="12" y="19.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#4285F4">31</text>
    </symbol>
  </defs>
</svg>`;

export function renderIndex(parks: NpsPark[], opts: { indexCacheHours: number; icsCacheHours: number }): string {
  const { icsCacheHours } = opts;
  const sorted = [...parks].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const parkItems = sorted.map(renderPark).join('\n');
  const total = sorted.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📅</text></svg>">
<title>National Park Service — Unofficial iCal Event Feeds</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  color: #1a1a1a;
  background: #f7f7f5;
  min-height: 100vh;
}
.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}
header { margin-bottom: 1.5rem; }
h1 { font-size: 1.4rem; font-weight: 700; color: #1b4d2e; }
h1 span { font-weight: 400; color: #555; }
.subtitle { font-size: 0.85rem; color: #666; margin-top: 0.3rem; }
.search-wrap {
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f7f7f5;
  padding: 0.75rem 0 0.5rem;
  border-bottom: 1px solid #e0e0db;
}
#search {
  width: 100%;
  padding: 0.55rem 0.75rem;
  font-size: 0.95rem;
  border: 1px solid #bbb;
  border-radius: 6px;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
}
#search:focus { border-color: #1b4d2e; }
#count { font-size: 0.8rem; color: #888; margin-top: 0.4rem; }
.park-list { list-style: none; }
.park {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid #e8e8e4;
}
.park[hidden] { display: none; }
.park-info { flex: 1; min-width: 0; }
.park-name { font-weight: 600; font-size: 0.95rem; }
.park-type {
  display: inline-block;
  margin-left: 0.4rem;
  font-size: 0.72rem;
  font-weight: 500;
  color: #4a7c59;
  background: #e8f2ec;
  border: 1px solid #c5dece;
  padding: 1px 6px;
  border-radius: 3px;
  vertical-align: middle;
  white-space: nowrap;
}
.park-loc { font-size: 0.8rem; color: #666; margin-top: 0.15rem; }
.park-links {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
  flex-shrink: 0;
}
.official-link, .cal-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.8rem;
  color: #1b4d2e;
  text-decoration: none;
  white-space: nowrap;
}
.official-link:hover .link-text,
.cal-btn:hover .link-text { text-decoration: underline; }
.cal-btn svg { display: block; flex-shrink: 0; }
.cal-links {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.no-results { padding: 2rem 0; color: #888; font-size: 0.9rem; display: none; }
footer { margin-top: 2rem; font-size: 0.78rem; color: #aaa; text-align: center; }
@media (max-width: 560px) {
  .park { flex-direction: column; align-items: flex-start; gap: 0.4rem; }
  .park-links { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.55rem; }
  .cal-links { flex-wrap: wrap; }
}
</style>
</head>
<body>
${SVG_DEFS}
<div class="container">
  <header>
    <h1><span>Unofficial</span> National Park Service <span>iCal Event Feeds</span></h1>
    <p class="subtitle">Subscribe to any park's upcoming events in your calendar app.</p>
  </header>
  <div class="search-wrap">
    <input id="search" type="search" placeholder="Search parks, states, designations…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" autofocus>
    <div id="count">${total} parks</div>
  </div>
  <ul class="park-list" id="park-list">
${parkItems}
  </ul>
  <p class="no-results" id="no-results">No parks match your search.</p>
  <footer>Data from the <a href="https://www.nps.gov/subjects/developer/" style="color:#888">NPS API</a>. iCal feeds refresh every ${icsCacheHours} hour${icsCacheHours === 1 ? '' : 's'}. Vibecoded with <a href="https://claude.ai" style="color:#888">Claude</a>, no promises on accuracy. <a href="https://github.com/bburky/nps-ical" style="color:#888">Source code</a>.</footer>
</div>
<script>
(function () {
  // Upgrade subscription links to absolute webcal:// URLs based on the current host
  var host = window.location.host;
  document.querySelectorAll('[data-webcal]').forEach(function (a) {
    a.href = 'webcal://' + host + a.dataset.webcal;
  });
  document.querySelectorAll('[data-gcal]').forEach(function (a) {
    var webcal = 'webcal://' + host + a.dataset.gcal;
    a.href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
  });

  // Search filtering
  var search = document.getElementById('search');
  var count = document.getElementById('count');
  var noResults = document.getElementById('no-results');
  var parks = Array.from(document.querySelectorAll('.park'));
  var total = parks.length;

  function update() {
    var raw = search.value.trim().toLowerCase();
    var words = raw.split(/\\s+/).filter(Boolean);
    var visible = 0;

    parks.forEach(function (el) {
      if (words.length === 0) { el.hidden = false; visible++; return; }
      var match = words.every(function (w) { return el.dataset.search.includes(w); });
      el.hidden = !match;
      if (match) visible++;
    });

    count.textContent = visible === total
      ? total + ' parks'
      : visible + ' of ' + total + ' parks';
    noResults.style.display = visible === 0 ? 'block' : 'none';
  }

  search.addEventListener('input', update);
})();
</script>
</body>
</html>`;
}
