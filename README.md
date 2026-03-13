# hrrr-smoke-leaflet

Leaflet-based viewer for NOAA HRRR-Smoke forecast frames, intended for GitHub Pages deployment.

## Features

- interactive Leaflet base map
- latest NOAA runtime fetch attempt from the HRRR-Smoke page
- selectable smoke layers
- forecast-hour slider and autoplay
- GitHub Pages workflow included

## Local development

```bash
npm install
npm run dev
```

## Deploy on GitHub Pages

1. Create a GitHub repo and push this folder to its `main` branch.
2. In the GitHub repo settings, enable **Pages** and select **GitHub Actions** as the source.
3. Pushes to `main` will deploy automatically via `.github/workflows/deploy.yml`.

## NOAA source

- <https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/>

## Caveat

NOAA’s public HRRR-Smoke site is not exposed here as a clean CORS-friendly Leaflet tile service, so this app builds and animates forecast frame viewer URLs from NOAA’s published page structure.
