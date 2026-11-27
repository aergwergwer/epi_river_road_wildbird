// VWorld's official browser examples use JSONP for the address API.
// Request from the visitor's browser: the hosting server's outbound route
// can return an HTML error before the address service validates the key.
let requestSequence=0;
export function requestGeocodeJsonp(url,{documentImpl=globalThis.document,callbackTarget=globalThis,timeoutMs=15000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 return new Promise((resolve,reject)=>{
  const callbackName='__nibrGeocode_'+Date.now()+'_'+(++requestSequence);
  const script=documentImpl.createElement('script');let settled=false,timer;
  const finish=(error,data)=>{
   if(settled)return;settled=true;clearTimer(timer);
   script.onload=null;script.onerror=null;script.remove();delete callbackTarget[callbackName];
   error?reject(error):resolve(data);
  };
  callbackTarget[callbackName]=data=>finish(null,data);
  const requestUrl=new URL(url);requestUrl.searchParams.set('callback',callbackName);
  script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';script.src=requestUrl.href;
  script.onerror=()=>finish(Error('브이월드 주소 검색에 직접 연결하지 못했습니다. 네트워크 상태 또는 브라우저의 콘텐츠 차단 설정을 확인해 주세요.'));
  script.onload=()=>{if(!settled)finish(Error('브이월드가 주소 검색 결과 대신 다른 응답을 반환했습니다. 잠시 후 다시 시도해 주세요.'));};
  timer=setTimer(()=>finish(Error('브이월드 주소 검색 응답이 지연됩니다. 잠시 후 다시 시도해 주세요.')),timeoutMs);
  try{documentImpl.head.append(script);}catch{finish(Error('브이월드 주소 검색을 시작하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'));}
 });
}
export function parseGeocodeResult(payload,address,type){
 const response=payload?.response;
 if(response?.status==='NOT_FOUND')throw Error('일치하는 주소를 찾지 못했습니다. 도로명·지번 유형과 시·군·구, 번지 또는 건물번호를 확인해 주세요.');
 if(response?.status!=='OK'){
  const code=String(response?.error?.code||'');
  if(/KEY|AUTH|DENIED|PERMISSION|EXPIRED|REGIST|DOMAIN/i.test(code))throw Error('브이월드 주소 검색 인증 또는 이용권한 오류입니다. 인증키의 Geocoder 이용 권한·유효기간과 등록 URL을 확인해 주세요.');
  if(/LIMIT|QUOTA|OVER|RESOURCE/i.test(code))throw Error('브이월드 주소 검색 이용 한도를 초과했습니다. 잠시 후 다시 시도하거나 키의 이용 한도를 확인해 주세요.');
  throw Error('브이월드가 주소 검색을 처리하지 못했습니다. 주소 유형과 입력 내용을 확인한 뒤 다시 시도해 주세요.');
 }
 const point=response.result?.point;
 const lat=Number(point?.y),lon=Number(point?.x);
 if(!point||point.x==null||point.y==null||String(point.x).trim()===''||String(point.y).trim()===''||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<32||lat>40||lon<124||lon>132)throw Error('주소 검색 결과의 국내 좌표를 확인할 수 없습니다. 주소를 다시 확인해 주세요.');
 return {lat,lon,address:typeof response.refined?.text==='string'?response.refined.text:address,inputAddress:address,type,source:'브이월드 Geocoder'};
}
export async function geocodeInBrowser(address,type,key,{requestImpl=requestGeocodeJsonp,origin=globalThis.location?.origin||''}={}){
 address=String(address||'').trim();
 key=String(key||'').trim().replace(/^[*`'"\s]+|[*`'"\s]+$/g,'').replace(/[\u200B-\u200D\uFEFF\s]/g,'').replace(/[\u2010-\u2015\u2212\uFF0D]/g,'-');
 if(address.length<5||address.length>200||/[\x00-\x1f]/.test(address)||!['ROAD','PARCEL'].includes(type))throw Error('시·군·구와 번지 또는 건물번호를 포함한 주소 및 주소 유형을 확인해 주세요.');
 if(!key||key.length>1500||/[^\x21-\x7e]/.test(key))throw Error('주소 검색용 브이월드 Geocoder 인증키를 입력해 주세요.');
 const url=new URL('https://api.vworld.kr/req/address');
 for(const [name,value] of Object.entries({service:'address',request:'getCoord',version:'2.0',crs:'EPSG:4326',address,type,format:'json',refine:'true',simple:'false',key,domain:origin}))url.searchParams.set(name,value);
 const payload=await requestImpl(url.href);
 return parseGeocodeResult(payload,address,type);
}
export function addressCandidateIdentity(item,type) {
 const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
 if(type==='PLACE')return ['place',normalize(item.title),normalize(item.road),normalize(item.parcel),item.lon,item.lat].join('|');
 // Full road addresses retain municipality and building details.
 return [type,normalize(item.road),normalize(item.parcel)].join('|');
}
export function uniqueAddressCandidates(items,type) {
 const seen=new Set();
 return items.filter(item=>{
  const key=addressCandidateIdentity(item,type);
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
}
export async function searchAddressCandidates(address,type,key,{region='',page=1,requestImpl=requestGeocodeJsonp,origin=globalThis.location?.origin||''}={}){
 address=String(address||'').trim();region=String(region||'').trim();
 key=String(key||'').trim().replace(/^[*`'"\s]+|[*`'"\s]+$/g,'').replace(/[\u200B-\u200D\uFEFF\s]/g,'').replace(/[\u2010-\u2015\u2212\uFF0D]/g,'-');
 if(address.length<2||address.length>200||region.length>80||/[\x00-\x1f]/.test(address+region)||!['ROAD','PARCEL','PLACE'].includes(type)||!Number.isInteger(page)||page<1)throw Error('검색어는 두 글자 이상 입력하고 주소 유형과 지역을 확인해 주세요.');
 if(!key||key.length>1500||/[^\x21-\x7e]/.test(key))throw Error('브이월드 검색 API 이용 권한이 있는 인증키를 입력해 주세요.');
 const url=new URL('https://api.vworld.kr/req/search');
 for(const [name,value] of Object.entries({service:'search',request:'search',version:'2.0',crs:'EPSG:4326',query:[region,address].filter(Boolean).join(' '),type:type==='PLACE'?'PLACE':'ADDRESS',format:'json',size:10,page,key,domain:origin}))url.searchParams.set(name,value);
 if(type!=='PLACE')url.searchParams.set('category',type.toLowerCase());
 const response=(await requestImpl(url.href))?.response;
 if(response?.status==='NOT_FOUND')return {items:[],page:1,pages:0,total:0,skipped:0};
 if(response?.status!=='OK'){
  const code=String(response?.error?.code||'');
  if(/KEY|AUTH|DENIED|PERMISSION|EXPIRED|REGIST|DOMAIN/i.test(code))throw Error('브이월드 주소 후보 검색 인증 오류입니다. 키의 검색 API 2.0 이용 권한·유효기간·등록 URL을 확인해 주세요.');
  if(/LIMIT|QUOTA|OVER|RESOURCE/i.test(code))throw Error('브이월드 검색 이용 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.');
  throw Error('브이월드 주소 후보를 읽을 수 없습니다. 주소 유형과 검색어를 확인해 주세요.');
 }
 if(!Array.isArray(response.result?.items))throw Error('브이월드 주소 후보 목록의 응답 형식을 확인할 수 없습니다.');
 const items=[],seen=new Set();let skipped=0;
 for(const item of response.result.items){
  const lat=Number(item.point?.y),lon=Number(item.point?.x),road=String(item.address?.road||''),parcel=String(item.address?.parcel||'');
  const fullAddress=(type==='ROAD'?road:parcel)||road||parcel||(type==='PLACE'?String(item.title||''):'');
  if(!fullAddress||item.point?.x==null||item.point?.y==null||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<32||lat>40||lon<124||lon>132){skipped++;continue;}
  const identity=String(item.id||fullAddress)+':'+lon+':'+lat;if(seen.has(identity))continue;seen.add(identity);
  items.push({id:identity,lat,lon,address:fullAddress,road,parcel,title:String(item.title||''),inputAddress:address,type,region,source:'브이월드 검색 API'});
 }
 const total=Number(response.record?.total),pages=Number(response.page?.total);
 if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(pages)||pages<0)throw Error('주소 검색 결과의 전체 건수를 확인할 수 없습니다. 잠시 후 다시 검색해 주세요.');
 const unique=uniqueAddressCandidates(items,type);
 return {items:unique,total,page,pages,skipped,duplicates:items.length-unique.length};
}
export const searchReferencePlaces=(query,key,options)=>searchAddressCandidates(query,'PLACE',key,options);
