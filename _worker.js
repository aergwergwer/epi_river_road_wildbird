// Cloudflare Pages 고급 모드 워커. /api/* 만 처리한다(_routes.json). 정적 파일은 Pages가 직접 서빙한다.
// 국립생물자원관 철새지리정보를 브라우저 대신 호출해 주는 읽기 전용 중계다.
// 주의: 아래 엔드포인트는 공개 API가 아니라 사이트 내부 AJAX다. 사이트가 바뀌면 응답 형식 오류가 난다.
const BASE = 'https://species.nibr.go.kr';

const reply = (body, status = 200, cache = 'no-store') => Response.json(body, { status, headers: { 'Cache-Control': cache } });
const fail = (message, status = 502) => Object.assign(new Error(message), { status });

async function upstream(path, body) {
  let response;
  try {
    response = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json; charset=utf-8' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw fail('국립생물자원관 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
  }
  if (!response.ok) throw fail('공공자료 서버 응답 오류 (' + response.status + ')');
  let data;
  try { data = await response.json(); } catch { throw fail('국립생물자원관이 JSON 대신 웹페이지를 반환했습니다. 공공자료 서비스 상태를 확인한 뒤 다시 조회해 주세요.'); }
  if (data.meta?.err) throw fail('공공자료 서버가 조회 요청을 처리하지 못했습니다.');
  return data;
}

let metaCache = null;
async function metadata() {
  if (metaCache && Date.now() - metaCache.at < 3600000) return metaCache.value;
  const [areas, terms] = await Promise.all([
    upstream('/bird/home/geo/searchAjax.do?type=visitant_obsv_area'),
    upstream('/bird/home/geo/searchAjax.do?type=visitant_obsv_term'),
  ]);
  const project = areas.data?.find(p => p.project_cd === 'BRDA');
  if (!project || !terms.data?.BRDA) throw fail('조사지역·조사월 응답 형식이 바뀌었습니다.');
  const list = [...new Map(project.children.flatMap(s => s.children).map(a => [a.area_sno, a])).values()];
  const dates = new Set();
  for (const group of Object.values(terms.data.BRDA)) {
    for (const items of Object.values(group)) {
      for (const term of items) for (let i = 4; i < term.length; i += 2) dates.add(term.slice(0, 4) + term.slice(i, i + 2));
    }
  }
  const value = { areas: list, dates: [...dates].filter(d => /^\d{6}$/.test(d)).sort().reverse(), retrievedAt: new Date().toISOString(), source: BASE + '/bird/home/geo/index.do' };
  metaCache = { at: Date.now(), value };
  return value;
}

let boundaryCache = null;
async function boundaries(env, origin) {
  if (boundaryCache && Date.now() - boundaryCache.at < 86400000) return boundaryCache.data;
  const snapshotResponse = await env.ASSETS.fetch(new URL('/data/nibr-boundaries.json', origin));
  if (!snapshotResponse.ok) throw fail('조사구역 경계 스냅샷 파일(data/nibr-boundaries.json)을 찾지 못했습니다.', 500);
  const snapshot = await snapshotResponse.json();
  try {
    const live = await fetch(snapshot.source, { signal: AbortSignal.timeout(8000) });
    const body = await live.json();
    if (!live.ok || body.type !== 'FeatureCollection' || !body.features?.length || body.features.length < Number(body.totalFeatures || 0)) throw new Error('incomplete');
    const data = { ...body, source: snapshot.source, retrievedAt: new Date().toISOString(), snapshot: false };
    boundaryCache = { at: Date.now(), data };
    return data;
  } catch {
    return { ...snapshot, snapshot: true }; // 실시간 조회 실패 시 저장해 둔 경계로 대신한다(캐시하지 않아 다음 요청에 다시 시도).
  }
}

async function counts(params) {
  const raw = params.get('ids') || '', month = params.get('month') || '';
  const ids = raw.split(',').map(Number);
  if (!/^\d+(,\d+)*$/.test(raw) || ids.length > 350 || ids.some(x => !Number.isInteger(x) || x < 1) || !/^\d{4}(0[1-9]|1[0-2])$/.test(month)) throw fail('조회 조건이 올바르지 않습니다.', 400);
  const result = await upstream('/bird/home/geo/searchAjax.do?type=visitant_features', {
    obsvProject: 'BRDA', obsvDiv: [], obsvArea: ids.map(area_sno => ({ area_sno })), obsvTerm: [month], resultType: '2',
  });
  if (result.data?.type !== 'FeatureCollection') throw fail('개체수 응답 형식이 변경되었습니다.');
  return result.data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method !== 'GET') return reply({ error: '지원하지 않는 요청 방식입니다.' }, 405);
      const cache = 'private, max-age=300';
      if (url.pathname === '/api/metadata') return reply(await metadata(), 200, cache);
      if (url.pathname === '/api/boundaries') return reply(await boundaries(env, url.origin), 200, cache);
      if (url.pathname === '/api/counts') return reply(await counts(url.searchParams), 200, cache);
      return reply({ error: '없는 API입니다.' }, 404);
    } catch (error) {
      return reply({ error: error.message || '공공자료 연결에 실패했습니다.' }, error.status || 502);
    }
  },
};
