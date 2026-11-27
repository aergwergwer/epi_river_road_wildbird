// 슬라이드 지도 그리기. 지도 그림(벡터 레이어·범례)은 캔버스에 굽고,
// 번호표·노선표·이름표는 겹침을 피해 배치한 뒤 PPTX에서는 편집 가능한 도형으로 올린다.
import { circlePoints } from './geo.js';

export const COLORS = {
  national: '#123d89', local: '#36a9df', lake: '#00877e', bird: '#6b57d6',
  road: { 국도: '#d9531e', 지방도: '#e6a700' }, ink: '#173440', point: '#c62828',
};
export const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans CJK KR","Noto Sans KR",system-ui,sans-serif';

const intersects = (box, view) => !(box[2] < view.bbox[0] || box[0] > view.bbox[2] || box[3] < view.bbox[1] || box[1] > view.bbox[3]);

function screenRing(view, xy) {
  const out = new Float64Array(xy.length);
  for (let i = 0; i < xy.length; i += 2) {
    const p = view.toPx(xy[i], xy[i + 1]);
    out[i] = p[0];
    out[i + 1] = p[1];
  }
  return out;
}

function tracePolygon(ctx, rings) {
  ctx.beginPath();
  for (const px of rings) {
    ctx.moveTo(px[0], px[1]);
    for (let i = 2; i < px.length; i += 2) ctx.lineTo(px[i], px[i + 1]);
    ctx.closePath();
  }
}

/** 실제 경계만 선으로 긋는다(타일 클리핑으로 생긴 인위적 변은 건너뜀). */
function strokeEdges(ctx, px, art) {
  ctx.beginPath();
  let pen = false;
  for (let i = 0, edge = 0; i + 3 < px.length; i += 2, edge++) {
    if (art && art[edge]) { pen = false; continue; }
    if (!pen) { ctx.moveTo(px[i], px[i + 1]); pen = true; }
    ctx.lineTo(px[i + 2], px[i + 3]);
  }
  ctx.stroke();
}

function drawAreas(ctx, view, features, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const feature of features) {
    if (!intersects(feature.bbox, view)) continue;
    for (const polygon of feature.polys) {
      const px = polygon.map(ring => screenRing(view, ring.xy));
      tracePolygon(ctx, px);
      ctx.fill('evenodd');
      polygon.forEach((ring, i) => strokeEdges(ctx, px[i], ring.art));
    }
  }
}

