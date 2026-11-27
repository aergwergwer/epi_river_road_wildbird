// 슬라이드 위에 올릴 말풍선·표지의 배치(순수 함수). 화면 미리보기와 PPTX가 같은 목록을 쓴다.
// 좌표는 지도 캔버스 픽셀(왼쪽 위 기준, 144px = 1인치). 슬라이드는 13.333 x 7.5 인치다.
import { textWidth } from './render.js';

export const PPI = 144;
export const FACE = '맑은 고딕';
// 1장은 슬라이드 전체가 지도, 2장은 위아래 0.174인치를 비운 지도(top = 지도 윗변의 슬라이드 y, 인치).
export const MAP1 = { width: 1920, height: 1080, top: 0 };
export const MAP2 = { width: 1920, height: 1030, top: 0.174 };
// 원본 웹앱과 같은 지도 크기: 조회 반경 원이 지도 높이의 약 95.8%(원본은 반경 345px / 반높이 360px)를 차지한다.
export const RADIUS_FILL = 345 / 360;

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
// chosenWaters / chosenRoutes: 사용자가 체크한 항목(Set). 없으면 원본 기준(거리 구간별 2곳 등)으로 고른다.
export function layoutWaterSlide(view, { waters, routes, rivers = [], pointName, credit, maxRoads = 6, chosenWaters = null, chosenRoutes = null }) {
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
  const shownRoutes = chosenRoutes ? routes.filter(r => chosenRoutes.has(r)) : routes.slice(0, maxRoads);
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
  const counts = new Map(), shown = new Set(), withBubble = new Set(), bubbled = [];
  const gaps = [12, 35, 65, 100, 145].map(g => g * 1.5);
  const dirs = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  const pool = chosenWaters ? waters.filter(r => chosenWaters.has(r)) : waters;
  for (const row of [...pool].sort(byPriority)) {
    const band = labelBand(row.distance), identity = row.grade + ':' + row.name;
    const mandatory = chosenWaters ? true : bigLake(row); // 체크한 항목은 빠뜨리지 않는다
    if (!chosenWaters && (!band || (!mandatory && ((counts.get(band) || 0) >= 2 || shown.has(identity))))) continue;
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
    if (!mandatory && band) counts.set(band, (counts.get(band) || 0) + 1);
    shown.add(identity);
    if (row.kind !== 'lake') withBubble.add(row.name);
    bubbled.push(row);
    keep(pos);
    const distW = 123;
    items.push({ name: `${row.name} 거리`, shape: 'roundRect', x: pos.x + (w - distW) / 2, y: pos.y, w: distW, h: distH, fill: 'FFF200', line: { color: '12212A', pt: 1.4 }, text: meterText(row), color: '000000', pt: 13, bold: true });
    items.push({ name: `${row.name} 하천명`, shape: 'roundRect', x: pos.x, y: pos.y + distH, w, h: nameH, fill: '00E6EE', line: { color: '12212A', pt: 1.4 }, text: row.name, color: '000000', pt: 15, bold: true });
  }

  // 거리 말풍선이 없는 하천은 이름만 반투명 흰 글상자로 하천 위에 붙인다(원본 방식: 화면에 보이는 모든 이름 있는 하천).
  const tagBoxes = [];
  const overlapsAny = box => taken.some(t => overlaps(box, t, 3)) || tagBoxes.some(t => overlaps(box, t, 3));
  for (const river of visibleRiverNames(view, rivers).sort((a, b) => [...b.name].length - [...a.name].length)) {
    if (withBubble.has(river.name)) continue;
    const w = Math.max(57, [...river.name].length * 22.5 + 18), h = 30;
    const at = dy => ({ x: Math.max(6, Math.min(W - w - 6, river.x - w / 2)), y: Math.max(6, Math.min(H - h - 6, river.y - h / 2 + dy)), w, h });
    const offsets = [0, -24, 24, -48, 48, -72, 72, -96, 96].map(v => v * 1.5);
    let box = offsets.map(at).find(b => !overlapsAny(b));
    if (!box) {
      let nearest = Infinity;
      for (let top = 6; top + h <= H - 6; top += 18) for (let left = 6; left + w <= W - 6; left += 27) {
        const candidate = { x: left, y: top, w, h }, d = (left - river.x) ** 2 + (top - river.y) ** 2;
        if (d < nearest && !overlapsAny(candidate)) { nearest = d; box = candidate; }
      }
    }
    if (!box) continue;
    tagBoxes.push(box);
    items.push({ name: `${river.name} 이름`, shape: 'rect', ...box, fill: 'FFFFFF', opacity: 0.875, text: river.name, color: '142B3E', pt: 10.5, bold: true });
  }
  return { signs, items, bubbled, signed: placedSigns.map(p => p.route) };
}

