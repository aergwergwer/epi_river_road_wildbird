// 배경지도: OSM·브이월드 래스터 타일, Google Earth Engine Sentinel-2, 배경 없음.
import { cleanKey } from './geocode.js';

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
export const MAX_TILES = 48;

export const BACKGROUNDS = {
  none: { label: '배경 없음 (벡터만)', credit: '' },
  osm: { label: 'OpenStreetMap 일반지도', credit: '© OpenStreetMap contributors', needsKey: false },
  Base: { label: '브이월드 일반지도', credit: '© 공간정보 오픈플랫폼(브이월드)', needsKey: true },
  Satellite: { label: '브이월드 위성지도', credit: '© 공간정보 오픈플랫폼(브이월드)', needsKey: true },
  Hybrid: { label: '브이월드 하이브리드', credit: '© 공간정보 오픈플랫폼(브이월드)', needsKey: true },
  sentinel: { label: 'Google Earth Engine · Sentinel-2', credit: 'Contains modified Copernicus Sentinel data · Earth Engine', needsKey: false },
};

/** 화면 해상도에 맞는 타일 줌과 타일 범위. 타일이 너무 많으면 줌을 낮춘다. */
export function tilePlan(view, maxZoom = 18) {
  let zoom = Math.min(maxZoom, Math.max(3, Math.ceil(Math.log2((EARTH_CIRCUMFERENCE * view.scale) / 256))));
  const range = z => {
    const tile = EARTH_CIRCUMFERENCE / 2 ** z, origin = EARTH_CIRCUMFERENCE / 2, last = 2 ** z - 1;
    const [x0, y0, x1, y1] = view.mercatorBox;
    return {
      z, tile,
      xMin: Math.max(0, Math.floor((x0 + origin) / tile)), xMax: Math.min(last, Math.floor((x1 + origin) / tile)),
      yMin: Math.max(0, Math.floor((origin - y1) / tile)), yMax: Math.min(last, Math.floor((origin - y0) / tile)),
    };
  };
  let plan = range(zoom);
  const count = p => (p.xMax - p.xMin + 1) * (p.yMax - p.yMin + 1);
  while (count(plan) > MAX_TILES && zoom > 3) plan = range(--zoom);
  return { ...plan, count: count(plan) };
}

const vworldUrl = (key, layer, z, x, y) =>
  `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/${layer}/${z}/${y}/${x}.${layer === 'Satellite' ? 'jpeg' : 'png'}`;

export function tileUrls(mode, key, z, x, y) {
  if (mode === 'osm') return [`https://tile.openstreetmap.org/${z}/${x}/${y}.png`];
  if (mode === 'Base') return [vworldUrl(key, 'Base', z, x, y)];
  if (mode === 'Satellite') return [vworldUrl(key, 'Satellite', z, x, y)];
  if (mode === 'Hybrid') return [vworldUrl(key, 'Satellite', z, x, y), vworldUrl(key, 'Hybrid', z, x, y)];
  return [];
}

async function fetchVworldBitmap(url, { fetchImpl = fetch, origin = globalThis.location?.origin || '' } = {}) {
  const target = new URL(url);
  if (origin) target.searchParams.set('domain', origin);
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(target.href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', signal: AbortSignal.timeout(10000) });
    } catch {
      if (attempt < 3) { await new Promise(r => setTimeout(r, attempt * 500)); continue; }
      throw new Error('브이월드 지도 서버에 연결하지 못했습니다. 네트워크 또는 서비스 상태를 확인해 주세요.');
    }
    if (response.ok && /^image\//i.test(response.headers.get('Content-Type') || '')) return createImageBitmap(await response.blob());
    const raw = await response.text();
    const locator = raw.match(/\blocator\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const code = raw.match(/\bexceptionCode\s*=\s*["']([A-Za-z][\w.-]{1,79})["']/i)?.[1] || '';
    if (locator === 'key' || locator === 'domain' || /AUTH|DENIED|PERMISSION|EXPIRED|REGIST|FORBIDDEN/i.test(code)) {
      throw new Error(locator === 'key' ? '브이월드 인증키가 거절되었습니다. 발급한 키와 이용 승인 상태를 확인해 주세요.' : `브이월드 이용 권한 또는 등록 도메인을 확인해 주세요. 등록할 서비스 URL: ${origin}`);
    }
    if ([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526].includes(response.status) && attempt < 3) { await new Promise(r => setTimeout(r, attempt * 500)); continue; }
    throw new Error(`브이월드 지도 응답 오류 (HTTP ${response.status}${code ? ', ' + code : ''}). 서비스 상태와 WMTS 이용 설정을 확인해 주세요.`);
  }
}

function loadPlainImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error('지도 타일 응답 시간이 초과됐습니다.')), 15000);
    image.crossOrigin = 'anonymous';
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('지도 타일을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    image.src = url;
  });
}