function drawRadius(ctx, view) {
  ctx.save();
  ctx.setLineDash([16, 11]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3a3a3a';
  ctx.beginPath();
  circlePoints(view.lat, view.lon, view.radiusM).forEach(([lon, lat], i) => {
    const [x, y] = view.toPx(lon, lat);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

/** 슬라이드 1 지도: 하천·호수 면, 국도·지방도 선, 조회 반경. */
export function drawWaterRoadScene(ctx, view, { rivers, lakes, roads }) {
  // 타일 이음매에서 같은 하천이 겹쳐 들어오므로, 불투명으로 따로 그린 뒤 한 번에 합성한다(겹침이 진하게 보이지 않도록).
  const layer = ctx.canvas.ownerDocument.createElement('canvas');
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const layerCtx = layer.getContext('2d');
  drawAreas(layerCtx, view, lakes, COLORS.lake, '#00665f');
  drawAreas(layerCtx, view, rivers.filter(r => r.grade === '지방'), COLORS.local, '#2386b8');
  drawAreas(layerCtx, view, rivers.filter(r => r.grade === '국가'), COLORS.national, '#0b2a63');
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  const visible = roads.filter(road => intersects(road.bbox, view));
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const [width, color] of [[9, () => '#ffffff'], [5, road => COLORS.road[road.kind]]]) {
    ctx.lineWidth = width;
    for (const road of visible) {
      ctx.strokeStyle = color(road);
      const px = screenRing(view, road.xy);
      ctx.beginPath();
      ctx.moveTo(px[0], px[1]);
      for (let i = 2; i < px.length; i += 2) ctx.lineTo(px[i], px[i + 1]);
      ctx.stroke();
    }
  }
  drawRadius(ctx, view);
}

/** 슬라이드 2 지도: 철새 조사구역 경계와 조회 반경. boundaries는 GeoJSON Feature 배열. */
export function drawBirdScene(ctx, view, { boundaries, highlight = new Set() }) {
  ctx.lineJoin = 'round';
  for (const feature of boundaries) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const listed = highlight.has(feature.id);
    ctx.fillStyle = listed ? 'rgba(107,87,214,0.50)' : 'rgba(107,87,214,0.18)';
    ctx.strokeStyle = listed ? '#4b3bb3' : 'rgba(75,59,179,0.55)';
    ctx.lineWidth = listed ? 3 : 2;
    for (const polygon of polygons) {
      const px = polygon.map(ring => screenRing(view, Float64Array.from(ring.flatMap(p => [p[0], p[1]]))));
      tracePolygon(ctx, px);
      ctx.fill('evenodd');
      ctx.stroke();
    }
  }
  drawRadius(ctx, view);
}

export function niceLength(maxMeters) {
  for (const length of [20000, 10000, 5000, 2000, 1000, 500, 200, 100]) if (length <= maxMeters) return length;
  return 50;
}

/** 범례, 축척, 북쪽 표시, 출처. 지도 이미지에 함께 굽는다. */
export function drawFurniture(ctx, view, { legend, credit }) {
  const pad = 14, font = 22;
  ctx.save();
  ctx.font = `${font}px ${FONT}`;
  ctx.textBaseline = 'middle';
  // 범례
  const rows = legend.length, boxW = 40 + Math.max(...legend.map(l => ctx.measureText(l.label).width)) + 30, boxH = rows * 34 + 18;
  const left = pad, top = view.height - boxH - 46;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(left, top, boxW, boxH);
  legend.forEach((item, i) => {
    const y = top + 26 + i * 34;
    ctx.fillStyle = item.color;
    if (item.line) ctx.fillRect(left + 12, y - 3, 28, 6); else ctx.fillRect(left + 12, y - 10, 28, 20);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(item.label, left + 52, y);
  });
  // 축척
  const length = niceLength(view.width * 0.22 / view.pxPerMeter), barPx = length * view.pxPerMeter;
  const x1 = view.width - pad - barPx, y1 = view.height - 70;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x1 - 10, y1 - 34, barPx + 20, 56);
  ctx.fillStyle = '#222';
  ctx.fillRect(x1, y1, barPx, 5);
  ctx.textAlign = 'center';
  ctx.fillText(length >= 1000 ? length / 1000 + ' km' : length + ' m', x1 + barPx / 2, y1 - 14);
  // 북쪽
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(view.width - 66, 14, 52, 70);
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.moveTo(view.width - 40, 22); ctx.lineTo(view.width - 26, 58); ctx.lineTo(view.width - 40, 50); ctx.lineTo(view.width - 54, 58); ctx.closePath();
  ctx.fill();
  ctx.fillText('N', view.width - 40, 72);
  // 출처
  if (credit) {
    ctx.font = `18px ${FONT}`;
    ctx.textAlign = 'right';
    const w = ctx.measureText(credit).width + 16;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(view.width - w, view.height - 28, w, 28);
    ctx.fillStyle = '#333';
    ctx.fillText(credit, view.width - 8, view.height - 14);
  }
  ctx.restore();
}

export function textWidth(text, fontPx) {
  return [...String(text)].reduce((sum, ch) => sum + (ch.charCodeAt(0) >= 0x1100 ? 1 : 0.58), 0) * fontPx;
}

const OFFSETS = size => [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1], [0, -2], [0, 2], [2, 0], [-2, 0], [2, -1], [-2, -1], [2, 1], [-2, 1]]
  .map(([dx, dy]) => [dx * (size[0] + 5), dy * (size[1] + 5)]);

const overlap = (a, b, gap = 3) => a.x - a.w / 2 < b.x + b.w / 2 + gap && a.x + a.w / 2 + gap > b.x - b.w / 2 && a.y - a.h / 2 < b.y + b.h / 2 + gap && a.y + a.h / 2 + gap > b.y - b.h / 2;

/**
 * 오버레이 배치. 모든 좌표는 지도 캔버스 픽셀(도형 중심 기준).
 * badges: [{x, y, text, kind: 'num'|'국도'|'지방도', fill, name?}] 는 우선순위 순서.
 * 겹치면 기준점 가까이의 빈 자리를 찾고, 이름표는 빈 자리가 있을 때만 붙인다.
 */