/**
 * 화면에 보이는 이름 있는 하천마다 가장 길게 보이는 선분의 가운데를 돌려준다(하천 코드 기준, 타일 클리핑 변은 제외).
 */
function visibleRiverNames(view, rivers) {
  const W = view.width, H = view.height, names = new Map();
  for (const river of rivers) {
    if (!river.name || river.kind === 'lake' || !river.polys) continue;
    if (river.bbox && (river.bbox[2] < view.bbox[0] || river.bbox[0] > view.bbox[2] || river.bbox[3] < view.bbox[1] || river.bbox[1] > view.bbox[3])) continue;
    const key = river.code || river.name;
    for (const polygon of river.polys) for (const ring of polygon) {
      let px = null;
      for (let i = 0, edge = 0; i + 3 < ring.xy.length; i += 2, edge++) {
        const a = px || view.toPx(ring.xy[i], ring.xy[i + 1]), b = view.toPx(ring.xy[i + 2], ring.xy[i + 3]);
        px = b;
        if (ring.art && ring.art[edge]) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        let start = 0, end = 1;
        for (const [p, q] of [[-dx, a[0]], [dx, W - a[0]], [-dy, a[1]], [dy, H - a[1]]]) {
          if (p < 0) start = Math.max(start, q / p);
          else if (p > 0) end = Math.min(end, q / p);
          else if (q < 0) end = -1;
        }
        const length = (end - start) * Math.hypot(dx, dy);
        if (length > (names.get(key)?.length || 0)) {
          const t = (start + end) / 2;
          names.set(key, { name: river.name, x: a[0] + t * dx, y: a[1] + t * dy, length });
        }
      }
    }
  }
  return [...names.values()];
}

// ---- 슬라이드 2: 철새도래지 ----
export const siteText = site => `${site.name} ${site.count === null ? '자료 없음' : site.count.toLocaleString('ko-KR') + '수'}`;

/**
 * 2장 배치: 도래지 이름·개체수(회색 칸, 파란 글씨)와 구역 경계까지의 거리(하늘색 칸).
 * 지도 범위 안의 조사구역을 하나도 빼지 않고 모두 올린다. 한 번에 다 못 앉으면 칸과 글자를 단계적으로 줄여 다시 배치한다.
 * site.point는 지도 범위 안에 있는 구역 경계 위의 한 점(라벨 기준점)이다.
 */
