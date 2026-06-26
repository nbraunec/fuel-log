# Fuel Log PWA — Claude Code Prompt Template

Copy everything below the divider and paste it into Claude Code when you want to make changes.
Replace the **Requested Changes** section with your description each time.

---

## Fuel Log PWA — Change Request

### Project Context
This is a PWA fuel tracker hosted on GitHub Pages. Here is everything Claude Code needs to know before touching any file:

**Tech stack:**
- Plain `React.createElement` throughout — no JSX, no Babel, no build step. Do not introduce any.
- `index.html` loads React and Supabase via CDN, then `app.js`
- `app.js` is one IIFE containing all components and logic
- `styles.css` is a separate stylesheet
- `sw.js` is the service worker handling offline caching
- `manifest.json` and two icon PNGs complete the PWA package

**Supabase:**
- URL: `https://jhrqdgylshubhdaegyri.supabase.co`
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocnFkZ3lsc2h1YmhkYWVneXJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MjA5MzgsImV4cCI6MjA5Nzk5NjkzOH0.ZJFeJV5jGMf8lZTiojTu4YOGeWVDfMqHJJM6Q1KlqVE`
- Table: `fill_ups` with columns: `id` (bigint), `vehicle` (text), `date` (text), `trip_miles` (numeric), `total_miles` (numeric), `gallons` (numeric), `price_per_gallon` (numeric), `total_price` (numeric), `fuel_type` (text), `partial` (boolean), `mpg` (numeric), `created_at` (timestamptz)
- Supabase client is available as `window.supabase` (loaded via CDN in `index.html`)
- All reads/writes use snake_case column names; the app uses camelCase internally. Mapper functions handle conversion between the two.

**Data architecture:**
- Supabase is the primary store for all fill-up entries
- localStorage caches entries for offline use and stores app preferences (active vehicle, vehicle list) under the key `fuellog_prefs`
- MPG is never stored in React state — it is always computed dynamically by `computeMpg()` which handles partial-fill rollover logic. MPG is written to Supabase on insert for reference only.
- Partial fills accumulate their miles and gallons into the next full fill for accurate tank-to-tank MPG

**App structure — tabs:**
- Dashboard: summary stats, MPG trend line chart, recent fill-ups
- Add: entry form (date, trip miles, odometer, gallons, PPG, fuel type, full/partial toggle)
- Monthly: bar chart of spend per month + monthly detail table
- History: full fill-up log with delete
- Settings: export JSON, export CSV, import JSON, migrate localStorage → Supabase, vehicle management

**Rules — do not violate these:**
- No JSX, no build tools, no new npm dependencies in the app itself
- Do not change any UI layout, tab structure, or CSS unless the change request explicitly asks for it
- Do not change the `computeMpg()` logic unless explicitly asked
- Do not remove the offline localStorage fallback
- Always run the syntax check before committing (see Required Steps below)
- Always bump the service worker cache version (see Required Steps below)

---

### Requested Changes

> ✏️ Replace this block with your description of what you want added or changed.
> Be as specific or as vague as you like — Claude Code will ask for clarification if needed.
>
> Examples:
> - "Add an MPG by fuel type comparison table to the Monthly tab showing average MPG and cost per mile broken down by fuel grade"
> - "The delete button in History is too easy to accidentally tap on mobile — add a swipe or second-tap confirmation"
> - "Add a notes field to each fill-up for things like which station I used"
> - "Add a yearly summary card to the Dashboard showing total spend, total miles, and average MPG for the current calendar year"

---

### Required Steps on Every Change Request

Regardless of what is being changed, always do all of the following before finishing:

**1. Syntax check**
```
node -e "new Function(require('fs').readFileSync('app.js','utf8')); console.log('app.js parses ok')"
```
Do not commit if this fails. Fix any syntax errors first.

**2. Bump service worker cache version**
In `sw.js`, increment the cache version constant by one:
```javascript
// e.g. 'fuel-log-v4' → 'fuel-log-v5'
const CACHE = 'fuel-log-v5';
```
This ensures all installed PWAs on all devices fetch the updated files on next launch rather than serving stale cache.

**3. Commit and push**
```
git add .
git commit -m "[brief description of what changed]"
git push
```

**4. Summary**
After pushing, provide:
- Which files were changed and why
- What the specific code change was (show before/after for any logic changes)
- The new service worker cache version number
- Any follow-up steps needed (e.g. run SQL in Supabase, update a config value)

---

## Reference — File Structure

```
fuel-log/
├── index.html          # Entry point — loads CDN scripts, registers service worker
├── app.js              # All React components and app logic (one IIFE, no JSX)
├── styles.css          # All styling
├── manifest.json       # PWA manifest (name, icons, theme color)
├── sw.js               # Service worker — cache-first offline strategy
├── icon-192.png        # Home screen icon (192×192)
├── icon-512.png        # Home screen icon (512×512)
└── PROMPT_TEMPLATE.md  # This file
```

## Reference — Key Functions in app.js

| Function | Purpose |
|---|---|
| `loadData()` | Initial load — fetches from Supabase, falls back to localStorage |
| `saveData()` | Persists app preferences (not entries) to localStorage |
| `computeMpg(entries)` | Derives MPG for all entries with partial-fill rollover — do not store result in state |
| `migrate(data)` | Backfills new fields onto older entries for schema upgrades |
| `snakeToCamel(row)` | Maps Supabase snake_case columns to app camelCase fields on read |
| `camelToSnake(entry)` | Maps app camelCase fields to Supabase snake_case columns on write |
| `toCSV(entries)` | Generates CSV string for export |
| `downloadFile(name, content, mime)` | Triggers a file download in the browser |

## Reference — Supabase Column ↔ App Field Mapping

| Supabase column | App field |
|---|---|
| `id` | `id` |
| `vehicle` | `vehicle` |
| `date` | `date` |
| `trip_miles` | `tripMiles` |
| `total_miles` | `totalMiles` |
| `gallons` | `gallons` |
| `price_per_gallon` | `pricePerGallon` |
| `total_price` | `totalPrice` |
| `fuel_type` | `fuelType` |
| `partial` | `partial` |
| `mpg` | `mpg` (write-only to Supabase; always recomputed in app) |
| `created_at` | (not used in app) |

## Reference — Deployment Notes

- Hosted on **GitHub Pages** from the `main` branch root
- GitHub Pages rebuilds ~1–2 minutes after every push
- Installed PWA on phone updates on next launch after push, provided `sw.js` cache version was bumped
- To force an immediate update on phone: fully quit the app (swipe away) and relaunch
- Nuclear reset if phone won't update: delete the home screen icon and re-add from Safari
