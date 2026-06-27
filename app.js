(function(){
const { useState, useEffect, useRef, useCallback } = React;
const h = React.createElement;

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://jhrqdgylshubhdaegyri.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocnFkZ3lsc2h1YmhkYWVneXJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MjA5MzgsImV4cCI6MjA5Nzk5NjkzOH0.ZJFeJV5jGMf8lZTiojTu4YOGeWVDfMqHJJM6Q1KlqVE';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── MAPPERS ───────────────────────────────────────────────────────────────────
function toSb(entry, mpg) {
  return {
    id: entry.id,
    vehicle: entry.vehicle,
    date: entry.date,
    trip_miles: entry.tripMiles,
    total_miles: entry.totalMiles,
    gallons: entry.gallons,
    price_per_gallon: entry.pricePerGallon,
    total_price: entry.totalPrice,
    fuel_type: entry.fuelType,
    partial: !!entry.partial,
    notes: entry.notes ? entry.notes : null,
    driver: entry.driver ? entry.driver : null,
    latitude: entry.lat != null ? entry.lat : null,
    longitude: entry.lng != null ? entry.lng : null,
    mpg: mpg != null ? mpg : null
  };
}
function fromSb(row) {
  return {
    id: row.id,
    vehicle: row.vehicle,
    date: row.date,
    tripMiles: row.trip_miles,
    totalMiles: row.total_miles,
    gallons: row.gallons,
    pricePerGallon: row.price_per_gallon,
    totalPrice: row.total_price,
    fuelType: row.fuel_type || '',
    partial: !!row.partial,
    notes: row.notes || '',
    driver: row.driver || '',
    lat: row.latitude != null ? row.latitude : null,
    lng: row.longitude != null ? row.longitude : null
  };
}

// ── MAPPERS: fixed_costs ───────────────────────────────────────────────────────
function fromSbFixedCost(row) {
  return {
    id: row.id, vehicle: row.vehicle, category: row.category,
    label: row.label || '', amount: row.amount,
    frequency: row.frequency || 'monthly',
    startDate: row.start_date || '', endDate: row.end_date || ''
  };
}
function toSbFixedCost(fc) {
  return {
    id: fc.id, vehicle: fc.vehicle, category: fc.category,
    label: fc.label ? fc.label : null, amount: fc.amount,
    frequency: fc.frequency || 'monthly',
    start_date: fc.startDate ? fc.startDate : null,
    end_date: fc.endDate ? fc.endDate : null
  };
}

// ── MAPPERS: maintenance_log ───────────────────────────────────────────────────
function fromSbMaint(row) {
  return {
    id: row.id, vehicle: row.vehicle, date: row.date, odometer: row.odometer,
    category: row.category, description: row.description || '', cost: row.cost,
    shop: row.shop || '', nextDueMiles: row.next_due_miles, nextDueDate: row.next_due_date || ''
  };
}
function toSbMaint(m) {
  return {
    id: m.id, vehicle: m.vehicle, date: m.date,
    odometer: m.odometer != null ? m.odometer : null,
    category: m.category, description: m.description ? m.description : null,
    cost: m.cost != null ? m.cost : null, shop: m.shop ? m.shop : null,
    next_due_miles: m.nextDueMiles != null ? m.nextDueMiles : null,
    next_due_date: m.nextDueDate ? m.nextDueDate : null
  };
}

// ── MAINTENANCE CATEGORIES ─────────────────────────────────────────────────────
const MAINT_CATEGORIES = [
  { value: 'oil_change', label: 'Oil Change' },
  { value: 'tires', label: 'Tires' },
  { value: 'brakes', label: 'Brakes' },
  { value: 'battery', label: 'Battery' },
  { value: 'scheduled', label: 'Scheduled Service' },
  { value: 'repair', label: 'Repair' },
  { value: 'other', label: 'Other' }
];
function maintCatLabel(v) {
  const c = MAINT_CATEGORIES.find(function(x){ return x.value === v; });
  return c ? c.label : 'Other';
}

// ── FIXED COST CATEGORIES / FREQUENCIES ────────────────────────────────────────
const FIXED_CATEGORIES = [
  { value: 'payment', label: 'Loan / Lease' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'registration', label: 'Registration' },
  { value: 'parking', label: 'Parking' },
  { value: 'other', label: 'Other' }
];
function fixedCatLabel(v) {
  const c = FIXED_CATEGORIES.find(function(x){ return x.value === v; });
  return c ? c.label : 'Other';
}
const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'biannual', label: 'Every 6 Months' },
  { value: 'annual', label: 'Annual' }
];
function freqLabel(v) {
  const f = FREQUENCIES.find(function(x){ return x.value === v; });
  return f ? f.label : 'Monthly';
}
// Pure helper: monthly-equivalent of a recurring cost
function monthlyEquivalent(amount, frequency) {
  const a = amount || 0;
  if (frequency === 'biannual') return a / 6;
  if (frequency === 'annual') return a / 12;
  return a; // monthly (and default)
}

// ── STORAGE ───────────────────────────────────────────────────────────────────
const PREFS_KEY   = 'fuellog_prefs';
const CACHE_KEY   = 'fuellog_cache';
const PENDING_KEY = 'fuellog_pending';
const LEGACY_KEY  = 'fuellog_v1';
const FIXED_KEY   = 'fuellog_fixed_cache';
const MAINT_KEY   = 'fuellog_maint_cache';
function loadJSON(key) { try { const r = localStorage.getItem(key); if (r) return JSON.parse(r); } catch (e) {} return []; }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

function loadPrefs() {
  try { const r = localStorage.getItem(PREFS_KEY); if (r) return JSON.parse(r); } catch (e) {}
  // fall back to legacy format so existing installs keep their vehicle names
  try {
    const r = localStorage.getItem(LEGACY_KEY);
    if (r) { const d = JSON.parse(r); return { vehicles: d.vehicles || ['My Vehicle'], activeVehicle: d.activeVehicle || 'My Vehicle' }; }
  } catch (e) {}
  return { vehicles: ['My Vehicle'], activeVehicle: 'My Vehicle' };
}
function savePrefs(prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }
function loadCache() { try { const r = localStorage.getItem(CACHE_KEY); if (r) return JSON.parse(r); } catch (e) {} return []; }
function saveCache(entries) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(entries)); } catch (e) {} }
function loadPending() { try { const r = localStorage.getItem(PENDING_KEY); if (r) return JSON.parse(r); } catch (e) {} return []; }
function savePending(ops) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(ops)); } catch (e) {} }
function addPending(op) { const ops = loadPending(); ops.push(op); savePending(ops); }

function migrate(data) {
  if (data && data.entries) {
    data.entries.forEach(function(e){
      if (e.partial === undefined) e.partial = false;
      if (e.fuelType === undefined) e.fuelType = '';
      if (e.notes === undefined) e.notes = '';
      if (e.driver === undefined) e.driver = '';
      if (e.lat === undefined) e.lat = null;
      if (e.lng === undefined) e.lng = null;
    });
  }
  return data;
}

// ── FUEL TYPES ───────────────────────────────────────────────────────────────
const FUEL_TYPES = [
  { value: '', label: '—' },
  { value: 'reg87', label: 'Regular 87' },
  { value: 'mid89', label: 'Midgrade 89' },
  { value: 'prem91', label: 'Premium 91' },
  { value: 'prem93', label: 'Premium 93' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'e85', label: 'E85' },
  { value: 'other', label: 'Other' }
];
function fuelLabel(v) {
  const f = FUEL_TYPES.find(function(t){return t.value === v;});
  return f ? f.label : '—';
}

// ── THEMES ───────────────────────────────────────────────────────────────────
// id maps to a :root[data-theme="id"] block in styles.css. 'midnight' is the
// default (base :root vars), so it has no override block.
const THEMES = [
  { id: 'midnight', label: 'Midnight', swatch: '#f5a623' },
  { id: 'ocean',    label: 'Ocean',    swatch: '#38bdf8' },
  { id: 'forest',   label: 'Forest',   swatch: '#4ade80' },
  { id: 'violet',   label: 'Violet',   swatch: '#a78bfa' },
  { id: 'light',    label: 'Daylight', swatch: '#d97706' }
];

