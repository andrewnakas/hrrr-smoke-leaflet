# hrrr-smoke-leaflet

Leaflet-based viewer for HRRR smoke, deployed via GitHub Pages.

## Current architecture

This version is moving off NOAA screenshot graphics and onto **public AWS HRRR Zarr raw data**.

Pipeline:

1. GitHub Actions opens public HRRR Zarr from `hrrrzarr`
2. reads smoke fields:
   - `8m_above_ground/MASSDEN` (near-surface smoke)
   - `entire_atmosphere_single_layer/COLMD` (vertically integrated smoke)
3. reprojects them to EPSG:4326
4. writes transparent PNG overlays into `public/cache-raw`
5. deploys to GitHub Pages

## Local development

```bash
npm install
python3 -m pip install -r requirements-pipeline.txt
npm run render-raw-smoke
npm run dev
```

## Notes

- Source archive: public AWS HRRR Zarr (`hrrrzarr`)
- This avoids the warped NOAA baked graphics problem.
- The app loads locally generated overlays, not screenshot maps.
