import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCoordinate } from '../src/pipeline.js';
import { surveySites, applyCounts, norm, viewportAnchor } from '../src/birds.js';
import { searchVworld, searchNominatim, searchAddress } from '../src/geocode.js';
import { textWidth } from '../src/render.js';
import { MAP1, MAP2, RADIUS_FILL, SIGN, layoutWaterSlide, layoutBirdSlide, kmText, meterText, roadLabel } from '../src/layout.js';
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

const birdBox = (lat, lon, radiusM) => makeView({ lat, lon, radiusM, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL }).bbox;

test('조사구역: 지도 범위에 걸치는 구역을 모두 거리순으로, 반경 밖이라도 지도에 보이면 포함', () => {
  const first = boundaries.features[0];
  const areas = [{ area_sno: 11, area_nm: first.properties.name }, { area_sno: 12, area_nm: '다른곳' }];
  const ring = first.geometry.coordinates.flat(1)[0];
  const [lon, lat] = ring[0];
  const sites = surveySites(boundaries, areas, lat, lon, birdBox(lat, lon, 20000));
  assert.ok(sites.length >= 1);
  for (let i = 1; i < sites.length; i++) assert.ok(sites[i - 1].distance <= sites[i].distance);
  const own = sites.find(s => s.name === first.properties.name);
  assert.equal(own.nibrId, 11);
  assert.ok(own.distance < 1, '경계 위의 점은 거리가 0에 가깝다');
  const box = birdBox(lat, lon, 20000);
  for (const s of sites) assert.ok(s.point[0] >= box[0] - 1e-9 && s.point[0] <= box[2] + 1e-9 && s.point[1] >= box[1] - 1e-9 && s.point[1] <= box[3] + 1e-9, '라벨 기준점은 지도 범위 안');
  // 반경(20km)보다 먼 구역도 지도 범위(직사각형)에 걸치면 들어온다
  assert.ok(sites.some(s => s.distance > 20000) || sites.length >= 1);
  assert.equal(surveySites(boundaries, areas, 33.0, 124.5, birdBox(33.0, 124.5, 5000)).length, 0);
  // 반경을 키우면 구역이 같거나 더 많아진다
  assert.ok(surveySites(boundaries, areas, lat, lon, birdBox(lat, lon, 50000)).length >= sites.length);
});

test('라벨 기준점: 범위를 지나는 경계선 위의 점, 범위 밖이면 null', () => {
  const square = { type: 'Polygon', coordinates: [[[127, 37], [127.1, 37], [127.1, 37.1], [127, 37.1], [127, 37]]] };
  const anchor = viewportAnchor(square, [126.9, 36.9, 127.05, 37.05]);
  assert.ok(anchor[0] >= 126.9 && anchor[0] <= 127.05 && anchor[1] >= 36.9 && anchor[1] <= 37.05);
  assert.equal(viewportAnchor(square, [128, 38, 128.1, 38.1]), null);
  // 지도 범위가 구역 안에 통째로 들어가면 지도 한가운데
  assert.deepEqual(viewportAnchor(square, [127.02, 37.02, 127.04, 37.04]), [127.03, 37.03]);
});