// ── HELPERS ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function mpgColor(mpg) {
  if (mpg === null || mpg === undefined) return '';
  if (mpg >= 30) return 'mpg-hi';
  if (mpg >= 22) return 'mpg-mid';
  return 'mpg-lo';
}
function fmt(n, dec) {
  if (dec === undefined) dec = 2;
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(dec);
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
function monthKey(iso) { return iso ? iso.slice(0, 7) : ''; }
function monthLabel(key) {
  if (!key) return '';
  const d = new Date(key + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ── MPG COMPUTATION (with partial-fill rollover) ───────────────────────────────
function computeMpg(entries) {
  const byVehicle = {};
  entries.forEach(function(e){ (byVehicle[e.vehicle] = byVehicle[e.vehicle] || []).push(e); });
  const result = {};
  Object.keys(byVehicle).forEach(function(v){
    const list = byVehicle[v].slice().sort(function(a,b){
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.id - b.id;
    });
    let carryMiles = 0, carryGal = 0;
    list.forEach(function(e){
      const miles = e.tripMiles || 0;
      const gal = e.gallons || 0;
      if (e.partial) {
        carryMiles += miles; carryGal += gal; result[e.id] = null;
      } else {
        const totalMiles = miles + carryMiles;
        const totalGal = gal + carryGal;
        result[e.id] = (totalMiles > 0 && totalGal > 0)
          ? parseFloat((totalMiles / totalGal).toFixed(2)) : null;
        carryMiles = 0; carryGal = 0;
      }
    });
  });
  return result;
}

// ── SMOOTH PATH HELPER ─────────────────────────────────────────────────────────
// Builds a smooth cubic-Bézier path through points (Catmull-Rom style) so the
// line charts read as gentle curves rather than jagged segments.
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) {
    return pts.map(function(p, i){ return (i===0?'M':'L') + p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ');
  }
  const t = 0.18; // tension
  let d = 'M' + pts[0].x.toFixed(2) + ',' + pts[0].y.toFixed(2);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i-1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i+1];
    const p3 = pts[i+2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ' C' + c1x.toFixed(2) + ',' + c1y.toFixed(2) + ' ' + c2x.toFixed(2) + ',' + c2y.toFixed(2) + ' ' + p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
  }
  return d;
}

// ── SHARED CHART CURSOR (tap/hover tooltip + crosshair) ─────────────────────────
// Maps a pointer position to the nearest data index. Works for every chart because
// they all use preserveAspectRatio="none", so pointer→viewBox is a linear stretch.
function useChartCursor(pointXs, viewBoxW) {
  const wrapRef = useRef(null);
  const st = useState(null); const activeIndex = st[0], setActiveIndex = st[1];
  function resolve(clientX) {
    const el = wrapRef.current;
    if (!el || !pointXs.length) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const vbX = ((clientX - rect.left) / rect.width) * viewBoxW;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pointXs.length; i++) {
      const dd = Math.abs(pointXs[i] - vbX);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    setActiveIndex(best);
  }
  const handlers = {
    onMouseMove: function(e){ resolve(e.clientX); },
    onMouseLeave: function(){ setActiveIndex(null); },
    onTouchStart: function(e){ if (e.touches[0]) resolve(e.touches[0].clientX); },
    onTouchMove: function(e){ if (e.touches[0]) resolve(e.touches[0].clientX); },
    onTouchEnd: function(){ setActiveIndex(null); }
  };
  return { wrapRef: wrapRef, activeIndex: activeIndex, handlers: handlers };
}
// Builds the floating tooltip; clamps horizontally so it never clips at the edges.
function chartTip(leftPct, lines) {
  const L = Math.max(11, Math.min(89, leftPct));
  return h('div', { className: 'chart-tip', style: { left: L + '%' } },
    lines.map(function(ln, i){ return h('div', { key: i, className: i === 0 ? 'chart-tip-title' : 'chart-tip-row' }, ln); })
  );
}

// ── MPG LINE CHART (per-fill + rolling 10-tank average) ─────────────────────────
function MpgChart(props) {
  const data = props.entries.slice()
    .filter(function(e){ return e.mpg != null; })
    .sort(function(a,b){return a.date.localeCompare(b.date);}).slice(-20);
  if (data.length < 2) return h('div', { className: 'chart-empty' }, 'Add more full fill-ups to see trend');
  const mpgs = data.map(function(e){return e.mpg;});
  // rolling average: mean of this entry + up to 9 preceding full fill-ups
  const rolling = mpgs.map(function(_, i){
    const window = mpgs.slice(Math.max(0, i - 9), i + 1);
    return window.reduce(function(a,b){return a+b;},0) / window.length;
  });
  const showRolling = data.length >= 3;
  const min = Math.min.apply(null, mpgs) * 0.85;
  const max = Math.max.apply(null, mpgs) * 1.1;
  const W = 600, H = 120, PL = 8, PR = 8, PT = 10, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;
  function yOf(v){ return PT + iH - ((v - min) / (max - min)) * iH; }
  const pts = data.map(function(e, i) {
    return { x: PL + (i / (data.length - 1)) * iW, y: yOf(e.mpg), e: e };
  });
  const rollPts = rolling.map(function(v, i){
    return { x: PL + (i / (data.length - 1)) * iW, y: yOf(v) };
  });
  const perFillD = smoothPath(pts);
  const rollD = smoothPath(rollPts);
  const areaD = perFillD + ' L' + pts[pts.length-1].x.toFixed(2) + ',' + (H-PB) + ' L' + pts[0].x.toFixed(2) + ',' + (H-PB) + ' Z';
  const avg = mpgs.reduce(function(a,b){return a+b;},0) / mpgs.length;
  const avgY = yOf(avg);
  // legend, bottom-right (only meaningful once the rolling line is drawn)
  const legX = W - 132, legY1 = H - PB - 16, legY2 = H - PB - 4;
  const cursor = useChartCursor(pts.map(function(p){ return p.x; }), W);
  const cur = (cursor.activeIndex != null && cursor.activeIndex < pts.length) ? cursor.activeIndex : null;
  return h('div', Object.assign({ className: 'chart-wrap', ref: cursor.wrapRef }, cursor.handlers),
    h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' },
      h('defs', null,
        h('linearGradient', { id: 'mpgGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
          h('stop', { offset: '0%', stopColor: '#f5a623', stopOpacity: '0.22' }),
          h('stop', { offset: '100%', stopColor: '#f5a623', stopOpacity: '0.02' })
        )
      ),
      h('line', { x1: PL, y1: avgY, x2: W-PR, y2: avgY, stroke: '#3ecfcf', strokeWidth: '1', strokeDasharray: '4 4', opacity: '0.35' }),
      h('path', { d: areaD, fill: 'url(#mpgGrad)' }),
      // per-fill-up line: thin, de-emphasized
      h('path', { d: perFillD, fill: 'none', stroke: '#f5a623', strokeOpacity: '0.45', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      pts.map(function(p, i){ return h('circle', { key: i, cx: p.x, cy: p.y, r: '2.5', fill: '#f5a623', fillOpacity: '0.5' }); }),
      // rolling 10-tank average: thick, primary
      showRolling ? h('path', { d: rollD, fill: 'none', stroke: '#f5a623', strokeWidth: '2.5', strokeLinecap: 'round', strokeLinejoin: 'round' }) : null,
      h('text', { x: W-PR, y: avgY - 4, textAnchor: 'end', fill: '#3ecfcf', fillOpacity: '0.6', fontSize: '10', fontFamily: 'IBM Plex Mono' }, 'avg ' + fmt(avg) + ' mpg'),
      h('text', { x: pts[0].x, y: H, textAnchor: 'middle', fill: '#4a5268', fontSize: '10', fontFamily: 'IBM Plex Mono' }, fmtDate(pts[0].e.date)),
      h('text', { x: pts[pts.length-1].x, y: H, textAnchor: 'middle', fill: '#4a5268', fontSize: '10', fontFamily: 'IBM Plex Mono' }, fmtDate(pts[pts.length-1].e.date)),
      // legend, top-right (kept out of the bottom date-label zone)
      showRolling ? h('g', null,
        h('line', { x1: legX, y1: legY1, x2: legX + 16, y2: legY1, stroke: '#f5a623', strokeOpacity: '0.45', strokeWidth: '1.5' }),
        h('text', { x: legX + 21, y: legY1 + 3, fill: '#7a8299', fontSize: '9', fontFamily: 'IBM Plex Mono' }, 'Per fill-up'),
        h('line', { x1: legX, y1: legY2, x2: legX + 16, y2: legY2, stroke: '#f5a623', strokeWidth: '2.5' }),
        h('text', { x: legX + 21, y: legY2 + 3, fill: '#7a8299', fontSize: '9', fontFamily: 'IBM Plex Mono' }, '10-tank avg')
      ) : null,
      // crosshair at the active point
      cur != null ? h('g', null,
        h('line', { x1: pts[cur].x, y1: PT, x2: pts[cur].x, y2: H - PB, stroke: '#7a8299', strokeWidth: '1', strokeOpacity: '0.5' }),
        showRolling ? h('circle', { cx: rollPts[cur].x, cy: rollPts[cur].y, r: '3.5', fill: '#f5a623', stroke: '#0f1117', strokeWidth: '1' }) : null,
        h('circle', { cx: pts[cur].x, cy: pts[cur].y, r: '3', fill: '#f5a623', fillOpacity: '0.9', stroke: '#0f1117', strokeWidth: '1' })
      ) : null
    ),
    cur != null ? chartTip((pts[cur].x / W) * 100, [
      fmtDate(data[cur].date),
      h('span', null, h('span', { className: 'tip-k' }, 'fill '), fmt(mpgs[cur]) + ' mpg'),
      showRolling ? h('span', null, h('span', { className: 'tip-k' }, '10-tank '), fmt(rolling[cur]) + ' mpg') : null
    ]) : null
  );
}

// ── BAR CHART (monthly spend) ──────────────────────────────────────────────────
function BarChart(props) {
  const rows = props.rows;
  if (!rows.length) return h('div', { className: 'chart-empty' }, 'No data yet');
  const max = Math.max.apply(null, rows.map(function(r){return r.value;})) || 1;
  const W = 600, H = 130, PB = 22, PT = 8, gap = 6;
  const bw = (W - gap * (rows.length - 1)) / rows.length;
  const centers = rows.map(function(r, i){ return i * (bw + gap) + bw / 2; });
  const cursor = useChartCursor(centers, W);
  const cur = (cursor.activeIndex != null && cursor.activeIndex < rows.length) ? cursor.activeIndex : null;
  return h('div', Object.assign({ className: 'chart-wrap', style: { height: 150 }, ref: cursor.wrapRef }, cursor.handlers),
    h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' },
      cur != null ? h('rect', { x: cur * (bw + gap) - 2, y: PT, width: bw + 4, height: H - PB - PT, rx: 3, fill: 'var(--accent)', opacity: 0.1 }) : null,
      rows.map(function(r, i){
        const bh = ((H - PB - PT) * r.value) / max;
        const x = i * (bw + gap);
        const y = H - PB - bh;
        return h('g', { key: r.key },
          h('rect', { x: x, y: y, width: bw, height: Math.max(bh, 0), rx: 3, fill: '#f5a623', opacity: cur === i ? 1 : 0.85 }),
          h('text', { x: x + bw/2, y: y - 3, textAnchor: 'middle', fill: '#e8eaf0', fontSize: '11', fontFamily: 'IBM Plex Mono' }, '$' + Math.round(r.value)),
          h('text', { x: x + bw/2, y: H - 6, textAnchor: 'middle', fill: '#7a8299', fontSize: '10', fontFamily: 'IBM Plex Mono' }, r.label.split(' ')[0])
        );
      })
    ),
    cur != null ? chartTip((centers[cur] / W) * 100, [
      rows[cur].label,
      h('span', null, h('span', { className: 'tip-k' }, 'spent '), '$' + fmt(rows[cur].value))
    ]) : null
  );
}

// ── COST / MILE LINE CHART ──────────────────────────────────────────────────────
function CostPerMileChart(props) {
  const data = props.entries.slice()
    .filter(function(e){ return e.totalPrice != null && e.tripMiles != null && e.tripMiles > 0; })
    .map(function(e){ return { date: e.date, cpm: parseFloat((e.totalPrice / e.tripMiles).toFixed(3)) }; })
    .sort(function(a,b){return a.date.localeCompare(b.date);}).slice(-20);
  if (data.length < 2) return h('div', { className: 'chart-empty' }, 'Add more fill-ups to see cost trend');
  const vals = data.map(function(d){return d.cpm;});
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (lo === hi) { lo = lo * 0.9; hi = hi * 1.1 || 0.001; }
  const min = lo * 0.9, max = hi * 1.1;
  const W = 600, H = 120, PL = 46, PR = 8, PT = 12, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;
  function yOf(v){ return PT + iH - ((v - min) / (max - min)) * iH; }
  const pts = data.map(function(d, i){
    return { x: PL + (i / (data.length - 1)) * iW, y: yOf(d.cpm), d: d };
  });
  const lineD = smoothPath(pts);
  const areaD = lineD + ' L' + pts[pts.length-1].x.toFixed(2) + ',' + (H-PB) + ' L' + pts[0].x.toFixed(2) + ',' + (H-PB) + ' Z';
  const avg = vals.reduce(function(a,b){return a+b;},0) / vals.length;
  const avgY = yOf(avg);
  const cursor = useChartCursor(pts.map(function(p){ return p.x; }), W);
  const cur = (cursor.activeIndex != null && cursor.activeIndex < pts.length) ? cursor.activeIndex : null;
  return h('div', Object.assign({ className: 'chart-wrap', ref: cursor.wrapRef }, cursor.handlers),
    h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' },
      h('defs', null,
        h('linearGradient', { id: 'cpmGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
          h('stop', { offset: '0%', stopColor: '#3ecfcf', stopOpacity: '0.28' }),
          h('stop', { offset: '100%', stopColor: '#3ecfcf', stopOpacity: '0.02' })
        )
      ),
      // Y axis min/max labels at the left edge
      h('text', { x: 4, y: PT + 4, fill: '#7a8299', fontSize: '9', fontFamily: 'IBM Plex Mono' }, '$' + hi.toFixed(3)),
      h('text', { x: 4, y: H - PB, fill: '#7a8299', fontSize: '9', fontFamily: 'IBM Plex Mono' }, '$' + lo.toFixed(3)),
      h('line', { x1: PL, y1: avgY, x2: W-PR, y2: avgY, stroke: '#3ecfcf', strokeWidth: '1', strokeDasharray: '4 4', opacity: '0.5' }),
      h('path', { d: areaD, fill: 'url(#cpmGrad)' }),
      h('path', { d: lineD, fill: 'none', stroke: '#3ecfcf', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      pts.map(function(p, i){ return h('circle', { key: i, cx: p.x, cy: p.y, r: '2.5', fill: '#3ecfcf' }); }),
      h('text', { x: W-PR, y: avgY - 4, textAnchor: 'end', fill: '#3ecfcf', fontSize: '10', fontFamily: 'IBM Plex Mono' }, 'avg $' + avg.toFixed(3) + '/mi'),
      h('text', { x: pts[0].x, y: H, textAnchor: 'middle', fill: '#4a5268', fontSize: '10', fontFamily: 'IBM Plex Mono' }, fmtDate(pts[0].d.date)),
      h('text', { x: pts[pts.length-1].x, y: H, textAnchor: 'middle', fill: '#4a5268', fontSize: '10', fontFamily: 'IBM Plex Mono' }, fmtDate(pts[pts.length-1].d.date)),
      cur != null ? h('g', null,
        h('line', { x1: pts[cur].x, y1: PT, x2: pts[cur].x, y2: H - PB, stroke: '#7a8299', strokeWidth: '1', strokeOpacity: '0.5' }),
        h('circle', { cx: pts[cur].x, cy: pts[cur].y, r: '3.5', fill: '#3ecfcf', stroke: '#0f1117', strokeWidth: '1' })
      ) : null
    ),
    cur != null ? chartTip((pts[cur].x / W) * 100, [
      fmtDate(data[cur].date),
      h('span', null, h('span', { className: 'tip-k' }, 'cost '), '$' + data[cur].cpm.toFixed(3) + '/mi')
    ]) : null
  );
}

// ── STACKED COST BAR CHART (fixed + maintenance + fuel) ─────────────────────────
function StackedCostChart(props) {
  const rows = props.rows; // [{ key, label, fixed, maint, fuel }]
  if (!rows.length) return h('div', { className: 'chart-empty' }, 'No data yet');
  const totals = rows.map(function(r){ return r.fixed + r.maint + r.fuel; });
  const max = Math.max.apply(null, totals) || 1;
  const W = 600, H = 150, PB = 22, PT = 10, gap = 6;
  const bw = (W - gap * (rows.length - 1)) / rows.length;
  function segH(v){ return ((H - PB - PT) * v) / max; }
  const centers = rows.map(function(r, i){ return i * (bw + gap) + bw / 2; });
  const cursor = useChartCursor(centers, W);
  const cur = (cursor.activeIndex != null && cursor.activeIndex < rows.length) ? cursor.activeIndex : null;
  return h('div', null,
    h('div', Object.assign({ className: 'chart-wrap', style: { height: 170 }, ref: cursor.wrapRef }, cursor.handlers),
      h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' },
        cur != null ? h('rect', { x: cur * (bw + gap) - 2, y: PT, width: bw + 4, height: H - PB - PT, rx: 3, fill: 'var(--accent)', opacity: 0.1 }) : null,
        rows.map(function(r, i){
          const x = i * (bw + gap);
          const hFixed = segH(r.fixed), hMaint = segH(r.maint), hFuel = segH(r.fuel);
          const yFixed = H - PB - hFixed;
          const yMaint = yFixed - hMaint;
          const yFuel = yMaint - hFuel;
          const total = r.fixed + r.maint + r.fuel;
          return h('g', { key: r.key },
            h('rect', { x: x, y: yFixed, width: bw, height: Math.max(hFixed, 0), fill: '#7a8299', opacity: cur === i ? 1 : 0.9 }),
            h('rect', { x: x, y: yMaint, width: bw, height: Math.max(hMaint, 0), fill: '#3ecfcf', opacity: cur === i ? 1 : 0.9 }),
            h('rect', { x: x, y: yFuel, width: bw, height: Math.max(hFuel, 0), rx: 2, fill: '#f5a623', opacity: cur === i ? 1 : 0.9 }),
            h('text', { x: x + bw/2, y: yFuel - 3, textAnchor: 'middle', fill: '#e8eaf0', fontSize: '10', fontFamily: 'IBM Plex Mono' }, '$' + Math.round(total)),
            h('text', { x: x + bw/2, y: H - 6, textAnchor: 'middle', fill: '#7a8299', fontSize: '10', fontFamily: 'IBM Plex Mono' }, r.label.split(' ')[0])
          );
        })
      ),
      cur != null ? chartTip((centers[cur] / W) * 100, [
        rows[cur].label,
        h('span', null, h('span', { className: 'tip-k' }, 'fixed '), '$' + fmt(rows[cur].fixed)),
        h('span', null, h('span', { className: 'tip-k' }, 'maint '), '$' + fmt(rows[cur].maint)),
        h('span', null, h('span', { className: 'tip-k' }, 'fuel '), '$' + fmt(rows[cur].fuel)),
        h('span', null, h('span', { className: 'tip-k' }, 'total '), '$' + fmt(rows[cur].fixed + rows[cur].maint + rows[cur].fuel))
      ]) : null
    ),
    h('div', { style: { display: 'flex', gap: 14, marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' } },
      [['Fixed','#7a8299'],['Maintenance','#3ecfcf'],['Fuel','#f5a623']].map(function(p){
        return h('span', { key: p[0], style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
          h('span', { style: { width: 10, height: 10, borderRadius: 2, background: p[1], display: 'inline-block' } }),
          p[0]
        );
      })
    )
  );
}

// ── ADD ENTRY FORM ────────────────────────────────────────────────────────────
function AddEntryForm(props) {
  const today = new Date().toISOString().split('T')[0];
  const knownDrivers = props.drivers || [];
  const blank = { date: today, tripMiles: '', totalMiles: '', gallons: '', pricePerGallon: '', fuelType: '', partial: false, notes: '', driver: props.defaultDriver || '', driverNew: '', lat: null, lng: null, geoStatus: '' };
  const state = useState(blank); const f = state[0], setF = state[1];
  function set(k, v){ setF(function(prev){ var n = Object.assign({}, prev); n[k]=v; return n; }); }
  function captureLocation() {
    if (!navigator.geolocation) { set('geoStatus', 'error'); return; }
    set('geoStatus', 'locating');
    navigator.geolocation.getCurrentPosition(function(pos){
      setF(function(prev){ return Object.assign({}, prev, {
        lat: parseFloat(pos.coords.latitude.toFixed(6)),
        lng: parseFloat(pos.coords.longitude.toFixed(6)),
        geoStatus: 'ok'
      }); });
    }, function(){ set('geoStatus', 'error'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  const tripMilesNum = parseFloat(f.tripMiles);
  const gallonsNum = parseFloat(f.gallons);
  const ppgNum = parseFloat(f.pricePerGallon);
  const totalPrice = (!isNaN(gallonsNum) && !isNaN(ppgNum)) ? gallonsNum * ppgNum : null;
  const previewMpg = (!f.partial && tripMilesNum > 0 && gallonsNum > 0)
    ? parseFloat((tripMilesNum / gallonsNum).toFixed(2)) : null;
  const canSave = f.date && !isNaN(tripMilesNum) && tripMilesNum > 0 && !isNaN(gallonsNum) && gallonsNum > 0;
  const resolvedDriver = (f.driver === '__new__' ? (f.driverNew || '').trim() : f.driver);
  function handleAdd() {
    if (!canSave) return;
    const entry = {
      id: Date.now(), vehicle: props.vehicle, date: f.date,
      tripMiles: tripMilesNum, totalMiles: f.totalMiles ? parseFloat(f.totalMiles) : null,
      gallons: gallonsNum, pricePerGallon: !isNaN(ppgNum) ? ppgNum : null,
      totalPrice: totalPrice ? parseFloat(totalPrice.toFixed(2)) : null,
      fuelType: f.fuelType, partial: !!f.partial,
      notes: f.notes ? f.notes.trim() : '',
      driver: resolvedDriver,
      lat: f.lat, lng: f.lng
    };
    props.onAdd(entry);
    if (resolvedDriver && props.onDriverUsed) props.onDriverUsed(resolvedDriver);
    setF(Object.assign({}, blank, { date: f.date, fuelType: f.fuelType, driver: resolvedDriver || '', driverNew: '' }));
  }
  function field(label, key, ph) {
    return h('div', { className: 'form-group' },
      h('label', null, label),
      h('input', { type: 'number', inputMode: 'decimal', placeholder: ph,
        value: f[key], onChange: function(e){ set(key, e.target.value); } })
    );
  }
  return h('div', { className: 'card' },
    h('div', { className: 'card-title' }, 'Log Fill-Up — ' + props.vehicle),
    h('div', { className: 'form-grid' },
      h('div', { className: 'form-group' },
        h('label', null, 'Date'),
        h('input', { type: 'date', value: f.date, onChange: function(e){ set('date', e.target.value); } })
      ),
      field('Trip Miles', 'tripMiles', '0.0'),
      field('Total Odometer', 'totalMiles', 'optional'),
      field('Gallons', 'gallons', '0.000'),
      field('Price / Gallon ($)', 'pricePerGallon', '0.00'),
      h('div', { className: 'form-group' },
        h('label', null, 'Total Cost ($)'),
        h('input', { type: 'text', readOnly: true, value: totalPrice !== null ? '$' + fmt(totalPrice) : '',
          placeholder: 'auto-calc', style: { color: 'var(--accent)', cursor: 'default' } })
      ),
      h('div', { className: 'form-group' },
        h('label', null, 'Fuel Type / Octane'),
        h('select', { value: f.fuelType, onChange: function(e){ set('fuelType', e.target.value); } },
          FUEL_TYPES.map(function(t){ return h('option', { key: t.value, value: t.value }, t.label); })
        )
      ),
      h('div', { className: 'form-group' },
        h('label', null, 'Driver'),
        h('select', { value: f.driver, onChange: function(e){ set('driver', e.target.value); } },
          h('option', { value: '' }, '—'),
          knownDrivers.map(function(d){ return h('option', { key: d, value: d }, d); }),
          h('option', { value: '__new__' }, 'Add new driver…')
        )
      ),
      f.driver === '__new__' ? h('div', { className: 'form-group full' },
        h('label', null, 'New Driver Name'),
        h('input', { type: 'text', placeholder: 'e.g. Alex', value: f.driverNew, autoFocus: true,
          onChange: function(e){ set('driverNew', e.target.value); } })
      ) : null,
      h('div', { className: 'form-group' },
        h('label', null, 'Fill Type'),
        h('div', { className: 'toggle-row' },
          h('button', { type: 'button', className: 'toggle-btn' + (!f.partial ? ' active' : ''), onClick: function(){ set('partial', false); } }, 'Full'),
          h('button', { type: 'button', className: 'toggle-btn' + (f.partial ? ' active' : ''), onClick: function(){ set('partial', true); } }, 'Partial')
        )
      ),
      h('div', { className: 'form-group full' },
        h('label', null, 'Notes'),
        h('input', { type: 'text', placeholder: 'e.g. Shell on Main St, topped off',
          value: f.notes, onChange: function(e){ set('notes', e.target.value); } })
      ),
      h('div', { className: 'form-group full' },
        h('label', null, 'Location'),
        h('div', { className: 'geo-row' },
          h('button', { type: 'button', className: 'btn btn-ghost',
            onClick: captureLocation, disabled: f.geoStatus === 'locating' },
            f.geoStatus === 'locating' ? 'Locating…' : (f.lat != null ? '📍 Update location' : '📍 Capture location')
          ),
          h('span', { className: 'geo-status' },
            f.geoStatus === 'error' ? h('span', { style: { color: 'var(--red)' } }, 'Location unavailable') :
            (f.lat != null ? h('span', { style: { color: 'var(--accent2)' } }, fmt(f.lat, 5) + ', ' + fmt(f.lng, 5)) :
            h('span', { style: { color: 'var(--text-dim)' } }, 'optional'))
          ),
          f.lat != null ? h('button', { type: 'button', className: 'delete-btn', title: 'Clear location',
            onClick: function(){ setF(function(prev){ return Object.assign({}, prev, { lat: null, lng: null, geoStatus: '' }); }); } }, '×') : null
        )
      )
    ),
    f.partial ? h('div', { className: 'info-note' },
      'Partial fill: miles & gallons roll into your next full fill so MPG stays accurate.'
    ) : (previewMpg !== null ? h('div', { className: 'calc-preview', style: { marginTop: 10 } },
      h('div', null,
        h('div', { style: { fontWeight: 600, fontSize: 18 } }, fmt(previewMpg), ' ', h('span', { style: { fontSize: 12 } }, 'MPG')),
        totalPrice ? h('div', { style: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 } }, '$' + fmt(totalPrice/tripMilesNum, 3) + '/mi') : null
      ),
      h('span', null, 'est. (this tank)')
    ) : null),
    h('div', { className: 'btn-row', style: { marginTop: 12 } },
      h('button', { className: 'btn btn-primary btn-full', disabled: !canSave, onClick: handleAdd }, 'Save Fill-Up')
    )
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard(props) {
  const ve = props.entries.filter(function(e){return e.vehicle === props.vehicle;});
  const sorted = ve.slice().sort(function(a,b){return b.date.localeCompare(a.date);});
  const mpgs = ve.map(function(e){return e.mpg;}).filter(function(m){return m != null;});
  const avgMpg = mpgs.length ? mpgs.reduce(function(a,b){return a+b;},0)/mpgs.length : null;
  const bestMpg = mpgs.length ? Math.max.apply(null, mpgs) : null;
  const totalSpent = ve.reduce(function(a,e){return a+(e.totalPrice||0);},0);
  const allMiles = ve.map(function(e){return e.tripMiles;}).filter(Boolean);
  const totalMiles = allMiles.reduce(function(a,b){return a+b;},0);
  const costPerMile = totalMiles > 0 ? totalSpent / totalMiles : null;
  const fillCount = ve.length;
  const recent5 = ve.slice().filter(function(e){return e.mpg != null;}).sort(function(a,b){return b.date.localeCompare(a.date);}).slice(0,5).map(function(e){return e.mpg;});
  const recent5avg = recent5.length ? recent5.reduce(function(a,b){return a+b;},0)/recent5.length : null;
  const trendUp = (recent5avg && avgMpg) ? recent5avg >= avgMpg : null;
  const curYear = String(new Date().getFullYear());
  const yearEntries = ve.filter(function(e){ return e.date && e.date.slice(0,4) === curYear; });
  const yearSpent = yearEntries.reduce(function(a,e){return a+(e.totalPrice||0);},0);
  const yearMiles = yearEntries.reduce(function(a,e){return a+(e.tripMiles||0);},0);
  const yearMpgs = yearEntries.map(function(e){return e.mpg;}).filter(function(m){return m != null;});
  const yearAvgMpg = yearMpgs.length ? yearMpgs.reduce(function(a,b){return a+b;},0)/yearMpgs.length : null;
  // ── driver comparison (avg MPG per driver) ──
  const driverGroups = {};
  ve.forEach(function(e){
    const k = e.driver || '—';
    if (!driverGroups[k]) driverGroups[k] = [];
    if (e.mpg != null) driverGroups[k].push(e.mpg);
  });
  const driverKeys = Object.keys(driverGroups);
  const driverStats = driverKeys.map(function(k){
    const ms = driverGroups[k];
    return { driver: k, avgMpg: ms.length ? ms.reduce(function(a,b){return a+b;},0)/ms.length : null };
  }).sort(function(a,b){
    if (a.avgMpg == null) return 1;
    if (b.avgMpg == null) return -1;
    return b.avgMpg - a.avgMpg;
  });
  // ── TCO: monthly cost breakdown (current calendar month) ──
  const fixedCosts = props.fixedCosts || [];
  const maintenanceLogs = props.maintenanceLogs || [];
  const curMonthKey = new Date().toISOString().slice(0, 7);
  const fixedMonthly = fixedCosts.reduce(function(a, c){ return a + monthlyEquivalent(c.amount, c.frequency); }, 0);
  const monthEntries = ve.filter(function(e){ return monthKey(e.date) === curMonthKey; });
  const fuelThisMonth = monthEntries.reduce(function(a, e){ return a + (e.totalPrice || 0); }, 0);
  const milesThisMonth = monthEntries.reduce(function(a, e){ return a + (e.tripMiles || 0); }, 0);
  const hasMaint = maintenanceLogs.length > 0;
  const maintThisMonth = maintenanceLogs
    .filter(function(m){ return monthKey(m.date) === curMonthKey; })
    .reduce(function(a, m){ return a + (m.cost || 0); }, 0);
  const totalThisMonth = fixedMonthly + fuelThisMonth + (hasMaint ? maintThisMonth : 0);
  const trueCostPerMile = milesThisMonth > 0 ? totalThisMonth / milesThisMonth : null;
  const allTimeMaint = maintenanceLogs.reduce(function(a, m){ return a + (m.cost || 0); }, 0);
  // ── maintenance reminder banners (mileage-based) ──
  const latestOdo = ve.filter(function(e){ return e.totalMiles != null; }).reduce(function(mx, e){ return Math.max(mx, e.totalMiles); }, 0);
  const dismissed = props.dismissed || { has: function(){ return false; } };
  const banners = (latestOdo > 0 ? maintenanceLogs.filter(function(m){ return m.nextDueMiles != null; }).map(function(m){
    const remaining = m.nextDueMiles - latestOdo;
    if (remaining <= 0) return { id: m.id, level: 'red', text: maintCatLabel(m.category) + ' overdue by ' + Math.round(-remaining).toLocaleString() + ' miles' };
    if (remaining <= 500) return { id: m.id, level: 'amber', text: maintCatLabel(m.category) + ' due in ' + Math.round(remaining).toLocaleString() + ' miles' };
    return null;
  }).filter(Boolean) : []).filter(function(b){ return !dismissed.has(b.id); });
  function statCell(label, val, cls, unit) {
    return h('div', { className: 'stat-cell' },
      h('div', { className: 'stat-label' }, label),
      h('div', { className: 'stat-value ' + (cls||'') }, val),
      h('div', { className: 'stat-unit' }, unit)
    );
  }
  return h(React.Fragment, null,
    banners.map(function(b){
      return h('div', { key: b.id, className: 'reminder-banner ' + b.level },
        h('span', null, (b.level === 'red' ? '⚠ ' : '🔧 ') + b.text),
        h('button', { title: 'Dismiss', onClick: function(){ if (props.onDismiss) props.onDismiss(b.id); } }, '×')
      );
    }),
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Summary — ' + props.vehicle),
      h('div', { className: 'stat-grid' },
        statCell('Avg MPG', fmt(avgMpg), avgMpg ? mpgColor(avgMpg) : '', 'mi / gal'),
        statCell('Best MPG', fmt(bestMpg), 'green', 'all time'),
        statCell('Total Miles', totalMiles > 0 ? Math.round(totalMiles).toLocaleString() : '—', 'accent', 'logged'),
        statCell('Total Spent', totalSpent > 0 ? '$' + fmt(totalSpent) : '—', '', 'on fuel'),
        statCell('Cost / Mile', costPerMile ? '$' + fmt(costPerMile, 3) : '—', '', 'avg'),
        statCell('Fill-Ups', String(fillCount), '', 'total')
      ),
      trendUp !== null ? h('div', { style: { marginTop: 10, fontSize: 12, color: trendUp ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' } },
        (trendUp ? '↑' : '↓') + ' Recent avg ' + fmt(recent5avg) + ' mpg vs ' + fmt(avgMpg) + ' mpg lifetime'
      ) : null
    ),
    fixedCosts.length > 0 ? h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Monthly Cost Breakdown — ' + props.vehicle),
      h('div', { className: 'stat-grid' },
        statCell('Fixed Costs', '$' + fmt(fixedMonthly), '', '/ mo'),
        statCell('Fuel This Month', '$' + fmt(fuelThisMonth), '', curMonthKey),
        statCell('Maintenance', hasMaint ? '$' + fmt(maintThisMonth) : '—', '', 'this month'),
        statCell('Total This Month', '$' + fmt(totalThisMonth), 'accent', curMonthKey),
        statCell('Miles This Month', milesThisMonth > 0 ? Math.round(milesThisMonth).toLocaleString() : '—', '', 'this month'),
        statCell('True Cost / Mile', trueCostPerMile != null ? '$' + fmt(trueCostPerMile, 3) : '—', 'green', 'all-in')
      ),
      maintenanceLogs.length > 0 ? h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' } },
        'All-Time Maintenance: ', h('span', { style: { color: 'var(--text)', fontWeight: 600 } }, '$' + fmt(allTimeMaint))
      ) : null
    ) : null,
    driverKeys.length > 1 ? h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Driver Comparison — ' + props.vehicle),
      h('div', { className: 'stat-grid' },
        driverStats.map(function(d){
          return h('div', { key: d.driver, className: 'stat-cell' },
            h('div', { className: 'stat-label' }, d.driver),
            h('div', { className: 'stat-value ' + (d.avgMpg ? mpgColor(d.avgMpg) : '') }, fmt(d.avgMpg)),
            h('div', { className: 'stat-unit' }, 'avg mpg')
          );
        })
      )
    ) : null,
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, curYear + ' Year to Date — ' + props.vehicle),
      h('div', { className: 'stat-grid' },
        statCell('Total Spent', yearSpent > 0 ? '$' + fmt(yearSpent) : '—', 'accent', 'this year'),
        statCell('Total Miles', yearMiles > 0 ? Math.round(yearMiles).toLocaleString() : '—', '', 'this year'),
        statCell('Avg MPG', fmt(yearAvgMpg), yearAvgMpg ? mpgColor(yearAvgMpg) : '', 'this year')
      )
    ),
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'MPG Trend'),
      h(MpgChart, { entries: ve })
    ),
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Recent Fill-Ups'),
      sorted.length === 0 ? h('div', { className: 'no-data' }, 'No fill-ups logged yet') :
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'history-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Date'), h('th', null, 'Trip'), h('th', null, 'Gal'),
            h('th', null, 'PPG'), h('th', null, 'Total'), h('th', null, 'MPG')
          )),
          h('tbody', null, sorted.slice(0,8).map(function(e){
            return h('tr', { key: e.id },
              h('td', null, fmtDate(e.date), e.partial ? h('span', { className: 'partial-tag' }, 'P') : null),
              h('td', null, fmt(e.tripMiles, 1)),
              h('td', null, fmt(e.gallons, 3)),
              h('td', null, e.pricePerGallon ? '$' + fmt(e.pricePerGallon) : '—'),
              h('td', null, e.totalPrice ? '$' + fmt(e.totalPrice) : '—'),
              h('td', { className: 'mpg-cell ' + mpgColor(e.mpg) }, e.partial ? '—' : fmt(e.mpg))
            );
          }))
        )
      )
    )
  );
}

