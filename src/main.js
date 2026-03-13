const NOAA_ROOT = 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke';
const NOAA_INDEX = `${NOAA_ROOT}/`;

const layerLabels = {
  trc1_full_sfc: 'Near-surface smoke',
  trc1_full_1000ft: '1000 ft AGL smoke',
  trc1_full_6000ft: '6000 ft AGL smoke',
  trc1_full_int: 'Vertically integrated smoke',
  mfrp_full_sfc: 'Fire radiative power',
  hpbl_full_sfc: 'PBL height',
};

const els = {
  layerSelect: document.querySelector('#layerSelect'),
  frameSlider: document.querySelector('#frameSlider'),
  frameLabel: document.querySelector('#frameLabel'),
  playButton: document.querySelector('#playButton'),
  refreshButton: document.querySelector('#refreshButton'),
  runtimeInput: document.querySelector('#runtimeInput'),
  openNoaaLink: document.querySelector('#openNoaaLink'),
  statusBox: document.querySelector('#statusBox'),
  viewerTitle: document.querySelector('#viewerTitle'),
  viewerMeta: document.querySelector('#viewerMeta'),
  forecastFrame: document.querySelector('#forecastFrame'),
};

const state = {
  runtime: '',
  frame: 0,
  layer: els.layerSelect.value,
  playing: false,
  timer: null,
};

const map = L.map('map', {
  zoomControl: true,
  minZoom: 3,
  maxZoom: 10,
}).setView([39.5, -98.35], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const smokeBounds = [
  [21.5, -129.5],
  [52.5, -61.0],
];
L.rectangle(smokeBounds, {
  color: '#ffb347',
  weight: 1,
  fillOpacity: 0.05,
  dashArray: '6 6',
}).addTo(map).bindTooltip('Approximate HRRR-Smoke full-domain extent');

function setStatus(text) {
  els.statusBox.textContent = text;
}

function padFrame(frame) {
  return String(frame).padStart(3, '0');
}

function buildFrameUrl(runtime, layer, frame) {
  const params = new URLSearchParams({
    keys: 'hrrr_ncep_smoke_jet:',
    runtime,
    plot_type: layer,
    fcst: padFrame(frame),
    time_inc: '60',
    num_times: '49',
    model: 'hrrr',
    ptitle: 'HRRR-Smoke Graphics',
    maxFcstLen: '48',
    fcstStrLen: '-1',
    domain: 'full:hrrr',
    adtfn: '1',
  });
  return `${NOAA_ROOT}/displayMapUpdated.cgi?${params.toString()}`;
}

function updateViewer() {
  const label = layerLabels[state.layer] || state.layer;
  const frame = padFrame(state.frame);
  els.frameLabel.textContent = `F${frame}`;
  els.viewerTitle.textContent = label;
  els.viewerMeta.textContent = `Runtime ${state.runtime || '—'} / Forecast F${frame}`;
  const url = buildFrameUrl(state.runtime, state.layer, state.frame);
  els.forecastFrame.src = url;
  els.openNoaaLink.href = url;
}

async function fetchLatestRuntime() {
  setStatus('Fetching latest runtime from NOAA…');
  try {
    const response = await fetch(NOAA_INDEX);
    const html = await response.text();
    const match = html.match(/runtime=(\d{10})/);
    if (!match) throw new Error('Could not find runtime on NOAA page');
    state.runtime = match[1];
    els.runtimeInput.value = state.runtime;
    setStatus(`Loaded NOAA runtime ${state.runtime}.`);
    updateViewer();
  } catch (error) {
    console.error(error);
    setStatus('Could not fetch NOAA runtime directly from the browser. Paste a runtime manually, then the viewer still works.');
    if (!state.runtime) {
      const fallback = new Date();
      const yyyy = fallback.getUTCFullYear();
      const mm = String(fallback.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(fallback.getUTCDate()).padStart(2, '0');
      const hh = String(fallback.getUTCHours()).padStart(2, '0');
      state.runtime = `${yyyy}${mm}${dd}${hh}`;
      els.runtimeInput.value = state.runtime;
      updateViewer();
    }
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
  state.timer = setInterval(() => {
    state.frame = (state.frame + 1) % 49;
    els.frameSlider.value = String(state.frame);
    updateViewer();
  }, 1200);
}

els.layerSelect.addEventListener('change', () => {
  state.layer = els.layerSelect.value;
  updateViewer();
});

els.frameSlider.addEventListener('input', () => {
  state.frame = Number(els.frameSlider.value);
  updateViewer();
});

els.playButton.addEventListener('click', () => {
  if (state.playing) stopPlayback();
  else startPlayback();
});

els.refreshButton.addEventListener('click', fetchLatestRuntime);

els.runtimeInput.addEventListener('change', () => {
  const value = els.runtimeInput.value.trim();
  if (/^\d{10}$/.test(value)) {
    state.runtime = value;
    setStatus(`Using manual runtime ${value}.`);
    updateViewer();
  } else {
    setStatus('Runtime must be 10 digits: YYYYMMDDHH');
    els.runtimeInput.value = state.runtime;
  }
});

updateViewer();
fetchLatestRuntime();
