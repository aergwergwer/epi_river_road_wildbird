import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCoordinate } from '../src/pipeline.js';
import { surveySites, applyCounts, norm } from '../src/birds.js';
import { searchVworld, searchNominatim, searchAddress } from '../src/geocode.js';
import { textWidth } from '../src/render.js';
import { MAP1, MAP2, SIGN, layoutWaterSlide, layoutBirdSlide, kmText, meterText, roadLabel } from '../src/layout.js';
import { routeName } from '../src/analysis.js';
import { makeView } from '../src/view.js';
import { tilePlan, tileUrls, MAX_TILES } from '../src/basemap.js';
import { measureBoundary } from '../src/analysis.js';
import { root } from './helpers.mjs';

const boundaries = JSON.parse(fs.readFileSync(path.join(root, 'data', 'nibr-boundaries.json'), 'utf8'));

test('좌표 입력: 정상 값, 빈 값, 위도·경도를 바꿔 쓴 값', () => {
  assert.deepEqual(parseCoordinate('37.5', '127.1'), { lat: 37.5, lon: 127.1 });
  assert.throws(() => parseCoordinate('', '127'), /숫자/);
  assert.throws(() => parseCoordinate('abc', '127'), /숫자/);
  assert.throws(() => parseCoordinate('127.1', '37.5'), /대한민국 범위/);
  assert.throws(() => parseCoordinate('0', '0'), /대한민국 범위/);
});

test('조사구역: 이름으로 id를 잇고 거리순 정렬, 반경 밖은 제외', () => {
  const first = boundaries.features[0];
  const areas = [{ area_sno: 11, area_nm: first.properties.name }, { area_sno: 12, area_nm: '다른곳' }];
  const ring = first.geometry.coordinates.flat(1)[0];
  const [lon, lat] = ring[0];
  const sites = surveySites(boundaries, areas, lat, lon, 20000);
  assert.ok(sites.length >= 1);
  for (let i = 1; i < sites.length; i++) assert.ok(sites[i - 1].distance <= sites[i].distance);
  const own = sites.find(s => s.name === first.properties.name);
  assert.equal(own.nibrId, 11);
  assert.ok(own.distance < 1, '경계 위의 점은 거리가 0에 가깝다');
  assert.equal(surveySites(boundaries, areas, 33.0, 124.5, 5000).length, 0);
});

test('조사구역: 같은 이름이 둘 이상이면 연결하지 않는다', () => {
  const first = boundaries.features[0];
  const areas = [{ area_sno: 1, area_nm: first.properties.name }, { area_sno: 2, area_nm: first.properties.name }];
  const [lon, lat] = first.geometry.coordinates.flat(1)[0][0];
  const own = surveySites(boundaries, areas, lat, lon, 1000).find(s => s.name === first.properties.name);
  assert.equal(own.nibrId, null);
  assert.match(own.reason, /동명/);
});

test('개체수 반영: 정상 값, 빈 값, 음수, 문자열은 자료 없음', () => {
  const sites = [1, 2, 3, 4, 5].map(id => ({ nibrId: id, count: null, reason: '' }));
  sites.push({ nibrId: null, count: null, reason: '조사지역명 불일치' });
  applyCounts(sites, [
    { properties: { area_sno: 1, cnt_tot: 120 } }, { properties: { area_sno: 2, cnt_tot: '' } },
    { properties: { area_sno: 3, cnt_tot: -4 } }, { properties: { area_sno: 4, cnt_tot: 'abc' } }, { properties: { area_sno: 5, cnt_tot: 0 } },
  ]);
  assert.deepEqual(sites.map(s => s.count), [120, null, null, null, 0, null]);
  assert.equal(sites[5].reason, '조사지역명 불일치');
});

test('경계 거리: 구역 안은 0, 밖은 양수', () => {
  const square = { type: 'Polygon', coordinates: [[[127, 37], [127.1, 37], [127.1, 37.1], [127, 37.1], [127, 37]]] };
  assert.equal(measureBoundary(square, 37.05, 127.05).distance, 0);
  const d = measureBoundary(square, 37.05, 126.99).distance;
  assert.ok(d > 800 && d < 900, String(d)); // 경도 0.01도 ≈ 888m
});

test('norm: 공백·중점·괄호 차이를 무시한다', () => {
  assert.equal(norm('성산대교 - 성수대교'), norm('성산대교-성수대교'));
  assert.equal(norm('영광·함평 (해안)'), norm('영광함평해안'));
});

