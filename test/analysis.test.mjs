import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { measureWaters, measureRoads } from '../src/analysis.js';
import { fsStore, viewBox, root } from './helpers.mjs';

const expected = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'expected.json'), 'utf8'));

// expected.json은 타일 분할 전 원본 전체를 전수 탐색해 만든 값이다(tools/make_fixture.py).
for (const e of expected) {
  test(`원본 전수 탐색과 일치: ${e.lat}, ${e.lon}`, async () => {
    const store = fsStore();
    const box = viewBox(e.lat, e.lon, e.radius);
    const [rivers, lakes, roads] = await Promise.all([store.load('rivers', box), store.load('lakes', box), store.load('roads', box)]);

    const waters = measureWaters([...rivers, ...lakes], e.lat, e.lon, e.radius);
    assert.deepEqual(waters.map(w => w.key).sort(), e.waters.map(w => w[0]).sort(), '하천·호수 목록이 같아야 한다');
    const byKey = new Map(waters.map(w => [w.key, w]));
    for (const [key, name, distance, inside] of e.waters) {
      const got = byKey.get(key);
      assert.ok(Math.abs(got.distance - distance) < 0.25, `${name} 거리 ${got.distance} vs ${distance}`);
      assert.equal(got.inside, inside, `${name} 구역 안 여부`);
    }

    const routes = measureRoads(roads, e.lat, e.lon, e.radius);
    assert.deepEqual(routes.map(r => r.key).sort(), e.roads.map(r => r[0]).sort(), '도로 노선 목록이 같아야 한다');
    const byRoute = new Map(routes.map(r => [r.key, r]));
    for (const [key, distance] of e.roads) assert.ok(Math.abs(byRoute.get(key).distance - distance) < 0.25, `${key} 거리`);
  });
}

test('거리 오름차순으로 정렬된다', async () => {
  const store = fsStore();
  const [lat, lon] = [37.5665, 126.978];
  const box = viewBox(lat, lon, 5000);
  const waters = measureWaters([...(await store.load('rivers', box)), ...(await store.load('lakes', box))], lat, lon, 5000);
  assert.ok(waters.length > 0);
  for (let i = 1; i < waters.length; i++) assert.ok(waters[i - 1].distance <= waters[i].distance);
});