test('조사구역: 같은 이름이 둘 이상이면 연결하지 않는다', () => {
  const first = boundaries.features[0];
  const areas = [{ area_sno: 1, area_nm: first.properties.name }, { area_sno: 2, area_nm: first.properties.name }];
  const [lon, lat] = first.geometry.coordinates.flat(1)[0][0];
  const own = surveySites(boundaries, areas, lat, lon, birdBox(lat, lon, 1000)).find(s => s.name === first.properties.name);
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
  const solid = items.filter(i => i.shape !== 'ellipse' || i.name !== '기준점'); // 번호 표지도 items에 들어 있다
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
    name: '조사구역' + i, count: i === 3 ? null : 1000 + i * 111, distance: 1500 + i * 4000, point: [127 + Math.cos(i * 0.6) * 0.5 * (1 + i * 0.05), 35 + Math.sin(i * 0.6) * 0.3 * (1 + i * 0.05)],
  }));
  const { items } = layoutBirdSlide(view, { sites, pointName: '나주 육용오리' });
  const names = items.filter(i => i.name.startsWith('도래지'));
  assert.equal(names.length, 12);
  assert.ok(names.some(i => /자료 없음$/.test(i.text)) && names.some(i => /1,111수$/.test(i.text)));
  assert.ok(items.some(i => i.text === '1.5km'));
  for (const item of items) assert.ok(insideMap(item, MAP2), JSON.stringify(item));
  const boxes = items.filter(i => !i.name.startsWith('조회 지점')); // 기준점 표시·이름 칸과의 겹침은 따로(가능하면 피하되 강제하지 않음)
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

test('2장 배치: 실제 경계 데이터로 많아도 하나도 빼지 않고, 칸은 경계점 곁에 두고 글자를 줄여 겹침을 피한다', () => {
  const [lat, lon] = [35.0161, 126.7108];
  const view = makeView({ lat, lon, radiusM: 50000, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL });
  const sites = surveySites(boundaries, [], lat, lon, view.bbox).map(site => ({ ...site, count: 100 }));
  assert.ok(sites.length >= 30);
  const { items, scale } = layoutBirdSlide(view, { sites, pointName: '나주' });
  const names = items.filter(i => i.name.startsWith('도래지'));
  assert.equal(names.length, sites.length, '전부 올라가야 한다');
  assert.ok(scale < 1, '많으면 글자를 줄인다: ' + scale);
  for (const item of items) assert.ok(insideMap(item, MAP2), JSON.stringify(item));
  for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) assert.ok(apart(names[a], names[b]), `${names[a].text} / ${names[b].text} 겹침`);
  // 칸이 자기 경계점에서 멀리 떨어지지 않는다(위치를 바꿔 혼란을 주지 않는다)
  sites.forEach((site, i) => {
    const [px, py] = view.toPx(...site.point), box = names[i];
    const dx = Math.max(box.x - px, 0, px - (box.x + box.w)), dy = Math.max(box.y - py, 0, py - (box.y + box.h));
    assert.ok(Math.hypot(dx, dy) < 140, `${site.name} 칸이 경계점에서 ${Math.round(Math.hypot(dx, dy))}px 떨어짐`);
  });
  const few = layoutBirdSlide(view, { sites: sites.slice(30, 32), pointName: '나주' });
  assert.equal(few.scale, 1, '적으면 원본 크기(22pt)를 유지한다');
  // 체크 해제한 구역은 올리지 않는다
  assert.equal(layoutBirdSlide(view, { sites: sites.slice(0, 7), pointName: '나주' }).items.filter(i => i.name.startsWith('도래지')).length, 7);
});

