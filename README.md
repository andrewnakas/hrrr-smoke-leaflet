# hrrr-smoke-leaflet

Leaflet-based viewer for NOAA HRRR-Smoke forecast frames, deployed via GitHub Pages.

## Features

- interactive Leaflet base map
- NOAA smoke PNG frames overlaid directly on the map
- selectable smoke layers
- forecast-hour slider and autoplay
- scheduled manifest refresh via GitHub Actions

## Local development

```bash
npm install
npm run update-manifest
npm run dev
```

## Deploy on GitHub Pages

Push to `main`. The workflow will:

1. fetch the latest NOAA runtime server-side
2. write `public/latest.json`
3. build the site
4. deploy to GitHub Pages

It also refreshes hourly on a GitHub Actions cron.

## NOAA source

- <https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/>

## Why this architecture

GitHub Pages cannot reliably scrape NOAA live from the browser because NOAA does not expose the needed data with browser-friendly CORS behavior. So the app uses a same-origin manifest generated in GitHub Actions, then loads NOAA frame PNGs directly onto the map.
