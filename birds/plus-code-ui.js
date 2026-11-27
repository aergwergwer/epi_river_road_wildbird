import {parsePlusCode,decodePlusCode} from './plus-code.js';
import {searchReferencePlaces} from './geocoding.js';
export function createPlusCodeController({$,clearResults,fitView,controls,status,isBusy,setBusy,isActive=()=>true,onConfirmed=()=>{},searchPlaces=searchReferencePlaces}){
 let resolved=null,reference=null,results={items:[],page:1,pages:0,total:0},candidateButtons=[];
 const signature=()=>JSON.stringify(['plusInput','plusReferenceMode','plusRefLat','plusRefLon','plusPlace'].map(id=>$(id).value.trim()).concat(reference?.id||''));
 const isCurrent=()=>!!resolved&&resolved.signature===signature();
 function refresh(){
  let parsed;try{parsed=parsePlusCode($('plusInput').value);}catch{}
  $('plusReferenceSection').hidden=parsed&&!parsed.short;
  $('plusCoordinateReference').hidden=$('plusReferenceMode').value!=='coordinates';
  $('plusPlaceReference').hidden=$('plusReferenceMode').value!=='place';
  syncDisabled(isBusy());
 }
 function invalidate(clearReference=true){
  resolved=null;
  if(clearReference){reference=null;results={items:[],page:1,pages:0,total:0};$('plusCandidates').replaceChildren();$('plusPager').hidden=true;candidateButtons=[];}
  clearResults();
  $('plusResult').textContent='코드 또는 기준 위치가 변경되었습니다. 플러스 코드 위치를 확인해 주세요.';
  if(isActive())$('mapInfo').textContent='플러스 코드 위치 미확정 · 지도에는 이전 위치가 남아 있습니다. 코드 위치를 확인해 주세요.';
  refresh();controls();
 }
 function syncDisabled(busy){
  for(const id of ['plusInput','plusReferenceMode','plusRefLat','plusRefLon','plusPlace','plusSearchKey','plusFindReference','plusResolve'])$(id).disabled=busy||!isActive();
  for(const id of ['plusRefLat','plusRefLon'])$(id).disabled=busy||!isActive()||$('plusReferenceSection').hidden||$('plusCoordinateReference').hidden;
  $('plusPrev').disabled=busy||results.page<=1;$('plusNext').disabled=busy||results.page>=results.pages;
  for(const button of candidateButtons)button.disabled=busy;
 }
 async function run(action){
  if(isBusy())return;resolved=null;clearResults();setBusy(true);controls();
  try{await action();}catch(error){$('plusResult').textContent=error.message;status(error.message,true);}
  finally{setBusy(false);controls();}
 }
 function convert(){
  const parsed=parsePlusCode($('plusInput').value);
  let ref=null;
  if(parsed.short){
   if($('plusReferenceMode').value==='coordinates')ref={lat:$('plusRefLat').value,lon:$('plusRefLon').value};
   else{
    if(!reference||reference.query!==$('plusPlace').value.trim())throw Error('짧은 코드의 기준 지역·장소 후보를 검색하고 한 곳을 선택해 주세요.');
    ref=reference;
   }
  }
  const result=decodePlusCode($('plusInput').value,ref);
  if(Math.abs(result.lat)>80)throw Error('코드를 해석했지만 현재 지도의 지원 위도 범위(-80~80도)를 벗어납니다.');
  resolved={...result,signature:signature(),reference:parsed.short?ref:null};
  $('lat').value=result.lat;$('lon').value=result.lon;fitView();
  $('plusResult').textContent=`${parsed.short?'기준점에 가장 가까운 긴 코드로 복원':'긴 코드 확인'}: ${result.fullCode} · 코드 영역의 중심 좌표 ${result.lat.toFixed(6)}, ${result.lon.toFixed(6)}. 지도 위치를 확인한 뒤 주변 도래지를 조회해 주세요.`;
  status('플러스 코드 위치를 지도에 표시했습니다. 위치를 확인한 뒤 주변 도래지를 조회해 주세요.');
 }
 function renderCandidates(){
  $('plusCandidates').replaceChildren();candidateButtons=[];
  const groups=new Map();
  for(const item of results.items){const location=decodePlusCode($('plusInput').value,item);if(!groups.has(location.fullCode))groups.set(location.fullCode,{location,items:[]});groups.get(location.fullCode).items.push(item);}
  for(const {location,items} of groups.values()){
   const item=items[0];
   const card=document.createElement('div');card.className='addressCandidate';
   for(const text of [location.fullCode,`복원 좌표: ${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`,`기준점: ${item.title||item.address||''}`,item.road||item.parcel,items.length>1?`기준점 ${items.length}곳이 같은 위치로 복원됩니다.`:''].filter(Boolean)){const line=document.createElement('p');line.textContent=text;card.append(line);}
   const selected=items.some(candidate=>candidate.id===reference?.id);
   const button=document.createElement('button');button.type='button';button.className='sample';button.textContent=selected?'선택한 위치로 다시 조회':'이 위치로 도래지 조회';button.setAttribute('aria-label',location.fullCode+' 위치로 도래지 조회');button.setAttribute('aria-pressed',String(selected));
   button.onclick=async()=>{if(isBusy())return;reference={...item,query:$('plusPlace').value.trim()};await run(()=>{convert();renderCandidates();});if(isCurrent())await onConfirmed();};
   candidateButtons.push(button);card.append(button);$('plusCandidates').append(card);
  }
  $('plusPager').hidden=results.pages<=1;$('plusPageInfo').textContent=`${results.page} / ${results.pages} 페이지`;
  return groups.size;
 }
 async function findReferences(page=1){
  if(isBusy())return;
  invalidate();
  await run(async()=>{
   status('짧은 코드의 기준 지역·장소 후보를 검색하고 있습니다…');
   const query=$('plusPlace').value.trim(),key=$('plusSearchKey').value.trim()||$('geocodeKey').value.trim()||$('vworldKey').value.trim();
   parsePlusCode($('plusInput').value);
   results=await searchPlaces(query,key,{page});const locations=renderCandidates();
   const message=results.total?`기준점 총 ${results.total.toLocaleString('ko-KR')}곳 · ${results.page}/${results.pages} 페이지에서 복원된 위치 ${locations}곳. 같은 위치는 하나로 묶었습니다. 아래 ‘이 위치로 도래지 조회’를 누르세요.`:'국내 기준점 후보가 없습니다. 읍면동·주변 장소명을 보완하거나 기준 위경도를 직접 입력해 주세요.';
   $('plusResult').textContent=message;status(message);
  });
 }
 async function resolve(){
  if(isBusy())return;
  let parsed;try{parsed=parsePlusCode($('plusInput').value);}catch(error){invalidate();$('plusResult').textContent=error.message;status(error.message,true);return;}
  if(parsed.short&&$('plusReferenceMode').value==='place'&&(!reference||reference.query!==$('plusPlace').value.trim())){if(results.items.length){renderCandidates();status('복원된 위치의 ‘이 위치로 도래지 조회’ 버튼을 눌러 주세요.');}else await findReferences();return;}
  await run(convert);
 }
 $('plusInput').addEventListener('input',()=>{
  try{const parsed=parsePlusCode($('plusInput').value);if(parsed.locality)$('plusPlace').value=parsed.locality;}catch{}
  invalidate();
 });
 for(const id of ['plusReferenceMode','plusRefLat','plusRefLon','plusPlace'])$(id).addEventListener('input',()=>invalidate());
 $('plusResolve').onclick=resolve;$('plusFindReference').onclick=()=>findReferences();
 $('plusPrev').onclick=()=>findReferences(results.page-1);$('plusNext').onclick=()=>findReferences(results.page+1);
 for(const id of ['plusInput','plusRefLat','plusRefLon','plusPlace'])$(id).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();resolve();}});
 refresh();
 return {isCurrent,syncDisabled,resolve,reset:invalidate,getLocation(){if(!isCurrent())throw Error('플러스 코드 위치를 먼저 확인해 주세요.');$('lat').value=resolved.lat;$('lon').value=resolved.lon;return resolved;}};
}