// ── MONTHLY BREAKDOWN ──────────────────────────────────────────────────────────
function Monthly(props) {
  const ve = props.entries.filter(function(e){return e.vehicle === props.vehicle;});
  const groups = {};
  ve.forEach(function(e){
    const k = monthKey(e.date);
    if (!k) return;
    if (!groups[k]) groups[k] = { key: k, spent: 0, gallons: 0, miles: 0, fills: 0 };
    groups[k].spent += e.totalPrice || 0;
    groups[k].gallons += e.gallons || 0;
    groups[k].miles += e.tripMiles || 0;
    groups[k].fills += 1;
  });
  const months = Object.keys(groups).sort().map(function(k){ return groups[k]; });
  const recentMonths = months.slice(-6).map(function(m){
    return { key: m.key, label: monthLabel(m.key), value: m.spent };
  });
  if (months.length === 0) {
    return h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Monthly Breakdown — ' + props.vehicle),
      h('div', { className: 'no-data' }, 'No fill-ups logged yet')
    );
  }
  const monthsDesc = months.slice().reverse();
  // ── MPG & cost/mile broken down by fuel grade ──
  const fuelGroups = {};
  ve.forEach(function(e){
    const k = e.fuelType || '';
    if (!fuelGroups[k]) fuelGroups[k] = { key: k, mpgs: [], spent: 0, miles: 0, fills: 0 };
    if (e.mpg != null) fuelGroups[k].mpgs.push(e.mpg);
    fuelGroups[k].spent += e.totalPrice || 0;
    fuelGroups[k].miles += e.tripMiles || 0;
    fuelGroups[k].fills += 1;
  });
  const fuelRows = Object.keys(fuelGroups).map(function(k){
    const g = fuelGroups[k];
    return {
      key: k,
      label: fuelLabel(k),
      avgMpg: g.mpgs.length ? g.mpgs.reduce(function(a,b){return a+b;},0)/g.mpgs.length : null,
      costPerMile: g.miles > 0 ? g.spent / g.miles : null,
      fills: g.fills
    };
  }).sort(function(a,b){
    if (a.avgMpg == null) return 1;
    if (b.avgMpg == null) return -1;
    return b.avgMpg - a.avgMpg;
  });
  // ── per-driver breakdown ──
  const driverGroups = {};
  ve.forEach(function(e){
    const k = e.driver || '—';
    if (!driverGroups[k]) driverGroups[k] = { key: k, mpgs: [], spent: 0, miles: 0, fills: 0 };
    if (e.mpg != null) driverGroups[k].mpgs.push(e.mpg);
    driverGroups[k].spent += e.totalPrice || 0;
    driverGroups[k].miles += e.tripMiles || 0;
    driverGroups[k].fills += 1;
  });
  const driverRows = Object.keys(driverGroups).map(function(k){
    const g = driverGroups[k];
    return {
      key: k,
      avgMpg: g.mpgs.length ? g.mpgs.reduce(function(a,b){return a+b;},0)/g.mpgs.length : null,
      costPerMile: g.miles > 0 ? g.spent / g.miles : null,
      miles: g.miles, spent: g.spent, fills: g.fills
    };
  }).sort(function(a,b){ return b.fills - a.fills; });
  // ── stacked total cost per month (fixed + maintenance + fuel) ──
  const fixedCosts = props.fixedCosts || [];
  const maintenanceLogs = props.maintenanceLogs || [];
  const fixedMonthly = fixedCosts.reduce(function(a, c){ return a + monthlyEquivalent(c.amount, c.frequency); }, 0);
  const maintByMonth = {};
  maintenanceLogs.forEach(function(m){
    const k = monthKey(m.date); if (!k) return;
    maintByMonth[k] = (maintByMonth[k] || 0) + (m.cost || 0);
  });
  const stackedRows = months.slice(-6).map(function(m){
    return { key: m.key, label: monthLabel(m.key), fixed: fixedMonthly, maint: maintByMonth[m.key] || 0, fuel: m.spent };
  });
  return h(React.Fragment, null,
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Spend / Month (last 6) — ' + props.vehicle),
      h(BarChart, { rows: recentMonths })
    ),
    fixedCosts.length > 0 ? h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Total Cost / Month (last 6) — ' + props.vehicle),
      h(StackedCostChart, { rows: stackedRows })
    ) : null,
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Cost / Mile Trend — ' + props.vehicle),
      h(CostPerMileChart, { entries: ve })
    ),
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'MPG by Fuel Type'),
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'history-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Fuel'), h('th', null, 'Fills'), h('th', null, 'Avg MPG'), h('th', null, '$/mi')
          )),
          h('tbody', null, fuelRows.map(function(r){
            return h('tr', { key: r.key || 'none' },
              h('td', null, r.label),
              h('td', null, String(r.fills)),
              h('td', { className: 'mpg-cell ' + mpgColor(r.avgMpg) }, fmt(r.avgMpg)),
              h('td', null, r.costPerMile ? '$' + fmt(r.costPerMile, 3) : '—')
            );
          }))
        )
      )
    ),
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Monthly Detail'),
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'history-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Month'), h('th', null, 'Fills'), h('th', null, 'Gal'),
            h('th', null, 'Miles'), h('th', null, 'Spent'), h('th', null, '$/mi')
          )),
          h('tbody', null, monthsDesc.map(function(m){
            const cpm = m.miles > 0 ? m.spent / m.miles : null;
            return h('tr', { key: m.key },
              h('td', null, monthLabel(m.key)),
              h('td', null, String(m.fills)),
              h('td', null, fmt(m.gallons, 2)),
              h('td', null, Math.round(m.miles).toLocaleString()),
              h('td', null, '$' + fmt(m.spent)),
              h('td', null, cpm ? '$' + fmt(cpm, 3) : '—')
            );
          }))
        )
      )
    ),
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Driver Breakdown — ' + props.vehicle),
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'history-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Driver'), h('th', null, 'Fills'), h('th', null, 'Miles'),
            h('th', null, 'Spent'), h('th', null, 'Avg MPG'), h('th', null, '$/mi')
          )),
          h('tbody', null, driverRows.map(function(r){
            return h('tr', { key: r.key },
              h('td', null, r.key),
              h('td', null, String(r.fills)),
              h('td', null, Math.round(r.miles).toLocaleString()),
              h('td', null, '$' + fmt(r.spent)),
              h('td', { className: 'mpg-cell ' + mpgColor(r.avgMpg) }, fmt(r.avgMpg)),
              h('td', null, r.costPerMile ? '$' + fmt(r.costPerMile, 3) : '—')
            );
          }))
        )
      )
    )
  );
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
function History(props) {
  const ve = props.entries.filter(function(e){return e.vehicle === props.vehicle;}).sort(function(a,b){return b.date.localeCompare(a.date);});
  const armState = useState(null); const armedId = armState[0], setArmedId = armState[1];
  const armTimer = useRef();
  function disarm() { if (armTimer.current) { clearTimeout(armTimer.current); armTimer.current = null; } setArmedId(null); }
  function handleDeleteClick(id) {
    if (armedId === id) { disarm(); props.onDelete(id); return; }
    // first tap: arm this row, auto-disarm after 3s
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmedId(id);
    armTimer.current = setTimeout(function(){ setArmedId(null); armTimer.current = null; }, 3000);
  }
  return h('div', { className: 'card' },
    h('div', { className: 'card-title' }, 'All Fill-Ups — ' + props.vehicle + ' (' + ve.length + ')'),
    ve.length === 0 ? h('div', { className: 'no-data' }, 'No fill-ups logged yet') :
    h('div', { style: { overflowX: 'auto' } },
      h('table', { className: 'history-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Date'), h('th', null, 'Trip'), h('th', null, 'Odo'), h('th', null, 'Gal'),
          h('th', null, 'PPG'), h('th', null, 'Total'), h('th', null, 'Fuel'), h('th', null, 'Driver'), h('th', null, 'MPG'), h('th', null, '')
        )),
        h('tbody', null, ve.map(function(e){
          const armed = armedId === e.id;
          const rows = [
            h('tr', { key: e.id },
              h('td', null, fmtDate(e.date), e.partial ? h('span', { className: 'partial-tag' }, 'P') : null),
              h('td', null, fmt(e.tripMiles, 1)),
              h('td', null, e.totalMiles ? Math.round(e.totalMiles).toLocaleString() : '—'),
              h('td', null, fmt(e.gallons, 3)),
              h('td', null, e.pricePerGallon ? '$' + fmt(e.pricePerGallon) : '—'),
              h('td', null, e.totalPrice ? '$' + fmt(e.totalPrice) : '—'),
              h('td', { style: { fontSize: 10, color: 'var(--text-muted)' } }, e.fuelType ? fuelLabel(e.fuelType) : '—'),
              h('td', { style: { fontSize: 11, color: 'var(--text-muted)' } }, e.driver ? e.driver : '—'),
              h('td', { className: 'mpg-cell ' + mpgColor(e.mpg) }, e.partial ? '—' : fmt(e.mpg)),
              h('td', null, h('button', {
                className: 'delete-btn' + (armed ? ' armed' : ''),
                onClick: function(){ handleDeleteClick(e.id); },
                title: armed ? 'Tap again to confirm' : 'Delete'
              }, armed ? 'Sure?' : '×'))
            )
          ];
          if (e.notes) {
            rows.push(h('tr', { key: e.id + '-notes', className: 'notes-row' },
              h('td', { colSpan: 10, className: 'notes-cell' }, '🗒 ' + e.notes)
            ));
          }
          return rows;
        }))
      )
    )
  );
}

