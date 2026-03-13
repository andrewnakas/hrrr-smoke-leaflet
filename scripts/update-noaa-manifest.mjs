import fs from 'node:fs/promises';
import path from 'node:path';

const NOAA_INDEX = 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/';
const PUBLIC_DIR = new URL('../public/', import.meta.url);
const OUT_PATH = new URL('../public/latest.json', import.meta.url);
const CACHE_DIR = new URL('../public/cache/', import.meta.url);
const FALLBACK_RUNTIME = '2026031223';
const MAX_FRAME = 18;
const layers = {
  trc1_full_sfc: 'Near-surface smoke',
  trc1_full_1000ft: '1000 ft AGL smoke',
  trc1_full_6000ft: '6000 ft AGL smoke',
  trc1_full_int: 'Vertically integrated smoke',
};

async function fetchWithTimeout(url, ms = 30000, binary = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Claw/1.0 (+GitHub Actions)' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function shiftHour(runtime, deltaHours) {
  const y = Number(runtime.slice(0, 4));
  const m = Number(runtime.slice(4, 6)) - 1;
  const d = Number(runtime.slice(6, 8));
  const h = Number(runtime.slice(8, 10));
  const dt = new Date(Date.UTC(y, m, d, h));
  dt.setUTCHours(dt.getUTCHours() + deltaHours);
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
    String(dt.getUTCHours()).padStart(2, '0'),
  ].join('');
}

async function fetchLoopPaths(runtime, layer) {
  const params = new URLSearchParams({
    dsKeys: 'hrrr_ncep_smoke_jet:',
    runTime: runtime,
    plotName: layer,
    fcstInc: '60',
    numFcsts: String(MAX_FRAME + 1),
    model: 'hrrr',
    ptitle: 'HRRR-Smoke Graphics',
    maxFcstLen: String(MAX_FRAME),
    fcstStrLen: '-1',
    domain: 'full:hrrr',
    adtfn: '1',
    resizePlot: '1',
  });
  const url = `${NOAA_INDEX}jsloopUpdated.cgi?${params.toString()}`;
  const html = await fetchWithTimeout(url, 15000);
  const match = html.match(/globalTemp = \[(.*?)\];/s);
  if (!match) return [];
  return Array.from(match[1].matchAll(/'([^']+\.png)'/g), (m) => `https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/${m[1]}`);
}

async function resolveRuntime() {
  let seedRuntime = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const html = await fetchWithTimeout(NOAA_INDEX, 30000);
      const match = html.match(/runtime=(\d{10})/);
      if (match) {
        seedRuntime = match[1];
        break;
      }
    } catch (error) {
      console.error(`Runtime attempt ${attempt} failed:`, error.message);
    }
  }

  const candidates = [];
  if (seedRuntime) {
    for (let i = 0; i < 18; i += 1) candidates.push(shiftHour(seedRuntime, -i));
  }
  for (const fallback of [FALLBACK_RUNTIME]) {
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }

  for (const runtime of candidates) {
    try {
      const paths = await fetchLoopPaths(runtime, 'trc1_full_sfc');
      if (paths.length >= 4) return { runtime, source: runtime === seedRuntime ? 'live-validated' : 'fallback-validated' };
    } catch (error) {
      console.error(`Runtime validation failed for ${runtime}:`, error.message);
    }
  }

  try {
    const previous = JSON.parse(await fs.readFile(OUT_PATH, 'utf8'));
    if (previous.runtime) return { runtime: previous.runtime, source: 'previous-manifest' };
  } catch {}

  return { runtime: FALLBACK_RUNTIME, source: 'fallback' };
}

function remoteFrameUrl(runtime, layer, frame) {
  const f = String(frame).padStart(3, '0');
  return `https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/for_web/hrrr_ncep_smoke_jet/${runtime}/full/${layer}_f${f}.png`;
}

function localFramePath(runtime, layer, frame) {
  const f = String(frame).padStart(3, '0');
  return `./cache/${runtime}/${layer}/f${f}.png`;
}

async function ensureDir(dirUrl) {
  await fs.mkdir(dirUrl, { recursive: true });
}

async function clearOldCache(keepRuntime) {
  await ensureDir(CACHE_DIR);
  const entries = await fs.readdir(CACHE_DIR, { withFileTypes: true });
  await Promise.all(entries.filter((e) => e.isDirectory() && e.name !== keepRuntime).map((e) => fs.rm(new URL(`./${e.name}/`, CACHE_DIR), { recursive: true, force: true })));
}

async function fileExists(url) {
  try {
    await fs.access(url);
    return true;
  } catch {
    return false;
  }
}

async function cacheFrame(runtime, layer, frame, logs, remoteUrlOverride = null) {
  const remoteUrl = remoteUrlOverride || remoteFrameUrl(runtime, layer, frame);
  const relativePath = localFramePath(runtime, layer, frame);
  const dest = new URL(relativePath.replace('./', ''), PUBLIC_DIR);
  await ensureDir(new URL(`./cache/${runtime}/${layer}/`, PUBLIC_DIR));

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const data = await fetchWithTimeout(remoteUrl, 12000, true);
      await fs.writeFile(dest, data);
      logs.push(`cached ${layer} F${String(frame).padStart(3, '0')}`);
      return { frame, url: relativePath, remoteUrl, cached: true };
    } catch (error) {
      logs.push(`failed ${layer} F${String(frame).padStart(3, '0')} attempt ${attempt}: ${error.message}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 700));
    }
  }

  if (await fileExists(dest)) {
    logs.push(`reused stale cache ${layer} F${String(frame).padStart(3, '0')}`);
    return { frame, url: relativePath, remoteUrl, cached: true, stale: true };
  }

  return { frame, url: relativePath, remoteUrl, cached: false };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function runner() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

const { runtime, source } = await resolveRuntime();
await clearOldCache(runtime);
const logs = [`runtime ${runtime} (${source})`];

const manifestLayers = {};
for (const [key, label] of Object.entries(layers)) {
  let loopPaths = [];
  try {
    loopPaths = await fetchLoopPaths(runtime, key);
    logs.push(`loop paths ${key}: ${loopPaths.length}`);
  } catch (error) {
    logs.push(`loop fetch failed ${key}: ${error.message}`);
  }

  const frames = await mapLimit(Array.from({ length: MAX_FRAME + 1 }, (_, i) => i), 6, (frame) => cacheFrame(runtime, key, frame, logs, loopPaths[frame] || null));
  frames.sort((a, b) => a.frame - b.frame);
  manifestLayers[key] = {
    label,
    frames,
    availableFrames: frames.filter((f) => f.cached).map((f) => f.frame),
  };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  runtime,
  runtimeSource: source,
  bounds: [[21.5, -129.5], [52.5, -61.0]],
  maxFrame: MAX_FRAME,
  logs,
  layers: manifestLayers,
};

await fs.writeFile(OUT_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${path.resolve(new URL(OUT_PATH).pathname)} with runtime ${runtime} (${source}).`);
console.log(logs.join('\n'));
