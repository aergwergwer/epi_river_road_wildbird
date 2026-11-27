// GIS 엑셀(.xlsx) 읽기와 지점 묶기. 외부 라이브러리 없이 zip + XML을 직접 읽는다(브라우저·Node 공용).
import { EARTH_R } from './geo.js';

const decoder = new TextDecoder('utf-8');
const view32 = (dv, o) => dv.getUint32(o, true), view16 = (dv, o) => dv.getUint16(o, true);

async function inflateRaw(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zip 안의 파일들을 {이름: Uint8Array}로 푼다. 암호화·zip64는 지원하지 않는다. */
export async function unzip(buffer) {
  const bytes = new Uint8Array(buffer), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view32(dv, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
  const count = view16(dv, end + 10);
  let p = view32(dv, end + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (view32(dv, p) !== 0x02014b50) throw new Error('엑셀 파일 구조를 읽지 못했습니다.');
    const method = view16(dv, p + 10), size = view32(dv, p + 20), nameLen = view16(dv, p + 28), extraLen = view16(dv, p + 30), commentLen = view16(dv, p + 32), local = view32(dv, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + view16(dv, local + 26) + view16(dv, local + 28);
    const raw = bytes.subarray(dataStart, dataStart + size);
    if (/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml|workbook\.xml|styles\.xml|theme\/theme1\.xml)$/.test(name)) files[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescapeXml = text => text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
});
const textOf = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
const columnIndex = ref => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
function applyTint(rgb, tint) {
  if (!tint) return rgb;
  const c = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16));
  return c.map(v => hex2(tint < 0 ? v * (1 + tint) : v + (255 - v) * tint)).join('');
}

/** styles.xml(+theme)로 셀 서식 번호 → 배경색(RRGGBB, 없으면 '') 표를 만든다. */
function fillTable(files) {
  const styles = files['xl/styles.xml'] ? decoder.decode(files['xl/styles.xml']) : '';
  const theme = files['xl/theme/theme1.xml'] ? decoder.decode(files['xl/theme/theme1.xml']) : '';
  // 테마 색 순서: lt1, dk1, lt2, dk2, accent1~6
  const slot = name => new RegExp(`<a:${name}>[\\s\\S]*?(?:val|lastClr)="([0-9A-Fa-f]{6})"`).exec(theme)?.[1]?.toUpperCase();
  const themeColors = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(slot);
  const fillsXml = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles)?.[1] || '';
  const fills = [...fillsXml.matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map(m => {
    const pattern = /<patternFill\b([^>]*)/.exec(m[1])?.[1] || '';
    if (/patternType="none"/.test(pattern) || !/patternType="solid"/.test(pattern)) return '';
    const fg = /<fgColor\b([^>]*)\/?>/.exec(m[1])?.[1] || '';
    const rgb = /rgb="([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})"/.exec(fg)?.[1];
    if (rgb) return rgb.slice(-6).toUpperCase();
    const th = /theme="(\d+)"/.exec(fg)?.[1];
    if (th !== undefined && themeColors[Number(th)]) return applyTint(themeColors[Number(th)], Number(/tint="(-?[\d.]+)"/.exec(fg)?.[1] || 0));
    return '';
  });
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || '';
  return [...xfs.matchAll(/<xf\b([^>]*)/g)].map(m => fills[Number(/fillId="(\d+)"/.exec(m[1])?.[1] ?? 0)] || '');
}

/** 첫 번째 시트를 행 배열(문자열·숫자·null)로 읽는다. 결과의 fills[행][열]에는 셀 배경색(RRGGBB, 없으면 '')이 들어 있다. */
export async function readXlsx(buffer) {
  const files = await unzip(buffer);
  const sheetName = Object.keys(files).filter(n => n.startsWith('xl/worksheets/')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0];
  if (!sheetName || !files[sheetName]) throw new Error('엑셀에서 시트를 찾지 못했습니다.');
  const shared = files['xl/sharedStrings.xml'] ? [...decoder.decode(files['xl/sharedStrings.xml']).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const xfFill = fillTable(files);
  const rows = [], fills = [];
  for (const row of decoder.decode(files[sheetName]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [], colors = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1], body = cell[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1], type = /\bt="(\w+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = null;
      if (type === 'inlineStr') value = textOf(body);
      else if (v !== undefined) value = type === 's' ? shared[Number(v)] ?? null : type === 'str' || type === 'e' ? unescapeXml(v) : type === 'b' ? v === '1' : Number(v);
      const index = columnIndex(ref);
      cells[index] = value;
      colors[index] = xfFill[Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0)] || '';
    }
    rows.push(Array.from(cells, v => v ?? null));
    fills.push(Array.from(colors, c => c || ''));
  }
  rows.fills = fills;
  return rows;
}

const NAMED = {
  red: 'FF0000', 빨강: 'FF0000', 빨강색: 'FF0000', 적색: 'FF0000', orange: 'FFA500', 주황: 'FFA500', 주황색: 'FFA500', yellow: 'FFD700', 노랑: 'FFD700', 노랑색: 'FFD700', 노란색: 'FFD700', 황색: 'FFD700',
  green: '00A000', 초록: '00A000', 초록색: '00A000', 녹색: '00A000', blue: '0000FF', 파랑: '0000FF', 파랑색: '0000FF', 파란색: '0000FF', 청색: '0000FF',
  purple: '800080', 보라: '800080', 보라색: '800080', pink: 'FF69B4', 분홍: 'FF69B4', 분홍색: 'FF69B4', black: '000000', 검정: '000000', 검정색: '000000', 검은색: '000000',
  gray: '808080', grey: '808080', 회색: '808080', brown: '8B4513', 갈색: '8B4513', white: 'FFFFFF', 흰색: 'FFFFFF', 하양: 'FFFFFF', 하얀색: 'FFFFFF', cyan: '00BFFF', 하늘색: '00BFFF', 하늘: '00BFFF',
};