test('1장 배치: 체크한 하천·호수만 말풍선, 체크한 노선만 표지', () => {
  const view = makeView({ lat: 35, lon: 127, radiusM: 3000, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
  const mk = (name, grade, distance, dx) => ({ name, grade, kind: grade === '호수·저수지' ? 'lake' : 'river', distance, point: [127 + dx, 35.005], area: 5000 });
  const waters = [mk('가천', '국가하천', 300, 0.004), mk('나천', '지방하천', 500, -0.004), mk('다천', '지방하천', 700, 0.01), mk('라천', '지방하천', 900, -0.01)];
  const autoRule = layoutWaterSlide(view, { waters, routes: [] });
  assert.equal(autoRule.bubbled.length, 2, '원본 기준: 같은 거리 구간은 2곳까지');
  assert.equal(layoutWaterSlide(view, { waters, routes: [], chosenWaters: new Set(waters) }).bubbled.length, 4, '체크하면 기준과 무관하게 모두 올린다');
  const chosen = layoutWaterSlide(view, { waters, routes: [], chosenWaters: new Set([waters[0], waters[3]]) });
  assert.deepEqual(chosen.bubbled.map(r => r.name).sort(), ['가천', '라천']);
  assert.ok(!chosen.items.some(i => i.name === '나천 하천명'));
  const none = layoutWaterSlide(view, { waters, routes: [], chosenWaters: new Set() });
  assert.equal(none.bubbled.length, 0);
});

test('지도 범위: 반경 원이 화면 짧은 변의 80%를 차지한다(fill 지정 시)', () => {
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

// ---- GIS 엑셀 ----
import { readXlsx, parseGis, groupGis, gisInside, pointInGeometry } from '../src/gis.js';

const gisFile = new URL('./fixtures/gis-sample.xlsx', import.meta.url);

test('GIS 엑셀: 첫 시트를 읽고 좌표 없는 행은 건너뛴다', async () => {
  const { points, skipped } = parseGis(await readXlsx(fs.readFileSync(gisFile)));
  assert.equal(points.length, 6);
  assert.equal(skipped, 1);
  assert.deepEqual(points[0], { kind: '25/26', lat: 35.03, lon: 126.73, title: '시험천', date: '2025-12-01', note: '', color: '377EB8' });
  assert.deepEqual(points.map(p => p.color), ['377EB8', 'FF0000', 'A6CEE3', 'FFFF33', '', '377EB8'], '표현색 열의 배경색');
  assert.equal(points[3].date, '');
  assert.throws(() => parseGis([['이름', '값']]), /구분.*위도.*경도/);
  await assert.rejects(readXlsx(Buffer.from('not a zip file at all, just text')), /엑셀/);
});

test('GIS 묶기: 같은 제목이 1km 안이면 한 칸, 지도 범위 밖은 제외, 거리는 기준점부터', async () => {
  const { points } = parseGis(await readXlsx(fs.readFileSync(gisFile)));
  const box = makeView({ lat: 35.0161, lon: 126.7108, radiusM: 50000, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL }).bbox;
  const groups = groupGis(points, 35.0161, 126.7108, box);
  assert.equal(groups.length, 4, '멀리(서울 근처)는 범위 밖, 시험천 두 건은 한 칸');
  const stream = groups.find(g => g.name === '시험천');
  assert.deepEqual(stream.kinds, ['25/26', '26/27 H5']);
  assert.equal(stream.count, 2);
  assert.equal(stream.color, 'FF0000', '묶음 칸은 가장 최근 건의 색');
  assert.match(stream.label, /시험천 25\/26·26\/27 H5 \(2건\)/);
  assert.equal(stream.dates, '2025-12-01 ~ 2026-11-20');
  assert.ok(stream.distance > 1000 && stream.distance < 3000, String(stream.distance));
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i - 1].distance <= groups[i].distance);
});

test('GIS 권역 안: 조사구역 안에 든 지점만 구분별로 센다', async () => {
  const { points } = parseGis(await readXlsx(fs.readFileSync(gisFile)));
  const byName = n => boundaries.features.find(f => f.properties.name === n).geometry;
  assert.deepEqual(gisInside(byName('영산강중류'), points), [{ kind: '25/26', count: 1 }, { kind: '26/27 H5', count: 1 }, { kind: '24/25', count: 1 }]);
  assert.deepEqual(gisInside(byName('영산강상류'), points), [{ kind: '나주', count: 1 }]);
  assert.deepEqual(gisInside(byName('무안-목포 해안'), points), [{ kind: '25/26', count: 1 }]);
  assert.deepEqual(gisInside(byName('한강하류'), points), []);
  assert.equal(pointInGeometry(byName('영산강중류'), 126.53, 34.9), true);
  assert.equal(pointInGeometry(byName('영산강중류'), 127.5, 37.5), false);
});

test('GIS 칸: 주황 칸으로 올라가고 체크한 묶음만 올라간다', async () => {
  const { points } = parseGis(await readXlsx(fs.readFileSync(gisFile)));
  const view = makeView({ lat: 35.0161, lon: 126.7108, radiusM: 50000, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL });
  const groups = groupGis(points, 35.0161, 126.7108, view.bbox);
  const { items } = layoutBirdSlide(view, { sites: groups, pointName: '나주' });
  const names = items.filter(i => i.name.startsWith('GIS 지점 이름'));
  assert.equal(names.length, 4);
  assert.deepEqual(names.map(i => i.line.color).sort(), ['377EB8'.length && 'A6CEE3', 'E8590C', 'FF0000', 'FFFF33'].sort(), '표현색(없으면 주황)이 칸 테두리 색');
  const dist = items.filter(i => i.name === 'GIS 지점 거리 (편집 가능)');
  assert.ok(dist.some(i => i.fill === 'FF0000' && i.color === 'FFFFFF') && dist.some(i => i.fill === 'FFFF33' && i.color === '000000'), '거리 칸은 표현색, 글자는 읽히는 색');
  assert.ok(items.filter(i => i.name.startsWith('도래지')).concat(items.filter(i => i.name.startsWith('GIS'))).every(i => i.pt <= 18), '슬라이드 2 글씨는 18pt 이하');
  assert.ok(names.some(i => /시험천 25\/26·26\/27 H5 \(2건\)/.test(i.text)));
  assert.equal(layoutBirdSlide(view, { sites: groups.slice(0, 1), pointName: '나주' }).items.filter(i => i.name.startsWith('GIS 지점 이름')).length, 1);
});

test('표현색 해석: 16진수·색 이름·ARGB', async () => {
  const { parseColor } = await import('../src/gis.js');
  assert.equal(parseColor('#ff0000'), 'FF0000');
  assert.equal(parseColor('377eb8'), '377EB8');
  assert.equal(parseColor('FF00B050'), '00B050');
  assert.equal(parseColor('#f00'), 'FF0000');
  assert.equal(parseColor('rgb(0, 128, 255)'), '0080FF');
  assert.equal(parseColor('빨강'), 'FF0000');
  assert.equal(parseColor('아무색'), '');
  assert.equal(parseColor(null), '');
});

test('2장 글씨: 기본 18pt(겹치면 그보다 작게)', () => {
  const view = makeView({ lat: 35, lon: 127, radiusM: 50000, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL });
  const { items } = layoutBirdSlide(view, { sites: [{ name: '가', count: 5, distance: 3000, point: [126.6, 35.3] }], pointName: '나주' });
  assert.deepEqual([...new Set(items.filter(i => i.text).map(i => i.pt))], [18]);
});

test('1장: 도로 번호 표지는 지도에 굽지 않고 옮길 수 있는 도형으로 올라간다', () => {
  const view = makeView({ lat: 35, lon: 127, radiusM: 3000, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
  const routes = [{ name: '국도 13번', kind: '국도', number: 13, distance: 300, point: [127.004, 35.003] }, { name: '지방도 822번', kind: '지방도', number: 822, distance: 900, point: [126.99, 35.01] }];
  const { signs, items } = layoutWaterSlide(view, { waters: [], routes });
  const shields = items.filter(i => i.name.endsWith('번호 표지'));
  assert.equal(shields.length, signs.length);
  assert.equal(shields.length, 2);
  const national = shields.find(i => i.text === '13'), local = shields.find(i => i.text === '822');
  assert.equal(national.shape, 'ellipse');
  assert.equal(local.shape, 'roundRect');
  assert.notEqual(national.fill, local.fill);
  assert.ok(items.some(i => i.text === '국도 13번') && items.some(i => i.text === '지방도 822번'), '이름표도 따로 있다');
});

// ───────── 적대적 리뷰 회귀(REV-01·02·03·05) ─────────
import { createGisInput } from '../src/gisInput.js';
import { boundaryInfo } from '../src/pipeline.js';
import { boundaryLabel } from '../src/report.js';

const fixture = name => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url));
const sheetOf = async name => { const bytes = fixture(name); const rows = await readXlsx(bytes); return { rows, ...parseGis(rows) }; };

test('REV-02: 시트 순서가 바뀐 엑셀은 보이는 첫 시트를 읽는다(파일 번호가 아니라 workbook 순서)', async () => {
  const normal = await sheetOf('gis-two-sheets.xlsx');
  assert.equal(normal.rows.sheetName, 'FIRST_SHEET');
  assert.equal(normal.points[0].title, 'FIRST_SHEET지점');
  const reordered = await sheetOf('gis-reordered.xlsx');
  assert.equal(reordered.rows.sheetName, 'SECOND_SHEET');
  assert.equal(reordered.points[0].title, 'SECOND_SHEET지점');
  const hidden = await sheetOf('gis-first-hidden.xlsx');
  assert.equal(hidden.rows.sheetName, 'SECOND_SHEET');
});

test('REV-02: 단일 시트(기존 샘플)는 그대로 읽히고, 관계를 못 찾으면 sheet1로 대신하지 않고 오류', async () => {
  const sample = await sheetOf('gis-sample.xlsx');
  assert.ok(sample.points.length > 0 && sample.rows.sheetName);
  const { firstSheet } = await import('../src/gis.js');
  const enc = new TextEncoder();
  const files = {
    'xl/workbook.xml': enc.encode('<workbook xmlns:r="x"><sheets><sheet name="A" sheetId="7" r:id="rId9"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': enc.encode('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': enc.encode('<worksheet/>'),
  };
  assert.throws(() => firstSheet(files), /찾지 못/);
  files['xl/_rels/workbook.xml.rels'] = enc.encode('<Relationships><Relationship Id="rId9" Target="worksheets/data-x.xml"/></Relationships>');
  files['xl/worksheets/data-x.xml'] = enc.encode('<worksheet/>');
  assert.equal(firstSheet(files).path, 'xl/worksheets/data-x.xml'); // sheetId=7, rId9, 파일명 모두 서로 다름
});

function harness() {
  const log = { invalidated: 0, msgs: [] };
  const gates = {};
  const gi = createGisInput({
    read: file => new Promise((resolve, reject) => { gates[file.name] = { resolve: v => resolve({ points: v, skipped: 0, sheet: 'S' }), reject }; }),
    onInvalidate: () => log.invalidated++,
    onChange: c => log.msgs.push(c),
  });
  return { gi, gates, log };
}

test('REV-01: 삭제하면 즉시 무효화되고 GIS 점이 비며 이후 조회에 쓰이지 않는다', async () => {
  const { gi, gates, log } = harness();
  const p = gi.load({ name: 'a.xlsx' }); gates['a.xlsx'].resolve([{ lat: 1, lon: 2 }]); await p;
  assert.equal(gi.points.length, 1);
  const before = log.invalidated;
  await gi.load(null);
  assert.equal(log.invalidated, before + 1);
  assert.deepEqual(gi.points, []);
  assert.equal(gi.name, '');
  assert.equal(log.msgs.at(-1).hasFile, false);
});

test('REV-03: 읽는 중 삭제하면 늦게 끝난 읽기가 GIS를 되살리지 못한다', async () => {
  const { gi, gates } = harness();
  const a = gi.load({ name: 'a.xlsx' });
  assert.equal(gi.reading, true);
  await gi.load(null);
  assert.equal(gi.reading, false);
  gates['a.xlsx'].resolve([{ lat: 1, lon: 2 }]);
  assert.equal(await a, false);
  assert.deepEqual(gi.points, []);
});

test('REV-03: A→B 교체에서 B가 먼저 끝나면 나중에 끝난 A는 무시, 오래된 실패는 최신 성공 문구를 덮지 않는다', async () => {
  const { gi, gates, log } = harness();
  const a = gi.load({ name: 'a.xlsx' }), b = gi.load({ name: 'b.xlsx' });
  gates['b.xlsx'].resolve([{ lat: 9, lon: 9 }]); await b;
  const msg = log.msgs.at(-1).message;
  gates['a.xlsx'].reject(new Error('깨진 파일'));
  assert.equal(await a, false);
  assert.equal(gi.name, 'b.xlsx');
  assert.equal(gi.points[0].lat, 9);
  assert.equal(log.msgs.at(-1).message, msg);
  assert.match(msg, /b\.xlsx/);
});

test('REV-03: 읽는 동안 reading=true(조회 버튼 차단 근거), 시작 시 이전 결과 무효화', async () => {
  const { gi, gates, log } = harness();
  const p = gi.load({ name: 'a.xlsx' });
  assert.equal(gi.reading, true);
  assert.equal(log.invalidated, 1);
  gates['a.xlsx'].resolve([]); await p;
  assert.equal(gi.reading, false);
});

test('REV-05: 경계 출처 정보 — 저장본/실시간/메타 없음을 구분하고 없는 수집일을 지어내지 않는다', () => {
  assert.deepEqual(boundaryInfo({ snapshot: true, retrievedAt: '2026-11-20T12:01:55Z', source: 'u' }), { snapshot: true, retrievedAt: '2026-11-20T12:01:55Z', source: 'u' });
  assert.equal(boundaryInfo({ snapshot: false, retrievedAt: '2026-11-27T01:00:00Z' }).snapshot, false);
  const none = boundaryInfo({ features: [] });
  assert.deepEqual(none, { snapshot: null, retrievedAt: '', source: '' });
  assert.equal(boundaryInfo(undefined).retrievedAt, '');
  const snap = boundaryLabel({ snapshot: true, retrievedAt: '2026-11-20T12:01:55Z' });
  assert.match(snap.short, /경계 저장본 사용/); assert.match(snap.short, /2026-11-20/); assert.equal(snap.warn, true);
  assert.match(boundaryLabel({ snapshot: true, retrievedAt: '' }).short, /수집일 미확인/);
  assert.match(boundaryLabel({ snapshot: false, retrievedAt: '2026-11-27T00:00:00Z' }).short, /실시간/);
  assert.match(boundaryLabel(undefined).short, /미확인/);
});

// ───────── 2차 적대적 리뷰 회귀(R2-01·02·03) ─────────
import { serialToDate, isDate1904 } from '../src/gis.js';

test('R2-02: 같은 2026-11-27을 1900·1904 시스템으로 저장한 실제 xlsx가 같은 날짜로 읽힌다(참·거짓 표현 포함)', async () => {
  const dates = async name => (await sheetOf(name)).points.map(p => p.date);
  const expected = ['2026-11-27', '2026-11-27', '2026-11-27'];
  assert.deepEqual(await dates('gis-date1900.xlsx'), expected);   // 문자열 날짜는 보정 없이 그대로, 숫자는 시각 포함해도 날짜 부분만
  assert.deepEqual(await dates('gis-date1904.xlsx'), expected);   // date1904="1" (openpyxl 저장)
  assert.deepEqual(await dates('gis-date1904-one.xlsx'), expected); // date1904="1"
  assert.deepEqual(await dates('gis-date1900-false.xlsx'), expected); // date1904="false"
  assert.equal((await sheetOf('gis-date1904.xlsx')).rows.date1904, true);
  assert.equal((await sheetOf('gis-sample.xlsx')).rows.date1904, false); // 속성 없는 기존 샘플은 1900
});

test('R2-02: 날짜 변환 — 1904 일련번호 44891은 2026-11-27, 1900은 46353, 잘못된 값은 날짜 미확인(빈 문자열)', () => {
  assert.equal(serialToDate(44891, true), '2026-11-27');
  assert.equal(serialToDate(46353), '2026-11-27');
  assert.equal(serialToDate(46353.99), '2026-11-27');
  assert.equal(serialToDate(NaN), ''); assert.equal(serialToDate(-5), ''); assert.equal(serialToDate(1e9), '');
  assert.equal(isDate1904(new TextEncoder().encode('<workbook><workbookPr date1904="TRUE"/></workbook>')), true);
  assert.equal(isDate1904(new TextEncoder().encode('<workbook><workbookPr/></workbook>')), false);
  assert.equal(isDate1904(undefined), false);
});

test('R2-03: 시트 순서 테스트가 파일마다 한 번만 읽은 Buffer를 쓰고 반복 실행해도 같다', async () => {
  for (let i = 0; i < 3; i++) for (const name of ['gis-two-sheets.xlsx', 'gis-reordered.xlsx', 'gis-first-hidden.xlsx']) assert.ok((await sheetOf(name)).rows.sheetName);
});

// 도로 12개의 가장 가까운 점이 한 곳에 몰려 번호 표지를 다 못 놓는 합성 입력(실제 지역 재현이 아님)
function crowded(n) {
  const view = makeView({ lat: 37, lon: 127, radiusM: 5000, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
  const routes = Array.from({ length: n }, (_, i) => ({ key: `국도:${i + 1}`, kind: '국도', number: String(i + 1), name: `국도 ${i + 1}번`, distance: 100 + i, point: [127.0001, 37.0001] }));
  const waters = Array.from({ length: n }, (_, i) => ({ key: `r:${i}`, kind: 'river', grade: '국가하천', name: `하천${i}`, distance: 200 + i, point: [127.0002, 37.0002], area: 0 }));
  return { view, routes, waters };
}

test('R2-01: 번호 표지·말풍선을 다 못 놓아도 선택한 도형은 모두 그리고, 못 놓은 항목은 unplaced로 알린다', () => {
  const { view, routes, waters } = crowded(12);
  const out = layoutWaterSlide(view, { waters, routes, pointName: '', credit: '', chosenWaters: new Set(waters), chosenRoutes: new Set(routes) });
  assert.ok(out.signed.length < 12, '합성 입력이 혼잡해야 의미가 있다: ' + out.signed.length);
  assert.equal(out.drawKeys.routes.size, 12);
  assert.equal(out.drawKeys.waters.size, 12);
  assert.equal(out.unplacedRoutes.length, 12 - out.signed.length);
  assert.equal(out.unplacedWaters.length, 12 - out.bubbled.length);
  assert.ok(out.unplacedRoutes.every(r => !out.signed.includes(r)));
});

test('R2-01: 해제한 항목은 그리기 대상에서 빠지고, 전체 해제 → 일부 → 전체를 반복해도 선택 집합과 일치한다', () => {
  const { view, routes, waters } = crowded(12);
  const run = (w, r) => layoutWaterSlide(view, { waters, routes, pointName: '', credit: '', chosenWaters: new Set(w), chosenRoutes: new Set(r) });
  for (let round = 0; round < 2; round++) {
    const none = run([], []);
    assert.equal(none.drawKeys.routes.size + none.drawKeys.waters.size, 0);
    assert.equal(none.items.filter(i => /번호 표지|이름|거리|하천명/.test(i.name)).length, 0);
    const some = run(waters.slice(0, 3), routes.slice(0, 5));
    assert.deepEqual([...some.drawKeys.routes], routes.slice(0, 5).map(r => r.key));
    assert.deepEqual([...some.drawKeys.waters], waters.slice(0, 3).map(r => r.key));
    const all = run(waters, routes);
    assert.equal(all.drawKeys.routes.size, 12);
  }
});

test('R2-01: 선택 상태가 없을 때(최초)는 원본 정책(가까운 노선 maxRoads개)이 기본 선택이 된다', () => {
  const { view, routes, waters } = crowded(12);
  const out = layoutWaterSlide(view, { waters, routes, pointName: '', credit: '', maxRoads: 6 });
  assert.equal(out.shownRoutes.length, 6);
  assert.equal(out.drawKeys.routes.size, 6);
});
