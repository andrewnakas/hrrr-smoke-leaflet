const DEFAULT_BOUNDS = [[21.5, -129.5], [52.5, -61.0]];

const els = {
  layerSelect: document.querySelector('#layerSelect'),
  frameSlider: document.querySelector('#frameSlider'),
  frameLabel: document.querySelector('#frameLabel'),
  playButton: document.querySelector('#playButton'),
  refreshButton: document.querySelector('#refreshButton'),
  opacitySlider: document.querySelector('#opacitySlider'),
  openNoaaLink: document.querySelector('#openNoaaLink'),
  statusBox: document.querySelector('#statusBox'),
  runtimeMeta: document.querySelector('#runtimeMeta'),
  debugConsole: document.querySelector('#debugConsole'),
  copyConsoleButton: document.querySelector('#copyConsoleButton'),
  clearConsoleButton: document.querySelector('#clearConsoleButton'),
};

const state = {
  manifest: null,
  frame: 0,
  layer: els.layerSelect.value,
  playing: false,
  timer: null,
  opacity: Number(els.opacitySlider.value),
  overlay: null,
  logLines: [],
};

function log(message, extra) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`;
  state.logLines.push(line);
  if (state.logLines.length > 300) state.logLines.shift();
  els.debugConsole.textContent = state.logLines.join('\n');
  els.debugConsole.scrollTop = els.debugConsole.scrollHeight;
  console.log(message, extra || '');
}

const map = L.map('map', { zoomControl: true, minZoom: 3, maxZoom: 10 }).setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

const smokeBoundsRect = L.rectangle(DEFAULT_BOUNDS, { color: '#ffb347', weight: 1, fillOpacity: 0.05, dashArray: '6 6' }).addTo(map);
smokeBoundsRect.bindTooltip('Approximate HRRR-Smoke full-domain extent');

const metaControl = L.control({ position: 'topright' });
metaControl.onAdd = () => {
  const div = L.DomUtil.create('div', 'map-badge');
  div.id = 'mapBadge';
  div.textContent = 'Loading NOAA smoke…';
  return div;
};
metaControl.addTo(map);

function setMapBadge(text) {
  const badge = document.querySelector('#mapBadge');
  if (badge) badge.textContent = text;
}

function setStatus(text) {
  els.statusBox.textContent = text;
  log(`status: ${text}`);
}

function padFrame(frame) {
  return String(frame).padStart(3, '0');
}

function getLayerData() {
  return state.manifest?.layers?.[state.layer] || null;
}

function getFrameRecord() {
  const layer = getLayerData();
  return layer?.frames?.find((f) => f.frame === state.frame) || null;
}

function currentLocalUrl() {
  return getFrameRecord()?.url || null;
}

function applyOverlay(url) {
  const bounds = state.manifest?.bounds || DEFAULT_BOUNDS;
  if (state.overlay) {
    state.overlay.setBounds(bounds);
    state.overlay.setUrl(url);
    state.overlay.setOpacity(state.opacity);
    return;
  }

  state.overlay = L.imageOverlay(url, bounds, { opacity: state.opacity, interactive: false }).addTo(map);
  state.overlay.on('load', () => {
    log('overlay loaded', { layer: state.layer, frame: state.frame, url: currentLocalUrl() });
  });
  state.overlay.on('error', () => {
    const record = getFrameRecord();
    log('overlay error', record || { layer: state.layer, frame: state.frame });
    setStatus(`Cached image missing for ${state.layer} F${padFrame(state.frame)}.`);
  });
}

function nearestAvailableFrame(requested) {
  const layer = getLayerData();
  const available = layer?.availableFrames || [];
  if (available.includes(requested)) return requested;
  const next = available.find((f) => f >= requested);
  if (next != null) return next;
  return available[available.length - 1] ?? 0;
}

function updateMap() {
  if (!state.manifest) return;
  const adjusted = nearestAvailableFrame(state.frame);
  if (adjusted !== state.frame) {
    log('adjusted frame to available cache', { requested: state.frame, adjusted });
    state.frame = adjusted;
    els.frameSlider.value = String(adjusted);
  }

  const frame = padFrame(state.frame);
  const layer = getLayerData();
  const label = layer?.label || state.layer;
  const record = getFrameRecord();
  if (!record?.url) {
    setStatus(`No cached frame available for ${label} F${frame}.`);
    return;
  }

  applyOverlay(record.url);
  setMapBadge(`${label} · runtime ${state.manifest.runtime} · F${frame}`);
  els.frameLabel.textContent = `F${frame}`;
  els.openNoaaLink.href = record.remoteUrl || 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/';
  setStatus(`Showing ${label}, runtime ${state.manifest.runtime}, forecast F${frame}.`);
}

async function loadManifest() {
  setStatus('Loading NOAA manifest…');
  try {
    const response = await fetch(`./latest.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const manifest = await response.json();
    state.manifest = manifest;
    const bounds = manifest.bounds || DEFAULT_BOUNDS;
    smokeBoundsRect.setBounds(bounds);
    els.frameSlider.max = String(manifest.maxFrame ?? 18);
    els.runtimeMeta.textContent = `Runtime: ${manifest.runtime} · source: ${manifest.runtimeSource} · generated: ${manifest.generatedAt}`;
    log('manifest loaded', { runtime: manifest.runtime, source: manifest.runtimeSource, maxFrame: manifest.maxFrame, logs: manifest.logs?.slice(-8) });
    updateMap();
  } catch (error) {
    log('manifest load failed', { message: error.message });
    setStatus('Failed to load local NOAA manifest from GitHub Pages.');
    setMapBadge('Manifest load failed');
  }
}

function stopPlayback() {
  state.playing = false;
  els.playButton.textContent = 'Play';
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  log('playback stopped');
}

function startPlayback() {
  state.playing = true;
  els.playButton.textContent = 'Pause';
  const max = Number(els.frameSlider.max || 18);
  log('playback started', { max });
  state.timer = setInterval(() => {
    state.frame = (state.frame + 1) % (max + 1);
    els.frameSlider.value = String(state.frame);
    updateMap();
  }, 1200);
}

els.layerSelect.addEventListener('change', () => {
  state.layer = els.layerSelect.value;
  log('layer changed', { layer: state.layer });
  updateMap();
});

els.frameSlider.addEventListener('input', () => {
  state.frame = Number(els.frameSlider.value);
  log('frame changed', { frame: state.frame });
  updateMap();
});

els.opacitySlider.addEventListener('input', () => {
  state.opacity = Number(els.opacitySlider.value);
  if (state.overlay) state.overlay.setOpacity(state.opacity);
  log('opacity changed', { opacity: state.opacity });
});

els.playButton.addEventListener('click', () => {
  if (state.playing) stopPlayback();
  else startPlayback();
});

els.refreshButton.addEventListener('click', () => {
  log('manual manifest reload');
  loadManifest();
});

els.copyConsoleButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.debugConsole.textContent || '');
    log('console copied');
  } catch (error) {
    log('console copy failed', { message: error.message });
  }
});

els.clearConsoleButton.addEventListener('click', () => {
  state.logLines = [];
  els.debugConsole.textContent = '';
  log('console cleared');
});

loadManifest();
