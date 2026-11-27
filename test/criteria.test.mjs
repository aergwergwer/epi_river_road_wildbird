// 원본 웹앱의 표시 기준(대표 말풍선 규칙)을 실제 내장 데이터로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fsStore, viewBox } from './helpers.mjs';
import { makeView } from '../src/view.js';
import { measureWaters, measureRoads } from '../src/analysis.js';
import { MAP1, RADIUS_FILL, layoutWaterSlide } from '../src/layout.js';

const BANDS = [1000, 1500, 3000, 5000];
const band = d => BANDS.find(limit => d <= limit);

async function scene(lat, lon, radiusM) {
  const view = makeView({ lat, lon, radiusM, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
  const store = fsStore();
  const [rivers, lakes, roads] = await Promise.all(['rivers', 'lakes', 'roads'].map(layer => store.load(layer, view.bbox)));
  const waters = measureWaters([...rivers, ...lakes], lat, lon, radiusM);
  const routes = measureRoads(roads, lat, lon, radiusM);
  return { view, rivers, waters, routes, layout: layoutWaterSlide(view, { waters, routes, rivers, pointName: '기준', credit: '출처' }) };
}

test('말풍선 기준: 거리 구간마다 최대 2곳, 10만㎡ 이상 호수·저수지는 항상', async () => {
  const { waters, layout } = await scene(35.0161, 126.7108, 5000);
  assert.ok(waters.length > 8, '표에는 반경 안 전체');
  const big = waters.filter(r => r.grade === '호수·저수지' && r.area >= 100000);
  const normal = layout.bubbled.filter(r => !(r.grade === '호수·저수지' && r.area >= 100000));
  const perBand = new Map();
  for (const r of normal) perBand.set(band(r.distance), (perBand.get(band(r.distance)) || 0) + 1);
  for (const [b, n] of perBand) assert.ok(n <= 2, `${b}m 구간 ${n}곳`);
  for (const r of big) assert.ok(layout.bubbled.includes(r), `${r.name}(${Math.round(r.area)}㎡) 큰 호수는 말풍선이 있어야 한다`);
  // 구간 안에서는 국가하천 > 지방하천 > 호수·저수지 순
  for (const b of BANDS) {
    const inBand = waters.filter(r => band(r.distance) === b && !(r.grade === '호수·저수지' && r.area >= 100000));
    const picked = normal.filter(r => band(r.distance) === b);
    const rank = r => (r.grade === '국가하천' ? 0 : r.grade === '지방하천' ? 1 : 2);
    if (picked.length) {
      const worstPicked = Math.max(...picked.map(rank));
      for (const r of inBand) if (!picked.includes(r) && !normal.some(p => p.name === r.name && p.grade === r.grade)) assert.ok(rank(r) >= Math.min(worstPicked, rank(r)), '더 높은 등급이 밀려나면 안 된다');
    }
  }
  const dedupe = layout.bubbled.map(r => r.grade + ':' + r.name);
  assert.equal(new Set(dedupe.filter(k => !k.startsWith('호수·저수지'))).size, dedupe.filter(k => !k.startsWith('호수·저수지')).length, '같은 구분·이름은 한 번만');
});

test('이름표: 말풍선이 없는 하천은 화면에 보이면 이름만 하천 위에 붙인다', async () => {
  const { layout, waters } = await scene(35.0161, 126.7108, 5000);
  const tags = layout.items.filter(i => i.name.endsWith(' 이름') && i.shape === 'rect' && i.pt === 10.5);
  assert.ok(tags.length >= 1, '이름표가 하나 이상');
  const bubbleNames = new Set(layout.bubbled.map(r => r.name));
  for (const tag of tags) assert.ok(!bubbleNames.has(tag.text), `${tag.text}은(는) 말풍선과 이름표가 중복되면 안 된다`);
  assert.ok(waters.length >= layout.bubbled.length);
});

test('도로: 반경 안 노선마다 표지가 있고(최대 6), 이름은 종류+번호+번', async () => {
  const { layout, routes } = await scene(35.0161, 126.7108, 5000);
  assert.ok(routes.length >= 3);
  assert.equal(layout.signed.length, Math.min(6, routes.length));
  const names = layout.items.filter(i => /번 이름$/.test(i.name)).map(i => i.text);
  assert.ok(names.includes('국도 13번') && names.includes('국도 23번'));
});
