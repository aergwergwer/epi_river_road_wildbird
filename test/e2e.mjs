#!/usr/bin/env node
// 실제 브라우저(Chrome headless) 종단 점검. 의존 패키지 없이 DevTools 프로토콜을 직접 쓴다.
// 사용법: node test/e2e.mjs [출력폴더=/tmp/e2e]
// - 국립생물자원관은 가짜 응답(test/mock-nibr.mjs), OSM·브이월드 타일은 합성 PNG로 대신한다. 외부 네트워크는 쓰지 않는다.
// - 결과: <출력폴더>/*.pptx, *.png(미리보기 캔버스), report.json
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { startServer } from '../tools/dev-server.mjs';

const outDir = process.argv[2] || '/tmp/e2e';
fs.mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME || 'google-chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 합성 PNG (타일 이음매가 이어지는지 눈으로 확인하려고 격자와 색을 넣는다) ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buffer => { let c = 0xffffffff; for (const b of buffer) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
function tilePng(z, x, y, dark = false) {
  const size = 256, raw = Buffer.alloc((size * 3 + 1) * size);
  const hue = (x * 37 + y * 91 + z * 13) % 60;
  for (let j = 0; j < size; j++) {
    raw[j * (size * 3 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      const edge = i === 0 || j === 0 || i === 255 || j === 255, grid = i % 64 === 0 || j % 64 === 0;
      const o = j * (size * 3 + 1) + 1 + i * 3;
      raw[o] = edge ? 90 : grid ? (dark ? 70 : 205) : dark ? 58 + hue : 232 - hue / 3;
      raw[o + 1] = edge ? 90 : grid ? (dark ? 90 : 215) : dark ? 82 + hue : 236 - hue / 4;
      raw[o + 2] = edge ? 90 : grid ? (dark ? 66 : 210) : dark ? 52 + hue / 2 : 226 + hue / 4;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 최소 CDP 클라이언트 ----
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.waiting = new Map(); this.handlers = [];
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('CDP 연결 실패')); });
    this.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.waiting.has(msg.id)) { const { resolve, reject } = this.waiting.get(msg.id); this.waiting.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
      else for (const h of this.handlers) h(msg);
    };
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject })); }
  on(handler) { this.handlers.push(handler); }
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }
}

async function until(cdp, expression, label, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (await cdp.evaluate(expression)) return; await sleep(250); }
  throw new Error('시간 초과: ' + label);
}

const scenarios = [
  // 기본 설정: 하천·도로는 브이월드 위성, 철새도래지는 브이월드 일반지도
  { name: 'seoul-satellite', lat: 37.5665, lon: 126.978, pointName: '서울시청', waterBg: 'Satellite', birdBg: 'Base', key: 'TESTKEY', waterRadius: 5000, birdRadius: 20000 },
  { name: 'naju-gis', gis: true, lat: 35.0161, lon: 126.7108, pointName: '나주 육용오리(11.26)', waterBg: 'Satellite', birdBg: 'Base', key: 'TESTKEY', waterRadius: 5000, birdRadius: 50000 },
  { name: 'naju-sample', lat: 35.0161, lon: 126.7108, pointName: '나주 육용오리(11.26)', waterBg: 'Satellite', birdBg: 'Base', key: 'TESTKEY', waterRadius: 5000, birdRadius: 50000 },
  { name: 'gwangju-osm', lat: 35.1595, lon: 126.8526, pointName: '광주 영산강 인근', waterBg: 'osm', birdBg: 'osm', key: '', waterRadius: 3000, birdRadius: 50000 },
  { name: 'seoul-counts-fail', lat: 37.5665, lon: 126.978, pointName: '개체수 실패', waterBg: 'none', birdBg: 'none', key: '', waterRadius: 5000, birdRadius: 20000, fail: 'counts' },
  { name: 'gangneung-1500', lat: 37.7519, lon: 128.8761, pointName: '강릉', waterBg: 'Satellite', birdBg: 'Base', key: 'TESTKEY', waterRadius: 1500, birdRadius: 30000 },
  { name: 'nokey-error', lat: 37.5665, lon: 126.978, pointName: '키 없음', waterBg: 'Satellite', birdBg: 'Base', key: '', waterRadius: 5000, birdRadius: 20000, expectError: true },
];

