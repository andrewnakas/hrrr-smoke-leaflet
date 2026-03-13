# hrrr-smoke-leaflet

Leaflet-based viewer for NOAA HRRR-Smoke forecast frames, deployed via GitHub Pages.

## What changed

This version caches NOAA PNG frames into the repo during GitHub Actions instead of hotlinking every frame from the browser.

That means:

- less NOAA throttling pain
- same-origin images on GitHub Pages
- the first 18 forecast hours should animate reliably on-map
- an in-page debug console is available for troubleshooting

## Local development

```bash
npm install
npm run update-manifest
npm run dev
```

## Deploy behavior

Push to `main` or wait for the hourly workflow. The workflow will:

1. fetch the latest NOAA runtime server-side
2. download cached PNGs for forecast hours 0-18 for each smoke layer
3. write `public/latest.json`
4. build and deploy to GitHub Pages

## NOAA source

- <https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/>
