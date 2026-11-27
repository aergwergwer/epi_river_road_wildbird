// 국립생물자원관 서버를 흉내 내는 가짜 응답. 실제 서버를 호출할 수 없는 환경(테스트)에서 워커의 해석 코드를 검증한다.
// 응답 모양은 _worker.js가 기대하는 형식(내부 AJAX)을 따른다. 실제 서버 응답과 같다는 보장은 없다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data', 'nibr-boundaries.json'), 'utf8'));
export const names = [...new Set(snapshot.features.map(f => f.properties.name))];
export const areaIdOf = name => 1000 + names.indexOf(name);
export const countOf = (id, month) => ((id * 7919 + Number(month)) % 9000) + (id % 5 === 0 ? 0 : 150);

export function installMockUpstream() {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    const fail = globalThis.__mockFail;
    if (fail === 'counts' && url.includes('type=visitant_features')) return new Response('boom', { status: 500 });
    if (fail === 'metadata' && url.includes('type=visitant_obsv_area')) return new Response('<html>점검 중</html>', { status: 200 });
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://species.nibr.go.kr/bird/home/geo/searchAjax.do?type=visitant_obsv_area')) {
      return json({ data: [{ project_cd: 'BRDA', children: [{ children: names.map(n => ({ area_sno: areaIdOf(n), area_nm: n })) }] }] });
    }
    if (url.startsWith('https://species.nibr.go.kr/bird/home/geo/searchAjax.do?type=visitant_obsv_term')) {
      return json({ data: { BRDA: { g: { h: ['20251112', '20260102', '2026030405'] } } } });
    }
    if (url.startsWith('https://species.nibr.go.kr/bird/home/geo/searchAjax.do?type=visitant_features')) {
      const body = JSON.parse(init.body);
      const month = body.obsvTerm[0];
      return json({ data: { type: 'FeatureCollection', features: body.obsvArea.map(a => ({ properties: { area_sno: a.area_sno, cnt_tot: countOf(a.area_sno, month) } })) } });
    }
    if (url.startsWith('https://species.nibr.go.kr/geosvr/wfs')) return new Response('offline', { status: 503 });
    return real(input, init);
  };
}
