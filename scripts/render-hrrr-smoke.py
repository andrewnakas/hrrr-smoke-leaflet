#!/usr/bin/env python3
import json
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
import s3fs
import xarray as xr
import zarr
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.transform import from_origin
from rasterio.warp import calculate_default_transform, reproject, Resampling

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
OUT = PUBLIC / 'latest.json'
CACHE = PUBLIC / 'cache-raw'

PROJ4 = '+proj=lcc +a=6371200.0 +b=6371200.0 +lon_0=262.5 +lat_0=38.5 +lat_1=38.5 +lat_2=38.5'
NX = 1799
NY = 1059
DX = 3000.0
DY = 3000.0
FIRST_LON = -122.719528
FIRST_LAT = 21.138123
MAX_FRAME = 18
LAYERS = {
    'trc1_full_sfc': {
        'label': 'Near-surface smoke',
        'level': '8m_above_ground',
        'variable': 'MASSDEN',
        'units': 'kg/m^3',
        'scale_max': 250e-9,
    },
    'trc1_full_int': {
        'label': 'Vertically integrated smoke',
        'level': 'entire_atmosphere_single_layer',
        'variable': 'COLMD',
        'units': 'kg/m^2',
        'scale_max': 0.6,
    },
}


def latest_cycle_utc(now=None):
    now = now or datetime.now(timezone.utc)
    cycle_hour = (now.hour // 6) * 6
    dt = now.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)
    return dt


def cycle_candidates():
    dt = latest_cycle_utc()
    for step in range(0, 36, 6):
        cand = dt.timestamp() - step * 3600
        yield datetime.fromtimestamp(cand, tz=timezone.utc)


def open_dataset(run_dt, layer):
    ymd = run_dt.strftime('%Y%m%d')
    hh = run_dt.strftime('%H')
    store = f"s3://hrrrzarr/sfc/{ymd}/{ymd}_{hh}z_fcst.zarr"
    group = f"{layer['level']}/{layer['variable']}"
    fs = s3fs.S3FileSystem(anon=True)
    mapper = fs.get_mapper(store)
    zg = zarr.open_group(mapper, mode='r', path=group)

    data_key = f"{layer['level']}/{layer['variable']}"
    if data_key not in zg:
        raise RuntimeError(f'data array {data_key} not found in {store} group {group}; keys={list(zg.array_keys())}')

    data = zg[data_key]
    time = np.asarray(zg['time'])
    x = np.asarray(zg['projection_x_coordinate'])
    y = np.asarray(zg['projection_y_coordinate'])

    if data.shape[0] < MAX_FRAME:
        raise RuntimeError(f'insufficient time dimension in {store} group {group}')

    var = xr.DataArray(
        data,
        dims=('time', 'projection_y_coordinate', 'projection_x_coordinate'),
        coords={
            'time': time,
            'projection_x_coordinate': x,
            'projection_y_coordinate': y,
        },
        name=layer['variable'],
    )
    return f"{store}::{group}", None, var


def build_source_transform():
    src_crs = CRS.from_proj4(PROJ4)
    to_proj = Transformer.from_crs('EPSG:4326', src_crs, always_xy=True)
    x0, y0 = to_proj.transform(FIRST_LON, FIRST_LAT)
    return src_crs, from_origin(x0 - DX / 2.0, y0 + DY / 2.0, DX, DY)


def smoke_rgba(data, scale_max):
    arr = np.nan_to_num(data.astype('float64'), nan=0.0, posinf=0.0, neginf=0.0)
    arr[arr < 0] = 0
    if scale_max <= 0:
        scale_max = float(np.nanpercentile(arr, 99)) or 1.0
    norm = np.clip(arr / scale_max, 0, 1)
    alpha = np.clip(np.power(norm, 0.65) * 255, 0, 255).astype('uint8')
    r = np.interp(norm, [0, 0.1, 0.25, 0.5, 0.75, 1.0], [0, 150, 201, 236, 200, 93]).astype('uint8')
    g = np.interp(norm, [0, 0.1, 0.25, 0.5, 0.75, 1.0], [0, 150, 201, 186, 93, 33]).astype('uint8')
    b = np.interp(norm, [0, 0.1, 0.25, 0.5, 0.75, 1.0], [0, 150, 201, 79, 30, 4]).astype('uint8')
    rgba = np.dstack([r, g, b, alpha])
    rgba[alpha == 0] = 0
    return rgba


