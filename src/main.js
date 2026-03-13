const NOAA_ROOT = 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke';
const DEFAULT_BOUNDS = [
  [21.5, -129.5],
  [52.5, -61.0],
];

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
};

const state = {
  manifest: null,
  frame: 0,
  layer: els.layerSelect.value,
  playing: false,
  timer: null,
  opacity: Number(els.opacitySlider.value),
  overlay: null,
};

const map = L.map('map', {
  zoomControl: true,
  minZoom: 3,
  maxZoom: 10,
}).setView([39.5, -98.35], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const smokeBoundsRect = L.rectangle(DEFAULT_BOUNDS, {
  color: '#ffb347',
  weight: 1,
  fillOpacity: 0.05,
  dashArray: '6 6',
}).addTo(map);
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
}

function padFrame(frame) {
  return String(frame).padStart(3, '0');
}

function frameUrl(runtime, layer, frame) {
  return `${NOAA_ROOT}/for_web/hrrr_ncep_smoke_jet/${runtime}/full/${layer}_f${padFrame(frame)}.png`;
}

function activeFrameUrl() {
  const runtime = state.manifest?.runtime;
  if (!runtime) return null;
  return frameUrl(runtime, state.layer, state.frame);
}

function applyOverlay(url) {
  const bounds = state.manifest?.bounds || DEFAULT_BOUNDS;
  if (state.overlay) {
    state.overlay.setUrl(url);
    state.overlay.setOpacity(state.opacity);
    return;
  }

  state.overlay = L.imageOverlay(url, bounds, {
    opacity: state.opacity,
    interactive: false,
    crossOrigin: true,
    errorOverlayUrl: '',
  }).addTo(map);

  state.overlay.on('error', () => {
    setStatus('NOAA image failed to load for this frame. The runtime may be stale or NOAA may be throttling.');
  });
}

function updateMap() {
  const runtime = state.manifest?.runtime;
  if (!runtime) return;

  const url = activeFrameUrl();
  const frame = padFrame(state.frame);
  const label = state.manifest.layers?.[state.layer]?.label || state.layer;
  applyOverlay(url);
  setMapBadge(`${label} · runtime ${runtime} · F${frame}`);
  setStatus(`Showing ${label}, runtime ${runtime}, forecast F${frame}.`);
  els.frameLabel.textContent = `F${frame}`;
  els.openNoaaLink.href = url;
}

async function loadManifest() {
  setStatus('Loading NOAA manifest…');
  try {
    const response = await fetch('./latest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const manifest = await response.json();
    state.manifest = manifest;

    const bounds = manifest.bounds || DEFAULT_BOUNDS;
    smokeBoundsRect.setBounds(bounds);
    els.frameSlider.max = String(manifest.maxFrame ?? 48);
    els.runtimeMeta.textContent = `Runtime: ${manifest.runtime} · manifest source: ${manifest.runtimeSource} · generated: ${manifest.generatedAt}`;
    updateMap();
  } catch (error) {
    console.error(error);
    setStatus('Failed to load local NOAA manifest from GitHub Pages.');
    setMapBadge('Manifest load failed');
  }
}

function stopPlayback() {
  state.playing = false;
  els.playButton.textContent = 'Play';
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function startPlayback() {
  state.playing = true;
  els.playButton.textContent = 'Pause';
  const max = Number(els.frameSlider.max || 48);
  state.timer = setInterval(() => {
    state.frame = (state.frame + 1) % (max + 1);
    els.frameSlider.value = String(state.frame);
    updateMap();
  }, 1200);
}

els.layerSelect.addEventListener('change', () => {
  state.layer = els.layerSelect.value;
  updateMap();
});

els.frameSlider.addEventListener('input', () => {
  state.frame = Number(els.frameSlider.value);
  updateMap();
});

els.opacitySlider.addEventListener('input', () => {
  state.opacity = Number(els.opacitySlider.value);
  if (state.overlay) state.overlay.setOpacity(state.opacity);
});

els.playButton.addEventListener('click', () => {
  if (state.playing) stopPlayback();
  else startPlayback();
});

els.refreshButton.addEventListener('click', loadManifest);

loadManifest();
