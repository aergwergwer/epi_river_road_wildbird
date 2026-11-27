// PPTX 생성(16:9, 슬라이드 2장). 1장: 하천·도로, 2장: 철새도래지.
export const MAP_PX = { width: 1580, height: 1220 };
const MAP_IN = { x: 0.4, y: 1.0, w: 7.9, h: 6.1 };
const PX_PER_IN = MAP_PX.width / MAP_IN.w;
const FACE = '맑은 고딕';
const INK = '173440', HEAD = '123641', LINE = 'C9D6DA';

const inch = px => px / PX_PER_IN;
export const fmtMeters = meters => Math.round(meters).toLocaleString('ko-KR');
export const fmtKm = meters => (meters === 0 ? '구역 안' : meters < 50 ? '0.1 km 미만' : (meters / 1000).toFixed(1) + ' km');
export const fmtCount = count => (count === null ? '자료 없음' : count.toLocaleString('ko-KR'));

function addOverlay(pptx, slide, items) {
  const T = pptx.ShapeType;
  for (const item of items) {
    const box = { x: MAP_IN.x + inch(item.x - item.w / 2), y: MAP_IN.y + inch(item.y - item.h / 2), w: inch(item.w), h: inch(item.h) };
    if (item.type === 'center') {
      slide.addShape(T.ellipse, { ...box, fill: { color: 'C62828' }, line: { color: 'FFFFFF', width: 1.5 }, objectName: '조회 지점' });
    } else if (item.type === 'badge') {
      const sign = item.kind === '지방도';
      slide.addText(item.text, {
        ...box, shape: sign ? T.roundRect : T.ellipse, rectRadius: sign ? 0.04 : undefined,
        fill: { color: item.fill.replace('#', '') }, line: { color: sign ? '222222' : 'FFFFFF', width: 1.25 },
        color: sign ? '111111' : 'FFFFFF', bold: true, fontSize: 9, fontFace: FACE, align: 'center', valign: 'middle', margin: 0,
        objectName: item.kind === 'num' ? '번호 ' + item.text : item.kind + ' ' + item.text,
      });
    } else {
      const named = item.type === 'pointName';
      slide.addText(item.text, {
        ...box, shape: T.roundRect, rectRadius: 0.04,
        fill: named ? { color: 'C62828' } : { color: 'FFFFFF', transparency: 12 }, line: { color: named ? 'C62828' : 'FFFFFF', width: 0.5 },
        color: named ? 'FFFFFF' : INK, bold: named, fontSize: named ? 9 : 8, fontFace: FACE, align: 'center', valign: 'middle', margin: 0.02,
        objectName: named ? '조회 지점 이름' : '이름표',
      });
    }
  }
}

const cell = (text, options = {}) => ({ text: String(text), options: { fontFace: FACE, fontSize: 9, color: INK, valign: 'middle', ...options } });
const head = text => cell(text, { bold: true, color: 'FFFFFF', fill: { color: HEAD }, align: 'center' });

function table(slide, title, y, columns, rows, empty) {
  slide.addText(title, { x: 8.55, y, w: 4.4, h: 0.28, fontSize: 11, bold: true, fontFace: FACE, color: INK, margin: 0 });
  const data = [columns.map(c => head(c.label))];
  if (rows.length) for (const row of rows) data.push(row.map((value, i) => cell(value, { align: columns[i].align || 'left' })));
  else data.push([cell(empty, { colspan: columns.length, align: 'center', color: '5B7078' })]);
  slide.addTable(data, {
    x: 8.55, y: y + 0.3, w: 4.4, colW: columns.map(c => c.w), rowH: 0.27,
    border: { type: 'solid', pt: 0.5, color: LINE }, fontFace: FACE, margin: [0, 0.05, 0, 0.05],
  });
}

function frame(pptx, slide, { title, subtitle, image, overlay, footnote }) {
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.82, fill: { color: HEAD }, line: { color: HEAD, width: 0 } });
  slide.addText(title, { x: 0.4, y: 0.08, w: 12.5, h: 0.4, fontSize: 20, bold: true, fontFace: FACE, color: 'FFFFFF', margin: 0 });
  slide.addText(subtitle, { x: 0.4, y: 0.48, w: 12.5, h: 0.28, fontSize: 10, fontFace: FACE, color: 'D0F5EE', margin: 0 });
  slide.addImage({ data: image, x: MAP_IN.x, y: MAP_IN.y, w: MAP_IN.w, h: MAP_IN.h, objectName: '지도 (배경·도형)' });
  slide.addShape(pptx.ShapeType.rect, { x: MAP_IN.x, y: MAP_IN.y, w: MAP_IN.w, h: MAP_IN.h, fill: { color: 'FFFFFF', transparency: 100 }, line: { color: '8FA3A9', width: 0.75 }, objectName: '지도 테두리' });
  addOverlay(pptx, slide, overlay);
  slide.addText(footnote, { x: 0.4, y: 7.13, w: 12.5, h: 0.3, fontSize: 7, fontFace: FACE, color: '5B7078', margin: 0, valign: 'top' });
}