def warp_rgba(rgba, src_transform, src_crs):
    height, width = rgba.shape[:2]
    left, bottom, right, top = rasterio.transform.array_bounds(height, width, src_transform)
    dst_transform, dst_width, dst_height = calculate_default_transform(
        src_crs, 'EPSG:4326', width, height, left, bottom, right, top, resolution=0.05
    )
    dst = np.zeros((4, dst_height, dst_width), dtype='uint8')
    for band in range(4):
        reproject(
            source=rgba[:, :, band],
            destination=dst[band],
            src_transform=src_transform,
            src_crs=src_crs,
            dst_transform=dst_transform,
            dst_crs='EPSG:4326',
            resampling=Resampling.bilinear,
            src_nodata=0,
            dst_nodata=0,
        )
    bounds = rasterio.transform.array_bounds(dst_height, dst_width, dst_transform)
    # array_bounds returns left,bottom,right,top
    leaflet_bounds = [[bounds[1], bounds[0]], [bounds[3], bounds[2]]]
    return np.moveaxis(dst, 0, -1), leaflet_bounds


def save_png(rgba, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode='RGBA').save(path)


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    src_crs, src_transform = build_source_transform()

    chosen_run = None
    sources = {}
    startup_logs = []
    for run_dt in cycle_candidates():
        try:
            startup_logs.append(f"trying runtime {run_dt.strftime('%Y%m%d%H')}")
            for key, layer in LAYERS.items():
                store, ds, var = open_dataset(run_dt, layer)
                sources[key] = {'store': store, 'dataset': ds, 'var': var}
                startup_logs.append(f"opened {key} from {store}")
            chosen_run = run_dt
            break
        except Exception as e:
            startup_logs.append(f"failed runtime {run_dt.strftime('%Y%m%d%H')}: {e}")
            sources = {}
            continue

    if chosen_run is None:
        raise SystemExit('Could not open any recent HRRR smoke zarr run\n' + '\n'.join(startup_logs))

    runtime = chosen_run.strftime('%Y%m%d%H')
    runtime_cache = CACHE / runtime
    if runtime_cache.exists():
        pass
    else:
        runtime_cache.mkdir(parents=True, exist_ok=True)
    for old in CACHE.iterdir():
        if old.is_dir() and old.name != runtime:
            shutil.rmtree(old, ignore_errors=True)

    manifest = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'runtime': runtime,
        'runtimeSource': 'aws-hrrrzarr',
        'maxFrame': MAX_FRAME - 1,
        'bounds': None,
        'logs': startup_logs + [f'using runtime {runtime} from public AWS HRRR Zarr'],
        'layers': {},
    }

    for key, layer in LAYERS.items():
        ds = sources[key]['dataset']
        var = sources[key]['var']
        layer_cache = runtime_cache / key
        layer_cache.mkdir(parents=True, exist_ok=True)
        frames = []
        available = []
        layer_bounds = None
        for frame in range(MAX_FRAME):
            try:
                data = var.isel(time=frame).values
                rgba = smoke_rgba(data, layer['scale_max'])
                warped, layer_bounds = warp_rgba(rgba, src_transform, src_crs)
                rel = f'./cache-raw/{runtime}/{key}/f{frame:03d}.png'
                save_png(warped, PUBLIC / rel.replace('./', ''))
                frames.append({'frame': frame, 'url': rel, 'cached': True})
                available.append(frame)
            except Exception as e:
                frames.append({'frame': frame, 'url': None, 'cached': False, 'error': str(e)})
                manifest['logs'].append(f'failed {key} F{frame:03d}: {e}')
        manifest['layers'][key] = {
            'label': layer['label'],
            'units': layer['units'],
            'frames': frames,
            'availableFrames': available,
            'store': sources[key]['store'],
        }
        if layer_bounds is not None and manifest['bounds'] is None:
            manifest['bounds'] = layer_bounds

    OUT.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Wrote {OUT} for runtime {runtime}')


if __name__ == '__main__':
    main()
