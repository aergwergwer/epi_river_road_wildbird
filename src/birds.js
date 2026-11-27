// 국립생물자원관 철새 동시센서스: 조사구역 경계 + 월별 개체수.
import { measureBoundary } from './analysis.js';

export const norm = value => String(value || '').normalize('NFKC').replace(/[\s·ㆍ.,，()（）–—-]/g, '');

export const monthText = value => `${value.slice(0, 4)}년 ${Number(value.slice(4))}월`;

/** 선분 a-b 중 box([서,남,동,북]) 안에 들어오는 부분의 가운데 점. 만나지 않으면 null. */
function clipMidpoint(a, b, box) {
  let lo = 0, hi = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - box[0]], [dx, box[2] - a[0]], [-dy, a[1] - box[1]], [dy, box[3] - a[1]]]) {
    if (p === 0) { if (q < 0) return null; } else {
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) return null;
    }
  }
  return [a[0] + dx * (lo + hi) / 2, a[1] + dy * (lo + hi) / 2];
}

/**
 * 지도 범위 안에 들어오는 구역 경계 위의 한 점(라벨 기준점). 원본 웹앱과 같은 방식:
 * 경계선을 순서대로 보며 처음 범위와 만나는 선분의 가운데를 쓰고, 경계가 범위를 지나지 않으면
 * 지도 한가운데가 구역 안일 때만 그 한가운데를 쓴다. 범위와 전혀 겹치지 않으면 null.
 */
export function viewportAnchor(geometry, box) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const point = clipMidpoint(ring[i - 1], ring[i], box);
      if (point) return point;
    }
  }
  const center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  return measureBoundary(geometry, center[1], center[0]).inside ? center : null;
}

/**
 * 지도 범위(box)에 걸치는 조사구역을 모두 거리순으로 돌려준다(반경 밖이라도 지도에 보이면 포함, 원본 방식).
 * 경계 GeoJSON 이름과 조사지역 목록(area_nm)을 이름으로 이어 개체수 조회용 id(area_sno)를 붙인다. 이름이 겹치면 연결하지 않는다.
 * point는 라벨 기준점(지도 범위 안의 경계 위 점), distance는 기준점(lat, lon)에서 구역 경계까지의 최단거리(구역 안이면 0)다.
 */
export function surveySites(boundaries, areas, lat, lon, box) {
  const byName = new Map();
  for (const area of areas) {
    const key = norm(area.area_nm);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(area);
  }
  const sites = [];
  for (const feature of boundaries.features) {
    const geometry = feature.geometry;
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) continue;
    const anchor = viewportAnchor(geometry, box);
    if (!anchor) continue;
    const found = measureBoundary(geometry, lat, lon);
    const name = String(feature.properties?.name || feature.properties?.area_nm || '이름 없음');
    const matches = byName.get(norm(name)) || [];
    const area = matches.length === 1 ? matches[0] : null;
    sites.push({
      id: feature.id, name, geometry, distance: Number.isFinite(found.distance) ? found.distance : null, inside: found.inside, point: anchor,
      nibrId: area?.area_sno ?? null, count: null,
      reason: area ? '선택 월 자료 없음' : matches.length ? '동명 조사지역 확인 필요' : '조사지역명 불일치',
    });
  }
  return sites.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name, 'ko'));
}

/** /api/counts 응답(FeatureCollection)의 cnt_tot을 사이트에 반영한다. */
export function applyCounts(sites, countFeatures) {
  const byId = new Map(countFeatures.map(f => [Number(f.properties.area_sno), f.properties]));
  for (const site of sites) {
    if (!site.nibrId) continue;
    const raw = byId.get(Number(site.nibrId))?.cnt_tot;
    const valid = raw !== null && raw !== undefined && String(raw).trim() !== '' && Number.isSafeInteger(Number(raw)) && Number(raw) >= 0;
    site.count = valid ? Number(raw) : null;
    site.reason = valid ? '' : '선택 월 자료 없음';
  }
  return sites;
}

/** 서버 API 호출. fetchImpl은 테스트에서 바꿔 끼운다. */
export function createBirdApi(fetchImpl = globalThis.fetch.bind(globalThis)) {
  const json = async url => {
    const response = await fetchImpl(url);
    let body;
    try { body = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) throw new Error(body?.error || '철새 자료 서버 오류 (HTTP ' + response.status + ')');
    return body;
  };
  return {
    metadata: () => json('/api/metadata'),
    boundaries: () => json('/api/boundaries'),
    async counts(ids, month) {
      const features = [];
      for (let i = 0; i < ids.length; i += 100) {
        const body = await json('/api/counts?' + new URLSearchParams({ ids: ids.slice(i, i + 100).join(','), month }));
        features.push(...body.features);
      }
      return features;
    },
  };
}
