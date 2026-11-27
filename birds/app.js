import {surveySites,applyCounts} from './nibr-sites.js';
import {boundaryImage} from './boundary-renderer.js';
import {fmt,distance} from './core.js';
import {exportPptx} from './export.js';
import {DESIGN,labelLayout,siteText,distanceText} from './report-design.js';
import {radiusView,inputLocation} from './map-view.js';
import {loadMapTile,mapName,mapAttribution} from './base-map.js';
import {searchAddressCandidates} from './geocoding.js';
import {createPlusCodeController} from './plus-code-ui.js';
const $=id=>document.getElementById(id);
let meta,rows=[],query=null,busy=false,boundaryLayer=null,fetchSeq=0,overlayState=null,pendingRetry=null;
let plusCode=null;
let resolvedAddress=null;
let addressSearch={items:[],page:1,pages:0,total:0};
const addressMode=()=>$('locationMode').value==='address';
function clearLocationResults(){
 ++fetchSeq;query=null;rows=[];labels.clearLayers();updateBoundaries();$('results').replaceChildren();render();
}
function addressIsCurrent(){return resolvedAddress?.inputAddress===$('address').value.trim()&&resolvedAddress?.type===$('addressType').value&&resolvedAddress?.region===$('addressRegion').value.trim();}
async function resolveAddressLocation(){
 if(addressIsCurrent()){$('lat').value=resolvedAddress.lat;$('lon').value=resolvedAddress.lon;fitInputView();return resolvedAddress;}
 throw Error('주소 후보를 검색하고 조회할 주소를 선택해 주세요.');
}
function resetAddressSelection(){
 resolvedAddress=null;addressSearch={items:[],page:1,pages:0,total:0};
 $('addressCandidates').replaceChildren();$('addressPager').hidden=true;
 clearLocationResults();
}
function renderAddressCandidates(){
 $('addressCandidates').replaceChildren();
 for(const item of addressSearch.items){
  const card=document.createElement('div');card.className='addressCandidate';
  for(const [name,value] of [['도로명',item.road],['지번',item.parcel]])if(value){const line=document.createElement('p');line.textContent=name+' · '+value;card.append(line);}
  if(item.title&&item.title!==item.address){const title=document.createElement('p');title.className='candidateTitle';title.textContent=item.title;card.prepend(title);}
  const button=document.createElement('button');button.type='button';button.className='sample';button.textContent=resolvedAddress?.id===item.id?'선택한 주소':'이 주소 선택';button.setAttribute('aria-label',item.address+' 선택');button.setAttribute('aria-pressed',String(resolvedAddress?.id===item.id));
  button.onclick=()=>{
   if(busy)return;clearLocationResults();resolvedAddress=item;$('lat').value=item.lat;$('lon').value=item.lon;fitInputView();
   $('addressResult').textContent=`선택한 주소: ${item.address} · 위도 ${item.lat.toFixed(6)}, 경도 ${item.lon.toFixed(6)}. 지도 위치를 확인한 뒤 주변 도래지를 조회해 주세요.`;
   renderAddressCandidates();controls();status('선택한 주소를 지도에 표시했습니다. 위치와 조사월을 확인한 뒤 주변 도래지를 조회해 주세요.');
  };
  card.append(button);$('addressCandidates').append(card);
 }
 $('addressPager').hidden=addressSearch.pages<=1;
 $('addressPageInfo').textContent=`${addressSearch.page} / ${addressSearch.pages} 페이지`;
}
async function loadAddressCandidates(page=1){
 if(busy)return;
 const address=$('address').value.trim(),key=$('geocodeKey').value.trim()||$('vworldKey').value.trim();
 resetAddressSelection();busy=true;controls();status('일치하는 주소 후보를 검색하고 있습니다…');
 try{
  addressSearch=await searchAddressCandidates(address,$('addressType').value,key,{region:$('addressRegion').value,page});
  renderAddressCandidates();
  const message=addressSearch.total?`주소 후보 총 ${addressSearch.total.toLocaleString('ko-KR')}건 · ${addressSearch.page}/${addressSearch.pages} 페이지. 전체 주소를 확인하고 한 곳을 선택해 주세요.${addressSearch.skipped?' 좌표를 확인할 수 없는 '+addressSearch.skipped+'건은 제외했습니다.':''}`:'일치하는 주소 후보가 없습니다. 주소 유형을 확인하거나 지역·번지를 보완해 다시 검색해 주세요.';
  $('addressResult').textContent=message;status(message);
 }catch(e){$('addressResult').textContent=e.message;status(e.message,true);}
 finally{busy=false;controls();}
}
const map=L.map('map',{zoomControl:false,attributionControl:true,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,boxZoom:false,keyboard:false,zoomSnap:0,zoomDelta:.25}).setView([35.1045,128.9228],11);
const labels=L.layerGroup().addTo(map),center=L.marker([35.1045,128.9228],{interactive:false,icon:L.divIcon({className:'centerDot',iconSize:[14,14]})}).addTo(map);
const radiusCircle=L.circle([35.1045,128.9228],{radius:20000,color:'#555555',weight:1.3,dashArray:'6 5',fill:false,interactive:false}).addTo(map);
L.control.scale({imperial:false,maxWidth:100,position:'bottomleft'}).addTo(map);
let baseLayer=null,baseVersion=0,baseReady=false;
let sharedLayer='Base';
const mapConfig=()=>({layer:sharedLayer,provider:$('mapProvider').value,key:$('vworldKey').value.trim()});
function fitInputView(){
 const q=inputLocation($('lat').value,$('lon').value,$('radius').value),size=map.getSize();if(!q||!size.x||!size.y)return;
 const v=radiusView(q,size.x,size.y);center.setLatLng([q.lat,q.lon]);radiusCircle.setLatLng([q.lat,q.lon]).setRadius(q.radius*1000);map.fitBounds(v.bounds,{animate:false,padding:[0,0]});
 const width=distance(v.span.west,v.span.east),height=distance(v.span.south,v.span.north);
 $('mapInfo').textContent=`${mapName(mapConfig().provider)} · 입력 좌표 중심 고정 · 반경 ${q.radius} km · 지도 범위 약 ${width.toFixed(1)} × ${height.toFixed(1)} km (가로 × 세로)`;
 $('coordText').textContent=`WGS84 · ${q.lat.toFixed(4)}, ${q.lon.toFixed(4)} · 반경 ${q.radius} km`;
 if(query){query.viewWidth=width;query.viewHeight=height;}
}
function applyBaseMap(){
 const config=mapConfig(),version=++baseVersion;let failed=false;baseReady=false;
 if(baseLayer){map.removeLayer(baseLayer);baseLayer=null;}
 $('vworldConfig').hidden=config.provider!=='vworld';$('mapSource').textContent='국립생물자원관 · '+mapAttribution(config.provider);
 fitInputView();
 if(config.provider==='vworld'&&!config.key){status('브이월드 일반지도(Base)를 선택했습니다. 별도 브이월드 인증키를 입력하고 ‘지도 적용’을 눌러 주세요.',true);controls();return;}
 const Layer=L.GridLayer.extend({createTile(coords,done){const tile=document.createElement('canvas');tile.width=256;tile.height=256;loadMapTile(coords.z,coords.x,coords.y,config).then(im=>{tile.getContext('2d').drawImage(im,0,0,256,256);done(null,tile);}).catch(e=>{if(version===baseVersion){failed=true;baseReady=false;status(e.message,true);controls();}done(e,tile);});return tile;}});
 baseLayer=new Layer({tileSize:256,maxZoom:19,maxNativeZoom:19,attribution:mapAttribution(config.provider),keepBuffer:1}).addTo(map);
 baseLayer.on('load',()=>{if(version!==baseVersion)return;baseReady=!failed;controls();if(baseReady&&!busy)status(mapName(config.provider)+' 연결 완료 · 지도 클릭으로 조회 좌표가 바뀌지 않습니다.');});controls();
}
let resizeFrame;
new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{map.invalidateSize({pan:false});fitInputView();placeLabels();});}).observe($('map'));
function status(text,error=false){$('status').textContent=text;$('status').className='status'+(error?' error':'');if(!error){pendingRetry=null;$('retryArea').hidden=true;}}
function offerRetry(kind){pendingRetry=kind;$('retryArea').hidden=false;$('retrySource').textContent=kind==='export'?'PPTX 내보내기 재시도':kind==='metadata'?'조사월 다시 연결':'국립생물자원관 조회 재시도';}
function responseError(data,status){return Object.assign(Error(data.error||'공공자료 연결 실패'),{code:data.code,retryable:data.retryable===true,upstreamStatus:data.upstreamStatus,status});}
async function json(url){
 const r=await fetch(url);
 if(!r.headers.get('Content-Type')?.includes('application/json'))throw Error('자료 서버의 응답을 읽을 수 없습니다. 잠시 후 다시 조회해 주세요.');
 let d;try{d=await r.json();}catch{throw Error(`앱 API (${url})의 JSON 응답을 읽을 수 없습니다. 서버를 다시 시작해 주세요.`);}
 if(!r.ok)throw responseError(d,r.status);return d;
}
function controls(){
 rawBoundaryButton.disabled=busy||!query;
 for(const id of ['searchBtn','lat','lon','radius','month','mapProvider','vworldKey','applyMap','retrySource','locationMode','addressType','address','addressRegion','geocodeKey','resolveAddress'])$(id).disabled=busy||(id==='searchBtn'&&(!meta||($('locationMode').value==='address'&&!addressIsCurrent())));
 $('addressPrev').disabled=busy||addressSearch.page<=1;$('addressNext').disabled=busy||addressSearch.page>=addressSearch.pages;
 $('sample').disabled=busy||!baseReady||($('locationMode').value==='address'&&!addressIsCurrent());
 if(typeof plusCode!=='undefined'&&plusCode)plusCode.syncDisabled(busy);
 const pendingPlus=$('locationMode').value==='pluscode'&&!plusCode.isCurrent();
 $('searchBtn').textContent=pendingPlus?'플러스 코드 확인·도래지 조회':'주변 도래지 조회';
 if(pendingPlus)$('sample').disabled=true;
 const stale=!query; // Editing lookup inputs already clears query in their input handler.
 const reason=busy?'자료를 처리하고 있습니다. 완료 후 다운로드할 수 있습니다.':stale?'주변 도래지를 조회한 뒤 다운로드할 수 있습니다.':!rows.some(r=>r.selected)?'다운로드할 도래지를 한 곳 이상 선택해 주세요.':'';
 // Export fetches its own background; preview load failures must not lock it.
 $('export').disabled=!!reason;$('export').title=reason||'선택한 도래지를 PPTX로 다운로드';
 $('export').setAttribute('aria-describedby','exportHint');
 let hint=$('exportHint');if(!hint){hint=document.createElement('p');hint.id='exportHint';hint.className='exportHint';$('status').before(hint);}hint.textContent=reason||'PPTX 다운로드 준비 완료';
}
function monthText(s){return s.slice(0,4)+'년 '+Number(s.slice(4))+'월';}
function placeLabels(){
 const size=map.getSize();labels.clearLayers();if(!$('labels').checked)return;
 for(const box of labelLayout(map,rows.filter(r=>r.selected),$('distances').checked)){
  const el=document.createElement('div');el.className='templateLabel';el.style.width=(box.w/DESIGN.mapW*size.x)+'px';
  if(box.distance){const distance=document.createElement('div');distance.className='distanceLabel';distance.textContent=box.distance;el.append(distance);}
  const name=document.createElement('div');name.className='siteName';name.textContent=siteText(box.row);el.append(name);
  const ll=map.containerPointToLatLng([box.x/DESIGN.mapW*size.x,box.y/DESIGN.mapH*size.y]);L.marker(ll,{interactive:false,icon:L.divIcon({className:'templateLabelAnchor',html:el,iconSize:[box.w/DESIGN.mapW*size.x,box.h/DESIGN.mapH*size.y],iconAnchor:[0,0]})}).addTo(labels);
 }
}
function render(){
 const chosen=rows.filter(r=>r.selected),known=chosen.filter(r=>r.count!==null);$('siteCount').textContent=query?chosen.length:'—';$('birdCount').textContent=known.length?fmt(known.reduce((n,r)=>n+r.count,0)):'—';$('resultCount').textContent=rows.length;
 $('slideTitle').textContent=$('title').value||'주변 철새 조사구역 현황';$('slideDate').textContent=query?monthText(query.month):'조사월 선택';
 $('legendList').replaceChildren();for(const r of chosen){const div=document.createElement('div');div.className='legendItem';const i=document.createElement('i');i.style.background=r.color;const name=document.createElement('strong');name.textContent=r.name;const count=document.createElement('span');count.textContent=r.count===null?'자료 없음':fmt(r.count);div.append(i,name,count);$('legendList').append(div);}
 updateBoundaries();placeLabels();const pointLabel=$('pointName').value||'조회 지점';if(center.getTooltip())center.setTooltipContent(pointLabel);else center.bindTooltip(pointLabel,{permanent:true,direction:'right',className:'targetLabel',offset:[12,0]});
 if(query){$('coordText').textContent=`WGS84 · ${query.lat.toFixed(4)}, ${query.lon.toFixed(4)} · 반경 ${query.radius} km`;$('provenance').textContent=`경계·두수: 국립생물자원관 ${monthText(query.month)} 전체 관찰종 · ${known.length}/${chosen.length}개소 두수 확인 · 이름·두수 사용자 수정 시 * 표시 · 조회 시각 ${new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국시간)`;}
 if(!query)$('provenance').textContent='실시간 개체수가 아닌 조사 시점의 관찰 기록입니다.';
 if(query)$('provenance').textContent+=` · 거리: 국립생물자원관 경계 최단거리(내부 0km) · ${chosen.filter(r=>Number.isFinite(r.distance)).length}/${chosen.length}개소 경계 연결 · 경계 좌표 ${query.boundarySnapshot?'저장본':'조회본'} ${query.boundaryRetrievedAt?.slice(0,10)||'미확인'}`;
 controls();
}
function renderRows(){
 $('results').replaceChildren();if(!rows.length){const d=document.createElement('div');d.className='empty';d.textContent='현재 지도에 경계가 걸치는 도래지가 없습니다. 반경이나 좌표를 변경해 주세요.';$('results').append(d);return;}
 for(const r of rows){const div=document.createElement('div');div.className='resultRow';
 const check=document.createElement('input');check.type='checkbox';check.checked=r.selected;check.setAttribute('aria-label',r.name+' 포함');check.onchange=()=>{r.selected=check.checked;render();};
 const color=document.createElement('span');color.className='templateSwatch';color.title='참고 PPT의 파란색 표지';
 const field=document.createElement('div'),name=document.createElement('input');name.value=r.name;name.setAttribute('aria-label','도래지 이름');name.oninput=()=>{r.name=name.value;r.edited=true;render();};const source=document.createElement('div');source.className='sub';source.textContent=(r.siteSource||'국립생물자원관')+' · '+(r.reason||'국립생물자원관 연결');field.append(name,source);
 const countWrap=document.createElement('div'),count=document.createElement('input');count.type='number';count.min='0';count.step='1';count.placeholder='자료 없음';count.value=r.count??'';count.setAttribute('aria-label',r.name+' 두수');count.oninput=()=>{const n=Number(count.value);if(count.value!==''&&(!Number.isSafeInteger(n)||n<0)){count.setCustomValidity('0 이상의 정수를 입력해 주세요.');count.reportValidity();$('export').disabled=true;return;}count.setCustomValidity('');r.count=count.value===''?null:n;r.edited=true;render();};const unit=document.createElement('div');unit.className='sub';unit.textContent='마리 · '+(r.edited?'수정값':monthText(query.month));countWrap.append(count,unit);
 const dist=document.createElement('span');dist.className='distance';dist.textContent=distanceText(r);div.append(check,color,field,countWrap,dist);$('results').append(div);}
}
function showDownload(result){let link=document.getElementById('downloadFile');if(!link){link=document.createElement('a');link.id='downloadFile';document.getElementById('status').after(link);}else if(link.href.startsWith('blob:'))URL.revokeObjectURL(link.href);link.href=result.url;link.download=result.filename;link.textContent='완성된 PPTX 파일 저장';link.style.cssText='display:inline-block;padding:12px 20px;background:#1c6056;color:white;margin-bottom:16px;border-radius:6px';}
function updateBoundaries(){
 if(boundaryLayer){map.removeLayer(boundaryLayer);boundaryLayer=null;}
 overlayState=null;if(!query)return;
 const data=boundaryImage(map,rows,Number($('opacity').value));
 boundaryLayer=L.imageOverlay(data,map.getBounds(),{opacity:1,interactive:false}).addTo(map);overlayState={data};
}
const rawBoundaryButton=document.createElement('button');rawBoundaryButton.type='button';rawBoundaryButton.className='sample';rawBoundaryButton.textContent='조사지역 경계 PNG 저장';rawBoundaryButton.title='현재 선택한 국립생물자원관 조사지역 경계 이미지';$('status').after(rawBoundaryButton);
rawBoundaryButton.onclick=()=>{if(!overlayState){status('주변 도래지를 조회한 뒤 경계 PNG를 저장해 주세요.',true);return;}const a=document.createElement('a');a.href=overlayState.data;a.download='국립생물자원관_조사지역경계.png';a.click();};
map.on('moveend',()=>{placeLabels();updateBoundaries();});map.on('resize',()=>{placeLabels();updateBoundaries();});
async function search(event){
 event?.preventDefault();if(!$('search').reportValidity()||busy||!meta)return;
 if($('locationMode').value==='pluscode'&&!plusCode.isCurrent()){await plusCode.resolve();if(!plusCode.isCurrent())return;}
 const current=++fetchSeq;busy=true;rows=[];query=null;labels.clearLayers();updateBoundaries();render();controls();status('국립생물자원관 조사지역 경계 좌표를 조회하고 있습니다…');
 try{
  if(addressMode())await resolveAddressLocation();
  if($('locationMode').value==='pluscode')plusCode.getLocation();
  fitInputView();const q={...inputLocation($('lat').value,$('lon').value,$('radius').value),month:$('month').value,coordinateNote:'EPSG:4326 · WGS84'};
  if(addressMode())q.address=resolvedAddress.address;
  if($('locationMode').value==='pluscode'){const location=plusCode.getLocation();q.plusCode=location.fullCode;q.coordinateNote+=' · Plus Code '+location.fullCode+' 영역 중심';}
  const boundaries=await json('/api/boundaries'),b=map.getBounds();
  const next=surveySites(boundaries.features,meta.areas,[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],[q.lon,q.lat]);
  q.boundaryRetrievedAt=boundaries.retrievedAt;q.boundarySnapshot=boundaries.snapshot===true;q.boundarySource=boundaries.source;
  const ids=[...new Set(next.filter(r=>r.nibrId).map(r=>r.nibrId))];let countFailed=false;
  if(ids.length){
   status('국립생물자원관 '+monthText(q.month)+' 개체수를 연결하고 있습니다…');
   try{const features=[];for(let i=0;i<ids.length;i+=100){const counts=await json('/api/counts?'+new URLSearchParams({ids:ids.slice(i,i+100).join(','),month:q.month}));features.push(...counts.features);}applyCounts(next,features);}
   catch{countFailed=true;for(const r of next.filter(r=>r.nibrId))r.reason='개체수 조회 실패';}
  }
  if(current!==fetchSeq)return;query=q;rows=next;fitInputView();renderRows();render();
  status('국립생물자원관 경계 '+fmt(boundaries.features.length)+'개 중 지도에 걸치는 '+next.length+'개 조사지역 · '+next.filter(r=>r.count!==null).length+'개소 두수 연결 · '+(q.boundarySnapshot?'저장된 경계 '+q.boundaryRetrievedAt.slice(0,10)+' 사용':'최신 경계 조회')+' · 같은 좌표로 경계 표시·거리 계산'+(countFailed?' · 개체수 조회 실패: 다시 조회해 주세요.':next.length?' · PPTX 내보내기 준비 완료':''),countFailed);
  if(countFailed)offerRetry('sites');
 }catch(e){status(e.message,true);offerRetry('sites');render();}finally{busy=false;controls();}
}
$('retrySource').onclick=async()=>{if(busy)return;const kind=pendingRetry;if(kind==='metadata')await init();else if(kind==='export')$('export').click();else await search();};
 plusCode=createPlusCodeController({$,clearResults:clearLocationResults,fitView:fitInputView,controls,status,isBusy:()=>busy,isActive:()=>$('locationMode').value==='pluscode',onConfirmed:()=>search(),setBusy:value=>{busy=value;}});
 $('search').addEventListener('submit',search);
 $('locationMode').onchange=()=>{
  const enabled=addressMode();$('addressConfig').hidden=!enabled;$('address').required=enabled;
  const plus=$('locationMode').value==='pluscode';$('plusConfig').hidden=!plus;$('plusInput').required=plus;
  $('lat').readOnly=enabled||plus;$('lon').readOnly=enabled||plus;resetAddressSelection();plusCode.reset();
  status(plus?'긴 코드 또는 짧은 코드를 입력하고 플러스 코드 위치를 확인해 주세요.':enabled?'주소 후보를 검색한 뒤 전체 주소를 확인하고 한 곳을 선택해 주세요.':'위경도 좌표와 조사월을 선택해 주변 도래지를 조회해 주세요.');
 };
 for(const id of ['address','addressType','addressRegion'])$(id).addEventListener('input',()=>{
  resetAddressSelection();$('addressResult').textContent='검색 조건이 변경되었습니다. 주소 후보를 다시 검색해 주세요.';
  status('검색 조건이 변경되었습니다. 주소 후보를 다시 검색하고 선택해 주세요.');
 });
 $('resolveAddress').onclick=()=>loadAddressCandidates();
 $('addressPrev').onclick=()=>loadAddressCandidates(addressSearch.page-1);
 $('addressNext').onclick=()=>loadAddressCandidates(addressSearch.page+1);
 for(const id of ['address','addressRegion'])$(id).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadAddressCandidates();}});
 for(const id of ['lat','lon','radius','month'])$(id).addEventListener('input',()=>{++fetchSeq;query=null;rows=[];labels.clearLayers();updateBoundaries();$('results').replaceChildren();render();fitInputView();status('입력 좌표·반경에 맞춰 지도를 조절했습니다. 도래지 자료를 다시 조회해 주세요.');});
 $('mapProvider').onchange=applyBaseMap;$('applyMap').onclick=applyBaseMap;$('vworldKey').oninput=()=>{baseReady=false;controls();};
 $('title').oninput=render;$('pointName').oninput=render;$('labels').onchange=render;$('distances').onchange=placeLabels;$('opacity').oninput=()=>{$('opacityValue').textContent=$('opacity').value+'%';updateBoundaries();};
 $('export').onclick=async()=>{if(!query||busy||![...document.querySelectorAll('.resultRow input')].every(i=>i.reportValidity()))return;busy=true;controls();$('map').style.pointerEvents='none';status('국립생물자원관 경계와 PPTX를 준비하고 있습니다…');try{const result=await exportPptx({map,rows,query,title:$('title').value||'주변 철새 조사구역 현황',showLabels:$('labels').checked,showDistances:$('distances').checked,pointName:$('pointName').value||'조회 지점',boundaryImage:boundaryImage(map,rows,Number($('opacity').value)),mapConfig:mapConfig(),onProgress:message=>status(message)});showDownload(result);status('PPTX 다운로드 완료 · 16:9 와이드 · 이름·두수는 편집 가능 / 경계는 이미지');}catch(e){status(e.message,true);offerRetry('export');}finally{busy=false;$('map').style.pointerEvents='';controls();}};
 $('sample').onclick=async()=>{
 if(busy||!baseReady)return;fitInputView();busy=true;controls();$('map').style.pointerEvents='none';map.keyboard.disable();status('참고 PPT 스타일의 디자인 예시를 만들고 있습니다. 실제 조사자료가 아닙니다.');
 try{const size=map.getSize(),q={...inputLocation($('lat').value,$('lon').value,$('radius').value),month:$('month').value||'202601',demo:true};
 const positions=[[.35,.32],[.65,.26],[.44,.72]],examples=positions.map(([x,y],i)=>{const p=map.containerPointToLatLng([size.x*x,size.y*y]);return {id:'sample-'+i,selected:true,name:'예시 도래지 '+String.fromCharCode(65+i),count:[12345,6789,1234][i],lat:p.lat,lon:p.lng,distance:distance([q.lon,q.lat],[p.lng,p.lat]),edited:false};});
 const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=Math.round(1600*size.y/size.x);const ctx=canvas.getContext('2d');
 for(const [x,y] of positions){ctx.beginPath();ctx.moveTo((x-.065)*canvas.width,(y-.15)*canvas.height);ctx.lineTo((x+.07)*canvas.width,(y-.09)*canvas.height);ctx.lineTo((x+.045)*canvas.width,(y+.14)*canvas.height);ctx.lineTo((x-.04)*canvas.width,(y+.1)*canvas.height);ctx.closePath();ctx.fillStyle='rgba(125,117,232,.2)';ctx.fill();ctx.strokeStyle='#7D75E8';ctx.lineWidth=5;ctx.stroke();}
 await exportPptx({map,rows:examples,query:q,title:'디자인 확인용 예시',boundaryImage:canvas.toDataURL('image/png'),showLabels:true,showDistances:true,pointName:'예시 지점',mapConfig:mapConfig()});status('디자인 예시 PPTX 다운로드 완료 · 실제 조사자료가 아닙니다.');
 }catch(e){status(e.message,true);}finally{busy=false;$('map').style.pointerEvents='';controls();}
 };
 async function init(){try{meta=await json('/api/metadata');const max=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,7).replace('-','');const dates=meta.dates.filter(d=>d<=max);$('month').replaceChildren(...dates.map(d=>{const o=document.createElement('option');o.value=d;o.textContent=monthText(d);return o;}));if(!dates.length)throw Error('선택 가능한 조사월이 없습니다.');status(mapConfig().provider==='vworld'&&!mapConfig().key?'조사월 연결 완료 · 브이월드 인증키를 입력하고 지도 적용을 눌러 주세요.':'국립생물자원관 조사월 연결 완료 · 조회할 위치를 입력해 주세요.');}catch(e){meta=null;status(e.message,true);offerRetry('metadata');}controls();}
 try {
  const raw=sessionStorage.getItem('birdHandoff');
  sessionStorage.removeItem('birdHandoff');
  const shared=raw?JSON.parse(raw):null;
  if(shared && Date.now()-shared.at<3600000 && Number.isFinite(shared.lat)&&Number.isFinite(shared.lon)&&Math.abs(shared.lat)<=80&&Math.abs(shared.lon)<=180) {
   $('lat').value=shared.lat;$('lon').value=shared.lon;
   if(shared.pointName)$('pointName').value=shared.pointName;
   if(shared.key)$('vworldKey').value=shared.key;
  }
 } catch {}
 applyBaseMap();requestAnimationFrame(fitInputView);init();








