// 주소 → 좌표. 브이월드 검색 API(JSONP, 인증키 필요) 우선, 키가 없으면 OSM Nominatim.
// 브이월드 API는 브라우저 교차 출처 호출을 JSONP로만 허용해서 <script>를 쓴다.
let sequence = 0;

export const cleanKey = key => String(key || '').trim().replace(/^[*`'"\s]+|[*`'"\s]+$/g, '')
  .replace(/[​-‍﻿\s]/g, '').replace(/[‐-―−－]/g, '-');

export function jsonp(url, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const callback = '__vworld_' + Date.now() + '_' + ++sequence;
    const script = document.createElement('script');
    let settled = false, timer;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      delete globalThis[callback];
      error ? reject(error) : resolve(data);
    };
    globalThis[callback] = data => finish(null, data);
    const target = new URL(url);
    target.searchParams.set('callback', callback);
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.src = target.href;
    script.onerror = () => finish(new Error('브이월드 주소 검색에 연결하지 못했습니다. 네트워크 또는 브라우저의 콘텐츠 차단 설정을 확인해 주세요.'));
    script.onload = () => finish(new Error('브이월드가 주소 검색 결과 대신 다른 응답을 반환했습니다.'));
    timer = setTimeout(() => finish(new Error('브이월드 주소 검색 응답이 지연됩니다. 잠시 후 다시 시도해 주세요.')), timeoutMs);
    document.head.append(script);
  });
}

const inKoreaPoint = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 32 && lat <= 40 && lon >= 124 && lon <= 132;

/** 브이월드 검색 API 2.0. type: ROAD(도로명) | PARCEL(지번) | PLACE(장소명) */
export async function searchVworld(query, type, key, { region = '', page = 1, requestImpl = jsonp, origin = globalThis.location?.origin || '' } = {}) {
  query = String(query || '').trim();
  region = String(region || '').trim();
  key = cleanKey(key);
  if (query.length < 2 || query.length > 200 || region.length > 80 || /[\x00-\x1f]/.test(query + region)) throw new Error('검색어는 두 글자 이상 입력해 주세요.');
  if (!['ROAD', 'PARCEL', 'PLACE'].includes(type)) throw new Error('주소 유형을 확인해 주세요.');
  if (!key || key.length > 1500 || /[^\x21-\x7e]/.test(key)) throw new Error('브이월드 인증키를 입력해 주세요.');
  const url = new URL('https://api.vworld.kr/req/search');
  const params = {
    service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', format: 'json', size: 10, page, key, domain: origin,
    query: [region, query].filter(Boolean).join(' '), type: type === 'PLACE' ? 'PLACE' : 'ADDRESS',
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  if (type !== 'PLACE') url.searchParams.set('category', type.toLowerCase());
  const response = (await requestImpl(url.href))?.response;
  if (response?.status === 'NOT_FOUND') return { items: [], page: 1, pages: 0, total: 0, source: '브이월드' };
  if (response?.status !== 'OK') {
    const code = String(response?.error?.code || '');
    if (/KEY|AUTH|DENIED|PERMISSION|EXPIRED|REGIST|DOMAIN/i.test(code)) throw new Error('브이월드 인증 오류입니다. 키의 검색 API 2.0 이용 권한·유효기간·등록 URL을 확인해 주세요.');
    if (/LIMIT|QUOTA|OVER|RESOURCE/i.test(code)) throw new Error('브이월드 이용 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.');
    throw new Error('브이월드가 검색을 처리하지 못했습니다. 주소 유형과 검색어를 확인해 주세요.');
  }
  if (!Array.isArray(response.result?.items)) throw new Error('브이월드 응답 형식을 확인할 수 없습니다.');
  const items = [], seen = new Set();
  for (const item of response.result.items) {
    const lat = Number(item.point?.y), lon = Number(item.point?.x);
    const road = String(item.address?.road || ''), parcel = String(item.address?.parcel || '');
    const label = (type === 'ROAD' ? road : parcel) || road || parcel || String(item.title || '');
    if (!label || !inKoreaPoint(lat, lon)) continue;
    const id = `${item.id || label}:${lon}:${lat}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, lat, lon, label, road, parcel, title: String(item.title || '') });
  }
  return { items, page, pages: Number(response.page?.total) || 1, total: Number(response.record?.total) || items.length, source: '브이월드' };
}

/** 키가 없을 때의 대안. OSM Nominatim은 사용자가 직접 한 번 검색할 때만 호출한다(이용 정책). */
export async function searchNominatim(query, { region = '', fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  query = [region, query].map(v => String(v || '').trim()).filter(Boolean).join(' ');
  if (query.length < 2 || query.length > 200) throw new Error('검색어는 두 글자 이상 입력해 주세요.');
  const url = new URL('https://nominatim.openstreetmap.org/search');
  for (const [k, v] of Object.entries({ q: query, format: 'jsonv2', countrycodes: 'kr', limit: 10, 'accept-language': 'ko', addressdetails: 0 })) url.searchParams.set(k, v);
  let response;
  try { response = await fetchImpl(url.href); } catch { throw new Error('OpenStreetMap 주소 검색에 연결하지 못했습니다. 네트워크를 확인하거나 브이월드 키를 입력해 주세요.'); }
  if (!response.ok) throw new Error('OpenStreetMap 주소 검색 오류 (HTTP ' + response.status + '). 잠시 후 다시 시도해 주세요.');
  const rows = await response.json();
  const items = rows.map(r => ({ id: String(r.place_id), lat: Number(r.lat), lon: Number(r.lon), label: r.display_name, road: '', parcel: '', title: r.name || '' }))
    .filter(r => inKoreaPoint(r.lat, r.lon));
  return { items, page: 1, pages: 1, total: items.length, source: 'OpenStreetMap Nominatim' };
}

export function searchAddress(query, type, key, options = {}) {
  return cleanKey(key) ? searchVworld(query, type, key, options) : searchNominatim(query, options);
}
