const STATE_NAMES = {
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

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getCity(park) {
  const physical = (park.addresses || []).find((a) => a.type === 'Physical');
  const addr = physical || park.addresses?.[0];
  return addr?.city || '';
}

function expandStates(codesStr) {
  return (codesStr || '')
    .split(',')
    .map((c) => STATE_NAMES[c.trim()] || '')
    .filter(Boolean)
    .join(' ');
}

function buildSearchText(park, city) {
  return [
    park.fullName,
    park.name,
    park.designation,
    park.states,
    expandStates(park.states),
    city,
  ]
    .join(' ')
    .toLowerCase();
}

function renderPark(park) {
  const city = getCity(park);
  const codes = (park.states || '').split(',').map((s) => s.trim()).filter(Boolean);
  const locationParts = [codes.join(', ')];
  if (city) locationParts.push(city);
  const searchText = buildSearchText(park, city);

  return `<li class="park" data-search="${esc(searchText)}">
  <div class="park-info">
    <span class="park-name">${esc(park.fullName)}</span
    ><span class="park-type">${esc(park.designation)}</span>
    <div class="park-loc">${esc(locationParts.join(' · '))}</div>
  </div>
  <div class="park-links">
    <a href="${esc(park.url)}" target="_blank" rel="noopener">Official site</a>
    <a href="/ics/${esc(park.parkCode)}" class="ics-link">iCal feed</a>
  </div>
</li>`;
}

export function renderIndex(parks) {
  // Sort: alphabetically by fullName
  const sorted = [...parks].sort((a, b) =>
    (a.fullName || '').localeCompare(b.fullName || ''),
  );

  const parkItems = sorted.map(renderPark).join('\n');
  const total = sorted.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>National Park Service — iCal Event Feeds</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  color: #1a1a1a;
  background: #f7f7f5;
  min-height: 100vh;
}
.container {
  max-width: 860px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}
header {
  margin-bottom: 1.5rem;
}
h1 {
  font-size: 1.4rem;
  font-weight: 700;
  color: #1b4d2e;
}
h1 span {
  font-weight: 400;
  color: #555;
}
.subtitle {
  font-size: 0.85rem;
  color: #666;
  margin-top: 0.3rem;
}
.search-wrap {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f7f7f5;
  padding: 0.75rem 0;
  border-bottom: 1px solid #e0e0db;
  margin-bottom: 0.5rem;
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
#count {
  font-size: 0.8rem;
  color: #888;
  margin-top: 0.4rem;
}
.park-list {
  list-style: none;
}
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
.park-name {
  font-weight: 600;
  font-size: 0.95rem;
}
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
.park-loc {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.15rem;
}
.park-links {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex-shrink: 0;
  text-align: right;
}
.park-links a {
  font-size: 0.8rem;
  color: #1b4d2e;
  text-decoration: none;
  white-space: nowrap;
}
.park-links a:hover { text-decoration: underline; }
.ics-link::before { content: "📅 "; }
.no-results {
  padding: 2rem 0;
  color: #888;
  font-size: 0.9rem;
  display: none;
}
footer {
  margin-top: 2rem;
  font-size: 0.78rem;
  color: #aaa;
  text-align: center;
}
@media (max-width: 500px) {
  .park { flex-direction: column; align-items: flex-start; gap: 0.4rem; }
  .park-links { flex-direction: row; text-align: left; }
}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>National Park Service <span>iCal Event Feeds</span></h1>
    <p class="subtitle">Subscribe to any park's upcoming events in your calendar app.</p>
  </header>
  <div class="search-wrap">
    <input id="search" type="search" placeholder="Search parks, states, designations…" autocomplete="off" spellcheck="false">
    <div id="count">${total} parks</div>
  </div>
  <ul class="park-list" id="park-list">
${parkItems}
  </ul>
  <p class="no-results" id="no-results">No parks match your search.</p>
  <footer>Data from the <a href="https://www.nps.gov/subjects/developer/" style="color:#888">NPS API</a>. iCal feeds refresh every 12 hours.</footer>
</div>
<script>
(function () {
  const search = document.getElementById('search');
  const count = document.getElementById('count');
  const noResults = document.getElementById('no-results');
  const parks = Array.from(document.querySelectorAll('.park'));
  const total = parks.length;

  function update() {
    const raw = search.value.trim().toLowerCase();
    const words = raw.split(/\\s+/).filter(Boolean);
    let visible = 0;

    parks.forEach(function (el) {
      if (words.length === 0) {
        el.hidden = false;
        visible++;
        return;
      }
      const text = el.dataset.search;
      // Every word must appear somewhere in the combined search text
      const match = words.every(function (w) { return text.includes(w); });
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
