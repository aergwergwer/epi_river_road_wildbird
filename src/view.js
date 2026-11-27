// 슬라이드 지도 한 장의 화면 구성: 웹 메르카토르 기준, 기준점이 중심.
import { mercator, unmercator } from './geo.js';

const RAD = Math.PI / 180;

/**
 * width×height(px) 캔버스에 반경 radiusM(m)의 원이 짧은 변의 fill 비율만큼 들어오도록 맞춘다.
 * scale = 메르카토르 1m당 픽셀 수.
 */
export function makeView({ lat, lon, radiusM, width, height, fill = 0.8 }) {
  if (![lat, lon, radiusM, width, height].every(Number.isFinite) || radiusM <= 0) throw new Error('지도 범위를 계산할 수 없습니다.');
  const [cx, cy] = mercator(lon, lat);
  const k = 1 / Math.cos(lat * RAD); // 메르카토르 확대율
  const scale = (fill * Math.min(width, height)) / (2 * radiusM * k);
  const halfW = width / 2 / scale, halfH = height / 2 / scale;
  const [west, south] = unmercator(cx - halfW, cy - halfH);
  const [east, north] = unmercator(cx + halfW, cy + halfH);
  return {
    lat, lon, radiusM, width, height, scale, cx, cy, k,
    bbox: [west, south, east, north],
    mercatorBox: [cx - halfW, cy - halfH, cx + halfW, cy + halfH],
    toPx(pointLon, pointLat) {
      const [mx, my] = mercator(pointLon, pointLat);
      return [width / 2 + (mx - cx) * scale, height / 2 - (my - cy) * scale];
    },
    /** 지상 1m가 차지하는 픽셀 수(기준점 위도). */
    pxPerMeter: scale * k,
  };
}
