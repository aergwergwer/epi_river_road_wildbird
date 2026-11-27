import {fmt} from './core.js';
import {DESIGN as D,labelLayout,siteText,distanceText} from './report-design.js';
import {loadMapTile,mapAttribution,mapName} from './base-map.js';
import {destination} from './map-view.js';
export function createPresentation(scope=window){
 const Constructor=scope.PptxGenJS||scope.pptxgen;
 if(typeof Constructor!=='function')throw Error('PPTX 생성 라이브러리를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
 const pptx=new Constructor();pptx.layout='LAYOUT_WIDE';pptx.lang='ko-KR';pptx.author='NIBR Bird Atlas';pptx.company='NIBR Bird Atlas';pptx.theme={headFontFace:D.font,bodyFontFace:D.font,lang:'ko-KR'};return pptx;
}
async function mapImage(map,config,onProgress=()=>{}){
 const size=map.getSize(),baseZoom=map.getZoom();let z=Math.max(0,Math.min(19,Math.floor(baseZoom+Math.log2(1600/size.x)))),factor=2**(z-baseZoom);
 let corner=map.project(map.getBounds().getNorthWest(),z);
 const tileCount=()=>((Math.floor((corner.x+size.x*factor)/256)-Math.floor(corner.x/256)+1)*(Math.floor((corner.y+size.y*factor)/256)-Math.floor(corner.y/256)+1));
 while(tileCount()>24&&z>0){z--;factor=2**(z-baseZoom);corner=map.project(map.getBounds().getNorthWest(),z);}
 const c=document.createElement('canvas');c.width=1600;c.height=Math.round(1600*size.y/size.x);const ctx=c.getContext('2d'),scale=c.width/(size.x*factor);ctx.fillStyle='#e7eeee';ctx.fillRect(0,0,c.width,c.height);
 const left=corner.x,top=corner.y,tasks=[];
 for(let x=Math.floor(left/256);x<=Math.floor((left+size.x*factor)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+size.y*factor)/256);y++)tasks.push(async()=>{const im=await loadMapTile(z,x,y,config);ctx.drawImage(im,(x*256-left)*scale,(y*256-top)*scale,256*scale,256*scale);});
 let next=0,done=0;onProgress(`일반지도 타일 0/${tasks.length}개 수신 중…`);await Promise.all(Array.from({length:Math.min(6,tasks.length)},async()=>{while(next<tasks.length){const task=tasks[next++];await task();onProgress(`일반지도 타일 ${++done}/${tasks.length}개 수신 중…`);}}));return c.toDataURL('image/png');
}
export async function exportPptx({map,rows,query,title,showLabels=true,showDistances=true,boundaryImage,pointName='조회 지점',mapConfig={provider:'osm'},onProgress=()=>{},download=true}){
 const selected=rows.filter(r=>r.selected);if(!selected.length)throw Error('내보낼 도래지를 선택해 주세요.');
 const pptx=createPresentation();pptx.subject='국립생물자원관 동시센서스 조사지역 · 월별 개체수';pptx.title=title;
 const bg=await mapImage(map,mapConfig,onProgress),slide=pptx.addSlide();slide.background={color:'FFFFFF'};
 const txt=(text,x,y,w,h,opts={})=>slide.addText(String(text),{x,y,w,h,fontFace:D.font,fontSize:22,bold:true,color:D.blue,margin:0,breakLine:false,...opts});
 slide.addImage({data:bg,x:D.mapX,y:D.mapY,w:D.mapW,h:D.mapH,objectName:'일반지도 배경'});
 slide.addImage({data:boundaryImage,x:D.mapX,y:D.mapY,w:D.mapW,h:D.mapH,objectName:'국립생물자원관 조사지역 좌표 경계 (이미지)'});
 const mapSize=map.getSize(),radiusPoints=Array.from({length:72},(_,i)=>{const [lon,lat]=destination([query.lon,query.lat],query.radius,i*5);const p=map.latLngToContainerPoint([lat,lon]);return [D.mapX+p.x/mapSize.x*D.mapW,D.mapY+p.y/mapSize.y*D.mapH];});
 const rx=Math.min(...radiusPoints.map(p=>p[0])),ry=Math.min(...radiusPoints.map(p=>p[1])),rw=Math.max(...radiusPoints.map(p=>p[0]))-rx,rh=Math.max(...radiusPoints.map(p=>p[1]))-ry;
 if(rw>0&&rh>0)slide.addShape(pptx.ShapeType.ellipse,{x:rx,y:ry,w:rw,h:rh,line:{color:'555555',width:1,dashType:'dash'},fill:{color:'FFFFFF',transparency:100},objectName:'조회 반경 '+query.radius+'km'});
 const boxes=showLabels?labelLayout(map,selected,showDistances):[];
 for(const b of boxes){const x=D.mapX+b.x,y=D.mapY+b.labelY;
  txt(siteText(b.row),x,y,b.w,b.labelH,{fontSize:22,align:'center',valign:'mid',fit:'shrink',margin:.04,fill:{color:D.labelFill},line:{color:D.blue,width:1},objectName:'도래지 이름·두수 (통합 개체·편집 가능)'});
  if(b.distance)txt(b.distance,D.mapX+b.x+.05,D.mapY+b.y,Math.max(.62,b.distance.length*.18),.31,{fontSize:20,color:'000000',fill:{color:D.cyan},align:'center',valign:'mid',objectName:'구역 경계 최단거리 (편집 가능)'});
 }
 const cp=map.latLngToContainerPoint([query.lat,query.lon]),size=map.getSize();
 if(cp.x>=0&&cp.x<=size.x&&cp.y>=0&&cp.y<=size.y){const x=D.mapX+cp.x/size.x*D.mapW,y=D.mapY+cp.y/size.y*D.mapH;
  slide.addShape(pptx.ShapeType.ellipse,{x:x-.1,y:y-.1,w:.2,h:.2,line:{color:D.red,width:2.25},fill:{color:'FFFF00'},objectName:'조회 지점'});
  txt(pointName,Math.max(.04,Math.min(D.width-1.8,x+.18)),Math.max(D.mapY,Math.min(D.mapY+D.mapH-.68,y-.3)),1.65,.62,{fontSize:20,color:'FFFFFF',fill:{color:D.red},align:'center',valign:'mid',fit:'shrink',objectName:'조회 지점 이름 (편집 가능)'});
 }
 txt((query.demo?'디자인 확인용 예시 · 실제 조사자료 아님 · ':'')+`조사 ${query.month.slice(0,4)}-${query.month.slice(4)} · WGS84 ${query.lat.toFixed(4)}, ${query.lon.toFixed(4)} · 반경 ${query.radius}km`,.1,7.36,7,.12,{fontSize:6,bold:false,color:'555555'});
 txt('국립생물자원관 · '+mapAttribution(mapConfig.provider),7.1,7.36,6.1,.12,{fontSize:6,bold:false,color:'555555',align:'right'});
 for(let pg=0;pg<Math.ceil(selected.length/12);pg++){
  const s=pptx.addSlide();s.addText(query.demo?'디자인 확인용 예시 (실제 조사자료 아님)':title+' · 자료와 출처',{x:.5,y:.35,w:12.3,h:.5,fontSize:24,bold:true,fontFace:D.font,color:D.blue});
  s.addTable([['도래지명','두수(수)','경계 최단거리','조사월','자료 상태'],...selected.slice(pg*12,pg*12+12).map(r=>[r.name,r.count===null?'자료 없음':fmt(r.count)+(r.edited?' *':''),distanceText(r),query.month.slice(0,4)+'-'+query.month.slice(4),query.demo?'디자인 확인용 예시':r.edited?'사용자 수정값':r.reason||'국립생물자원관 조사지역명 일치'])],{x:.5,y:1.05,w:12.3,colW:[3,1.8,1.4,1.4,4.7],fontSize:11,fontFace:D.font,border:{pt:.5,color:'C6C4E4'},color:D.blue,fill:D.labelFill,margin:.12,autoPage:false});
  s.addText('조사지역·경계: 국립생물자원관 철새지리정보 (동시센서스)\n개체수: 국립생물자원관 / https://species.nibr.go.kr/bird/home/geo/index.do · 배경: '+mapName(mapConfig.provider)+'\n거리: 국립생물자원관 구역 경계까지의 최단거리 · 내부 0km · 미연결은 경계 미확인\n입력 좌표 중심 고정 · 지도 축척 기준 반경 '+query.radius+'km · '+(query.viewWidth?'지도 표시 범위 약 '+query.viewWidth.toFixed(1)+' × '+query.viewHeight.toFixed(1)+'km · ':'')+'와이드 화면의 가로 여백은 지도 축척 기준 반경 외 지역을 포함합니다.\n전체 관찰종의 해당 월 합계. 자료 없음은 0수와 다릅니다. 경계는 실제 서식지·법정 보호구역의 확정 경계가 아닌 센서스 조사지역이며, 원본 좌표를 연보라색으로 그렸습니다.\n경계 표시와 거리 계산에 같은 좌표 사용. 경계 '+(query.boundarySnapshot?'저장본':'조회본')+' '+(query.boundaryRetrievedAt?.slice(0,10)||'미확인')+' · 좌표계: '+(query.coordinateNote||query.crs||'WGS84')+' · 조회: '+new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' (한국시간) · * 수정값',{x:.5,y:6.2,w:12.3,h:1,fontSize:9,fontFace:D.font,color:'555555',margin:0});
 }
 onProgress('PPTX 파일 압축 중…');let timer;let buffer;try{buffer=await Promise.race([pptx.write({outputType:'arraybuffer'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PPTX 생성이 60초 넘게 지연됐습니다. 선택한 도래지 수를 줄여 다시 시도해 주세요.')),60000);})]);}finally{clearTimeout(timer);}const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=query.demo?'NIBR_철새조사구역_디자인예시.pptx':'NIBR_철새조사구역_'+query.month+'.pptx';if(download)a.click();return {blob,labels:boxes.length,slides:pptx.slides.length,url,filename:a.download};
}



