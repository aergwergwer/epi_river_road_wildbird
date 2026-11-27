// 슬라이드 위에 올릴 말풍선·표지의 배치(순수 함수). 화면 미리보기와 PPTX가 같은 목록을 쓴다.
// 좌표는 지도 캔버스 픽셀(왼쪽 위 기준, 144px = 1인치). 슬라이드는 13.333 x 7.5 인치다.
import { textWidth } from './render.js';

export const PPI = 144;
export const FACE = '맑은 고딕';
// 1장은 슬라이드 전체가 지도, 2장은 위아래 0.174인치를 비운 지도(top = 지도 윗변의 슬라이드 y, 인치).
export const MAP1 = { width: 1920, height: 1080, top: 0 };
export const MAP2 = { width: 1920, height: 1030, top: 0.174 };

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
const within = (box, W, H, edge) => box.x >= edge && box.y >= edge && box.x + box.w <= W - edge && box.y + box.h <= H - edge;
const clampBox = (value, size, limit, edge) => Math.max(edge, Math.min(limit - size - edge, value));
const units = text => [...String(text)].reduce((n, c) => n + (/[ᄀ-￿]/.test(c) ? 1 : 0.55), 0);

export const kmText = meters => (!Number.isFinite(meters) ? '경계 미확인' : meters === 0 ? '0km' : meters < 50 ? '<0.1km' : (meters / 1000).toFixed(1) + 'km');
export const meterText = row => (row.inside ? '구역 안' : row.distance < 1000 ? Math.round(row.distance) + ' m' : (row.distance / 1000).toFixed(1) + ' km');
export const roadLabel = route => `${route.kind} ${route.number}번`;

// ---- 슬라이드 1: 하천·도로 ----
const BANDS = [1000, 1500, 3000, 5000];
const labelBand = distance => BANDS.find(limit => distance <= limit);
const bigLake = row => row.grade === '호수·저수지' && row.area >= 100000;
const priority = row => (row.grade === '국가하천' ? 0 : row.grade === '지방하천' ? 1 : 2);
const byPriority = (a, b) => Number(bigLake(b)) - Number(bigLake(a)) || priority(a) - priority(b) || (b.area || 0) - (a.area || 0) || a.distance - b.distance;

/** 국도는 파란 타원, 지방도는 노란 사각 표지. 지도 그림에 함께 굽는다. */
export const SIGN = {
  국도: { w: 80, h: 56, fill: '#174f7b', edge: '#ffffff', ink: '#ffffff', ellipse: true },
  지방도: { w: 90, h: 54, fill: '#FFC000', edge: '#111111', ink: '#111111', ellipse: false },
};

/**
 * 1장 배치. 반환: signs(지도에 굽는 도로 표지), items(PPTX 도형).
 * waters/routes는 거리순 전체 목록이다. 하천 말풍선은 거리 구간(1·1.5·3·5km)마다 최대 2개,
 * 10만㎡ 이상 호수·저수지는 항상 붙인다.
 */