export function layoutOverlay(view, { pointName, badges }) {
  const items = [], taken = [];
  const inside = box => box.x - box.w / 2 >= 4 && box.x + box.w / 2 <= view.width - 4 && box.y - box.h / 2 >= 4 && box.y + box.h / 2 <= view.height - 4;
  const [cx, cy] = view.toPx(view.lon, view.lat);
  const center = { type: 'center', x: cx, y: cy, w: 30, h: 30 };
  items.push(center);
  taken.push(center);
  if (pointName) {
    const w = textWidth(pointName, 24) + 26, h = 38;
    const options = [[cx + 24 + w / 2, cy - 4], [cx - 24 - w / 2, cy - 4], [cx, cy - 36], [cx, cy + 40]];
    const box = options.map(([x, y]) => ({ type: 'pointName', x, y, w, h, text: pointName })).find(b => inside(b) && !taken.some(t => overlap(b, t)));
    if (box) { items.push(box); taken.push(box); }
  }
  const placed = [];
  for (const badge of badges) {
    const size = badge.kind === '국도' ? [66, 46] : badge.kind === '지방도' ? [70, 44] : [46, 46];
    let chosen = null;
    for (const [dx, dy] of OFFSETS(size)) {
      const box = { x: badge.x + dx, y: badge.y + dy, w: size[0], h: size[1] };
      if (inside(box) && !taken.some(t => overlap(box, t))) { chosen = box; break; }
    }
    chosen ||= { x: Math.min(view.width - size[0] / 2 - 4, Math.max(size[0] / 2 + 4, badge.x)), y: Math.min(view.height - size[1] / 2 - 4, Math.max(size[1] / 2 + 4, badge.y)), w: size[0], h: size[1] };
    const item = { type: 'badge', kind: badge.kind, text: String(badge.text), fill: badge.fill, name: badge.name, ...chosen };
    items.push(item);
    taken.push(item);
    placed.push(item);
  }
  for (const item of placed) {
    if (!item.name) continue;
    const w = textWidth(item.name, 22) + 18, h = 32;
    const options = [[item.x + item.w / 2 + 6 + w / 2, item.y], [item.x - item.w / 2 - 6 - w / 2, item.y], [item.x, item.y - item.h / 2 - 4 - h / 2], [item.x, item.y + item.h / 2 + 4 + h / 2]];
    const box = options.map(([x, y]) => ({ type: 'name', x, y, w, h, text: item.name })).find(b => inside(b) && !taken.some(t => overlap(b, t, 2)));
    if (box) { items.push(box); taken.push(box); }
  }
  return items;
}

/** 미리보기용: PPTX에 올라갈 도형을 캔버스에도 같은 모양으로 그린다. */
export function drawOverlay(ctx, items) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const item of items) {
    ctx.beginPath();
    if (item.type === 'center') {
      ctx.arc(item.x, item.y, 12, 0, 2 * Math.PI);
      ctx.fillStyle = COLORS.point;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      continue;
    }
    if (item.type === 'badge' && item.kind === '국도') ctx.ellipse(item.x, item.y, item.w / 2, item.h / 2, 0, 0, 2 * Math.PI);
    else if (item.type === 'badge' && item.kind !== 'num') ctx.roundRect(item.x - item.w / 2, item.y - item.h / 2, item.w, item.h, 6);
    else if (item.type === 'badge') ctx.arc(item.x, item.y, item.w / 2, 0, 2 * Math.PI);
    else ctx.roundRect(item.x - item.w / 2, item.y - item.h / 2, item.w, item.h, 6);
    if (item.type === 'badge') {
      ctx.fillStyle = item.fill;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = item.kind === '지방도' ? '#222' : '#fff';
      ctx.stroke();
      ctx.fillStyle = item.kind === '지방도' ? '#111' : '#fff';
      ctx.font = `bold 26px ${FONT}`;
    } else {
      ctx.fillStyle = item.type === 'pointName' ? COLORS.point : 'rgba(255,255,255,0.88)';
      ctx.fill();
      ctx.fillStyle = item.type === 'pointName' ? '#fff' : COLORS.ink;
      ctx.font = `${item.type === 'pointName' ? 'bold 24' : '22'}px ${FONT}`;
    }
    ctx.fillText(item.text, item.x, item.y + 1, item.w - 6);
  }
  ctx.restore();
}
