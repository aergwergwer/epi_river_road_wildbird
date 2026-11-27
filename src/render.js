// 슬라이드 지도 그리기: 하천·호수 면, 국도·지방도 선과 번호 표지, 철새 조사구역 경계를 캔버스에 굽는다.
// 말풍선·이름표는 layout.js가 배치하고 PPTX에서는 편집 가능한 도형으로 올린다.

export const COLORS = {
  national: '#123d89', local: '#36a9df', lake: '#00877e', bird: '#6b57d6',
  ink: '#173440',
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

/**
 * 슬라이드 1 지도: 하천·호수 면과 국도·지방도 선. 국도는 굵게, 지방도는 가늘게 그려 구분하고
 * 위성·일반 어느 배경에서도 보이도록 흰 선 아래에 옅은 테두리를 깐다.
 */
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
  const width = { 국도: 13, 지방도: 7 };
  for (const [extra, color] of [[4, 'rgba(15,25,35,0.30)'], [0, '#ffffff']]) {
    for (const kind of ['지방도', '국도']) {
      ctx.lineWidth = width[kind] + extra;
      ctx.strokeStyle = color;
      for (const road of visible) {
        if (road.kind !== kind) continue;
        const px = screenRing(view, road.xy);
        ctx.beginPath();
        ctx.moveTo(px[0], px[1]);
        for (let i = 2; i < px.length; i += 2) ctx.lineTo(px[i], px[i + 1]);
        ctx.stroke();
      }
    }
  }
}

/** 슬라이드 2 지도: 철새 조사구역 경계(투명 캔버스에 그려 따로 올린다). boundaries는 GeoJSON Feature 배열. */
export function drawBirdScene(ctx, view, { boundaries, highlight = new Set() }) {
  ctx.lineJoin = 'round';
  for (const feature of boundaries) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const listed = highlight.has(feature.id);
    if (!listed) continue; // 체크를 해제한 조사구역은 보라색 구역도 그리지 않는다
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
}

export function textWidth(text, fontPx) {
  return [...String(text)].reduce((sum, ch) => sum + (ch.charCodeAt(0) >= 0x1100 ? 1 : 0.58), 0) * fontPx;
}

/** GIS 엑셀 지점: 엑셀 '표현색'(없으면 주황)의 점에 흰 테두리. groups는 groupGis의 묶음 목록으로, 묶음 안의 모든 좌표에 점을 찍는다. */
export function drawGisDots(ctx, view, groups) {
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  for (const group of groups) for (const p of group.points) {
    const [x, y] = view.toPx(p.lon, p.lat);
    ctx.fillStyle = '#' + (p.color || 'E8590C');
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
