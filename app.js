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
    partial: !!row.partial
  };
}

// ── STORAGE ───────────────────────────────────────────────────────────────────
const PREFS_KEY   = 'fuellog_prefs';
const CACHE_KEY   = 'fuellog_cache';
const PENDING_KEY = 'fuellog_pending';
const LEGACY_KEY  = 'fuellog_v1';

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

// ── HELPERS ──────────────────────────────────────────────────────────────────
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

// ── MPG LINE CHART ─────────────────────────────────────────────────────────────
function MpgChart(props) {
  const data = props.entries.slice()
    .filter(function(e){ return e.mpg != null; })
    .sort(function(a,b){return a.date.localeCompare(b.date);}).slice(-20);
  if (data.length < 2) return h('div', { className: 'chart-empty' }, 'Add more full fill-ups to see trend');
  const mpgs = data.map(function(e){return e.mpg;});
  const min = Math.min.apply(null, mpgs) * 0.85;
  const max = Math.max.apply(null, mpgs) * 1.1;
  const W = 600, H = 120, PL = 8, PR = 8, PT = 10, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;
  const pts = data.map(function(e, i) {
    const x = PL + (i / (data.length - 1)) * iW;
    const y = PT + iH - ((e.mpg - min) / (max - min)) * iH;
    return { x: x, y: y, e: e };
  });
  const pathD = pts.map(function(p, i){ return (i===0?'M':'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  const areaD = pathD + ' L' + pts[pts.length-1].x + ',' + (H-PB) + ' L' + pts[0].x + ',' + (H-PB) + ' Z';
  const avg = mpgs.reduce(function(a,b){return a+b;},0) / mpgs.length;
  const avgY = PT + iH - ((avg - min) / (max - min)) * iH;
  return h('div', { className: 'chart-wrap' },
    h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' },
      h('defs', null,
        h('linearGradient', { id: 'mpgGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
          h('stop', { offset: '0%', stopColor: '#f5a623', stopOpacity: '0.35' }),
          h('stop', { offset: '100%', stopColor: '#f5a623', stopOpacity: '0.02' })
        )
      ),
      h('line', { x1: PL, y1: avgY, x2: W-PR, y2: avgY, stroke: '#3ecfcf', strokeWidth: '1', strokeDasharray: '4 4', opacity: '0.5' }),
      h('path', { d: areaD, fill: 'url(#mpgGrad)' }),
      h('path', { d: pathD, fill: 'none', stroke: '#f5a623', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      pts.map(function(p, i){ return h('circle', { key: i, cx: p.x, cy: p.y, r: '3.5', fill: '#f5a623', stroke: '#0f1117', strokeWidth: '1.5' }); }),
      h('text', { x: W-PR, y: avgY - 4, textAnchor: 'end', fill: '#3ecfcf', fontSize: '10', fontFamily: 'IBM Plex Mono' }, 'avg ' + fmt(avg) + ' mpg'),
      h('text', { x: pts[0].x, y: H, textAnchor: 'middle', fill: '#4a5268', fontSize: '10', fontFamily: 'IBM Plex Mono' }, fmtDate(pts[0].e.date)),
      h('text', { x: pts[pts.length-1].x, y: H, textAnchor: 'middle', fill: '#4a5268', fontSize: '10', fontFamily: 'IBM Plex Mono' }, fmtDate(pts[pts.length-1].e.date))
    )
  );
}

// ── BAR CHART (monthly spend) ──────────────────────────────────────────────────
function BarChart(props) {
  const rows = props.rows;
  if (!rows.length) return h('div', { className: 'chart-empty' }, 'No data yet');
  const max = Math.max.apply(null, rows.map(function(r){return r.value;})) || 1;
  const W = 600, H = 130, PB = 22, PT = 8, gap = 6;
  const bw = (W - gap * (rows.length - 1)) / rows.length;
  return h('div', { className: 'chart-wrap', style: { height: 150 } },
    h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' },
      rows.map(function(r, i){
        const bh = ((H - PB - PT) * r.value) / max;
        const x = i * (bw + gap);
        const y = H - PB - bh;
        return h('g', { key: r.key },
          h('rect', { x: x, y: y, width: bw, height: Math.max(bh, 0), rx: 3, fill: '#f5a623', opacity: 0.85 }),
          h('text', { x: x + bw/2, y: y - 3, textAnchor: 'middle', fill: '#e8eaf0', fontSize: '11', fontFamily: 'IBM Plex Mono' }, '$' + Math.round(r.value)),
          h('text', { x: x + bw/2, y: H - 6, textAnchor: 'middle', fill: '#7a8299', fontSize: '10', fontFamily: 'IBM Plex Mono' }, r.label.split(' ')[0])
        );
      })
    )
  );
}

// ── ADD ENTRY FORM ────────────────────────────────────────────────────────────
function AddEntryForm(props) {
  const today = new Date().toISOString().split('T')[0];
  const blank = { date: today, tripMiles: '', totalMiles: '', gallons: '', pricePerGallon: '', fuelType: '', partial: false };
  const state = useState(blank); const f = state[0], setF = state[1];
  function set(k, v){ setF(function(prev){ var n = Object.assign({}, prev); n[k]=v; return n; }); }
  const tripMilesNum = parseFloat(f.tripMiles);
  const gallonsNum = parseFloat(f.gallons);
  const ppgNum = parseFloat(f.pricePerGallon);
  const totalPrice = (!isNaN(gallonsNum) && !isNaN(ppgNum)) ? gallonsNum * ppgNum : null;
  const previewMpg = (!f.partial && tripMilesNum > 0 && gallonsNum > 0)
    ? parseFloat((tripMilesNum / gallonsNum).toFixed(2)) : null;
  const canSave = f.date && !isNaN(tripMilesNum) && tripMilesNum > 0 && !isNaN(gallonsNum) && gallonsNum > 0;
  function handleAdd() {
    if (!canSave) return;
    const entry = {
      id: Date.now(), vehicle: props.vehicle, date: f.date,
      tripMiles: tripMilesNum, totalMiles: f.totalMiles ? parseFloat(f.totalMiles) : null,
      gallons: gallonsNum, pricePerGallon: !isNaN(ppgNum) ? ppgNum : null,
      totalPrice: totalPrice ? parseFloat(totalPrice.toFixed(2)) : null,
      fuelType: f.fuelType, partial: !!f.partial
    };
    props.onAdd(entry);
    setF(Object.assign({}, blank, { date: f.date, fuelType: f.fuelType }));
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
        h('label', null, 'Fill Type'),
        h('div', { className: 'toggle-row' },
          h('button', { type: 'button', className: 'toggle-btn' + (!f.partial ? ' active' : ''), onClick: function(){ set('partial', false); } }, 'Full'),
          h('button', { type: 'button', className: 'toggle-btn' + (f.partial ? ' active' : ''), onClick: function(){ set('partial', true); } }, 'Partial')
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
  function statCell(label, val, cls, unit) {
    return h('div', { className: 'stat-cell' },
      h('div', { className: 'stat-label' }, label),
      h('div', { className: 'stat-value ' + (cls||'') }, val),
      h('div', { className: 'stat-unit' }, unit)
    );
  }
  return h(React.Fragment, null,
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
  return h(React.Fragment, null,
    h('div', { className: 'card' },
      h('div', { className: 'card-title' }, 'Spend / Month (last 6) — ' + props.vehicle),
      h(BarChart, { rows: recentMonths })
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
    )
  );
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
function History(props) {
  const ve = props.entries.filter(function(e){return e.vehicle === props.vehicle;}).sort(function(a,b){return b.date.localeCompare(a.date);});
  return h('div', { className: 'card' },
    h('div', { className: 'card-title' }, 'All Fill-Ups — ' + props.vehicle + ' (' + ve.length + ')'),
    ve.length === 0 ? h('div', { className: 'no-data' }, 'No fill-ups logged yet') :
    h('div', { style: { overflowX: 'auto' } },
      h('table', { className: 'history-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Date'), h('th', null, 'Trip'), h('th', null, 'Odo'), h('th', null, 'Gal'),
          h('th', null, 'PPG'), h('th', null, 'Total'), h('th', null, 'Fuel'), h('th', null, 'MPG'), h('th', null, '')
        )),
        h('tbody', null, ve.map(function(e){
          return h('tr', { key: e.id },
            h('td', null, fmtDate(e.date), e.partial ? h('span', { className: 'partial-tag' }, 'P') : null),
            h('td', null, fmt(e.tripMiles, 1)),
            h('td', null, e.totalMiles ? Math.round(e.totalMiles).toLocaleString() : '—'),
            h('td', null, fmt(e.gallons, 3)),
            h('td', null, e.pricePerGallon ? '$' + fmt(e.pricePerGallon) : '—'),
            h('td', null, e.totalPrice ? '$' + fmt(e.totalPrice) : '—'),
            h('td', { style: { fontSize: 10, color: 'var(--text-muted)' } }, e.fuelType ? fuelLabel(e.fuelType) : '—'),
            h('td', { className: 'mpg-cell ' + mpgColor(e.mpg) }, e.partial ? '—' : fmt(e.mpg)),
            h('td', null, h('button', { className: 'delete-btn', onClick: function(){ props.onDelete(e.id); }, title: 'Delete' }, '×'))
          );
        }))
      )
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
  const headers = ['Date','Vehicle','Trip Miles','Total Odometer','Gallons','Price Per Gallon','Total Cost','Fuel Type','Partial Fill','MPG'];
  const rows = entries.slice().sort(function(a,b){return a.date.localeCompare(b.date);}).map(function(e){
    return [
      e.date, e.vehicle,
      e.tripMiles != null ? e.tripMiles : '',
      e.totalMiles != null ? e.totalMiles : '',
      e.gallons != null ? e.gallons : '',
      e.pricePerGallon != null ? e.pricePerGallon : '',
      e.totalPrice != null ? e.totalPrice : '',
      e.fuelType ? fuelLabel(e.fuelType) : '',
      e.partial ? 'Yes' : 'No',
      (e.partial || e.mpg == null) ? '' : e.mpg
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

// ── APP ───────────────────────────────────────────────────────────────────────
function App() {
  const [entries, setEntries] = useState(loadCache);
  const [vehicles, setVehicles] = useState(function(){ return loadPrefs().vehicles || ['My Vehicle']; });
  const [activeVehicle, setActiveVehicle] = useState(function(){ const p = loadPrefs(); return p.activeVehicle || (p.vehicles || ['My Vehicle'])[0]; });
  const [tab, setTab] = useState('dashboard');
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [syncStatus, setSyncStatus] = useState('syncing');

  // keep a ref so async callbacks always see current entries without stale closure
  const entriesRef = useRef(entries);
  useEffect(function(){ entriesRef.current = entries; }, [entries]);

  useEffect(function(){
    savePrefs({ vehicles: vehicles, activeVehicle: activeVehicle });
  }, [vehicles, activeVehicle]);

  useEffect(function(){
    loadFromSupabase();
    window.addEventListener('online', handleOnline);
    return function(){ window.removeEventListener('online', handleOnline); };
  }, []);

  function loadFromSupabase() {
    setSyncStatus('syncing');
    return sb.from('fill_ups').select('*').then(function(res){
      if (res.error) throw res.error;
      const mapped = res.data.map(fromSb);
      setEntries(mapped);
      saveCache(mapped);
      setSyncStatus('synced');
    }).catch(function(){
      setEntries(loadCache());
      setSyncStatus('offline');
    });
  }

  function handleOnline() {
    const pending = loadPending();
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

  function handleAddEntry(entry) {
    const cur = entriesRef.current;
    const newEntries = [entry].concat(cur);
    const mpg = computeMpg(newEntries)[entry.id];
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
    if (!confirm('Delete this entry?')) return;
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

  const syncDotColor = { synced: '#34d399', syncing: '#f5a623', offline: '#f05252' }[syncStatus] || '#7a8299';
  const syncLabel = { synced: 'synced', syncing: 'syncing…', offline: 'offline' }[syncStatus] || '';

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'add', label: 'Add' },
    { id: 'monthly', label: 'Monthly' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' }
  ];

  return h(React.Fragment, null,
    h('nav', null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('div', { className: 'nav-brand' }, '⛽ ', h('span', null, 'Fuel'), 'Log'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--mono)', color: syncDotColor } },
          h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: syncDotColor, display: 'inline-block', flexShrink: 0 } }),
          syncLabel
        )
      ),
      h('div', { className: 'nav-tabs' }, tabs.map(function(t){
        return h('button', { key: t.id, className: 'nav-tab' + (tab === t.id ? ' active' : ''), onClick: function(){ setTab(t.id); } }, t.label);
      }))
    ),
    h('main', null,
      h('div', { className: 'vehicle-bar' },
        vehicles.map(function(v){
          return h('div', { key: v, className: 'vehicle-chip' + (v === activeVehicle ? ' active' : ''), onClick: function(){ setActiveVehicle(v); } }, v);
        }),
        h('div', { className: 'vehicle-chip add-btn', onClick: function(){ setShowAddVehicle(true); } }, '+ Add vehicle')
      ),
      tab === 'dashboard' ? h(Dashboard, { entries: entriesWithMpg, vehicle: activeVehicle }) : null,
      tab === 'add' ? h(AddEntryForm, { vehicle: activeVehicle, onAdd: function(e){ handleAddEntry(e); setTab('dashboard'); } }) : null,
      tab === 'monthly' ? h(Monthly, { entries: entriesWithMpg, vehicle: activeVehicle }) : null,
      tab === 'history' ? h(History, { entries: entriesWithMpg, vehicle: activeVehicle, onDelete: handleDeleteEntry }) : null,
      tab === 'settings' ? h(Settings, {
        data: { vehicles: vehicles, entries: entriesWithMpg, activeVehicle: activeVehicle },
        onClearVehicle: handleClearVehicle,
        onRemoveVehicle: handleRemoveVehicle,
        onImport: handleImport,
        onMigrate: handleMigrateLocalData
      }) : null
    ),
    showAddVehicle ? h(AddVehicleModal, { onAdd: handleAddVehicle, onClose: function(){ setShowAddVehicle(false); } }) : null
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
