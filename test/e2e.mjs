#!/usr/bin/env node
// 실제 브라우저(Chrome headless) 종단 점검. 의존 패키지 없이 DevTools 프로토콜을 직접 쓴다.
// 사용법: node test/e2e.mjs [출력폴더=/tmp/e2e]
// - 국립생물자원관은 가짜 응답(test/mock-nibr.mjs), OSM 타일은 합성 PNG로 대신한다. 외부 네트워크는 쓰지 않는다.
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
function tilePng(z, x, y) {
  const size = 256, raw = Buffer.alloc((size * 3 + 1) * size);
  const hue = (x * 37 + y * 91 + z * 13) % 60;
  for (let j = 0; j < size; j++) {
    raw[j * (size * 3 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      const edge = i === 0 || j === 0 || i === 255 || j === 255, grid = i % 64 === 0 || j % 64 === 0;
      const o = j * (size * 3 + 1) + 1 + i * 3;
      raw[o] = edge ? 90 : grid ? 205 : 232 - hue / 3;
      raw[o + 1] = edge ? 90 : grid ? 215 : 236 - hue / 4;
      raw[o + 2] = edge ? 90 : grid ? 210 : 226 + hue / 4;
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
  { name: 'seoul-none', lat: 37.5665, lon: 126.978, pointName: '서울시청', background: 'none', waterRadius: 5000, birdRadius: 20000 },
  { name: 'gwangju-osm', lat: 35.1595, lon: 126.8526, pointName: '광주 영산강 인근', background: 'osm', waterRadius: 3000, birdRadius: 30000 },
  { name: 'seoul-counts-fail', lat: 37.5665, lon: 126.978, pointName: '개체수 실패', background: 'none', waterRadius: 5000, birdRadius: 20000, fail: 'counts' },
  { name: 'gangneung-none-1500', lat: 37.7519, lon: 128.8761, pointName: '강릉', background: 'none', waterRadius: 1500, birdRadius: 50000 },
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
      const m = msg.params.request.url.match(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
      report.osmTiles = (report.osmTiles || 0) + 1;
      cdp.send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: tilePng(...m.slice(1).map(Number)).toString('base64') });
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://tile.openstreetmap.org/*' }] });

  for (const s of scenarios) {
    const t0 = Date.now();
    globalThis.__mockFail = s.fail || null;
    await cdp.send('Page.navigate', { url: base });
    await until(cdp, `document.readyState==='complete' && !document.getElementById('run').disabled`, '초기화');
    await cdp.evaluate(`(()=>{window.__blobs=[];const o=URL.createObjectURL;URL.createObjectURL=b=>{window.__blobs.push(b);return o(b)};
      const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
      set('pointName',${JSON.stringify(s.pointName)});set('lat','${s.lat}');set('lon','${s.lon}');set('waterRadius','${s.waterRadius}');set('birdRadius','${s.birdRadius}');set('background','${s.background}');
      document.getElementById('run').click();})()`);
    await until(cdp, `!document.getElementById('results').hidden || document.getElementById('status').className.includes('error')`, '조회');
    const view = await cdp.evaluate(`({status:document.getElementById('status').textContent,statusClass:document.getElementById('status').className,
      water:[...document.querySelectorAll('#waterRows tr')].map(r=>r.innerText.replace(/\\s+/g,' ')),
      road:[...document.querySelectorAll('#roadRows tr')].map(r=>r.innerText.replace(/\\s+/g,' ')),
      bird:[...document.querySelectorAll('#birdRows tr')].map(r=>r.innerText.replace(/\\s+/g,' ')),
      caption:document.getElementById('birdCaption').textContent})`);
    for (const id of ['preview1', 'preview2']) {
      const data = await cdp.evaluate(`document.getElementById('${id}').toDataURL('image/png').split(',')[1]`);
      fs.writeFileSync(path.join(outDir, `${s.name}-${id}.png`), Buffer.from(data, 'base64'));
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
console.log('콘솔 오류:', report.consoleErrors.length ? report.consoleErrors : '없음', '· OSM 타일 요청:', report.osmTiles ?? 0, '· JS 힙(MB):', report.heap);
process.exit(0);