/** 같은 URL은 한 번만 받는다(미리보기와 저장이 같은 타일을 쓴다). */
const imageCache = new Map();
export function defaultLoadTile(url) {
  if (!imageCache.has(url)) {
    const pending = (url.startsWith('https://api.vworld.kr/') ? fetchVworldBitmap(url) : loadPlainImage(url));
    imageCache.set(url, pending);
    pending.catch(() => imageCache.delete(url));
  }
  return imageCache.get(url);
}

/**
 * 배경을 그리고 출처 문구를 돌려준다.
 * deps.loadTile(url) → 이미지, deps.sentinel → Earth Engine 이미지(선택).
 */
export async function drawBackground(ctx, view, { mode, key = '', sentinel = null }, { loadTile = defaultLoadTile, onProgress = () => {} } = {}) {
  ctx.fillStyle = '#eef3f4';
  ctx.fillRect(0, 0, view.width, view.height);
  const info = BACKGROUNDS[mode];
  if (!info) throw new Error('알 수 없는 배경지도입니다.');
  if (mode === 'none') return '';
  if (mode === 'sentinel') {
    if (!sentinel) throw new Error('Sentinel-2 영상이 준비되지 않았습니다. Google 로그인부터 완료해 주세요.');
    ctx.drawImage(sentinel, 0, 0, view.width, view.height);
    return info.credit;
  }
  key = cleanKey(key);
  if (info.needsKey && !key) throw new Error('브이월드 인증키를 입력해 주세요.');
  const plan = tilePlan(view);
  const jobs = [];
  for (let x = plan.xMin; x <= plan.xMax; x++) for (let y = plan.yMin; y <= plan.yMax; y++) jobs.push([x, y]);
  const half = EARTH_CIRCUMFERENCE / 2;
  let done = 0, next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [x, y] = jobs[next++];
      const left = view.width / 2 + (-half + x * plan.tile - view.cx) * view.scale;
      const top = view.height / 2 - (half - y * plan.tile - view.cy) * view.scale;
      const size = plan.tile * view.scale;
      for (const url of tileUrls(mode, key, plan.z, x, y)) {
        const image = await loadTile(url);
        ctx.drawImage(image, left, top, size + 0.5, size + 0.5);
      }
      onProgress(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
  return info.credit;
}

/** Earth Engine Sentinel-2 최근 180일 자연색 합성 영상(화면 범위 그대로). */
export async function loadSentinel(view, ee) {
  const [west, south, east, north] = view.mercatorBox;
  const region = ee.Geometry.Rectangle([west, south, east, north], 'EPSG:3857', false);
  const end = new Date(), start = new Date(end.getTime() - 180 * 86400000);
  const day = value => value.toISOString().slice(0, 10);
  const scenes = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(region)
    .filterDate(day(start), day(end)).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 85));
  const image = scenes.map(scene => {
    const scl = scene.select('SCL');
    const clear = scl.eq(4).or(scl.eq(5)).or(scl.eq(6)).or(scl.eq(7));
    return scene.select(['B4', 'B3', 'B2']).updateMask(clear);
  }).median();
  const url = await new Promise((resolve, reject) => {
    image.getThumbURL({ region, crs: 'EPSG:3857', dimensions: `${view.width}x${view.height}`, min: 0, max: 3500, gamma: 1.15, format: 'png' },
      (value, error) => (value ? resolve(value) : reject(new Error(error || 'Earth Engine에서 영상을 생성하지 못했습니다.'))));
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Earth Engine 영상을 가져오지 못했습니다. 프로젝트 권한과 할당량을 확인해 주세요.');
  return createImageBitmap(await response.blob());
}

/**
 * Earth Engine 클라이언트 라이브러리를 필요할 때만 불러온다.
 * vendor/ee_api_js.js 가 있으면 그것을 쓰고(권장: tools/vendor-ee.sh), 없으면 CDN을 쓴다.
 * CDN 주소는 버전이 고정되지 않은 master 브랜치다.
 */
export async function loadEarthEngineLibrary() {
  if (globalThis.ee) return { local: globalThis.__eeLocal === true };
  const local = await fetch('vendor/ee_api_js.js', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
  const src = local ? 'vendor/ee_api_js.js' : 'https://cdn.jsdelivr.net/gh/google/earthengine-api@master/javascript/build/ee_api_js.js';
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Earth Engine 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    document.head.append(script);
  });
  globalThis.__eeLocal = local;
  return { local };
}
