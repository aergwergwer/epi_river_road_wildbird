import test from 'node:test';
import assert from 'node:assert/strict';
import { localProjector, mercator, unmercator, originInRing, circlePoints } from '../src/geo.js';
import { neededTiles, undelta } from '../src/tiles.js';
import { fsStore, manifest } from './helpers.mjs';

test('로컬 투영: 왕복 변환이 일치하고 기준점은 원점이다', () => {
  const { forward, inverse } = localProjector(37.5, 127);
  assert.deepEqual(forward(127, 37.5), [0, 0]);
  for (const [lon, lat] of [[127.05, 37.55], [126.9, 37.4], [127.3, 37.8]]) {
    const [x, y] = forward(lon, lat), [lon2, lat2] = inverse(x, y);
    assert.ok(Math.abs(lon2 - lon) < 1e-9 && Math.abs(lat2 - lat) < 1e-9);
  }
});

test('로컬 투영: 경도 0.01도는 약 882m (위도 37.5°)', () => {
  const [x] = localProjector(37.5, 127).forward(127.01, 37.5);
  assert.ok(Math.abs(x - 882.17) < 0.1);
});

test('메르카토르 왕복 변환', () => {
  const [x, y] = mercator(128.1, 35.2), [lon, lat] = unmercator(x, y);
  assert.ok(Math.abs(lon - 128.1) < 1e-9 && Math.abs(lat - 35.2) < 1e-9);
});

test('점-링 포함 판정', () => {
  const square = Float64Array.from([-1, -1, 1, -1, 1, 1, -1, 1, -1, -1]);
  const far = Float64Array.from([5, 5, 7, 5, 7, 7, 5, 7, 5, 5]);
  assert.equal(originInRing(square), true);
  assert.equal(originInRing(far), false);
});

test('반경 원: 모든 점이 반경에 있다', () => {
  const { forward } = localProjector(35, 128);
  for (const p of circlePoints(35, 128, 5000, 36)) assert.ok(Math.abs(Math.hypot(...forward(...p)) - 5000) < 0.01);
});

test('차분 복원', () => {
  assert.deepEqual(undelta([100, 200, 5, -3, -2, 4]), [100, 200, 105, 197, 103, 201]);
});

test('타일 선택: 존재하는 타일만, 경계에 걸치면 이웃 타일 포함', () => {
  const m = structuredClone(manifest);
  const near = neededTiles(m, 'roads', [126.97, 37.5, 126.99, 37.6]);
  assert.ok(near.length >= 1 && near.every(n => m.tiles.roads.includes(n)));
  // 0.1도 경계(126.9/127.0)를 가로지르는 범위는 두 열을 모두 가져와야 한다.
  const across = neededTiles(m, 'roads', [126.95, 37.55, 127.05, 37.56]);
  const cols = new Set(across.map(n => n.split('_')[0]));
  assert.ok(cols.has('1269') && cols.has('1270'), [...cols].join());
  assert.deepEqual(neededTiles(m, 'roads', [100, 10, 101, 11]), []);
});

test('하천 타일: 창 경계 위의 변은 인위적 변으로 표시된다', async () => {
  const store = fsStore();
  const rivers = await store.load('rivers', [126.95, 37.4, 127.05, 37.6]);
  const flagged = rivers.flatMap(r => r.polys.flat()).filter(ring => ring.art && ring.art.some(Boolean));
  assert.ok(flagged.length > 0, '경계에서 잘린 하천이 있어야 한다');
});

test('타일 캐시: 같은 타일은 한 번만 가져온다', async () => {
  let calls = 0;
  const { fetchJson } = fsStore();
  const store = fsStore();
  store.fetchJson = async (layer, name) => { calls++; return fetchJson(layer, name); };
  await store.load('roads', [126.97, 37.5, 126.98, 37.51]);
  const first = calls;
  await store.load('roads', [126.97, 37.5, 126.98, 37.51]);
  assert.equal(calls, first);
});
