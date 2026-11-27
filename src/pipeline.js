// 조회(데이터 → 행)와 슬라이드 지도 렌더링(행 → 이미지·도형). UI와 분리해 테스트할 수 있게 둔다.
import { inKorea } from './geo.js';
import { makeView } from './view.js';
import { measureWaters, measureRoads } from './analysis.js';
import { surveySites, applyCounts, monthText } from './birds.js';
import { groupGis, gisInside } from './gis.js';
import { drawBackground } from './basemap.js';
import { MAP1, MAP2, RADIUS_FILL, layoutWaterSlide, layoutBirdSlide, drawItems } from './layout.js';
import { FONT, drawWaterRoadScene, drawBirdScene, drawGisDots } from './render.js';

export const SLIDE_ROWS = { roads: 6 }; // 도로 이름표는 지도에 최대 6개 노선(나머지는 표·노트)

export function parseCoordinate(latText, lonText) {
  const lat = Number(latText), lon = Number(lonText);
  if (String(latText).trim() === '' || String(lonText).trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('위도와 경도를 숫자로 입력해 주세요.');
  if (!inKorea(lat, lon)) throw new Error('내장 데이터는 대한민국 범위(위도 32~40, 경도 124~132)만 지원합니다. 좌표를 확인해 주세요. 위도와 경도를 바꿔 입력했을 수 있습니다.');
  return { lat, lon };
}

/** 위치 하나에 대한 하천·도로·철새도래지 조회. */
/** 경계 자료의 출처 상태. snapshot이 true/false가 아니면(서버가 알려주지 않음) null로 두고 '미확인'으로 다룬다. 없는 수집일은 지어내지 않는다. */
export function boundaryInfo(boundaries) {
  const at = typeof boundaries?.retrievedAt === 'string' && !Number.isNaN(Date.parse(boundaries.retrievedAt)) ? boundaries.retrievedAt : '';
  return { snapshot: boundaries?.snapshot === true ? true : boundaries?.snapshot === false ? false : null, retrievedAt: at, source: typeof boundaries?.source === 'string' ? boundaries.source : '' };
}

export async function lookup({ lat, lon, waterRadiusM, birdRadiusM, month, store, birdApi, birdContext, gisPoints = [], onStatus = () => {} }) {
  const waterView = makeView({ lat, lon, radiusM: waterRadiusM, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
  onStatus('하천·호수·도로 데이터를 읽는 중…');
  const [rivers, lakes, roads] = await Promise.all(['rivers', 'lakes', 'roads'].map(layer => store.load(layer, waterView.bbox)));
  const waters = measureWaters([...rivers, ...lakes], lat, lon, waterRadiusM);
  const routes = measureRoads(roads, lat, lon, waterRadiusM);

  onStatus('철새 조사구역과 개체수를 조회하는 중…');
  const birdView = makeView({ lat, lon, radiusM: birdRadiusM, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL });
  const sites = surveySites(birdContext.boundaries, birdContext.meta.areas, lat, lon, birdView.bbox);
  // GIS 엑셀: 지도 범위의 지점은 묶어서 칸으로, 철새 권역(조사구역) 안의 지점은 구분별로 센다.
  const gis = groupGis(gisPoints, lat, lon, birdView.bbox);
  for (const site of sites) site.gis = gisPoints.length ? gisInside(site.geometry, gisPoints) : [];
  const ids = sites.filter(s => s.nibrId).map(s => s.nibrId);
  let countsError = null;
  if (ids.length) {
    // 개체수 조회가 실패해도 경계·거리는 보여 준다. 호출자가 경고를 띄운다.
    try { applyCounts(sites, await birdApi.counts(ids, month)); } catch (error) { countsError = error.message; }
  }
  return { lat, lon, waterRadiusM, birdRadiusM, month, rivers, lakes, roads, waters, routes, sites, gis, countsError, boundaries: birdContext.boundaries.features,
    boundaryInfo: boundaryInfo(birdContext.boundaries), generatedAt: new Date().toISOString() };
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
  // scene = 배경지도. 하천·도로 도형, 번호 표지, 말풍선은 체크한 항목에 따라 매번 다시 얹는다.
  {
    const view = makeView({ lat: data.lat, lon: data.lon, radiusM: data.waterRadiusM, width: MAP1.width, height: MAP1.height, fill: RADIUS_FILL });
    const scene = deps.canvas1 || newCanvas(MAP1), ctx = scene.getContext('2d'); // 배경지도만(하천·도로 도형은 체크 상태에 맞춰 매번 새로 얹는다)
    onStatus('하천·도로 배경지도를 그리는 중…');
    const bgCredit = await drawBackground(ctx, view, await withSentinel(backgrounds.water, view, deps), { ...deps, onProgress: progress('하천·도로') });
    const credit = ['하천: 기후에너지환경부', '도로: 국토지리정보원', bgCredit].filter(Boolean).join(' · ');
    const final = deps.canvas1b || newCanvas(MAP1);
    const preview = deps.preview1 || newCanvas(MAP1);
    out.water = { radiusM: data.waterRadiusM, rivers: data.waters, roads: data.routes, credit: bgCredit, preview, allWaters: data.waters, allRoutes: data.routes };
    // chosen이 없으면 원본 기준으로 고르고, 있으면 {waters, routes}(Set)에 든 항목만 지도에 올린다.
    out.water.relayout = (chosen = {}) => {
      const { items, bubbled, signed } = layoutWaterSlide(view, {
        waters: data.waters, routes: data.routes, pointName, credit, maxRoads: SLIDE_ROWS.roads,
        chosenWaters: chosen.waters || null, chosenRoutes: chosen.routes || null,
      });
      // 하천·호수 면과 도로 선도 체크한 항목만 그린다(해제한 항목의 도형·이름표·번호 표지는 모두 사라진다).
      const fctx = final.getContext('2d');
      fctx.clearRect(0, 0, final.width, final.height);
      fctx.drawImage(scene, 0, 0);
      drawWaterRoadScene(fctx, view, data, { waters: new Set(bubbled.map(r => r.key)), routes: new Set(signed.map(r => r.key)) });
      const pctx = preview.getContext('2d');
      pctx.drawImage(final, 0, 0);
      drawItems(pctx, items, FONT);
      Object.assign(out.water, { image: encode(final, backgrounds.water.mode), items, labeled: new Set(bubbled), signed: new Set(signed) });
      return out.water;
    };
    out.water.relayout();
  }

  // 슬라이드 2: 철새도래지 (지도 + 조사구역 경계 이미지를 따로 올린다)
  {
    const view = makeView({ lat: data.lat, lon: data.lon, radiusM: data.birdRadiusM, width: MAP2.width, height: MAP2.height, fill: RADIUS_FILL });
    const base = deps.canvas2 || newCanvas(MAP2), baseCtx = base.getContext('2d');
    onStatus('철새도래지 배경지도를 그리는 중…');
    const credit = await drawBackground(baseCtx, view, await withSentinel(backgrounds.bird, view, deps), { ...deps, onProgress: progress('철새도래지') });
    const boundary = deps.canvas3 || newCanvas(MAP2);
    const preview = deps.preview2 || newCanvas(MAP2);
    out.bird = {
      radiusM: data.birdRadiusM, monthLabel: monthText(data.month), sites: data.sites, credit, preview, gis: data.gis, allGis: data.gis, boundaryInfo: data.boundaryInfo, generatedAt: data.generatedAt,
      baseImage: encode(base, backgrounds.bird.mode), countsError: data.countsError, allSites: data.sites,
    };
    // chosen: 지도에 올릴 조사구역 Set. 없으면 지도 범위의 전부.
    out.bird.relayout = (chosen = null, chosenGis = null) => {
      const picked = chosen ? data.sites.filter(site => chosen.has(site)) : data.sites;
      const pickedGis = chosenGis ? data.gis.filter(group => chosenGis.has(group)) : data.gis;
      const bctx = boundary.getContext('2d');
      bctx.clearRect(0, 0, boundary.width, boundary.height);
      drawBirdScene(bctx, view, { boundaries: data.boundaries, highlight: new Set(picked.map(site => site.id)) });
      drawGisDots(bctx, view, pickedGis);
      const { items, scale } = layoutBirdSlide(view, { sites: [...picked, ...pickedGis], pointName });
      const pctx = preview.getContext('2d');
      pctx.drawImage(base, 0, 0);
      pctx.drawImage(boundary, 0, 0);
      drawItems(pctx, items, FONT);
      Object.assign(out.bird, {
        items, labelScale: scale, boundaryImage: boundary.toDataURL('image/png'), labeled: new Set(picked), labeledGis: new Set(pickedGis),
        total: picked.reduce((sum, site) => sum + (site.count || 0), 0), measured: picked.filter(site => site.count !== null).length,
      });
      return out.bird;
    };
    out.bird.relayout();
  }
  return out;
}