// ── MAP (Leaflet) ─────────────────────────────────────────────────────────────
function MapView(props) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const ve = props.entries.filter(function(e){
    return e.vehicle === props.vehicle && e.lat != null && e.lng != null;
  });
  const hasLeaflet = typeof window !== 'undefined' && !!window.L;

  useEffect(function(){
    if (!hasLeaflet || !containerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = window.L.map(containerRef.current, { scrollWheelZoom: true })
        .setView([39.5, -98.35], 4); // continental US fallback view
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
      }).addTo(mapRef.current);
      layerRef.current = window.L.layerGroup().addTo(mapRef.current);
    }
    const map = mapRef.current;
    const layer = layerRef.current;
    layer.clearLayers();
    const pts = [];
    ve.forEach(function(e){
      const html = '<strong>' + escapeHtml(fmtDate(e.date)) + '</strong><br>' +
        escapeHtml(fmt(e.gallons, 3)) + ' gal' + (e.totalPrice ? ' &middot; $' + escapeHtml(fmt(e.totalPrice)) : '') +
        (e.fuelType ? '<br>' + escapeHtml(fuelLabel(e.fuelType)) : '') +
        (e.notes ? '<br><em>' + escapeHtml(e.notes) + '</em>' : '');
      window.L.marker([e.lat, e.lng]).bindPopup(html).addTo(layer);
      pts.push([e.lat, e.lng]);
    });
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    // Leaflet needs a size recalc once the tab/container is actually visible
    setTimeout(function(){ if (mapRef.current) mapRef.current.invalidateSize(); }, 120);
  }, [props.entries, props.vehicle, hasLeaflet]);

  useEffect(function(){
    return function(){
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; }
    };
  }, []);

  return h('div', { className: 'card' },
    h('div', { className: 'card-title' }, 'Fill-Up Map — ' + props.vehicle),
    !hasLeaflet ? h('div', { className: 'info-note', style: { marginTop: 0 } },
      'Map library unavailable (likely offline). Reconnect to view the map.'
    ) : h(React.Fragment, null,
      ve.length === 0 ? h('div', { className: 'info-note', style: { marginTop: 0, marginBottom: 10 } },
        'No fill-ups with a saved location yet. Tap “Capture location” when logging a fill-up to plot it here.'
      ) : null,
      h('div', { ref: containerRef, className: 'map-canvas' }),
      ve.length ? h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' } },
        ve.length + ' location' + (ve.length !== 1 ? 's' : '') + ' plotted'
      ) : null
    )
  );
}