/** 엑셀 '표현색' 값을 RRGGBB로. #RRGGBB, RRGGBB, #RGB, ARGB(8자리), rgb(r,g,b), 영어·한글 색 이름을 받는다. 못 읽으면 ''. */
export function parseColor(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase();
  const hex = text.replace(/^#|^0x/i, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-f]{8}$/i.test(hex)) return hex.slice(2).toUpperCase(); // ARGB
  if (/^[0-9a-f]{3}$/i.test(hex)) return [...hex].map(c => c + c).join('').toUpperCase();
  return NAMED[text.toLowerCase().replace(/\s+/g, '')] || '';
}

const serialToDate = serial => new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);

/**
 * 첫 행의 열 이름(구분·위도·경도, 선택: 제목·날짜·내용)으로 지점 목록을 만든다.
 * 좌표가 숫자가 아니거나 대한민국 범위를 벗어난 행은 건너뛰고 skipped로 센다.
 */
export function parseGis(rows) {
  const header = (rows[0] || []).map(v => String(v ?? '').trim());
  const col = name => header.indexOf(name);
  const [iKind, iLat, iLon, iTitle, iDate, iNote, iColor] = ['구분', '위도', '경도', '제목', '날짜', '내용', '표현색'].map(col);
  if (iKind < 0 || iLat < 0 || iLon < 0) throw new Error('엑셀 첫 행에 "구분", "위도", "경도" 열이 있어야 합니다.');
  const points = [];
  let skipped = 0;
  rows.slice(1).forEach((row, rowIndex) => {
    if (!row || row.every(v => v === null || String(v).trim() === '')) return;
    const lat = Number(row[iLat]), lon = Number(row[iLon]);
    if (row[iLat] === null || row[iLon] === null || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 32 || lat > 40 || lon < 124 || lon > 132) { skipped++; return; }
    const date = iDate >= 0 ? row[iDate] : null;
    points.push({
      kind: String(row[iKind] ?? '').trim() || '구분 없음', lat, lon,
      title: iTitle >= 0 ? String(row[iTitle] ?? '').trim() : '',
      date: typeof date === 'number' ? serialToDate(date) : date ? String(date).trim() : '',
      note: iNote >= 0 ? String(row[iNote] ?? '').trim() : '',
      // 표현색: 셀에 적힌 색 값이 있으면 그것, 없으면 그 칸의 배경색(엑셀에서 색칠한 것)
      color: iColor >= 0 ? parseColor(row[iColor]) || rows.fills?.[rowIndex + 1]?.[iColor] || '' : '',
    });
  });
  return { points, skipped };
}

/** 두 지점 사이 직선거리(m). */
export function haversine(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/**
 * 지도 범위(box) 안의 지점을 같은 제목끼리 1km 안에서 하나로 묶는다(같은 농장·하천의 반복 발생을 칸 하나로).
 * 묶음마다 구분 목록(등장 순)과 건수, 날짜 범위를 갖고, distance는 기준점(lat, lon)까지의 거리다.
 */
export function groupGis(points, lat, lon, box) {
  const groups = [];
  for (const p of points) {
    if (p.lon < box[0] || p.lon > box[2] || p.lat < box[1] || p.lat > box[3]) continue;
    const group = groups.find(g => g.title === p.title && haversine(g.lat, g.lon, p.lat, p.lon) < 1000);
    if (group) group.points.push(p); else groups.push({ title: p.title, lat: p.lat, lon: p.lon, points: [p] });
  }
  return groups.map(g => {
    const kinds = [...new Set(g.points.map(p => p.kind))];
    const dates = g.points.map(p => p.date).filter(Boolean).sort();
    const name = g.title || '이름 없음';
    return {
      kind: 'gis', color: [...g.points].filter(p => p.color).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.color || '', // 묶음 칸은 가장 최근 건의 색
      name, title: g.title, lat: g.lat, lon: g.lon, point: [g.lon, g.lat], points: g.points, kinds, count: g.points.length,
      distance: haversine(lat, lon, g.lat, g.lon),
      label: `${name} ${kinds.join('·')}${g.points.length > 1 ? ` (${g.points.length}건)` : ''}`,
      dates: dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ~ ${dates.at(-1)}`) : '',
    };
  }).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'ko'));
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 경도·위도 점이 Polygon/MultiPolygon 안에 있는가(구멍 제외). */
export function pointInGeometry(geometry, lon, lat) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(([outer, ...holes]) => inRing(outer, lon, lat) && !holes.some(h => inRing(h, lon, lat)));
}

/** 조사구역(철새 권역) 안에 든 지점의 구분별 건수(처음 나온 순). 예: [{kind:'25/26', count:3}] */
export function gisInside(geometry, points) {
  const tally = new Map();
  for (const p of points) if (pointInGeometry(geometry, p.lon, p.lat)) tally.set(p.kind, (tally.get(p.kind) || 0) + 1);
  return [...tally].map(([kind, count]) => ({ kind, count }));
}