export function layoutBirdSlide(view, { sites, pointName }) {
  const W = view.width, H = view.height, inch = PPI;
  const [cx, cy] = view.toPx(view.lon, view.lat);
  const fixed = [{ name: '조회 지점', shape: 'ellipse', x: cx - 14.5, y: cy - 14.5, w: 29, h: 29, fill: 'FFFF00', line: { color: 'FF0000', pt: 2.25 } }];
  const fixedTaken = [{ x: cx - 20, y: cy - 20, w: 40, h: 40 }];
  if (pointName) {
    const w = Math.min(7 * inch, Math.max(1.65 * inch, textWidth(pointName, 40) + 40)), h = 0.5 * inch;
    // 기본은 기준점 오른쪽(원본 위치). 도래지 경계점이 그 칸 안에 걸리면 다른 쪽(왼쪽·위·아래)으로 옮긴다.
    const anchors = sites.map(site => view.toPx(...site.point));
    const spots = [[cx + 0.18 * inch, cy - 0.3 * inch], [cx - 0.18 * inch - w, cy - 0.3 * inch], [cx - w / 2, cy - 0.3 * inch - 0.7 * inch], [cx - w / 2, cy + 0.45 * inch]];
    const boxes = spots.map(([x, y]) => ({ x: clampBox(x, w, W, 6), y: clampBox(y, h, H, 6), w, h }));
    const hit = b => anchors.filter(([ax, ay]) => ax > b.x - 12 && ax < b.x + b.w + 12 && ay > b.y - 12 && ay < b.y + b.h + 12).length;
    const box = boxes.find(b => hit(b) === 0) || boxes.reduce((best, b) => (hit(b) < hit(best) ? b : best), boxes[0]);
    fixedTaken.push(box);
    fixed.push({ name: '조회 지점 이름 (편집 가능)', shape: 'rect', ...box, fill: 'FF0000', text: pointName, color: 'FFFFFF', pt: 20, bold: true, face: FACE });
  }

  // 칸은 도래지 경계점 바로 아래에 둔다. 겹치면 위치를 옮기지 않고 글자·칸을 줄이며(반쯤 줄어든 뒤에도 겹칠 때만
  // 경계점에 붙은 위·오른쪽·왼쪽 자리를 쓴다), 칸이 경계점에서 멀리 떨어지는 일은 없다.
  const attempt = (scale, { adjacent = false, perSite = false, strictFixed = false, floor = 0.12 } = {}) => {
    const taken = [], placed = []; // taken: 이미 놓인 도래지 칸. 기준점 표시·이름은 가능하면 피하는 정도로만 본다(피할 수 없으면 겹쳐도 다른 칸을 키우지 않는다).
    let overflow = 0;
    for (const site of sites) {
      const [px, py] = view.toPx(...site.point);
      if (px < -2 || px > W + 2 || py < -2 || py > H + 2) continue;
      const text = siteText(site), distance = kmText(site.distance);
      let s = scale, box, w, h, distH, nameH, open;
      for (;;) {
        w = Math.min(5, Math.max(1.8, units(text) * 22 / 72 + 0.18)) * inch * s;
        distH = 0.31 * inch * s;
        nameH = 0.44 * inch * s;
        h = distH + nameH;
        const g = 0.18 * inch; // 기준점 표시(원)를 비키도록 배율과 무관하게 고정
        const spots = [[px - w / 2, py + g]];
        if (adjacent) spots.push([px - w / 2, py - h - g], [px + g, py - h / 2], [px - w - g, py - h / 2], [px + g, py + g], [px - w - g, py + g], [px + g, py - h - g], [px - w - g, py - h - g]);
        const boxes = spots.map(([x, y]) => ({ x: clampBox(x, w, W, 6), y: clampBox(y, h, H, 6), w, h }));
        const gap = 0.06 * inch * s;
        const strict = boxes.find(b => !taken.some(t => overlaps(b, t, gap)) && !fixedTaken.some(t => overlaps(b, t, gap)));
        const soft = boxes.find(b => !taken.some(t => overlaps(b, t, gap)));
        // 기준점 표시와만 겹치는 칸은 글자가 읽히는 정도(원래 크기의 절반)까지만 줄이고, 도래지 칸끼리 겹치면 더 줄인다.
        const wait = strictFixed && perSite && (soft ? s * 0.9 >= Math.max(floor, 0.5 * scale) : s * 0.9 >= floor);
        open = strict || (wait ? undefined : soft);
        box = open || boxes[0];
        if (open || !perSite || s * 0.9 < floor) break;
        s *= 0.9;
      }
      if (!open) overflow++;
      taken.push(box);
      placed.push({ site, text, distance, box, distH, nameH, w, s });
    }
    return { placed, overflow };
  };
  let scale = 1, result = attempt(scale);
  for (const next of [0.9, 0.8, 0.7, 0.62, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3]) {
    if (!result.overflow) break;
    scale = next;
    result = attempt(scale, { adjacent: next <= 0.5 });
  }
  // 겹치는 칸(도래지끼리, 또는 기준점 표시·이름과)만 더 줄인다. 나머지 칸은 그대로 둔다.
  result = attempt(scale, { adjacent: scale <= 0.5, perSite: true, strictFixed: true });
  const items = [...fixed];
  const ptOf = (size, k) => Math.max(4, Math.round(size * k * 2) / 2);
  for (const { site, text, distance, box, distH, nameH, w, s: k } of result.placed) {
    const pt = size => ptOf(size, k);
    items.push({ name: '도래지 이름·개체수 (편집 가능)', shape: 'rect', x: box.x, y: box.y + distH, w, h: nameH, fill: 'EDEDED', line: { color: '0000FF', pt: 1 }, text, color: '0000FF', pt: pt(22), bold: true, face: FACE });
    items.push({ name: '구역 경계 최단거리 (편집 가능)', shape: 'rect', x: box.x + 0.05 * inch * k, y: box.y, w: Math.max(0.62, distance.length * 0.18) * inch * k, h: distH, fill: '00B0F0', text: distance, color: '000000', pt: pt(20), bold: true, face: FACE });
  }
  return { items, scale, overflow: result.overflow };
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