// ── EXPORTS ────────────────────────────────────────────────────────────────────
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function toCSV(entries) {
  const headers = ['Date','Vehicle','Trip Miles','Total Odometer','Gallons','Price Per Gallon','Total Cost','Fuel Type','Driver','Partial Fill','MPG','Notes','Latitude','Longitude'];
  const rows = entries.slice().sort(function(a,b){return a.date.localeCompare(b.date);}).map(function(e){
    return [
      e.date, e.vehicle,
      e.tripMiles != null ? e.tripMiles : '',
      e.totalMiles != null ? e.totalMiles : '',
      e.gallons != null ? e.gallons : '',
      e.pricePerGallon != null ? e.pricePerGallon : '',
      e.totalPrice != null ? e.totalPrice : '',
      e.fuelType ? fuelLabel(e.fuelType) : '',
      e.driver != null ? e.driver : '',
      e.partial ? 'Yes' : 'No',
      (e.partial || e.mpg == null) ? '' : e.mpg,
      e.notes != null ? e.notes : '',
      e.lat != null ? e.lat : '',
      e.lng != null ? e.lng : ''
    ];
  });
  function esc(v){ const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }
  return [headers].concat(rows).map(function(r){ return r.map(esc).join(','); }).join('\n');
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function Settings(props) {
  const fileRef = useRef();
  const data = props.data;
  function handleExportJSON() {
    downloadFile('fuellog_' + new Date().toISOString().split('T')[0] + '.json', JSON.stringify(data, null, 2), 'application/json');
  }
  function handleExportCSV() {
    downloadFile('fuellog_' + new Date().toISOString().split('T')[0] + '.csv', toCSV(data.entries), 'text/csv');
  }
  function handleImport(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev){
      try {
        const imported = JSON.parse(ev.target.result);
        if (imported.vehicles && imported.entries) { props.onImport(migrate(imported)); }
        else alert('Invalid file format.');
      } catch (err) { alert('Could not parse file.'); }
    };
    reader.readAsText(file); e.target.value = '';
  }
  function handleClearVehicle(vehicle) {
    if (!confirm('Delete ALL entries for "' + vehicle + '"? This cannot be undone.')) return;
    props.onClearVehicle(vehicle);
  }
  function handleRemoveVehicle(vehicle) {
    if (!confirm('Remove vehicle "' + vehicle + '" and all its data?')) return;
    props.onRemoveVehicle(vehicle);
  }
  return h('div', { className: 'card' },
    h('div', { className: 'settings-section' },
      h('div', { className: 'settings-title' }, 'Appearance'),
      h('div', { className: 'setting-row', style: { borderBottom: 'none' } },
        h('div', null,
          h('div', { className: 'setting-label' }, 'Color theme'),
          h('div', { className: 'setting-sub' }, 'Recolors the app chrome')
        )
      ),
      h('div', { className: 'theme-grid' },
        THEMES.map(function(t){
          return h('button', {
            key: t.id,
            className: 'theme-chip' + (props.theme === t.id ? ' active' : ''),
            onClick: function(){ props.onThemeChange(t.id); }
          },
            h('span', { className: 'theme-swatch', style: { background: t.swatch } }),
            t.label
          );
        })
      )
    ),
    h('div', { className: 'settings-section' },
      h('div', { className: 'settings-title' }, 'Cloud Sync'),
      h('div', { className: 'setting-row' },
        h('div', null,
          h('div', { className: 'setting-label' }, 'Migrate local data'),
          h('div', { className: 'setting-sub' }, 'Push any locally-stored entries to Supabase')
        ),
        h('button', { className: 'btn btn-ghost', onClick: props.onMigrate }, 'Migrate')
      )
    ),
    h('div', { className: 'settings-section' },
      h('div', { className: 'settings-title' }, 'Data'),
      h('div', { className: 'setting-row' },
        h('div', null,
          h('div', { className: 'setting-label' }, 'Export JSON'),
          h('div', { className: 'setting-sub' }, 'Full backup (re-importable)')
        ),
        h('button', { className: 'btn btn-ghost', onClick: handleExportJSON }, 'Export')
      ),
      h('div', { className: 'setting-row' },
        h('div', null,
          h('div', { className: 'setting-label' }, 'Export CSV'),
          h('div', { className: 'setting-sub' }, 'For Excel — all columns, all vehicles')
        ),
        h('button', { className: 'btn btn-ghost', onClick: handleExportCSV }, 'Export')
      ),
      h('div', { className: 'setting-row' },
        h('div', null,
          h('div', { className: 'setting-label' }, 'Import JSON'),
          h('div', { className: 'setting-sub' }, 'Restore from a backup file')
        ),
        h('button', { className: 'btn btn-ghost', onClick: function(){ fileRef.current.click(); } }, 'Import')
      ),
      h('input', { ref: fileRef, type: 'file', accept: '.json', style: { display: 'none' }, onChange: handleImport })
    ),
    h('div', { className: 'settings-section' },
      h('div', { className: 'settings-title' }, 'Vehicles (' + data.vehicles.length + ')'),
      data.vehicles.map(function(v){
        const count = data.entries.filter(function(e){return e.vehicle === v;}).length;
        return h('div', { key: v, className: 'setting-row' },
          h('div', null,
            h('div', { className: 'setting-label' }, v),
            h('div', { className: 'setting-sub' }, count + ' fill-up' + (count !== 1 ? 's' : ''))
          ),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('button', { className: 'btn btn-ghost', style: { fontSize: 12, padding: '5px 10px' }, onClick: function(){ handleClearVehicle(v); } }, 'Clear'),
            data.vehicles.length > 1 ? h('button', { className: 'btn btn-danger', style: { fontSize: 12, padding: '5px 10px' }, onClick: function(){ handleRemoveVehicle(v); } }, 'Remove') : null
          )
        );
      })
    ),
    h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)' } },
      data.entries.length + ' total entries · synced via Supabase'
    )
  );
}

