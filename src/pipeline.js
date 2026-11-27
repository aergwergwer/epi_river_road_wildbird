// 조회(데이터 → 행)와 슬라이드 지도 렌더링(행 → 이미지·도형). UI와 분리해 테스트할 수 있게 둔다.
import { inKorea } from './geo.js';
import { makeView } from './view.js';
import { measureWaters, measureRoads } from './analysis.js';
import { surveySites, applyCounts, monthText } from './birds.js';
import { drawBackground } from './basemap.js';
import { MAP1, MAP2, RADIUS_FILL, SIGN, layoutWaterSlide, layoutBirdSlide, drawItems } from './layout.js';
import { FONT, drawWaterRoadScene, drawBirdScene, drawRoadSigns } from './render.js';

export const SLIDE_ROWS = { roads: 6 }; // 도로 이름표는 지도에 최대 6개 노선(나머지는 표·노트)

export function parseCoordinate(latText, lonText) {
  const lat = Number(latText), lon = Number(lonText);
  if (String(latText).trim() === '' || String(lonText).trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('위도와 경도를 숫자로 입력해 주세요.');
  if (!inKorea(lat, lon)) throw new Error('내장 데이터는 대한민국 범위(위도 32~40, 경도 124~132)만 지원합니다. 좌표를 확인해 주세요. 위도와 경도를 바꿔 입력했을 수 있습니다.');
  return { lat, lon };
}

/** 위치 하나에 대한 하천·도로·철새도래지 조회. */
export async function lookup({ lat, lon, waterRadiusM, birdRadiusM, month, store, birdApi, birdContext, onStatus = () => {} }) {
  const waterView = makeView({ lat, lon, radiusM: waterRadiusM, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
  onStatus('하천·호수·도로 데이터를 읽는 중…');
  const [rivers, lakes, roads] = await Promise.all(['rivers', 'lakes', 'roads'].map(layer => store.load(layer, waterView.bbox)));
  const waters = measureWaters([...rivers, ...lakes], lat, lon, waterRadiusM);
  const routes = measureRoads(roads, lat, lon, waterRadiusM);

  onStatus('철새 조사구역과 개체수를 조회하는 중…');
  const birdView = makeView({ lat, lon, radiusM: birdRadiusM, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL });
  const sites = surveySites(birdContext.boundaries, birdContext.meta.areas, lat, lon, birdView.bbox);
  const ids = sites.filter(s => s.nibrId).map(s => s.nibrId);
  let countsError = null;
  if (ids.length) {
    // 개체수 조회가 실패해도 경계·거리는 보여 준다. 호출자가 경고를 띄운다.
    try { applyCounts(sites, await birdApi.counts(ids, month)); } catch (error) { countsError = error.message; }
  }
  return { lat, lon, waterRadiusM, birdRadiusM, month, rivers, lakes, roads, waters, routes, sites, countsError, boundaries: birdContext.boundaries.features };
}

export function newCanvas(size, createCanvas = () => document.createElement('canvas')) {
  const canvas = createCanvas();
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

async function withSentinel(background, view, deps) {
  if (background.mode !== 'sentinel') return background;
  if (!deps.sentinelFor) throw new Error('Sentinel-2 연결에서 Google 로그인부터 완료해 주세요.');
  return { ...background, sentinel: await deps.sentinelFor(view) };
}

// 위성·하이브리드·Sentinel-2는 사진이라 JPEG, 그 밖의 지도는 PNG로 저장해 파일 크기를 줄인다.
const PHOTO_MODES = new Set(['Satellite', 'Hybrid', 'sentinel']);
const encode = (canvas, mode) => (PHOTO_MODES.has(mode) ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'));

/**
 * 두 슬라이드의 지도를 그린다.
 * backgrounds: {water: {mode, key}, bird: {mode, key}} — 슬라이드별 배경지도.
 * 반환값의 image는 배경+하천·도로+도로 표지(1장은 JPEG/PNG), items는 PPTX에 도형으로 올릴 말풍선 목록,
 * preview는 화면 확인용 캔버스(도형까지 포함)다.
 */
export async function renderSlides(data, { pointName, backgrounds, deps = {}, onStatus = () => {} }) {
  const out = {};
  const progress = label => (done, total) => onStatus(`${label} 배경지도 타일 ${done}/${total}개`);

  // 슬라이드 1: 하천·도로 (슬라이드 전체가 지도)
  {
    const view = makeView({ lat: data.lat, lon: data.lon, radiusM: data.waterRadiusM, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
    const canvas = deps.canvas1 || newCanvas(MAP1), ctx = canvas.getContext('2d');
    onStatus('하천·도로 배경지도를 그리는 중…');
    const bgCredit = await drawBackground(ctx, view, await withSentinel(backgrounds.water, view, deps), { ...deps, onProgress: progress('하천·도로') });
    drawWaterRoadScene(ctx, view, data);
    const credit = ['하천: 기후에너지환경부', '도로: 국토지리정보원', bgCredit].filter(Boolean).join(' · ');
    const { signs, items, bubbled, signed } = layoutWaterSlide(view, { waters: data.waters, routes: data.routes, rivers: data.rivers, pointName, credit, maxRoads: SLIDE_ROWS.roads });
    drawRoadSigns(ctx, signs, SIGN);
    const image = encode(canvas, backgrounds.water.mode);
    const preview = deps.preview1 || newCanvas(MAP1);
    preview.getContext('2d').drawImage(canvas, 0, 0);
    drawItems(preview.getContext('2d'), items, FONT);
    out.water = {
      radiusM: data.waterRadiusM, rivers: data.waters, roads: data.routes, labeled: new Set(bubbled), signed: new Set(signed),
      image, items, credit: bgCredit, preview, allWaters: data.waters, allRoutes: data.routes,
    };
  }

  // 슬라이드 2: 철새도래지 (지도 + 조사구역 경계 이미지를 따로 올린다)
  {
    const view = makeView({ lat: data.lat, lon: data.lon, radiusM: data.birdRadiusM, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL });
    const base = deps.canvas2 || newCanvas(MAP2), baseCtx = base.getContext('2d');
    onStatus('철새도래지 배경지도를 그리는 중…');
    const credit = await drawBackground(baseCtx, view, await withSentinel(backgrounds.bird, view, deps), { ...deps, onProgress: progress('철새도래지') });
    const boundary = deps.canvas3 || newCanvas(MAP2);
    drawBirdScene(boundary.getContext('2d'), view, { boundaries: data.boundaries, highlight: new Set(data.sites.map(s => s.id)) });
    const { items, scale } = layoutBirdSlide(view, { sites: data.sites, pointName });
    const preview = deps.preview2 || newCanvas(MAP2), previewCtx = preview.getContext('2d');
    previewCtx.drawImage(base, 0, 0);
    previewCtx.drawImage(boundary, 0, 0);
    drawItems(previewCtx, items, FONT);
    out.bird = {
      radiusM: data.birdRadiusM, monthLabel: monthText(data.month), sites: data.sites, labelScale: scale,
      total: data.sites.reduce((sum, s) => sum + (s.count || 0), 0), measured: data.sites.filter(s => s.count !== null).length,
      baseImage: encode(base, backgrounds.bird.mode), boundaryImage: boundary.toDataURL('image/png'), items, credit, preview,
      countsError: data.countsError, allSites: data.sites,
    };
  }
  return out;
}
