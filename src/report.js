// PPTX 생성(16:9, 2장). 1장: 하천·도로(위성 등 전면 지도 + 거리·이름 말풍선), 2장: 철새도래지(일반지도 + 경계 + 이름·개체수 칸).
// 지도 그림은 이미지, 말풍선·이름표·거리표는 PowerPoint에서 고칠 수 있는 도형이다.
import { PPI, FACE, MAP2 } from './layout.js';

const SLIDE_W = 13.333333, SLIDE_H = 7.5;
export const fmtMeters = meters => Math.round(meters).toLocaleString('ko-KR');
export const fmtKm = meters => (!Number.isFinite(meters) ? '경계 미확인' : meters === 0 ? '구역 안' : meters < 50 ? '0.1 km 미만' : (meters / 1000).toFixed(1) + ' km');
export const fmtCount = count => (count === null ? '자료 없음' : count.toLocaleString('ko-KR'));

function addItems(pptx, slide, items, topIn) {
  const T = pptx.ShapeType;
  const shapes = { rect: T.rect, roundRect: T.roundRect, ellipse: T.ellipse };
  for (const item of items) {
    const box = { x: item.x / PPI, y: topIn + item.y / PPI, w: item.w / PPI, h: item.h / PPI };
    const fill = item.fill ? { color: item.fill, transparency: Math.round((1 - (item.opacity ?? 1)) * 100) } : { type: 'none' };
    const line = item.line ? { color: item.line.color, width: item.line.pt } : { type: 'none' };
    if (!item.text) {
      slide.addShape(shapes[item.shape], { ...box, fill, line, objectName: item.name });
      continue;
    }
    slide.addText(item.text, {
      ...box, shape: shapes[item.shape], rectRadius: item.shape === 'roundRect' ? (Math.min(box.w, box.h) * 0.16) : undefined,
      fill, line, color: item.color, fontSize: item.pt, bold: item.bold, fontFace: item.face || FACE,
      align: 'center', valign: 'middle', margin: 0, objectName: item.name,
    });
  }
}

const dataUrlOk = value => typeof value === 'string' && value.startsWith('data:image/');

/** 편집 중 데이터를 다시 볼 수 있도록 표 전체를 발표자 노트에 적어 둔다. */
function noteText(title, sections) {
  return [title, ...sections.map(([heading, lines]) => `\n[${heading}]\n${lines.length ? lines.join('\n') : '해당 없음'}`)].join('\n');
}

/**
 * meta: {pointName, lat, lon}
 * water: {radiusM, image(지도 JPEG/PNG), items, credit, allWaters, allRoutes}
 * bird: {radiusM, monthLabel, baseImage, boundaryImage, items, credit, allSites, countsError, total, measured}
 */
export async function buildReport(PptxGenJS, { meta, water, bird }) {
  if (!dataUrlOk(water.image) || !dataUrlOk(bird.baseImage) || !dataUrlOk(bird.boundaryImage)) throw new Error('지도 이미지가 준비되지 않았습니다. 다시 조회해 주세요.');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.lang = 'ko-KR';
  pptx.author = '하천·도로·철새도래지 현황';
  pptx.title = `${meta.pointName} 하천·도로·철새도래지 현황`;
  pptx.theme = { headFontFace: FACE, bodyFontFace: FACE, lang: 'ko-KR' };
  const where = `${meta.pointName} · WGS84 ${meta.lat.toFixed(5)}, ${meta.lon.toFixed(5)}`;

  // 1장: 하천·도로 — 슬라이드 전체가 지도
  const s1 = pptx.addSlide();
  s1.background = { color: 'FFFFFF' };
  s1.addImage({ data: water.image, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, objectName: '배경지도 + 하천·호수·국도·지방도' });
  addItems(pptx, s1, water.items, 0);
  s1.addNotes(noteText(`${where} · 하천·도로 반경 ${water.radiusM / 1000} km`, [
    ['하천·호수 — 반경 안 전체 (이름 · 구분 · 기준점에서 최단거리). 지도 말풍선은 거리 구간(1·1.5·3·5km)마다 최대 2곳과 10만㎡ 이상 호수·저수지만 표시', water.allWaters.map((r, i) => `${i + 1}. ${r.name} · ${r.grade} · ${r.inside ? '구역 안' : fmtMeters(r.distance) + ' m'}`)],
    ['국도·지방도', water.allRoutes.map(r => `${r.kind} ${r.number}번 · ${fmtMeters(r.distance)} m`)],
    ['출처', ['하천: 하천 공간정보(기후에너지환경부, 2026-09-14) · 호수·저수지: 국토지리정보원 연속수치지형도(이름이 있는 도형) · 도로: 국도·지방도 중심선', '거리는 기준점에서 GIS 도형 경계까지의 최단 직선거리이며, 면 도형 안이면 구역 안(0)입니다.']],
  ]));

  // 2장: 철새도래지 — 지도는 위아래 0.174인치를 비우고, 아래쪽 여백에 출처를 작게 적는다
  const s2 = pptx.addSlide();
  s2.background = { color: 'FFFFFF' };
  const mapH = MAP2.height / PPI;
  s2.addImage({ data: bird.baseImage, x: 0, y: MAP2.top, w: SLIDE_W, h: mapH, objectName: '배경지도' });
  s2.addImage({ data: bird.boundaryImage, x: 0, y: MAP2.top, w: SLIDE_W, h: mapH, objectName: '국립생물자원관 조사구역 경계 (이미지)' });
  addItems(pptx, s2, bird.items, MAP2.top);
  const footer = { fontSize: 6, bold: false, color: '555555', fontFace: FACE, margin: 0 };
  s2.addText(`조사 ${bird.monthLabel} · WGS84 ${meta.lat.toFixed(4)}, ${meta.lon.toFixed(4)} · 반경 ${bird.radiusM / 1000}km${bird.countsError ? ' · ※ 개체수 조회 실패(자료 없음으로 표시)' : ''}`, { x: 0.1, y: 7.36, w: 7, h: 0.12, ...footer });
  s2.addText(`국립생물자원관 철새지리정보 · ${bird.credit || '배경 없음'}`, { x: 7.1, y: 7.36, w: 6.1, h: 0.12, align: 'right', ...footer });
  s2.addNotes(noteText(`${where} · 철새도래지 반경 ${bird.radiusM / 1000} km · 조사월 ${bird.monthLabel}`, [
    ['철새도래지 — 지도 범위에 걸치는 조사구역 전체 (이름 · 경계까지 거리 · 개체수)', bird.allSites.map((s, i) => `${i + 1}. ${s.name} · ${fmtKm(s.distance)} · ${fmtCount(s.count)}${s.count === null && s.reason ? ` (${s.reason})` : ''}`)],
    ['출처', ['조사구역·경계·월별 개체수: 국립생물자원관 철새지리정보 동시센서스 (https://species.nibr.go.kr/bird/home/geo/index.do)', '거리는 조사구역 경계까지의 최단 직선거리이며 구역 안이면 0입니다. 조사지역명이 일치하지 않는 구역은 개체수를 자료 없음으로 표시합니다.',
      bird.countsError ? `개체수 조회에 실패해 모든 구역을 자료 없음으로 표시했습니다(${bird.countsError}). 합계는 의미가 없습니다.` : `합계 ${bird.total.toLocaleString('ko-KR')}개체 (자료가 있는 ${bird.measured}곳)`]],
  ]));

  return pptx.write({ outputType: 'arraybuffer' });
}