// ── ADD VEHICLE MODAL ─────────────────────────────────────────────────────────
function AddVehicleModal(props) {
  const state = useState(''); const name = state[0], setName = state[1];
  function handleAdd() { const t = name.trim(); if (!t) return; props.onAdd(t); props.onClose(); }
  return h('div', { className: 'modal-overlay', onClick: function(e){ if (e.target === e.currentTarget) props.onClose(); } },
    h('div', { className: 'modal' },
      h('div', { className: 'modal-title' }, 'Add Vehicle'),
      h('div', { className: 'form-group' },
        h('label', null, 'Name'),
        h('input', { type: 'text', placeholder: 'e.g. 2019 F-150', value: name, autoFocus: true,
          onChange: function(e){ setName(e.target.value); },
          onKeyDown: function(e){ if (e.key === 'Enter') handleAdd(); } })
      ),
      h('div', { className: 'modal-row' },
        h('button', { className: 'btn btn-ghost btn-full', onClick: props.onClose }, 'Cancel'),
        h('button', { className: 'btn btn-primary btn-full', disabled: !name.trim(), onClick: handleAdd }, 'Add')
      )
    )
  );
}

// ── COSTS (fixed cost manager) ──────────────────────────────────────────────────
function CostsView(props) {
  const vc = props.fixedCosts; // already filtered to active vehicle
  const blank = { category: 'payment', label: '', amount: '', frequency: 'monthly', startDate: '' };
  const fs = useState(blank); const f = fs[0], setF = fs[1];
  function set(k, v){ setF(function(prev){ var n = Object.assign({}, prev); n[k] = v; return n; }); }
  const amountNum = parseFloat(f.amount);
  const canAdd = f.category && !isNaN(amountNum) && amountNum > 0;
  function handleAdd() {
    if (!canAdd) return;
    props.onAdd({
      id: Date.now(), vehicle: props.vehicle, category: f.category,
      label: f.label ? f.label.trim() : '', amount: parseFloat(amountNum.toFixed(2)),
      frequency: f.frequency, startDate: f.startDate || '', endDate: ''
    });
    setF(Object.assign({}, blank, { category: f.category, frequency: f.frequency }));
  }
  const totalMonthly = vc.reduce(function(a, c){ return a + monthlyEquivalent(c.amount, c.frequency); }, 0);
  // per-category monthly equivalents for the summary card
  const catTotals = { payment: 0, insurance: 0, registration: 0, otherFixed: 0 };
  const catHas = { payment: false, insurance: false, registration: false, otherFixed: false };
  vc.forEach(function(c){
    const me = monthlyEquivalent(c.amount, c.frequency);
    if (c.category === 'payment') { catTotals.payment += me; catHas.payment = true; }
    else if (c.category === 'insurance') { catTotals.insurance += me; catHas.insurance = true; }
    else if (c.category === 'registration') { catTotals.registration += me; catHas.registration = true; }
    else { catTotals.otherFixed += me; catHas.otherFixed = true; }
  });
  function statCell(label, val, cls, unit) {
    return h('div', { className: 'stat-cell' },
      h('div', { className: 'stat-label' }, label),
      h('div', { className: 'stat-value ' + (cls||'') }, val),
      h('div', { className: 'stat-unit' }, unit)
    );
  }
  const summaryCells = [];
  if (catHas.payment) summaryCells.push(statCell('Payment', '$' + fmt(catTotals.payment), '', '/ mo'));
  if (catHas.insurance) summaryCells.push(statCell('Insurance', '$' + fmt(catTotals.insurance), '', '/ mo'));
  if (catHas.registration) summaryCells.push(statCell('Registration', '$' + fmt(catTotals.registration), '', '/ mo'));
  if (catHas.otherFixed) summaryCells.push(statCell('Other Fixed', '$' + fmt(catTotals.otherFixed), '', '/ mo'));
  summaryCells.push(statCell('Total Fixed / Mo', '$' + fmt(totalMonthly), 'accent', 'this vehicle'));

  return h(React.Fragment, null,
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Fixed Cost Manager — ' + props.vehicle),
      vc.length === 0 ? h('div', { className: 'no-data' }, 'No fixed costs added yet') :
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'history-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Category'), h('th', null, 'Label'), h('th', null, 'Amount'),
            h('th', null, 'Frequency'), h('th', null, 'Monthly Equiv'), h('th', null, '')
          )),
          h('tbody', null,
            vc.map(function(c){
              return h('tr', { key: c.id },
                h('td', null, fixedCatLabel(c.category)),
                h('td', { style: { color: 'var(--text-muted)' } }, c.label || '—'),
                h('td', null, '$' + fmt(c.amount)),
                h('td', null, freqLabel(c.frequency)),
                h('td', { style: { fontFamily: 'var(--mono)', fontWeight: 600 } }, '$' + fmt(monthlyEquivalent(c.amount, c.frequency))),
                h('td', null, h('button', { className: 'delete-btn', title: 'Delete', onClick: function(){ if (confirm('Delete this fixed cost?')) props.onDelete(c.id); } }, '×'))
              );
            }).concat([
              h('tr', { key: '__total', style: { borderTop: '2px solid var(--border)' } },
                h('td', { colSpan: 4, style: { color: 'var(--text-muted)', fontFamily: 'var(--mono)' } }, 'Total monthly fixed cost'),
                h('td', { colSpan: 2, style: { fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--accent)' } }, '$' + fmt(totalMonthly))
              )
            ])
          )
        )
      ),
      // ── inline add form ──
      h('div', { className: 'form-grid', style: { marginTop: 14 } },
        h('div', { className: 'form-group' },
          h('label', null, 'Category'),
          h('select', { value: f.category, onChange: function(e){ set('category', e.target.value); } },
            FIXED_CATEGORIES.map(function(c){ return h('option', { key: c.value, value: c.value }, c.label); })
          )
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Frequency'),
          h('select', { value: f.frequency, onChange: function(e){ set('frequency', e.target.value); } },
            FREQUENCIES.map(function(c){ return h('option', { key: c.value, value: c.value }, c.label); })
          )
        ),
        h('div', { className: 'form-group full' },
          h('label', null, 'Label'),
          h('input', { type: 'text', placeholder: 'e.g. State Farm full coverage', value: f.label, onChange: function(e){ set('label', e.target.value); } })
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Amount ($)'),
          h('input', { type: 'number', inputMode: 'decimal', placeholder: '0.00', value: f.amount, onChange: function(e){ set('amount', e.target.value); } })
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Start Date'),
          h('input', { type: 'date', value: f.startDate, onChange: function(e){ set('startDate', e.target.value); } })
        )
      ),
      h('div', { className: 'btn-row', style: { marginTop: 12 } },
        h('button', { className: 'btn btn-primary btn-full', disabled: !canAdd, onClick: handleAdd }, 'Add Cost')
      )
    ),
    vc.length > 0 ? h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Monthly Fixed Cost Summary — ' + props.vehicle),
      h('div', { className: 'stat-grid' }, summaryCells)
    ) : null
  );
}

