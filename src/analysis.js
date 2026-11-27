// 기준점 주변 하천·호수·도로 거리 계산(순수 함수).
import { localProjector, closestOnSegment, originInRing, projectFlat, bboxNear, ringArea } from './geo.js';

const GRADE = { 국가: '국가하천', 지방: '지방하천' };
export const LAKE_GRADE = '호수·저수지';

/** 투영된 평탄 배열의 선분 중 원점에 가장 가까운 점. art[i]가 1인 변은 건너뛴다. */
function nearestOnPath(flat, art) {
  let best = Infinity, point = null;
  for (let i = 0, edge = 0; i + 3 < flat.length; i += 2, edge++) {
    if (art && art[edge]) continue;
    const p = closestOnSegment(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
    const d = Math.hypot(p[0], p[1]);
    if (d < best) { best = d; point = p; }
  }
  return { distance: best, point };
}

function polygonArea(rings) {
  return rings.reduce((total, ring, index) => total + (index ? -1 : 1) * ringArea(ring), 0);
}

/**
 * 하천(국가·지방)과 호수·저수지까지의 최단거리.
 * 면 도형 안에 기준점이 있으면 거리 0(구역 안), 밖이면 경계까지의 거리다.
 * 같은 하천 코드·같은 호수 id로 겹쳐 들어온 도형은 하나로 합친다.
 */
export function measureWaters(features, lat, lon, radiusM) {
  const { forward, inverse } = localProjector(lat, lon);
  const rows = new Map();
  for (const feature of features) {
    if (!bboxNear(feature.bbox, lat, lon, radiusM)) continue;
    let distance = Infinity, point = null, inside = false, area = 0;
    for (const polygon of feature.polys) {
      const projected = polygon.map(ring => projectFlat(ring.xy, forward));
      if (originInRing(projected[0]) && !projected.slice(1).some(originInRing)) {
        distance = 0; point = [0, 0]; inside = true;
      }
      if (feature.kind === 'lake') area += polygonArea(projected);
      if (inside) continue;
      polygon.forEach((ring, index) => {
        const found = nearestOnPath(projected[index], ring.art);
        if (found.distance < distance) { distance = found.distance; point = found.point; }
      });
    }
    if (!point || distance > radiusM) continue;
    const key = feature.kind === 'river' ? 'r:' + feature.code : 'l:' + feature.id;
    const row = {
      key, kind: feature.kind, name: feature.name || '이름 미상',
      grade: feature.kind === 'river' ? GRADE[feature.grade] || feature.grade : LAKE_GRADE,
      distance, inside, point: inverse(point[0], point[1]), area: feature.kind === 'lake' ? area : 0,
    };
    const previous = rows.get(key);
    if (!previous) {
      rows.set(key, row);
    } else {
      previous.area = Math.max(previous.area, row.area);
      if (distance < previous.distance) Object.assign(previous, { distance, point: row.point, inside });
    }
  }
  return [...rows.values()].sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'ko'));
}

export const routeName = route => `${route.kind} ${route.number}번`;

/** 국도·지방도 노선별 최단거리. 한 도형이 여러 노선번호를 가지면 각 노선에 모두 반영한다. */
export function measureRoads(roads, lat, lon, radiusM) {
  const { forward, inverse } = localProjector(lat, lon);
  const rows = new Map();
  for (const road of roads) {
    if (!bboxNear(road.bbox, lat, lon, radiusM)) continue;
    const found = nearestOnPath(projectFlat(road.xy, forward), null);
    if (!found.point || found.distance > radiusM) continue;
    for (const number of road.numbers) {
      const key = road.kind + ':' + number;
      const previous = rows.get(key);
      if (!previous || found.distance < previous.distance) {
        rows.set(key, { key, kind: road.kind, number, distance: found.distance, point: inverse(found.point[0], found.point[1]) });
      }
    }
  }
  return [...rows.values()]
    .map(row => ({ ...row, name: routeName(row) }))
    .sort((a, b) => a.distance - b.distance || a.kind.localeCompare(b.kind, 'ko') || a.number - b.number);
}

/** 철새 조사구역 경계(GeoJSON 면)까지의 거리. 구역 안이면 0. */
export function measureBoundary(geometry, lat, lon) {
  const { forward, inverse } = localProjector(lat, lon);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let distance = Infinity, point = null, inside = false;
  for (const polygon of polygons) {
    const projected = polygon.map(ring => projectFlat(Float64Array.from(ring.flatMap(p => [p[0], p[1]])), forward));
    if (originInRing(projected[0]) && !projected.slice(1).some(originInRing)) return { distance: 0, point: [lon, lat], inside: true };
    for (const ring of projected) {
      const found = nearestOnPath(ring, null);
      if (found.distance < distance) { distance = found.distance; point = found.point; }
    }
  }
  return point ? { distance, point: inverse(point[0], point[1]), inside } : { distance: Infinity, point: null, inside: false };
}
