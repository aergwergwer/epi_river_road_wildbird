// 국립생물자원관 철새 동시센서스: 조사구역 경계 + 월별 개체수.
import { measureBoundary } from './analysis.js';

export const norm = value => String(value || '').normalize('NFKC').replace(/[\s·ㆍ.,，()（）–—-]/g, '');

export const monthText = value => `${value.slice(0, 4)}년 ${Number(value.slice(4))}월`;

/**
 * 반경 안의 조사구역을 거리순으로 돌려준다. 경계 GeoJSON 이름과 조사지역 목록(area_nm)을
 * 이름으로 이어 개체수 조회용 id(area_sno)를 붙인다. 이름이 겹치면 연결하지 않는다.
 */
export function surveySites(boundaries, areas, lat, lon, radiusM) {
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
    const found = measureBoundary(geometry, lat, lon);
    if (!Number.isFinite(found.distance) || found.distance > radiusM) continue;
    const name = String(feature.properties?.name || feature.properties?.area_nm || '이름 없음');
    const matches = byName.get(norm(name)) || [];
    const area = matches.length === 1 ? matches[0] : null;
    sites.push({
      id: feature.id, name, geometry, distance: found.distance, inside: found.inside, point: found.point,
      nibrId: area?.area_sno ?? null, count: null,
      reason: area ? '선택 월 자료 없음' : matches.length ? '동명 조사지역 확인 필요' : '조사지역명 불일치',
    });
  }
  return sites.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'ko'));
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
