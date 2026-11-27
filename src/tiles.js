// 격자 타일 선택·해독·캐시. tools/build_tiles.py가 만든 형식을 읽는다.
import { bboxOf } from './geo.js';

const SCALE = 1e6;

/** bbox([서,남,동,북] 도)가 걸치는 타일 중 실제로 존재하는 타일 이름 목록. */
export function neededTiles(manifest, layer, bbox) {
  const cell = manifest.cell[layer];
  const exists = (manifest._sets ||= {})[layer] ||= new Set(manifest.tiles[layer]);
  const ix0 = Math.floor(Math.round(bbox[0] * SCALE) / cell), ix1 = Math.floor(Math.round(bbox[2] * SCALE) / cell);
  const iy0 = Math.floor(Math.round(bbox[1] * SCALE) / cell), iy1 = Math.floor(Math.round(bbox[3] * SCALE) / cell);
  const names = [];
  for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) if (exists.has(ix + '_' + iy)) names.push(ix + '_' + iy);
  return names;
}

/** 차분 부호화된 평탄 배열 → 정수 좌표 [X0,Y0,X1,Y1,...] (마이크로도). */
export function undelta(flat) {
  const out = new Array(flat.length);
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x = i ? x + flat[i] : flat[i];
    y = i ? y + flat[i + 1] : flat[i + 1];
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

const toDegrees = ints => Float64Array.from(ints, v => v / SCALE);

function ringOf(ints, window) {
  const xy = toDegrees(ints);
  let art = null;
  if (window) {
    // 타일 창 경계 위에 놓인 변은 클리핑으로 생긴 인위적 변이다. 거리 계산에서 제외한다.
    const [x0, y0, x1, y1] = window;
    const n = ints.length / 2;
    art = new Uint8Array(Math.max(0, n - 1));
    for (let i = 1; i < n; i++) {
      const ax = ints[2 * i - 2], ay = ints[2 * i - 1], bx = ints[2 * i], by = ints[2 * i + 1];
      if ((ax === x0 && bx === x0) || (ax === x1 && bx === x1) || (ay === y0 && by === y0) || (ay === y1 && by === y1)) art[i - 1] = 1;
    }
  }
  return { xy, art };
}

function polygonsOf(list, window) {
  return list.map(rings => rings.map(flat => ringOf(undelta(flat), window)));
}

function polygonBox(polys) {
  const boxes = polys.map(rings => bboxOf(rings[0].xy));
  return [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
}

export function decodeRivers(raw, name, manifest) {
  const [ix, iy] = name.split('_').map(Number), cell = manifest.cell.rivers, m = manifest.margin;
  const window = [ix * cell - m, iy * cell - m, (ix + 1) * cell + m, (iy + 1) * cell + m];
  return raw.map(item => {
    const polys = polygonsOf(item.p, window);
    return { kind: 'river', code: item.c, name: item.n, grade: item.g, polys, bbox: polygonBox(polys) };
  });
}

export function decodeLakes(raw) {
  return raw.map(item => {
    const polys = polygonsOf(item.p, null);
    return { kind: 'lake', id: item.i, name: item.n, polys, bbox: polygonBox(polys) };
  });
}

export function decodeRoads(raw) {
  return raw.map(([type, numbers, flat]) => {
    const xy = toDegrees(undelta(flat));
    return { kind: type === 2 ? '국도' : type === 3 ? '지방도' : null, numbers, xy, bbox: bboxOf(xy) };
  }).filter(road => road.kind);
}

const DECODERS = { rivers: decodeRivers, lakes: decodeLakes, roads: decodeRoads };

/**
 * 타일 저장소. fetchJson(layer, name)이 해당 타일의 JSON 배열을 돌려준다.
 * 최근에 쓴 타일만 메모리에 둔다(layer별 최대 maxTiles개).
 */
export class TileStore {
  constructor(manifest, fetchJson, { maxTiles = 24 } = {}) {
    this.manifest = manifest;
    this.fetchJson = fetchJson;
    this.maxTiles = maxTiles;
    this.cache = new Map();
  }

  async tile(layer, name) {
    const key = layer + '/' + name;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const pending = this.fetchJson(layer, name).then(raw => DECODERS[layer](raw, name, this.manifest));
    this.cache.set(key, pending);
    pending.catch(() => this.cache.delete(key));
    const same = [...this.cache.keys()].filter(k => k.startsWith(layer + '/'));
    for (const old of same.slice(0, Math.max(0, same.length - this.maxTiles))) this.cache.delete(old);
    return pending;
  }

  /** bbox 안에 걸치는 모든 도형. 중복 제거는 호출자가 키로 한다. */
  async load(layer, bbox) {
    const names = neededTiles(this.manifest, layer, bbox);
    const tiles = await Promise.all(names.map(name => this.tile(layer, name)));
    return tiles.flat();
  }
}