// ── MAINTENANCE STATUS HELPER ──────────────────────────────────────────────────
// Returns { rank, level, label } — rank: 0 OK, 1 Due Soon, 2 Overdue (worst wins)
function maintStatus(m, latestOdo) {
  let rank = 0;
  if (m.nextDueMiles != null && latestOdo != null) {
    if (latestOdo >= m.nextDueMiles) rank = Math.max(rank, 2);
    else if (m.nextDueMiles - latestOdo <= 500) rank = Math.max(rank, 1);
  }
  if (m.nextDueDate) {
    const due = new Date(m.nextDueDate + 'T00:00:00').getTime();
    const now = Date.now();
    const days = (due - now) / 86400000;
    if (days < 0) rank = Math.max(rank, 2);
    else if (days <= 30) rank = Math.max(rank, 1);
  }
  return rank === 2 ? { rank: rank, level: 'overdue', label: 'Overdue' }
       : rank === 1 ? { rank: rank, level: 'soon', label: 'Due Soon' }
       : { rank: rank, level: 'ok', label: 'OK' };
}

// ── MAINTENANCE TAB ─────────────────────────────────────────────────────────────
function MaintenanceView(props) {
  const vm = props.maintenanceLogs; // already filtered to active vehicle
  const latestOdo = props.latestOdo;
  const today = new Date().toISOString().split('T')[0];
  const blank = { date: today, odometer: '', category: 'oil_change', description: '', cost: '', shop: '', nextDueMiles: '', nextDueDate: '' };
  const fs = useState(blank); const f = fs[0], setF = fs[1];
  function set(k, v){ setF(function(prev){ var n = Object.assign({}, prev); n[k] = v; return n; }); }
  const canAdd = f.date && f.category;
  function handleAdd() {
    if (!canAdd) return;
    props.onAdd({
      id: Date.now(), vehicle: props.vehicle, date: f.date,
      odometer: f.odometer !== '' ? parseFloat(f.odometer) : null,
      category: f.category, description: f.description ? f.description.trim() : '',
      cost: f.cost !== '' ? parseFloat(parseFloat(f.cost).toFixed(2)) : null,
      shop: f.shop ? f.shop.trim() : '',
      nextDueMiles: f.nextDueMiles !== '' ? parseFloat(f.nextDueMiles) : null,
      nextDueDate: f.nextDueDate || ''
    });
    setF(Object.assign({}, blank, { date: f.date, category: f.category }));
  }
  // reminders: entries with a due mileage or date, sorted worst-first
  const reminders = vm.filter(function(m){ return m.nextDueMiles != null || m.nextDueDate; })
    .map(function(m){ return { m: m, status: maintStatus(m, latestOdo) }; })
    .sort(function(a,b){ return b.status.rank - a.status.rank; });
  const sortedHistory = vm.slice().sort(function(a,b){ return (b.date || '').localeCompare(a.date || ''); });
  const totalSpend = vm.reduce(function(a, m){ return a + (m.cost || 0); }, 0);

  return h(React.Fragment, null,
    reminders.length > 0 ? h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Upcoming / Overdue Reminders — ' + props.vehicle),
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'history-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Service'), h('th', null, 'Due Date'), h('th', null, 'Due Mileage'), h('th', null, 'Status')
          )),
          h('tbody', null, reminders.map(function(r){
            return h('tr', { key: r.m.id },
              h('td', null, maintCatLabel(r.m.category)),
              h('td', null, r.m.nextDueDate ? fmtDate(r.m.nextDueDate) : '—'),
              h('td', null, r.m.nextDueMiles != null ? Math.round(r.m.nextDueMiles).toLocaleString() : '—'),
              h('td', null, h('span', { className: 'status-badge ' + r.status.level }, r.status.label))
            );
          }))
        )
      )
    ) : null,
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Log Maintenance — ' + props.vehicle),
      h('div', { className: 'form-grid' },
        h('div', { className: 'form-group' },
          h('label', null, 'Date'),
          h('input', { type: 'date', value: f.date, onChange: function(e){ set('date', e.target.value); } })
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Odometer'),
          h('input', { type: 'number', inputMode: 'decimal', placeholder: 'optional', value: f.odometer, onChange: function(e){ set('odometer', e.target.value); } })
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Category'),
          h('select', { value: f.category, onChange: function(e){ set('category', e.target.value); } },
            MAINT_CATEGORIES.map(function(c){ return h('option', { key: c.value, value: c.value }, c.label); })
          )
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Cost ($)'),
          h('input', { type: 'number', inputMode: 'decimal', placeholder: '0.00', value: f.cost, onChange: function(e){ set('cost', e.target.value); } })
        ),
        h('div', { className: 'form-group full' },
          h('label', null, 'Description'),
          h('input', { type: 'text', placeholder: 'e.g. Oil change + filter — Jiffy Lube', value: f.description, onChange: function(e){ set('description', e.target.value); } })
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Shop'),
          h('input', { type: 'text', placeholder: 'optional', value: f.shop, onChange: function(e){ set('shop', e.target.value); } })
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Next Due Mileage'),
          h('input', { type: 'number', inputMode: 'decimal', placeholder: 'optional', value: f.nextDueMiles, onChange: function(e){ set('nextDueMiles', e.target.value); } })
        ),
        h('div', { className: 'form-group' },
          h('label', null, 'Next Due Date'),
          h('input', { type: 'date', value: f.nextDueDate, onChange: function(e){ set('nextDueDate', e.target.value); } })
        )
      ),
      h('div', { className: 'btn-row', style: { marginTop: 12 } },
        h('button', { className: 'btn btn-primary btn-full', disabled: !canAdd, onClick: handleAdd }, 'Save Maintenance')
      )
    ),
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Maintenance History — ' + props.vehicle + ' (' + vm.length + ')'),
      vm.length === 0 ? h('div', { className: 'no-data' }, 'No maintenance logged yet') :
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'history-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Date'), h('th', null, 'Odo'), h('th', null, 'Category'),
            h('th', null, 'Description'), h('th', null, 'Shop'), h('th', null, 'Cost'), h('th', null, '')
          )),
          h('tbody', null,
            sortedHistory.map(function(m){
              return h('tr', { key: m.id },
                h('td', null, fmtDate(m.date)),
                h('td', null, m.odometer != null ? Math.round(m.odometer).toLocaleString() : '—'),
                h('td', null, maintCatLabel(m.category)),
                h('td', { style: { color: 'var(--text-muted)' } }, m.description || '—'),
                h('td', { style: { color: 'var(--text-muted)', fontSize: 11 } }, m.shop || '—'),
                h('td', null, m.cost != null ? '$' + fmt(m.cost) : '—'),
                h('td', null, h('button', { className: 'delete-btn', title: 'Delete', onClick: function(){ if (confirm('Delete this maintenance entry?')) props.onDelete(m.id); } }, '×'))
              );
            }).concat([
              h('tr', { key: '__total', style: { borderTop: '2px solid var(--border)' } },
                h('td', { colSpan: 5, style: { color: 'var(--text-muted)', fontFamily: 'var(--mono)' } }, 'Total maintenance spend'),
                h('td', { colSpan: 2, style: { fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--accent)' } }, '$' + fmt(totalSpend))
              )
            ])
          )
        )
      )
    )
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
function App() {
  const [entries, setEntries] = useState(loadCache);
  const [vehicles, setVehicles] = useState(function(){ return loadPrefs().vehicles || ['My Vehicle']; });
  const [activeVehicle, setActiveVehicle] = useState(function(){ const p = loadPrefs(); return p.activeVehicle || (p.vehicles || ['My Vehicle'])[0]; });
  const [tab, setTab] = useState('dashboard');
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [syncStatus, setSyncStatus] = useState('syncing');
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(function(){ return loadPrefs().theme || 'midnight'; });
  const [lastDriver, setLastDriver] = useState(function(){ return loadPrefs().lastDriver || ''; });
  const [fixedCosts, setFixedCosts] = useState(function(){ return loadJSON(FIXED_KEY); });
  const [maintenanceLogs, setMaintenanceLogs] = useState(function(){ return loadJSON(MAINT_KEY); });
  const [dismissedReminders, setDismissedReminders] = useState(function(){ return new Set(); });

  // keep a ref so async callbacks always see current entries without stale closure
  const entriesRef = useRef(entries);
  useEffect(function(){ entriesRef.current = entries; }, [entries]);

  useEffect(function(){
    savePrefs({ vehicles: vehicles, activeVehicle: activeVehicle, theme: theme, lastDriver: lastDriver });
  }, [vehicles, activeVehicle, theme, lastDriver]);

  // Apply the selected color theme to the document root
  useEffect(function(){
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(function(){
    loadFromSupabase();
    loadFixedCosts();
    loadMaintenance();
    window.addEventListener('online', handleOnline);
    return function(){ window.removeEventListener('online', handleOnline); };
  }, []);

  // Fixed costs + maintenance load independently of fill_ups so that a missing
  // table (before the Phase 1 SQL is run) never breaks the main sync path.
  function loadFixedCosts() {
    return sb.from('fixed_costs').select('*').then(function(res){
      if (res.error) throw res.error;
      const mapped = res.data.map(fromSbFixedCost);
      setFixedCosts(mapped); saveJSON(FIXED_KEY, mapped);
    }).catch(function(err){ console.warn('[FuelLog] fixed_costs read failed (run Phase 1 SQL?):', err); });
  }
  function loadMaintenance() {
    return sb.from('maintenance_log').select('*').then(function(res){
      if (res.error) throw res.error;
      const mapped = res.data.map(fromSbMaint);
      setMaintenanceLogs(mapped); saveJSON(MAINT_KEY, mapped);
    }).catch(function(err){ console.warn('[FuelLog] maintenance_log read failed (run Phase 1 SQL?):', err); });
  }

  function loadFromSupabase() {
    setSyncStatus('syncing');
    return sb.from('fill_ups').select('*').order('date', { ascending: true }).then(function(res){
      if (res.error) throw res.error;
      console.log('[FuelLog] raw row sample:', res.data[0]);
      const mapped = res.data.map(fromSb);
      console.log('[FuelLog] mapped row sample:', mapped[0]);
      // Rebuild vehicle list from the fetched data so a fresh device shows all vehicles
      const prefs = loadPrefs();
      const sbVehicles = Array.from(new Set(mapped.map(function(e){ return e.vehicle; })));
      const mergedVehicles = sbVehicles.length ? sbVehicles : (prefs.vehicles || ['My Vehicle']);
      const savedActive = prefs.activeVehicle;
      const activeV = (savedActive && mergedVehicles.indexOf(savedActive) !== -1) ? savedActive : mergedVehicles[0];
      setEntries(mapped);
      setVehicles(mergedVehicles);
      setActiveVehicle(activeV);
      saveCache(mapped);
      setSyncStatus('synced');
    }).catch(function(err){
      console.warn('[FuelLog] Supabase read failed, falling back to localStorage:', err);
      setEntries(loadCache());
      setSyncStatus('offline');
    }).finally(function(){
      setLoading(false);
    });
  }

  function handleOnline() {
    const pending = loadPending();
    loadFixedCosts(); loadMaintenance();
    if (!pending.length) { loadFromSupabase(); return; }
    setSyncStatus('syncing');
    const failed = [];
    let chain = Promise.resolve();
    pending.forEach(function(op){
      chain = chain.then(function(){
        if (op.op === 'insert') {
          return sb.from('fill_ups').upsert(toSb(op.entry, op.mpg)).then(function(r){ if (r.error) throw r.error; });
        } else if (op.op === 'delete') {
          return sb.from('fill_ups').delete().eq('id', op.id).then(function(r){ if (r.error) throw r.error; });
        } else if (op.op === 'deleteVehicle') {
          return sb.from('fill_ups').delete().eq('vehicle', op.vehicle).then(function(r){ if (r.error) throw r.error; });
        }
      }).catch(function(){ failed.push(op); });
    });
    chain.then(function(){ savePending(failed); loadFromSupabase(); });
  }

  const mpgMap = computeMpg(entries);
  const entriesWithMpg = entries.map(function(e){ return Object.assign({}, e, { mpg: mpgMap[e.id] }); });
  const knownDrivers = Array.from(new Set(entries.map(function(e){ return e.driver; }).filter(Boolean))).sort();

  function handleAddFixedCost(fc) {
    setFixedCosts(function(prev){ const next = prev.concat([fc]); saveJSON(FIXED_KEY, next); return next; });
    setSyncStatus('syncing');
    sb.from('fixed_costs').insert(toSbFixedCost(fc)).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(err){
      console.warn('[FuelLog] fixed_costs insert failed:', err);
      setSyncStatus('offline');
    });
  }
  function handleDeleteFixedCost(id) {
    setFixedCosts(function(prev){ const next = prev.filter(function(c){ return c.id !== id; }); saveJSON(FIXED_KEY, next); return next; });
    setSyncStatus('syncing');
    sb.from('fixed_costs').delete().eq('id', id).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(err){
      console.warn('[FuelLog] fixed_costs delete failed:', err);
      setSyncStatus('offline');
    });
  }

  function handleAddMaintenance(m) {
    setMaintenanceLogs(function(prev){ const next = prev.concat([m]); saveJSON(MAINT_KEY, next); return next; });
    setSyncStatus('syncing');
    sb.from('maintenance_log').insert(toSbMaint(m)).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(err){
      console.warn('[FuelLog] maintenance_log insert failed:', err);
      setSyncStatus('offline');
    });
  }
  function handleDeleteMaintenance(id) {
    setMaintenanceLogs(function(prev){ const next = prev.filter(function(m){ return m.id !== id; }); saveJSON(MAINT_KEY, next); return next; });
    setSyncStatus('syncing');
    sb.from('maintenance_log').delete().eq('id', id).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(err){
      console.warn('[FuelLog] maintenance_log delete failed:', err);
      setSyncStatus('offline');
    });
  }
  function handleDismissReminder(id) {
    setDismissedReminders(function(prev){ const next = new Set(prev); next.add(id); return next; });
  }

  function handleAddEntry(entry) {
    const cur = entriesRef.current;
    const newEntries = [entry].concat(cur);
    const mpg = computeMpg(newEntries)[entry.id];
    if (entry.driver) setLastDriver(entry.driver);
    setEntries(newEntries);
    saveCache(newEntries);
    setSyncStatus('syncing');
    sb.from('fill_ups').insert(toSb(entry, mpg)).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(){
      setSyncStatus('offline');
      addPending({ op: 'insert', entry: entry, mpg: mpg });
    });
  }

  function handleDeleteEntry(id) {
    // Confirmation is handled inline by History's two-tap "Sure?" button.
    const newEntries = entriesRef.current.filter(function(e){ return e.id !== id; });
    setEntries(newEntries);
    saveCache(newEntries);
    setSyncStatus('syncing');
    sb.from('fill_ups').delete().eq('id', id).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(){
      setSyncStatus('offline');
      addPending({ op: 'delete', id: id });
    });
  }

  function handleAddVehicle(name) {
    if (vehicles.indexOf(name) !== -1) { alert('Vehicle already exists.'); return; }
    setVehicles(function(prev){ return prev.concat([name]); });
    setActiveVehicle(name);
  }

  function handleClearVehicle(vehicle) {
    const newEntries = entriesRef.current.filter(function(e){ return e.vehicle !== vehicle; });
    setEntries(newEntries);
    saveCache(newEntries);
    setSyncStatus('syncing');
    sb.from('fill_ups').delete().eq('vehicle', vehicle).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(){
      setSyncStatus('offline');
      addPending({ op: 'deleteVehicle', vehicle: vehicle });
    });
  }

  function handleRemoveVehicle(vehicle) {
    const remaining = vehicles.filter(function(v){ return v !== vehicle; });
    const newEntries = entriesRef.current.filter(function(e){ return e.vehicle !== vehicle; });
    setVehicles(remaining);
    setEntries(newEntries);
    setActiveVehicle(remaining[0] || 'My Vehicle');
    saveCache(newEntries);
    setSyncStatus('syncing');
    sb.from('fill_ups').delete().eq('vehicle', vehicle).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
    }).catch(function(){
      setSyncStatus('offline');
      addPending({ op: 'deleteVehicle', vehicle: vehicle });
    });
  }

  function handleImport(importedData) {
    const newEntries = importedData.entries || [];
    setVehicles(importedData.vehicles || vehicles);
    setActiveVehicle(importedData.activeVehicle || (importedData.vehicles || [])[0] || 'My Vehicle');
    setEntries(newEntries);
    saveCache(newEntries);
    if (!newEntries.length) { alert('Data imported successfully.'); return; }
    setSyncStatus('syncing');
    const mpgM = computeMpg(newEntries);
    const rows = newEntries.map(function(e){ return toSb(e, mpgM[e.id]); });
    sb.from('fill_ups').upsert(rows).then(function(r){
      if (r.error) throw r.error;
      setSyncStatus('synced');
      alert('Data imported and synced to cloud successfully.');
    }).catch(function(){
      setSyncStatus('offline');
      alert('Data imported locally. Will sync to cloud when online.');
    });
  }

  function handleMigrateLocalData() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) { alert('No local data found in legacy storage.'); return; }
    let legacy;
    try { legacy = migrate(JSON.parse(raw)); } catch (e) { alert('Could not read local data.'); return; }
    if (!legacy.entries || !legacy.entries.length) { alert('No entries found in local data.'); return; }
    if (!confirm('Migrate ' + legacy.entries.length + ' local entries to Supabase?')) return;
    setSyncStatus('syncing');
    const mpgM = computeMpg(legacy.entries);
    const rows = legacy.entries.map(function(e){ return toSb(e, mpgM[e.id]); });
    sb.from('fill_ups').upsert(rows).then(function(r){
      if (r.error) throw r.error;
      return loadFromSupabase();
    }).then(function(){
      alert('Migrated ' + legacy.entries.length + ' entries to Supabase successfully.');
    }).catch(function(){
      setSyncStatus('offline');
      alert('Could not reach Supabase. Please try again when online.');
    });
  }

  if (loading) return h('div', { style: { padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--mono)' } }, 'Loading…');

  const syncDotColor = { synced: '#34d399', syncing: '#f5a623', offline: '#f05252' }[syncStatus] || '#7a8299';
  const syncLabel = { synced: 'synced', syncing: 'syncing…', offline: 'offline' }[syncStatus] || '';

  const vehicleFixed = fixedCosts.filter(function(c){ return c.vehicle === activeVehicle; });
  const vehicleMaint = maintenanceLogs.filter(function(m){ return m.vehicle === activeVehicle; });
  const vehicleLatestOdo = entriesWithMpg
    .filter(function(e){ return e.vehicle === activeVehicle && e.totalMiles != null; })
    .reduce(function(mx, e){ return Math.max(mx, e.totalMiles); }, 0) || null;

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'add', label: 'Add', icon: '⛽' },
    { id: 'monthly', label: 'Monthly', icon: '📅' },
    { id: 'costs', label: 'Costs', icon: '💰' },
    { id: 'maintenance', label: 'Maintenance', icon: '🔧' },
    { id: 'history', label: 'History', icon: '📜' },
    { id: 'map', label: 'Map', icon: '🗺️' },
    { id: 'settings', label: 'Settings', icon: '⚙️' }
  ];
  function tabButton(t) {
    return h('button', { key: t.id, className: 'nav-tab' + (tab === t.id ? ' active' : ''), onClick: function(){ setTab(t.id); } },
      h('span', { className: 'nav-ico' }, t.icon),
      h('span', { className: 'nav-lbl' }, t.label)
    );
  }

  return h(React.Fragment, null,
    h('nav', null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('div', { className: 'nav-brand' }, '⛽ ', h('span', null, 'Fuel'), 'Log'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--mono)', color: syncDotColor } },
          h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: syncDotColor, display: 'inline-block', flexShrink: 0 } }),
          syncLabel
        )
      ),
      h('div', { className: 'nav-tabs top-tabs' }, tabs.map(tabButton))
    ),
    h('main', null,
      h('div', { className: 'vehicle-bar' },
        vehicles.map(function(v){
          return h('div', { key: v, className: 'vehicle-chip' + (v === activeVehicle ? ' active' : ''), onClick: function(){ setActiveVehicle(v); } }, v);
        }),
        h('div', { className: 'vehicle-chip add-btn', onClick: function(){ setShowAddVehicle(true); } }, '+ Add vehicle')
      ),
      tab === 'dashboard' ? h(Dashboard, { entries: entriesWithMpg, vehicle: activeVehicle, fixedCosts: vehicleFixed, maintenanceLogs: vehicleMaint, dismissed: dismissedReminders, onDismiss: handleDismissReminder }) : null,
      tab === 'add' ? h(AddEntryForm, { vehicle: activeVehicle, drivers: knownDrivers, defaultDriver: lastDriver, onDriverUsed: setLastDriver, onAdd: function(e){ handleAddEntry(e); setTab('dashboard'); } }) : null,
      tab === 'monthly' ? h(Monthly, { entries: entriesWithMpg, vehicle: activeVehicle, fixedCosts: vehicleFixed, maintenanceLogs: vehicleMaint }) : null,
      tab === 'costs' ? h(CostsView, { vehicle: activeVehicle, fixedCosts: vehicleFixed, onAdd: handleAddFixedCost, onDelete: handleDeleteFixedCost }) : null,
      tab === 'maintenance' ? h(MaintenanceView, { vehicle: activeVehicle, maintenanceLogs: vehicleMaint, latestOdo: vehicleLatestOdo, onAdd: handleAddMaintenance, onDelete: handleDeleteMaintenance }) : null,
      tab === 'history' ? h(History, { entries: entriesWithMpg, vehicle: activeVehicle, onDelete: handleDeleteEntry }) : null,
      tab === 'map' ? h(MapView, { entries: entriesWithMpg, vehicle: activeVehicle }) : null,
      tab === 'settings' ? h(Settings, {
        data: { vehicles: vehicles, entries: entriesWithMpg, activeVehicle: activeVehicle },
        theme: theme,
        onThemeChange: setTheme,
        onClearVehicle: handleClearVehicle,
        onRemoveVehicle: handleRemoveVehicle,
        onImport: handleImport,
        onMigrate: handleMigrateLocalData
      }) : null
    ),
    h('div', { className: 'bottom-nav' }, tabs.map(tabButton)),
    showAddVehicle ? h(AddVehicleModal, { onAdd: handleAddVehicle, onClose: function(){ setShowAddVehicle(false); } }) : null
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
