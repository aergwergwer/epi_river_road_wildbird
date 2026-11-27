export const mapAttribution=provider=>provider==='vworld'?'© 공간정보 오픈플랫폼(브이월드)':'© OpenStreetMap contributors';
export const mapName=provider=>provider==='vworld'?'브이월드 일반지도(Base)':'OpenStreetMap 일반지도';
// VWorld permits cross-origin WMTS requests. Fetch from the user's browser:
// the hosting provider's outbound route can return 520 before key validation.
export async function fetchVworldBrowserTile(z,x,y,key,{fetchImpl=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),origin=globalThis.location?.origin||'',layer='Base'}={}){
 const url=new URL(`https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key.trim())}/${layer}/${z}/${y}/${x}.${layer==='Satellite'?'jpeg':'png'}`);
 if(origin)url.searchParams.set('domain',origin);
 for(let attempt=1;attempt<=3;attempt++){
  let response;
  try{response=await fetchImpl(url.href,{mode:'cors',credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin',signal:AbortSignal.timeout(10000)});}
  catch{if(attempt<3){await wait(attempt*500);continue;}throw Error('브이월드 WMTS에 직접 연결하지 못했습니다. 네트워크 또는 브이월드 서비스 상태를 확인해 주세요.');}
  if(response.ok&&/^image\//i.test(response.headers.get('Content-Type')||''))return response.blob();
  const raw=await response.text();
  const locator=raw.match(/\blocator\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  const code=raw.match(/\bexceptionCode\s*=\s*["']([A-Za-z][\w.-]{1,79})["']/i)?.[1];
  if(locator==='key'||locator==='domain'||/AUTH|DENIED|PERMISSION|EXPIRED|REGIST|FORBIDDEN/i.test(code||'')){
   throw Error(locator==='key'?'브이월드 WMTS 인증키가 거절되었습니다. 브이월드에서 발급한 키와 이용승인 상태를 확인해 주세요.':`브이월드 WMTS 이용 권한 또는 등록 도메인을 확인해 주세요. 등록할 서비스 URL: ${origin}`);
  }
  if([408,429,500,502,503,504,520,521,522,523,524,525,526].includes(response.status)&&attempt<3){await wait(attempt*500);continue;}
  throw Error(`브이월드 WMTS 응답 오류 (HTTP ${response.status}${code?', '+code:''}). 브이월드 서비스 상태와 WMTS 이용 설정을 확인해 주세요.`);
 }
}
export async function loadMapTile(z,x,y,{provider='osm',key='',layer='Base'}={}){
 let url,temporary=false;
 if(provider==='vworld'){
  if(!key.trim())throw Error('브이월드 WMTS 일반지도 인증키를 입력해 주세요.');
  url=URL.createObjectURL(await fetchVworldBrowserTile(z,x,y,key,{layer:layer==='Hybrid'?'Satellite':layer}));temporary=true;
 }else url=`https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
 return new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';let settled=false;const finish=(error,result=image)=>{if(settled)return;settled=true;clearTimeout(timer);image.onload=null;image.onerror=null;if(temporary)URL.revokeObjectURL(url);error?reject(error):resolve(result);};const timer=setTimeout(()=>{image.src='';finish(Error(mapName(provider)+' 타일 응답이 12초 넘게 지연됐습니다. 잠시 후 다시 시도해 주세요.'));},12000);image.onload=async()=>{
 if(provider==='vworld' && layer==='Hybrid') {
  try {
   const overlayUrl=URL.createObjectURL(await fetchVworldBrowserTile(z,x,y,key,{layer:'Hybrid'}));
   try {
    const overlay=new Image();overlay.src=overlayUrl;await overlay.decode();
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,256,256);ctx.drawImage(overlay,0,0,256,256);
    finish(null,canvas);
   } finally {URL.revokeObjectURL(overlayUrl);}
  } catch(error){finish(error);}
 } else finish();
};image.onerror=()=>finish(Error(mapName(provider)+' 타일을 불러오지 못했습니다.'));image.src=url;});
}
