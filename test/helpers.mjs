import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { TileStore } from '../src/tiles.js';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const tilesDir = path.join(root, 'assets', 'tiles');
export const manifest = JSON.parse(fs.readFileSync(path.join(tilesDir, 'manifest.json'), 'utf8'));

export function fsStore(options) {
  const fetchJson = async (layer, name) =>
    JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(tilesDir, layer, name + '.json.gz'))).toString('utf8'));
  return new TileStore(structuredClone(manifest), fetchJson, options);
}

/** 앱이 쓰는 것과 같은 조회 범위: 반경 + 지도 여백. */
export function viewBox(lat, lon, radiusM) {
  const dLat = (radiusM / 111320) * 1.3, dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}