export function layoutWaterSlide(view, { waters, routes, pointName, credit, maxRoads = 6 }) {
  const W = view.width, H = view.height;
  const items = [], taken = [], signs = [];
  const [cx, cy] = view.toPx(view.lon, view.lat);
  const free = (box, gap = 6) => !taken.some(t => overlaps(box, t, gap));
  const keep = box => { taken.push(box); return box; };

  if (credit) {
    const w = Math.min(W - 24, textWidth(credit, 18) + 30), h = 28;
    const box = keep({ x: W - w - 12, y: H - h - 12, w, h });
    items.push({ name: '배경지도 출처', shape: 'rect', ...box, fill: 'FFFFFF', opacity: 0.88, text: credit, color: '173440', pt: 9, bold: false });
  }
  keep({ x: cx - 20, y: cy - 20, w: 40, h: 40 });
  items.push({ name: '기준점', shape: 'ellipse', x: cx - 14.5, y: cy - 14.5, w: 29, h: 29, fill: 'A52D2D', line: { color: 'FFFFFF', pt: 1 } });

  if (pointName) {
    const w = Math.max(130, textWidth(pointName, 32) + 40), h = 60;
    const options = [[cx + 24, cy - h - 4], [cx + 24, cy + 6], [cx - 24 - w, cy - h - 4], [cx - 24 - w, cy + 6], [cx - w / 2, cy - h - 30], [cx - w / 2, cy + 30]];
    const box = options.map(([x, y]) => ({ x, y, w, h })).find(b => within(b, W, H, 4) && free(b));
    if (box) {
      keep(box);
      items.push({ name: '조회 지점 이름 (편집 가능)', shape: 'rect', ...box, fill: 'FF0000', text: pointName, color: 'FFFFFF', pt: 16, bold: true, face: FACE });
    }
  }

  // 도로: 번호 표지는 도로 위(가장 가까운 점)에, 이름표(예: 국도 16번)는 표지 옆에 둔다.
  const shownRoutes = routes.slice(0, maxRoads);
  const placedSigns = [];
  for (const route of shownRoutes) {
    const [x, y] = view.toPx(...route.point);
    const spec = SIGN[route.kind];
    let box = null;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const candidate = { x: x + dx * (spec.w + 8) - spec.w / 2, y: y + dy * (spec.h + 8) - spec.h / 2, w: spec.w, h: spec.h };
      if (within(candidate, W, H, 4) && free(candidate, 4)) { box = candidate; break; }
    }
    if (!box) continue;
    keep(box);
    const sign = { ...box, kind: route.kind, number: String(route.number) };
    signs.push(sign);
    placedSigns.push({ sign, route });
  }
  for (const { sign, route } of placedSigns) {
    const text = roadLabel(route), w = textWidth(text, 40) + 44, h = 68;
    const g = 14;
    const options = [
      [sign.x + sign.w + g, sign.y + sign.h / 2 - h / 2], [sign.x - g - w, sign.y + sign.h / 2 - h / 2],
      [sign.x + sign.w / 2 - w / 2, sign.y - g - h], [sign.x + sign.w / 2 - w / 2, sign.y + sign.h + g],
      [sign.x + sign.w + g, sign.y - h - g], [sign.x - g - w, sign.y + sign.h + g], [sign.x + sign.w + g, sign.y + sign.h + g], [sign.x - g - w, sign.y - h - g],
    ].map(([x, y]) => ({ x: clampBox(x, w, W, 6), y: clampBox(y, h, H, 6), w, h }));
    const box = options.find(b => free(b)) || options[0];
    keep(box);
    items.push({ name: `${text} 이름`, shape: 'roundRect', ...box, fill: 'FFFFFF', line: { color: '000000', pt: 1.5 }, text, color: '000000', pt: 20, bold: true });
  }

  // 하천·호수 말풍선: 거리(노랑) + 이름(하늘색).
  const counts = new Map(), shown = new Set(), withBubble = new Set();
  const gaps = [12, 35, 65, 100, 145].map(g => g * 1.5);
  const dirs = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  for (const row of [...waters].sort(byPriority)) {
    const band = labelBand(row.distance), mandatory = bigLake(row), identity = row.grade + ':' + row.name;
    if (!band || (!mandatory && ((counts.get(band) || 0) >= 2 || shown.has(identity)))) continue;
    const [ax, ay] = view.toPx(...row.point);
    const w = Math.max(147, 33 + [...row.name].length * 28.5), nameH = 48, distH = 36, h = nameH + distH;
    const candidates = [];
    for (const gap of gaps) for (const [dx, dy] of dirs) {
      candidates.push({ x: Math.max(12, Math.min(W - w - 12, ax - w / 2 + dx * (w / 2 + gap))), y: Math.max(12, Math.min(H - h - 12, ay - h / 2 + dy * (h / 2 + gap))), w, h });
    }
    let pos = candidates.find(c => free(c));
    if (!pos && mandatory) {
      let nearest = Infinity;
      for (let top = 12; top + h <= H - 12; top += 12) for (let left = 12; left + w <= W - 12; left += 12) {
        const d = (left + w / 2 - ax) ** 2 + (top + h / 2 - ay) ** 2, box = { x: left, y: top, w, h };
        if (d < nearest && free(box)) { nearest = d; pos = box; }
      }
    }
    if (!pos) continue;
    if (!mandatory) counts.set(band, (counts.get(band) || 0) + 1);
    shown.add(identity);
    withBubble.add(row.name);
    keep(pos);
    const distW = 123;
    items.push({ name: `${row.name} 거리`, shape: 'roundRect', x: pos.x + (w - distW) / 2, y: pos.y, w: distW, h: distH, fill: 'FFF200', line: { color: '12212A', pt: 1.4 }, text: meterText(row), color: '000000', pt: 13, bold: true });
    items.push({ name: `${row.name} 하천명`, shape: 'roundRect', x: pos.x, y: pos.y + distH, w, h: nameH, fill: '00E6EE', line: { color: '12212A', pt: 1.4 }, text: row.name, color: '000000', pt: 15, bold: true });
  }

  // 말풍선이 없는 하천은 이름만 반투명 흰 글상자로 붙인다.
  let tags = 0;
  for (const row of waters) {
    if (tags >= 6) break;
    if (row.kind === 'lake' || withBubble.has(row.name) || row.name === '이름 미상') continue;
    const [ax, ay] = view.toPx(...row.point);
    const w = 12 + 25 * [...row.name].length, h = 30;
    const box = [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: ax - w / 2 + dx * (w + 4), y: ay - h / 2 + dy * (h + 4), w, h }))
      .find(b => within(b, W, H, 4) && free(b, 2));
    if (!box) continue;
    keep(box);
    withBubble.add(row.name);
    tags++;
    items.push({ name: `${row.name} 이름`, shape: 'rect', ...box, fill: 'FFFFFF', opacity: 0.875, text: row.name, color: '142B3E', pt: 10.5, bold: true });
  }
  return { signs, items };
}