const server = await startServer({ port: 0 + 8793, mock: true });
const base = 'http://127.0.0.1:8793/';
const profile = fs.mkdtempSync('/tmp/e2e-chrome-');
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
const report = { scenarios: [], consoleErrors: [] };
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find(t => t.type === 'page'); } catch { /* 아직 안 떴다 */ } }
  if (!target) throw new Error('Chrome을 시작하지 못했습니다.');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  cdp.on(msg => {
    if (msg.method === 'Runtime.exceptionThrown') report.consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') report.consoleErrors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Fetch.requestPaused') {
      const url = msg.params.request.url;
      const osm = url.match(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
      const vworld = url.match(/api\.vworld\.kr\/req\/wmts\/1\.0\.0\/[^/]+\/(\w+)\/(\d+)\/(\d+)\/(\d+)\./);
      report.osmTiles = (report.osmTiles || 0) + (osm ? 1 : 0);
      report.vworldTiles = (report.vworldTiles || 0) + (vworld ? 1 : 0);
      const png = osm ? tilePng(Number(osm[1]), Number(osm[2]), Number(osm[3])) : tilePng(Number(vworld[2]), Number(vworld[4]), Number(vworld[3]), vworld[1] === 'Satellite');
      cdp.send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: png.toString('base64') });
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://tile.openstreetmap.org/*' }, { urlPattern: 'https://api.vworld.kr/req/wmts/*' }] });

  for (const s of scenarios) {
    const t0 = Date.now();
    globalThis.__mockFail = s.fail || null;
    await cdp.send('Page.navigate', { url: base });
    await until(cdp, `document.readyState==='complete' && !document.getElementById('run').disabled`, '초기화');
    await cdp.evaluate(`(()=>{window.__blobs=[];const o=URL.createObjectURL;URL.createObjectURL=b=>{window.__blobs.push(b);return o(b)};
      const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
      set('pointName',${JSON.stringify(s.pointName)});set('lat','${s.lat}');set('lon','${s.lon}');set('waterRadius','${s.waterRadius}');set('birdRadius','${s.birdRadius}');set('vworldKey','${s.key}');set('waterBackground','${s.waterBg}');set('birdBackground','${s.birdBg}');
      })()`);
    if (s.gis) {
      const xlsx = fs.readFileSync(new URL('./fixtures/gis-sample.xlsx', import.meta.url)).toString('base64');
      await cdp.evaluate(`(async()=>{const bin=atob('${xlsx}');const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
        const dt=new DataTransfer();dt.items.add(new File([bytes],'gis-sample.xlsx'));const input=document.getElementById('gisFile');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(cdp, `document.getElementById('gisStatus').textContent.includes('지점 6개를 읽었습니다')`, 'GIS 엑셀 읽기');
    }
    await cdp.evaluate(`document.getElementById('run').click()`);
    await until(cdp, `!document.getElementById('results').hidden || document.getElementById('status').className.includes('error')`, '조회');
    const rows = id => `[...document.querySelectorAll('#${id} tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' '))`;
    const checks = id => `(()=>{const b=[...document.querySelectorAll('#${id} tbody input[type=checkbox]')];return {n:b.length,on:b.filter(x=>x.checked).length,cap:document.querySelector('#${id} .cap').textContent}})()`;
    const view = await cdp.evaluate(`({status:document.getElementById('status').textContent,statusClass:document.getElementById('status').className,
      water:${rows('waterTable')}, road:${rows('roadTable')}, bird:${rows('birdTable')},
      waterChecks:${checks('waterTable')}, roadChecks:${checks('roadTable')}, birdChecks:${checks('birdTable')},
      caption:document.querySelector('#birdTable caption').textContent})`);
    if (s.expectError) {
      if (!view.statusClass.includes('error') || !/인증키/.test(view.status)) throw new Error('키가 없을 때 안내 오류가 나와야 합니다: ' + view.status);
      report.scenarios.push({ ...s, ms: Date.now() - t0, ...view });
      console.log(`${s.name}: [${view.statusClass.trim()}] ${view.status}`);
      continue;
    }
    for (const id of ['preview1', 'preview2']) {
      const data = await cdp.evaluate(`document.getElementById('${id}').toDataURL('image/png').split(',')[1]`);
      fs.writeFileSync(path.join(outDir, `${s.name}-${id}.png`), Buffer.from(data, 'base64'));
    }
    if (!s.expectError && !view.statusClass.includes('error') && view.birdChecks.n > 2) {
      // 표 체크: 철새도래지는 전부 체크가 기본, 해제하면 개수가 줄고 다시 체크하면 돌아온다
      if (view.birdChecks.on !== view.birdChecks.n) throw new Error('철새도래지는 전부 체크되어 있어야 합니다: ' + JSON.stringify(view.birdChecks));
      const click = id => cdp.evaluate(`document.querySelector('#${id} tbody input[type=checkbox]').click()`);
      await click('birdTable');
      const off = await cdp.evaluate(checks('birdTable'));
      if (off.on !== view.birdChecks.n - 1) throw new Error('체크 해제가 반영되지 않았습니다: ' + JSON.stringify(off));
      await click('birdTable');
      const back = await cdp.evaluate(checks('birdTable'));
      if (back.on !== view.birdChecks.n) throw new Error('다시 체크가 반영되지 않았습니다.');
      if (view.waterChecks.n) {
        const wBefore = await cdp.evaluate(`document.getElementById('preview1').toDataURL('image/png').length`);
        await cdp.evaluate(`document.querySelector('#waterTable tbody input[type=checkbox]').click()`);
        const wAfter = await cdp.evaluate(`document.getElementById('preview1').toDataURL('image/png').length`);
        await cdp.evaluate(`document.querySelector('#waterTable tbody input[type=checkbox]').click()`);
        if (wBefore === wAfter) throw new Error('하천 체크 변경이 미리보기에 반영되지 않았습니다.');
      }
    }
    if (s.gis) {
      const gisView = await cdp.evaluate(`({hidden:document.getElementById('gisTable').hidden, rows:[...document.querySelectorAll('#gisTable tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' ')), extras:[...document.querySelectorAll('#birdTable tbody tr')].map(r=>r.cells[6]?.innerText||'').filter(Boolean)})`);
      if (gisView.hidden || gisView.rows.length !== 4) throw new Error('GIS 표가 4행이어야 합니다: ' + JSON.stringify(gisView));
      if (!gisView.extras.some(t => /25\/26 1건/.test(t))) throw new Error('권역 내 GIS 구분이 표에 나와야 합니다: ' + JSON.stringify(gisView.extras));
      view.gisView = gisView;
      const before = await cdp.evaluate(`document.getElementById('preview2').toDataURL('image/png').length`);
      await cdp.evaluate(`document.querySelector('#gisTable tbody input[type=checkbox]').click()`);
      const after = await cdp.evaluate(`document.getElementById('preview2').toDataURL('image/png').length`);
      if (before === after) throw new Error('GIS 체크 해제가 지도에 반영되지 않았습니다.');
      await cdp.evaluate(`document.querySelector('#gisTable tbody input[type=checkbox]').click()`);
    }
    if (!s.expectError && !view.statusClass.includes('error') && view.waterChecks.n && view.roadChecks.n) {
      // 해제한 항목의 도형(하얀 도로 선, 하천·호수 면)이 지도에서 실제로 사라지는지 픽셀로 확인한다.
      const count = `(()=>{const c=document.getElementById('preview1'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let white=0,blue=0;for(let i=0;i<d.length;i+=4){if(d[i]>250&&d[i+1]>250&&d[i+2]>250)white++;else if(Math.abs(d[i]-18)<22&&Math.abs(d[i+1]-61)<22&&Math.abs(d[i+2]-137)<30)blue++;}return {white,blue}})()`;
      const before = await cdp.evaluate(count);
      await cdp.evaluate(`['waterTable','roadTable'].forEach(id=>{const a=document.querySelector('#'+id+' thead input.all');if(a.checked||a.indeterminate){a.checked=false;a.dispatchEvent(new Event('change'))}})`);
      const none = await cdp.evaluate(count);
      if (!(none.white < before.white * 0.6) || none.blue > before.blue * 0.2) throw new Error('전체 해제 후에도 도형이 남아 있습니다: ' + JSON.stringify({ before, none }));
      await cdp.evaluate(`['waterTable','roadTable'].forEach(id=>{const a=document.querySelector('#'+id+' thead input.all');a.checked=true;a.dispatchEvent(new Event('change'))})`);
      const all = await cdp.evaluate(count);
      if (all.white <= none.white) throw new Error('전체 체크 후 도형이 돌아오지 않았습니다: ' + JSON.stringify({ none, all }));
      view.shapePixels = { before, none, all };
    }
    if (s.gis) { // 화면 디자인 확인용 전체 화면 캡처
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(outDir, s.name + '-page.png'), Buffer.from(shot.data, 'base64'));
    }
    let pptxBytes = 0;
    if (!view.statusClass.includes('error')) {
      await cdp.evaluate(`document.getElementById('save').click()`);
      await until(cdp, `document.getElementById('saveStatus').textContent.includes('만들었습니다') || document.getElementById('saveStatus').textContent.includes('실패')`, 'PPTX 저장');
      view.saveStatus = await cdp.evaluate(`document.getElementById('saveStatus').textContent`);
      const base64 = await cdp.evaluate(`new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(window.__blobs[window.__blobs.length-1])})`);
      fs.writeFileSync(path.join(outDir, s.name + '.pptx'), Buffer.from(base64, 'base64'));
      pptxBytes = Buffer.from(base64, 'base64').length;
    }
    // 경계 API가 실패(모의 서버는 항상 실패)한 상황: 저장본 안내가 화면에 남고, 개체수 조회가 성공해도 유지되어야 한다(REV-05).
    if (!view.statusClass.includes('error') && view.birdChecks.n) {
      view.boundaryNote = await cdp.evaluate(`document.getElementById('boundaryNote').hidden ? '' : document.getElementById('boundaryNote').textContent`);
      if (!/저장본 사용/.test(view.boundaryNote) || !/수집일 2026-11-20/.test(view.boundaryNote)) throw new Error('경계 저장본 안내가 화면에 있어야 합니다: ' + view.boundaryNote);
    }
    if (s.gis) {
      const upload = (name, buf) => cdp.evaluate(`(()=>{const bytes=Uint8Array.from(atob('${buf.toString('base64')}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'${name}'));const i=document.getElementById('gisFile');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      const gisState = () => cdp.evaluate(`({save:document.getElementById('save').disabled,run:document.getElementById('run').disabled,resultsHidden:document.getElementById('results').hidden,gisHidden:document.getElementById('gisTable').hidden,status:document.getElementById('gisStatus').textContent})`);
      // REV-01: 삭제 → 결과·저장 버튼 무효화 → 재조회에 GIS 없음 → 저장
      await cdp.evaluate(`document.getElementById('gisClear').click()`);
      const afterDelete = await gisState();
      if (!afterDelete.save || !afterDelete.resultsHidden) throw new Error('엑셀 삭제 후 이전 결과가 남아 있습니다: ' + JSON.stringify(afterDelete));
      await cdp.evaluate(`document.getElementById('run').click()`);
      await until(cdp, `!document.getElementById('results').hidden`, '삭제 후 재조회');
      const relook = await gisState();
      if (!relook.gisHidden) throw new Error('삭제한 GIS 표가 재조회에 남아 있습니다.');
      await cdp.evaluate(`document.getElementById('save').click()`);
      await until(cdp, `document.getElementById('saveStatus').textContent.includes('만들었습니다')`, '삭제 후 PPTX 저장');
      fs.writeFileSync(path.join(outDir, s.name + '-after-delete.pptx'), Buffer.from(await cdp.evaluate(`new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(window.__blobs[window.__blobs.length-1])})`), 'base64'));
      // REV-02/03: 시트 순서가 바뀐 엑셀 + 빠른 교체(A 직후 B) → 최종은 B, 시트 이름 표시
      await upload('gis-sample.xlsx', fs.readFileSync(new URL('./fixtures/gis-sample.xlsx', import.meta.url)));
      await upload('gis-reordered.xlsx', fs.readFileSync(new URL('./fixtures/gis-reordered.xlsx', import.meta.url)));
      await until(cdp, `document.getElementById('gisStatus').textContent.includes('gis-reordered.xlsx') && document.getElementById('gisStatus').textContent.includes('개를 읽었습니다')`, '빠른 교체 완료');
      const replaced = await gisState();
      if (!/SECOND_SHEET/.test(replaced.status) || /gis-sample/.test(replaced.status) || !/지점 1개/.test(replaced.status)) throw new Error('빠른 교체 후 최신 파일(시트 SECOND_SHEET)이어야 합니다: ' + JSON.stringify(replaced));
      view.fastReplace = replaced;
    }
    report.scenarios.push({ ...s, ms: Date.now() - t0, pptxBytes, ...view });
    console.log(`${s.name}: [${view.statusClass.trim()}] ${view.status} · pptx ${pptxBytes} bytes · ${Date.now() - t0}ms`);
  }
  report.heap = await cdp.evaluate(`performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null`);
} finally {
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  chrome.kill();
  server.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 임시 폴더 정리 실패는 무시 */ }
}
console.log('콘솔 오류:', report.consoleErrors.length ? report.consoleErrors : '없음', '· OSM 타일 요청:', report.osmTiles ?? 0, '· 브이월드 타일 요청:', report.vworldTiles ?? 0, '· JS 힙(MB):', report.heap);
process.exit(0);