/**
 * meta: {pointName, lat, lon, backgroundLabel}
 * water: {radiusM, rivers: 표시할 행(번호순), more, roads: 행, image, overlay, credit}
 * bird: {radiusM, monthLabel, sites: 표시할 행, more, total, measured, image, overlay, credit}
 */
export async function buildReport(PptxGenJS, { meta, water, bird }) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.lang = 'ko-KR';
  pptx.author = '하천·도로·철새도래지 현황';
  pptx.title = `${meta.pointName} 하천·도로·철새도래지 현황`;
  pptx.theme = { headFontFace: FACE, bodyFontFace: FACE, lang: 'ko-KR' };
  const where = `${meta.pointName} · WGS84 ${meta.lat.toFixed(5)}, ${meta.lon.toFixed(5)}`;

  const s1 = pptx.addSlide();
  frame(pptx, s1, {
    title: '인근 하천·도로 현황',
    subtitle: `${where} · 조회 반경 ${water.radiusM / 1000} km`,
    image: water.image, overlay: water.overlay,
    footnote: `출처: 하천 공간정보(기후에너지환경부, 2026-09-14) · 호수·저수지(국토지리정보원 연속수치지형도, 이름이 있는 도형) · 국도·지방도 도로중심선(국토지리정보원) · ${water.credit || '배경 없음'}\n거리는 기준점에서 GIS 도형 경계까지의 최단 직선거리이며, 면 도형 안에 있으면 0(구역 안)입니다.`,
  });
  const riverRows = water.rivers.map((r, i) => [i + 1, r.name, r.grade, r.inside ? '구역 안' : fmtMeters(r.distance)]);
  if (water.more > 0) riverRows.push(['', `외 ${water.more}건`, '', '']);
  table(s1, `하천·호수 (반경 ${water.radiusM / 1000} km 이내 ${water.rivers.length + water.more}건)`, 1.0, [
    { label: '번호', w: 0.5, align: 'center' }, { label: '이름', w: 1.7 }, { label: '구분', w: 1.2 }, { label: '거리(m)', w: 1.0, align: 'right' },
  ], riverRows, '반경 안에 하천·호수가 없습니다.');
  const roadRows = water.roads.map(r => [r.name, r.kind, fmtMeters(r.distance)]);
  if (water.moreRoads > 0) roadRows.push([`외 ${water.moreRoads}개 노선`, '', '']);
  table(s1, `국도·지방도 (반경 ${water.radiusM / 1000} km 이내 ${water.roads.length + water.moreRoads}개 노선)`, 4.85, [
    { label: '노선', w: 2.0 }, { label: '구분', w: 1.2 }, { label: '거리(m)', w: 1.2, align: 'right' },
  ], roadRows, '반경 안에 국도·지방도가 없습니다.');

  const s2 = pptx.addSlide();
  frame(pptx, s2, {
    title: '인근 철새도래지 현황',
    subtitle: `${where} · 조회 반경 ${bird.radiusM / 1000} km · 조사월 ${bird.monthLabel}`,
    image: bird.image, overlay: bird.overlay,
    footnote: `출처: 국립생물자원관 철새지리정보 동시센서스(조사구역 경계·월별 개체수, https://species.nibr.go.kr/bird/home/geo/index.do) · ${bird.credit || '배경 없음'}\n거리는 조사구역 경계까지의 최단 직선거리이며 구역 안이면 0입니다. 조사지역명이 일치하지 않는 구역은 개체수를 '자료 없음'으로 표시합니다.${bird.countsError ? '\n※ 개체수 조회에 실패해 모든 구역을 \'자료 없음\'으로 표시했습니다. 합계는 의미가 없습니다.' : ''}`,
  });
  const siteRows = bird.sites.map((s, i) => [i + 1, s.name, fmtKm(s.distance), fmtCount(s.count)]);
  if (bird.more > 0) siteRows.push(['', `외 ${bird.more}곳`, '', '']);
  table(s2, `철새도래지 (반경 ${bird.radiusM / 1000} km 이내 ${bird.sites.length + bird.more}곳)`, 1.0, [
    { label: '번호', w: 0.5, align: 'center' }, { label: '도래지', w: 1.8 }, { label: '거리', w: 1.0, align: 'right' }, { label: '개체수', w: 1.1, align: 'right' },
  ], siteRows, '반경 안에 조사구역이 없습니다.');
  s2.addText(bird.countsError ? '개체수 자료를 가져오지 못했습니다(조회 실패).' : `합계 ${bird.total.toLocaleString('ko-KR')}개체 (자료가 있는 ${bird.measured}곳, ${bird.monthLabel})`, {
    x: 8.55, y: Math.min(6.85, 1.3 + 0.27 * (siteRows.length + 1) + 0.15), w: 4.4, h: 0.3, fontSize: 10, bold: true, fontFace: FACE, color: INK, margin: 0,
  });

  return pptx.write({ outputType: 'arraybuffer' });
}
