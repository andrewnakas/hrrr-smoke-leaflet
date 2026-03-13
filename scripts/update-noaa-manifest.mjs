import fs from 'node:fs/promises';

const NOAA_INDEX = 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/';
const OUT_PATH = new URL('../public/latest.json', import.meta.url);
const FALLBACK_RUNTIME = '2026031223';
const layers = {
  trc1_full_sfc: 'Near-surface smoke',
  trc1_full_1000ft: '1000 ft AGL smoke',
  trc1_full_6000ft: '6000 ft AGL smoke',
  trc1_full_int: 'Vertically integrated smoke',
  mfrp_full_sfc: 'Fire radiative power',
  hpbl_full_sfc: 'PBL height',
};

async function fetchWithTimeout(url, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Claw/1.0 (+GitHub Actions)' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveRuntime() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const html = await fetchWithTimeout(NOAA_INDEX, 30000);
      const match = html.match(/runtime=(\d{10})/);
      if (match) return { runtime: match[1], source: 'live' };
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
    }
  }

  try {
    const previous = JSON.parse(await fs.readFile(OUT_PATH, 'utf8'));
    if (previous.runtime) return { runtime: previous.runtime, source: 'previous-manifest' };
  } catch {}

  return { runtime: FALLBACK_RUNTIME, source: 'fallback' };
}

function frameUrl(runtime, layer, frame) {
  const f = String(frame).padStart(3, '0');
  return `https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/for_web/hrrr_ncep_smoke_jet/${runtime}/full/${layer}_f${f}.png`;
}

const { runtime, source } = await resolveRuntime();
const manifest = {
  generatedAt: new Date().toISOString(),
  runtime,
  runtimeSource: source,
  bounds: [[21.5, -129.5], [52.5, -61.0]],
  maxFrame: 48,
  layers: Object.fromEntries(
    Object.entries(layers).map(([key, label]) => [
      key,
      {
        label,
        frames: Array.from({ length: 49 }, (_, i) => ({
          frame: i,
          url: frameUrl(runtime, key, i),
        })),
      },
    ]),
  ),
};

await fs.writeFile(OUT_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${new URL(OUT_PATH).pathname} with runtime ${runtime} (${source}).`);