test('브이월드 검색: 응답 해석, 국내 밖 좌표 제외, 키 없음 오류', async () => {
  const response = { response: { status: 'OK', record: { total: '2' }, page: { total: '1' }, result: { items: [
    { id: 'a', title: '시청', address: { road: '서울 중구 세종대로 110', parcel: '서울 중구 태평로1가 31' }, point: { x: '126.97', y: '37.56' } },
    { id: 'b', title: '해외', address: { road: 'x' }, point: { x: '10', y: '10' } },
  ] } } };
  const out = await searchVworld('세종대로 110', 'ROAD', 'KEY123', { requestImpl: async () => response, origin: 'https://x.test' });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].label, '서울 중구 세종대로 110');
  assert.equal(out.total, 2);
  await assert.rejects(searchVworld('세종대로', 'ROAD', '', { requestImpl: async () => response }), /인증키/);
  await assert.rejects(searchVworld('세종대로', 'ROAD', 'K', { requestImpl: async () => ({ response: { status: 'ERROR', error: { code: 'INVALID_KEY' } } }) }), /인증/);
  assert.deepEqual((await searchVworld('없는곳', 'ROAD', 'K', { requestImpl: async () => ({ response: { status: 'NOT_FOUND' } }) })).items, []);
});

test('OSM 주소 검색 대체 경로: 키가 없으면 Nominatim을 쓴다', async () => {
  let called = '';
  const fetchImpl = async url => { called = url; return { ok: true, json: async () => [{ place_id: 1, lat: '35.1', lon: '129.0', display_name: '부산시청', name: '부산시청' }, { place_id: 2, lat: '0', lon: '0', display_name: 'x' }] }; };
  const out = await searchAddress('부산시청', 'PLACE', '', { fetchImpl });
  assert.match(called, /nominatim\.openstreetmap\.org/);
  assert.equal(out.items.length, 1);
  assert.equal(out.source, 'OpenStreetMap Nominatim');
  await assert.rejects(searchNominatim('부산', { fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/);
});

const apart = (p, q, gap = 0) => p.x + p.w + gap <= q.x || q.x + q.w + gap <= p.x || p.y + p.h + gap <= q.y || q.y + q.h + gap <= p.y;
const insideMap = (item, map) => item.x >= 0 && item.y >= 0 && item.x + item.w <= map.width && item.y + item.h <= map.height;

test('도로 이름: 국도 16번 형식', () => {
  assert.equal(routeName({ kind: '국도', number: 16 }), '국도 16번');
  assert.equal(roadLabel({ kind: '지방도', number: 820 }), '지방도 820번');
});

test('국도와 지방도 표지는 모양·색이 다르다', () => {
  assert.equal(SIGN.국도.ellipse, true);
  assert.equal(SIGN.지방도.ellipse, false);
  assert.notEqual(SIGN.국도.fill, SIGN.지방도.fill);
});

test('거리 문구', () => {
  assert.equal(meterText({ inside: true, distance: 0 }), '구역 안');
  assert.equal(meterText({ inside: false, distance: 591.4 }), '591 m');
  assert.equal(meterText({ inside: false, distance: 2340 }), '2.3 km');
  assert.equal(kmText(0), '0km');
  assert.equal(kmText(30), '<0.1km');
  assert.equal(kmText(9712), '9.7km');
  assert.equal(kmText(Infinity), '경계 미확인');
});

test('1장 배치: 도로 표지·이름, 하천 말풍선(거리+이름)이 겹치지 않고 화면 안에 들어온다', () => {
  const view = makeView({ lat: 37.5, lon: 127, radiusM: 5000, width: MAP1.width, height: MAP1.height });
  const around = (i, r) => { const a = i * 0.9; return [127 + Math.cos(a) * r * 0.00001, 37.5 + Math.sin(a) * r * 0.000009]; };
  const waters = Array.from({ length: 14 }, (_, i) => ({
    name: '하천' + i, kind: i % 5 === 4 ? 'lake' : 'river', grade: i % 5 === 4 ? '호수·저수지' : i % 2 ? '지방하천' : '국가하천',
    distance: 300 + i * 330, inside: false, area: i % 5 === 4 ? 150000 : 0, point: around(i, 300 + i * 330),
  }));
  const routes = [{ kind: '국도', number: 13, distance: 400, point: around(20, 400) }, { kind: '국도', number: 23, distance: 900, point: around(21, 900) }, { kind: '지방도', number: 820, distance: 1500, point: around(22, 1500) }];
  const { signs, items } = layoutWaterSlide(view, { waters, routes, pointName: '나주 육용오리', credit: '하천: 기후에너지환경부 · 도로: 국토지리정보원 · © 공간정보 오픈플랫폼(브이월드)' });
  assert.deepEqual(signs.map(x => x.kind + x.number), ['국도13', '국도23', '지방도820']);
  assert.deepEqual(items.filter(i => i.name.endsWith(' 이름') && /번 이름$/.test(i.name)).map(i => i.text), ['국도 13번', '국도 23번', '지방도 820번']);
  // 하천 말풍선: 거리 구간마다 최대 2개 + 큰 호수 전부
  const bubbles = items.filter(i => i.name.endsWith(' 하천명'));
  const normal = bubbles.filter(i => !/^하천(4|9|14)/.test(i.text) && !waters.find(w => w.name === i.text && w.kind === 'lake'));
  assert.ok(normal.length <= 8 && normal.length >= 4, String(normal.length));
  assert.ok(waters.filter(w => w.kind === 'lake').every(w => bubbles.some(b => b.text === w.name)), '10만㎡ 이상 호수는 항상 표시');
  for (const item of items) assert.ok(insideMap(item, MAP1), JSON.stringify(item));
  const solid = [...items.filter(i => i.shape !== 'ellipse' || i.name !== '기준점'), ...signs];
  for (let a = 0; a < solid.length; a++) for (let b = a + 1; b < solid.length; b++) {
    const p = solid[a], q = solid[b];
    if (p.name?.endsWith(' 거리') && q.name === p.name.replace(' 거리', ' 하천명')) continue; // 같은 말풍선의 위·아래 칸
    if (q.name?.endsWith(' 거리') && p.name === q.name.replace(' 거리', ' 하천명')) continue;
    assert.ok(apart(p, q), `겹침: ${JSON.stringify(p)} / ${JSON.stringify(q)}`);
  }
});

test('2장 배치: 개체수·거리 칸이 겹치지 않고 지도 안에 들어온다', () => {
  const view = makeView({ lat: 35, lon: 127, radiusM: 50000, width: MAP2.width, height: MAP2.height });
  const sites = Array.from({ length: 12 }, (_, i) => ({
    name: '조사구역' + i, count: i === 3 ? null : 1000 + i * 111, distance: 1500 + i * 4000, point: [127 + Math.cos(i * 0.6) * 0.09 * (1 + i * 0.3), 35 + Math.sin(i * 0.6) * 0.07 * (1 + i * 0.3)],
  }));
  const { items } = layoutBirdSlide(view, { sites, pointName: '나주 육용오리' });
  const names = items.filter(i => i.name.startsWith('도래지'));
  assert.equal(names.length, 12);
  assert.ok(names.some(i => /자료 없음$/.test(i.text)) && names.some(i => /1,111수$/.test(i.text)));
  assert.ok(items.some(i => i.text === '1.5km'));
  for (const item of items) assert.ok(insideMap(item, MAP2), JSON.stringify(item));
  const boxes = items.filter(i => i.name !== '조회 지점');
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const p = boxes[a], q = boxes[b];
    const pair = p.name.startsWith('구역') && q.name.startsWith('도래지') || p.name.startsWith('도래지') && q.name.startsWith('구역');
    if (pair && Math.abs(p.x - q.x) < 20 && (Math.abs(p.y + p.h - q.y) < 1 || Math.abs(q.y + q.h - p.y) < 1)) continue; // 같은 칸의 위·아래
    if (apart(p, q)) continue;
    // 빈 자리가 없으면 겹칠 수 있으므로 이 합성 데이터에서는 거리 칸이 이름 칸 바로 위에 붙은 경우만 허용
    assert.fail(`겹침: ${JSON.stringify(p)} / ${JSON.stringify(q)}`);
  }
  assert.ok(textWidth('한글', 20) > textWidth('ab', 20));
});

test('지도 범위: 반경 원이 화면 짧은 변의 80%를 차지한다', () => {
  const view = makeView({ lat: 36, lon: 128, radiusM: 3000, width: 1920, height: 1080, fill: 0.8 });
  const [x] = view.toPx(128, 36), [x2] = view.toPx(...[128 + 3000 / (111320 * Math.cos(36 * Math.PI / 180)), 36]);
  assert.ok(Math.abs((x2 - x) * 2 - 0.8 * 1080) < 6, String((x2 - x) * 2));
});

test('배경 타일: 타일 수가 한도를 넘지 않고 URL이 맞다', () => {
  for (const radiusM of [1500, 5000, 50000]) {
    const plan = tilePlan(makeView({ lat: 37.5, lon: 127, radiusM, width: 1920, height: 1080 }));
    assert.ok(plan.count <= MAX_TILES && plan.count >= 1, `${radiusM}: ${plan.count}`);
  }
  assert.deepEqual(tileUrls('osm', '', 14, 3, 5), ['https://tile.openstreetmap.org/14/3/5.png']);
  const hybrid = tileUrls('Hybrid', 'K', 14, 3, 5);
  assert.match(hybrid[0], /Satellite\/14\/5\/3\.jpeg$/);
  assert.match(hybrid[1], /Hybrid\/14\/5\/3\.png$/);
});
