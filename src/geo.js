// 지리 계산(순수 함수). 브라우저와 Node 테스트에서 같이 쓴다.
export const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MERC_R = 6378137;

/** 기준점 중심 방위등거리 투영. 입력 [경도, 위도] → 출력 [동쪽 m, 북쪽 m]. 기준점으로부터의 거리가 정확하다. */
export function localProjector(lat0, lon0) {
  const phi0 = lat0 * RAD, sin0 = Math.sin(phi0), cos0 = Math.cos(phi0);
  const forward = (lon, lat) => {
    const phi = lat * RAD, delta = (lon - lon0) * RAD;
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const east = cosPhi * Math.sin(delta);
    const north = cos0 * sinPhi - sin0 * cosPhi * Math.cos(delta);
    const dot = sin0 * sinPhi + cos0 * cosPhi * Math.cos(delta);
    const magnitude = Math.hypot(east, north);
    const factor = magnitude ? EARTH_R * Math.atan2(magnitude, dot) / magnitude : 0;
    return [east * factor, north * factor];
  };
  const inverse = (x, y) => {
    const rho = Math.hypot(x, y);
    if (!rho) return [lon0, lat0];
    const c = rho / EARTH_R, sinC = Math.sin(c), cosC = Math.cos(c);
    const lat = Math.asin(cosC * sin0 + (y / rho) * sinC * cos0);
    const lon = lon0 * RAD + Math.atan2((x / rho) * sinC, cosC * cos0 - (y / rho) * sinC * sin0);
    return [lon * DEG, lat * DEG];
  };
  return { forward, inverse };
}

/** 웹 메르카토르(EPSG:3857) 미터 좌표. */
export function mercator(lon, lat) {
  return [MERC_R * lon * RAD, MERC_R * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))];
}
export function unmercator(x, y) {
  return [(x / MERC_R) * DEG, (2 * Math.atan(Math.exp(y / MERC_R)) - Math.PI / 2) * DEG];
}

/** 원점(0,0)에서 선분 a-b까지의 가장 가까운 점. */
export function closestOnSegment(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
  return [ax + t * dx, ay + t * dy];
}

/** 점(0,0)이 링 안에 있는지(짝홀 규칙). ring은 [x0,y0,x1,y1,...] 평탄 배열. */
export function originInRing(flat) {
  let inside = false;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[2 * i], yi = flat[2 * i + 1], xj = flat[2 * j], yj = flat[2 * j + 1];
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 평탄 좌표([lon,lat,...])를 로컬 투영 좌표 평탄 배열로 바꾼다. */
export function projectFlat(xy, forward) {
  const out = new Float64Array(xy.length);
  for (let i = 0; i < xy.length; i += 2) {
    const p = forward(xy[i], xy[i + 1]);
    out[i] = p[0];
    out[i + 1] = p[1];
  }
  return out;
}

/** 경위도 bbox가 기준점 주변 정사각형(반경 + 여유)과 겹치는지. */
export function bboxNear(bbox, lat, lon, radiusM) {
  const dLat = (radiusM / 111320) * 1.02 + 1e-4;
  const dLon = dLat / Math.max(0.2, Math.cos(lat * RAD));
  return !(bbox[2] < lon - dLon || bbox[0] > lon + dLon || bbox[3] < lat - dLat || bbox[1] > lat + dLat);
}

export function bboxOf(xy) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    if (xy[i] < minX) minX = xy[i];
    if (xy[i] > maxX) maxX = xy[i];
    if (xy[i + 1] < minY) minY = xy[i + 1];
    if (xy[i + 1] > maxY) maxY = xy[i + 1];
  }
  return [minX, minY, maxX, maxY];
}

/** 지정 반경(m)의 원 둘레를 경위도 점 배열로. */
export function circlePoints(lat, lon, radiusM, steps = 120) {
  const { inverse } = localProjector(lat, lon);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return inverse(radiusM * Math.sin(a), radiusM * Math.cos(a));
  });
}

/** 투영 좌표 링(평탄)의 면적(㎡). 구멍은 호출자가 빼 준다. */
export function ringArea(flat) {
  let sum = 0;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) sum += flat[2 * j] * flat[2 * i + 1] - flat[2 * i] * flat[2 * j + 1];
  return Math.abs(sum) / 2;
}

export const inKorea = (lat, lon) => lat >= 32 && lat <= 40 && lon >= 124 && lon <= 132;