window.birdWorkflow = {
 async ready() {
  const start=Date.now();
  while(!meta) {
   if(Date.now()-start>45000)throw Error('철새 조사월 연결에 실패했습니다. 철새 화면의 재시도 버튼을 확인하세요.');
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  return {dates:[...$('month').options].map(option=>({value:option.value,text:option.textContent}))};
 },
 async configure(shared) {
  if(!shared || !Number.isFinite(shared.lat)||!Number.isFinite(shared.lon)||Math.abs(shared.lat)>80||Math.abs(shared.lon)>180)throw Error('공유 좌표를 확인하세요.');
  if(busy)throw Error('철새 작업이 진행 중입니다.');
  await this.ready();
  const changed=$('lat').value!==String(shared.lat)||$('lon').value!==String(shared.lon)||
    $('month').value!==shared.month||$('radius').value!==String(shared.radius)||
    sharedLayer!=='Base'||$('vworldKey').value!==shared.key;
  if(changed)clearLocationResults();
  $('locationMode').value='coordinates';
  $('lat').value=shared.lat;$('lon').value=shared.lon;
  $('month').value=shared.month;$('radius').value=shared.radius;
  $('pointName').value=shared.pointName||'조회 지점';
  $('vworldKey').value=shared.key;$('mapProvider').value='vworld';sharedLayer='Base';
  if(changed || !baseLayer)applyBaseMap();
  map.invalidateSize();fitInputView();
 },
 async preview() {
  if(!query)await search({preventDefault(){}});
  if(!query)throw Error('철새 조사구역 조회를 완료하지 못했습니다.');
  if(rows.some(row=>row.reason==='개체수 조회 실패'))throw Error('철새 개체수 조회 실패 · 다시 조회하세요.');
  return rows.filter(row=>row.selected).length;
 },
 async create() {
  await this.preview();
  if(!rows.some(row=>row.selected))throw Error('내보낼 철새 조사지역이 없습니다.');
  busy=true;controls();
  try {return await exportPptx({map,rows,query,title:$('title').value,
   pointName:$('pointName').value,boundaryImage:boundaryImage(map,rows,Number($('opacity').value)),
   showLabels:$('labels').checked,showDistances:$('distances').checked,mapConfig:mapConfig(),download:false,
   onProgress:message=>status(message)});
  } finally {busy=false;controls();}
 }
};
if(window.parent!==window) {
 document.body.classList.add('shared-workflow');
 $('mapProvider').closest('label').hidden=true;
 $('pointName').closest('label').hidden=true;

}
