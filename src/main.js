// 화면 연결: 입력 → 조회 → 미리보기 → PPTX 저장.
import { TileStore } from './tiles.js';
import { createBirdApi, monthText } from './birds.js';
import { searchAddress, cleanKey } from './geocode.js';
import { BACKGROUNDS, loadEarthEngineLibrary, loadSentinel } from './basemap.js';
import { lookup, renderSlides, parseCoordinate } from './pipeline.js';
import { buildReport, fmtMeters, fmtKm, fmtCount } from './report.js';

const $ = id => document.getElementById(id);
const birdApi = createBirdApi();
let store = null, birdContext = null, busy = false, last = null, eeReady = null;
let address = { items: [], page: 1, pages: 0, query: null };

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'note ' + kind;
}

/** 타일은 gzip 그대로 받아 푼다. 서버가 이미 풀어서 보내면(gzip 머리말 없음) 그대로 읽는다. */
async function fetchTile(layer, name) {
  const response = await fetch(`assets/tiles/${layer}/${name}.json.gz`);
  if (!response.ok) throw new Error(`지도 데이터(${layer}/${name})를 읽지 못했습니다. 배포 파일의 assets/tiles 폴더를 확인하세요.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const stream = new Response(bytes).body;
  const text = await new Response(gzipped ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).text();
  return JSON.parse(text);
}

function setBusy(value) {
  busy = value;
  for (const el of document.querySelectorAll('input, select, button')) el.disabled = value;
  if (!value) refreshControls();
}

function refreshControls() {
  $('run').disabled = busy || !store || !birdContext || !$('month').value;
  $('save').disabled = busy || !last;
  $('addrPrev').disabled = busy || address.page <= 1;
  $('addrNext').disabled = busy || address.page >= address.pages;
}

function invalidate() {
  if (!last) return;
  last = null;
  $('save').disabled = true;
  $('results').hidden = true;
  setStatus('입력이 바뀌었습니다. 다시 조회해 주세요.');
}

// ---- 초기화: 타일 목록과 철새 자료 연결 ----
async function init() {
  for (const id of ['waterBackground', 'birdBackground']) for (const [value, info] of Object.entries(BACKGROUNDS)) $(id).append(new Option(info.label, value));
  $('waterBackground').value = 'Satellite'; // 하천·도로: 위성
  $('birdBackground').value = 'Base'; // 철새도래지: 일반지도
  const [manifest, bird] = await Promise.allSettled([
    fetch('assets/tiles/manifest.json').then(r => { if (!r.ok) throw new Error('assets/tiles/manifest.json'); return r.json(); }),
    Promise.all([birdApi.metadata(), birdApi.boundaries()]),
  ]);
  const problems = [];
  if (manifest.status === 'fulfilled') store = new TileStore(manifest.value, fetchTile);
  else problems.push('하천·도로 내장 데이터 목록을 읽지 못했습니다(' + manifest.reason.message + ').');
  if (bird.status === 'fulfilled') {
    const [meta, boundaries] = bird.value;
    birdContext = { meta, boundaries };
    const nowMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7).replace('-', '');
    const months = meta.dates.filter(d => d <= nowMonth);
    $('month').replaceChildren(...months.map(d => new Option(monthText(d), d)));
    if (!months.length) problems.push('선택할 수 있는 철새 조사월이 없습니다.');
  } else {
    $('month').replaceChildren(new Option('자료 없음', ''));
    problems.push('국립생물자원관 철새 자료에 연결하지 못했습니다(' + bird.reason.message + ').');
  }
  if (problems.length) setStatus(problems.join(' ') + ' 새로고침 후 다시 시도해 주세요.', 'error');
  else setStatus('위치를 입력하고 조회하세요.');
  refreshControls();
}

// ---- 주소 검색 ----
function renderCandidates() {
  const box = $('addrResults');
  box.replaceChildren();
  for (const item of address.items) {
    const row = document.createElement('div');
    row.className = 'candidate';
    const text = document.createElement('div');
    for (const line of [item.title && item.title !== item.label ? item.title : '', item.road ? '도로명 · ' + item.road : '', item.parcel ? '지번 · ' + item.parcel : '', !item.road && !item.parcel ? item.label : ''].filter(Boolean)) {
      const p = document.createElement('p');
      p.textContent = line;
      text.append(p);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '이 위치 선택';
    button.onclick = () => {
      $('lat').value = item.lat;
      $('lon').value = item.lon;
      if (!$('pointName').value.trim()) $('pointName').value = item.title || item.label.split(',')[0].slice(0, 40);
      $('addrStatus').textContent = `선택한 위치 · ${item.label} · 위도 ${item.lat.toFixed(6)}, 경도 ${item.lon.toFixed(6)}`;
      invalidate();
    };
    row.append(text, button);
    box.append(row);
  }
  $('addrPager').hidden = address.pages <= 1;
  $('addrPage').textContent = `${address.page} / ${address.pages} 페이지`;
}

async function findAddress(page = 1) {
  if (busy) return;
  const query = $('addrQuery').value.trim();
  if (!query) { $('addrStatus').textContent = '주소 또는 장소명을 입력해 주세요.'; return; }
  setBusy(true);
  $('addrStatus').textContent = '주소 후보를 검색하는 중…';
  try {
    const result = await searchAddress(query, $('addrType').value, $('vworldKey').value, { region: $('addrRegion').value, page });
    address = { items: result.items, page: result.page, pages: result.pages };
    $('addrStatus').textContent = result.total
      ? `검색 결과 ${result.total.toLocaleString('ko-KR')}건 · 출처: ${result.source}. 위치를 확인하고 선택해 주세요.`
      : '검색 결과가 없습니다. 주소 유형이나 지역을 바꿔 보세요.';
    renderCandidates();
  } catch (error) {
    address = { items: [], page: 1, pages: 0 };
    renderCandidates();
    $('addrStatus').textContent = error.message;
  } finally {
    setBusy(false);
  }
}

// ---- Earth Engine (Sentinel-2) ----
function connectEarthEngine() {
  const project = $('eeProject').value.trim(), client = $('eeClient').value.trim();
  const status = $('eeStatus');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(client)) {
    status.textContent = 'Cloud 프로젝트 ID와 OAuth 웹 클라이언트 ID를 입력해 주세요.';
    return;
  }
  eeReady = null;
  status.textContent = 'Earth Engine 라이브러리를 불러오는 중…';
  loadEarthEngineLibrary().then(({ local }) => new Promise((resolve, reject) => {
    status.textContent = 'Google 로그인 창에서 연결을 완료해 주세요.' + (local ? '' : ' (고정되지 않은 외부 스크립트를 사용 중입니다. vendor/ee_api_js.js를 두면 그 파일을 씁니다.)');
    const timer = setTimeout(() => reject(new Error('로그인이 완료되지 않았습니다. 팝업과 승인된 JavaScript 원본을 확인해 주세요.')), 120000);
    const fail = error => { clearTimeout(timer); reject(new Error(error?.message || String(error || 'OAuth 설정을 확인해 주세요.'))); };
    try {
      ee.data.authenticateViaOauth(client, () => ee.initialize(null, null, () => { clearTimeout(timer); resolve(); }, fail, null, project), fail);
    } catch (error) { fail(error); }
  })).then(() => {
    eeReady = { project, client };
    status.textContent = 'Earth Engine에 연결되었습니다.';
  }).catch(error => { status.textContent = 'Google 연결 실패 · ' + error.message; });
}

// ---- 조회와 미리보기 ----
function fillRows(body, rows) {
  body.replaceChildren();
  if (!rows.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 4;
    cell.textContent = '반경 안에 해당 없음';
    return;
  }
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
}

async function run() {
  if (busy) return;
  let place;
  try { place = parseCoordinate($('lat').value, $('lon').value); } catch (error) { setStatus(error.message, 'error'); return; }
  const modes = { water: $('waterBackground').value, bird: $('birdBackground').value }, key = cleanKey($('vworldKey').value);
  for (const [label, mode] of [['하천·도로', modes.water], ['철새도래지', modes.bird]]) {
    if (BACKGROUNDS[mode].needsKey && !key) {
      $('addressBox').open = true;
      $('vworldKey').focus();
      setStatus(`${label} 배경(${BACKGROUNDS[mode].label})에는 브이월드 인증키가 필요합니다. 위치 항목의 "브이월드 인증키" 칸에 입력하거나 다른 배경을 고르세요.`, 'error');
      return;
    }
  }
  if (Object.values(modes).includes('sentinel') && !eeReady) { setStatus('Sentinel-2 배경은 Earth Engine 연결(Google 로그인)이 필요합니다.', 'error'); return; }
  setBusy(true);
  $('results').hidden = true;
  last = null;
  try {
    const month = $('month').value;
    const data = await lookup({
      ...place, waterRadiusM: Number($('waterRadius').value), birdRadiusM: Number($('birdRadius').value), month,
      store, birdApi, birdContext, onStatus: text => setStatus(text),
    });
    const pointName = $('pointName').value.trim() || '조회 지점';
    const rendered = await renderSlides(data, {
      pointName, backgrounds: { water: { mode: modes.water, key }, bird: { mode: modes.bird, key } },
      deps: { sentinelFor: view => loadSentinel(view, ee) },
      onStatus: text => setStatus(text),
    });
    last = { data, rendered, pointName };
    for (const [id, source] of [['preview1', rendered.water.preview], ['preview2', rendered.bird.preview]]) {
      const canvas = $(id);
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
    }
    const w = rendered.water, b = rendered.bird;
    fillRows($('waterRows'), w.rivers.map((r, i) => [i + 1, r.name, r.grade, r.inside ? '구역 안' : fmtMeters(r.distance)]).concat(w.more ? [['', `외 ${w.more}건`, '', '']] : []));
    fillRows($('roadRows'), w.roads.map(r => [r.name, r.kind, fmtMeters(r.distance)]).concat(w.moreRoads ? [[`외 ${w.moreRoads}개 노선`, '', '']] : []));
    fillRows($('birdRows'), b.sites.map((s, i) => [i + 1, s.name, fmtKm(s.distance), fmtCount(s.count)]).concat(b.more ? [['', `외 ${b.more}곳`, '', '']] : []));
    $('birdCaption').textContent = b.countsError ? `철새도래지 · ${b.monthLabel} · 개체수 조회 실패` : `철새도래지 · ${b.monthLabel} · 합계 ${b.total.toLocaleString('ko-KR')}개체`;
    $('results').hidden = false;
    const notes = [`하천·호수 ${data.waters.length}건, 국도·지방도 ${data.routes.length}개 노선, 철새 조사구역 ${data.sites.length}곳을 찾았습니다.`];
    if (data.countsError) notes.push('철새 개체수를 가져오지 못해 "자료 없음"으로 표시했습니다: ' + data.countsError);
    setStatus(notes.join(' '), data.countsError ? 'warn' : '');
  } catch (error) {
    last = null;
    setStatus('조회에 실패했습니다. ' + error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function save() {
  if (busy || !last) return;
  setBusy(true);
  $('saveStatus').textContent = 'PPTX를 만드는 중…';
  try {
    const { data, rendered, pointName } = last;
    const buffer = await buildReport(globalThis.PptxGenJS, {
      meta: { pointName, lat: data.lat, lon: data.lon }, water: rendered.water, bird: rendered.bird,
    });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const name = `하천도로철새_${pointName.replace(/[\\/:*?"<>|\s]+/g, '_')}_${data.lat.toFixed(4)}_${data.lon.toFixed(4)}.pptx`;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('saveStatus').textContent = `${name} 파일을 만들었습니다(슬라이드 2장).`;
  } catch (error) {
    $('saveStatus').textContent = 'PPTX 생성에 실패했습니다. ' + error.message;
  } finally {
    setBusy(false);
  }
}

$('run').onclick = run;
$('save').onclick = save;
$('addressForm').addEventListener('submit', event => { event.preventDefault(); findAddress(1); });
$('addrPrev').onclick = () => findAddress(address.page - 1);
$('addrNext').onclick = () => findAddress(address.page + 1);
$('eeLogin').onclick = connectEarthEngine;
for (const id of ['waterBackground', 'birdBackground']) {
  $(id).onchange = () => {
    $('eePanel').hidden = ![$('waterBackground').value, $('birdBackground').value].includes('sentinel');
    invalidate();
  };
}
for (const id of ['pointName', 'lat', 'lon', 'waterRadius', 'birdRadius', 'month', 'vworldKey']) $(id).addEventListener('input', invalidate);
for (const id of ['eeProject', 'eeClient']) $(id).addEventListener('input', () => { eeReady = null; $('eeStatus').textContent = '설정이 바뀌었습니다. Google 로그인으로 다시 연결해 주세요.'; });

init().catch(error => setStatus('초기화에 실패했습니다. ' + error.message, 'error'));
