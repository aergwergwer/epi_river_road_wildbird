// 조회(데이터 → 행)와 슬라이드 지도 렌더링(행 → 이미지·도형). UI와 분리해 테스트할 수 있게 둔다.
import { inKorea } from './geo.js';
import { makeView } from './view.js';
import { measureWaters, measureRoads } from './analysis.js';
import { surveySites, applyCounts, monthText } from './birds.js';
import { drawBackground } from './basemap.js';
import { MAP_PX } from './report.js';
import { COLORS, drawWaterRoadScene, drawBirdScene, drawFurniture, layoutOverlay, drawOverlay } from './render.js';

export const SLIDE_ROWS = { waters: 10, roads: 5, sites: 14 };

export function parseCoordinate(latText, lonText) {
  const lat = Number(latText), lon = Number(lonText);
  if (String(latText).trim() === '' || String(lonText).trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('위도와 경도를 숫자로 입력해 주세요.');
  if (!inKorea(lat, lon)) throw new Error('내장 데이터는 대한민국 범위(위도 32~40, 경도 124~132)만 지원합니다. 좌표를 확인해 주세요. 위도와 경도를 바꿔 입력했을 수 있습니다.');
  return { lat, lon };
}

/** 위치 하나에 대한 하천·도로·철새도래지 조회. */
export async function lookup({ lat, lon, waterRadiusM, birdRadiusM, month, store, birdApi, birdContext, onStatus = () => {} }) {
  const waterView = makeView({ lat, lon, radiusM: waterRadiusM, ...MAP_PX });
  onStatus('하천·호수·도로 데이터를 읽는 중…');
  const [rivers, lakes, roads] = await Promise.all(['rivers', 'lakes', 'roads'].map(layer => store.load(layer, waterView.bbox)));
  const waters = measureWaters([...rivers, ...lakes], lat, lon, waterRadiusM);
  const routes = measureRoads(roads, lat, lon, waterRadiusM);

  onStatus('철새 조사구역과 개체수를 조회하는 중…');
  const sites = surveySites(birdContext.boundaries, birdContext.meta.areas, lat, lon, birdRadiusM);
  const ids = sites.filter(s => s.nibrId).map(s => s.nibrId);
  let countsError = null;
  if (ids.length) {
    // 개체수 조회가 실패해도 경계·거리는 보여 준다. 호출자가 경고를 띄운다.
    try { applyCounts(sites, await birdApi.counts(ids, month)); } catch (error) { countsError = error.message; }
  }
  return { lat, lon, waterRadiusM, birdRadiusM, month, rivers, lakes, roads, waters, routes, sites, countsError, boundaries: birdContext.boundaries.features };
}

export function newCanvas(createCanvas = () => document.createElement('canvas')) {
  const canvas = createCanvas();
  canvas.width = MAP_PX.width;
  canvas.height = MAP_PX.height;
  return canvas;
}

async function withSentinel(background, view, deps) {
  if (background.mode !== 'sentinel') return background;
  if (!deps.sentinelFor) throw new Error('Sentinel-2 연결에서 Google 로그인부터 완료해 주세요.');
  return { ...background, sentinel: await deps.sentinelFor(view) };
}

const gradeFill = row => (row.kind === 'lake' ? COLORS.lake : row.grade === '국가하천' ? COLORS.national : '#1d7fb3');
const signFill = kind => (kind === '국도' ? '#174f7b' : '#FFC000');

/**
 * 두 슬라이드의 지도를 그린다. 반환값의 image는 배경+도형+범례(PNG data URL),
 * overlay는 PPTX에 편집 가능한 도형으로 올릴 번호표·노선표·이름표 목록이다.
 * preview 캔버스는 overlay까지 그려 화면에서 결과와 같은 모양을 보여 준다.
 */
export async function renderSlides(data, { pointName, background, deps = {}, onStatus = () => {} }) {
  const out = {};

  // 슬라이드 1: 하천·도로
  {
    const view = makeView({ lat: data.lat, lon: data.lon, radiusM: data.waterRadiusM, ...MAP_PX });
    const canvas = deps.canvas1 || newCanvas(), ctx = canvas.getContext('2d');
    onStatus('배경지도를 그리는 중…');
    const credit = await drawBackground(ctx, view, await withSentinel(background, view, deps), { ...deps, onProgress: (done, total) => onStatus(`배경지도 타일 ${done}/${total}개`) });
    drawWaterRoadScene(ctx, view, data);
    drawFurniture(ctx, view, {
      credit,
      legend: [
        { color: COLORS.national, label: '국가하천' }, { color: COLORS.local, label: '지방하천' }, { color: COLORS.lake, label: '호수·저수지' },
        { color: COLORS.road.국도, label: '국도', line: true }, { color: COLORS.road.지방도, label: '지방도', line: true },
      ],
    });
    const shown = data.waters.slice(0, SLIDE_ROWS.waters), roads = data.routes.slice(0, SLIDE_ROWS.roads);
    const badges = [
      ...shown.map((row, i) => ({ x: view.toPx(...row.point)[0], y: view.toPx(...row.point)[1], text: i + 1, kind: 'num', fill: gradeFill(row), name: row.name })),
      ...roads.map(row => ({ x: view.toPx(...row.point)[0], y: view.toPx(...row.point)[1], text: row.number, kind: row.kind, fill: signFill(row.kind) })),
    ];
    const overlay = layoutOverlay(view, { pointName, badges });
    const image = canvas.toDataURL('image/png');
    const preview = deps.preview1 || newCanvas();
    preview.getContext('2d').drawImage(canvas, 0, 0);
    drawOverlay(preview.getContext('2d'), overlay);
    out.water = {
      radiusM: data.waterRadiusM, rivers: shown, more: data.waters.length - shown.length,
      roads, moreRoads: data.routes.length - roads.length, image, overlay, credit, preview,
    };
  }

  // 슬라이드 2: 철새도래지
  {
    const view = makeView({ lat: data.lat, lon: data.lon, radiusM: data.birdRadiusM, ...MAP_PX });
    const canvas = deps.canvas2 || newCanvas(), ctx = canvas.getContext('2d');
    const credit = await drawBackground(ctx, view, await withSentinel(background, view, deps), { ...deps, onProgress: (done, total) => onStatus(`배경지도 타일 ${done}/${total}개`) });
    drawBirdScene(ctx, view, { boundaries: data.boundaries, highlight: new Set(data.sites.map(s => s.id)) });
    drawFurniture(ctx, view, {
      credit,
      legend: [{ color: 'rgba(107,87,214,0.6)', label: '조회 반경 안 조사구역' }, { color: 'rgba(107,87,214,0.25)', label: '그 밖의 조사구역' }],
    });
    const shown = data.sites.slice(0, SLIDE_ROWS.sites);
    const badges = shown.map((row, i) => ({ x: view.toPx(...row.point)[0], y: view.toPx(...row.point)[1], text: i + 1, kind: 'num', fill: COLORS.bird, name: row.name }));
    const overlay = layoutOverlay(view, { pointName, badges });
    const image = canvas.toDataURL('image/png');
    const preview = deps.preview2 || newCanvas();
    preview.getContext('2d').drawImage(canvas, 0, 0);
    drawOverlay(preview.getContext('2d'), overlay);
    out.bird = {
      radiusM: data.birdRadiusM, monthLabel: monthText(data.month), sites: shown, more: data.sites.length - shown.length,
      total: data.sites.reduce((sum, s) => sum + (s.count || 0), 0), measured: data.sites.filter(s => s.count !== null).length,
      image, overlay, credit, preview, countsError: data.countsError,
    };
  }
  return out;
}