// ---- 슬라이드 2: 철새도래지 ----
export const siteText = site => `${site.name} ${site.count === null ? '자료 없음' : site.count.toLocaleString('ko-KR') + '수'}`;

/** 2장 배치: 도래지 이름·개체수(회색 칸, 파란 글씨)와 구역 경계까지의 거리(하늘색 칸). */
export function layoutBirdSlide(view, { sites, pointName }) {
  const W = view.width, H = view.height, inch = PPI;
  const items = [], taken = [];
  const [cx, cy] = view.toPx(view.lon, view.lat);
  items.push({ name: '조회 지점', shape: 'ellipse', x: cx - 14.5, y: cy - 14.5, w: 29, h: 29, fill: 'FFFF00', line: { color: 'FF0000', pt: 2.25 } });
  taken.push({ x: cx - 20, y: cy - 20, w: 40, h: 40 });
  if (pointName) {
    const w = Math.min(7 * inch, Math.max(1.65 * inch, textWidth(pointName, 40) + 40)), h = 0.5 * inch;
    const box = { x: clampBox(cx + 0.18 * inch, w, W, 6), y: clampBox(cy - 0.3 * inch, h, H, 6), w, h };
    taken.push(box);
    items.push({ name: '조회 지점 이름 (편집 가능)', shape: 'rect', ...box, fill: 'FF0000', text: pointName, color: 'FFFFFF', pt: 20, bold: true, face: FACE });
  }
  for (const site of sites) {
    const [px, py] = view.toPx(...site.point);
    if (px < 0 || px > W || py < 0 || py > H) continue;
    const text = siteText(site), distance = kmText(site.distance);
    const w = Math.min(5, Math.max(1.8, units(text) * 22 / 72 + 0.18)) * inch, distH = 0.31 * inch, nameH = 0.44 * inch, h = distH + nameH;
    const candidates = [[px - w / 2, py + 0.12 * inch], [px - w / 2, py - h - 0.12 * inch], [px + 0.15 * inch, py - h / 2], [px - w - 0.15 * inch, py - h / 2]];
    for (let i = 1; i <= 8; i++) candidates.push([px - w / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.25 * inch, py + (i % 2 ? 0.2 : -0.3) * i * inch]);
    const fit = ([x, y]) => ({ x: clampBox(x, w, W, 6), y: clampBox(y, h, H, 6), w, h });
    const boxes = candidates.map(fit);
    const open = b => !taken.some(t => overlaps(b, t, 0.08 * inch));
    let box = boxes.find(open);
    if (!box) { // 후보가 모두 막히면 가장 가까운 빈자리를 찾는다. 그래도 없으면 첫 후보를 쓴다.
      let nearest = Infinity;
      for (let top = 6; top + h <= H - 6; top += 14) for (let left = 6; left + w <= W - 6; left += 14) {
        const d = (left + w / 2 - px) ** 2 + (top + h / 2 - py) ** 2, candidate = { x: left, y: top, w, h };
        if (d < nearest && open(candidate)) { nearest = d; box = candidate; }
      }
    }
    box ||= boxes[0];
    taken.push(box);
    items.push({ name: '도래지 이름·개체수 (편집 가능)', shape: 'rect', x: box.x, y: box.y + distH, w, h: nameH, fill: 'EDEDED', line: { color: '0000FF', pt: 1 }, text, color: '0000FF', pt: 22, bold: true, face: FACE });
    items.push({ name: '구역 경계 최단거리 (편집 가능)', shape: 'rect', x: box.x + 0.05 * inch, y: box.y, w: Math.max(0.62, distance.length * 0.18) * inch, h: distH, fill: '00B0F0', text: distance, color: '000000', pt: 20, bold: true, face: FACE });
  }
  return { items };
}

/** 미리보기용: PPTX 도형과 같은 모양으로 캔버스에 그린다. */
export function drawItems(ctx, items, font) {
  ctx.save();
  ctx.textBaseline = 'middle';
  for (const it of items) {
    ctx.beginPath();
    if (it.shape === 'ellipse') ctx.ellipse(it.x + it.w / 2, it.y + it.h / 2, it.w / 2, it.h / 2, 0, 0, 2 * Math.PI);
    else if (it.shape === 'roundRect') ctx.roundRect(it.x, it.y, it.w, it.h, Math.min(it.w, it.h) * 0.16);
    else ctx.rect(it.x, it.y, it.w, it.h);
    if (it.fill) {
      ctx.globalAlpha = it.opacity ?? 1;
      ctx.fillStyle = '#' + it.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (it.line) {
      ctx.lineWidth = it.line.pt * 2;
      ctx.strokeStyle = '#' + it.line.color;
      ctx.stroke();
    }
    if (it.text) {
      ctx.font = `${it.bold ? 'bold ' : ''}${it.pt * 2}px ${font}`;
      ctx.fillStyle = '#' + it.color;
      ctx.textAlign = 'center';
      ctx.fillText(it.text, it.x + it.w / 2, it.y + it.h / 2 + 1, it.w - 8);
    }
  }
  ctx.restore();
}
