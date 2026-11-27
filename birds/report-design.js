import {fmt} from './core.js';
export const DESIGN={width:13.333333,height:7.5,mapX:0,mapY:.174,mapW:13.333333,mapH:7.152,font:'맑은 고딕',purple:'7D75E8',blue:'0000FF',labelFill:'EDEDED',cyan:'00B0F0',red:'FF0000'};
export const siteText=r=>`${r.name} ${r.count===null?'자료 없음':fmt(r.count)+'수'}${r.edited?' *':''}`;
export const distanceText=r=>!Number.isFinite(r.distance)?'경계 미확인':r.distance===0?'0km':r.distance<.05?'<0.1km':r.distance.toFixed(1)+'km';
function collides(a,b){return a.x<b.x+b.w+.08&&a.x+a.w+.08>b.x&&a.y<b.y+b.h+.08&&a.y+a.h+.08>b.y;}
export function labelLayout(map,rows,showDistances=true){
 const size=map.getSize(),placed=[],result=[];
 for(const row of rows){const raw=map.latLngToContainerPoint([row.labelLat??row.lat,row.labelLon??row.lon]),p=Number.isFinite(row.labelLat)?{x:Math.max(0,Math.min(size.x,raw.x)),y:Math.max(0,Math.min(size.y,raw.y))}:raw;if(p.x<0||p.x>size.x||p.y<0||p.y>size.y)continue;
  const px=p.x/size.x*DESIGN.mapW,py=p.y/size.y*DESIGN.mapH,units=[...siteText(row)].reduce((n,c)=>n+(/[\u1100-\uFFFF]/.test(c)?1:.55),0);
  const w=Math.min(5,Math.max(1.8,units*22/72+.18)),distance=showDistances?distanceText(row):'',h=distance?.78:.44;
  const candidates=[[px-w/2,py+.12],[px-w/2,py-h-.12],[px+.15,py-h/2],[px-w-.15,py-h/2]];
  for(let i=1;i<=8;i++)candidates.push([px-w/2+(i%2?1:-1)*Math.ceil(i/2)*.25,py+(i%2?.2:-.3)*i]);
  const fit=([x,y])=>({x:Math.max(.04,Math.min(DESIGN.mapW-w-.04,x)),y:Math.max(.04,Math.min(DESIGN.mapH-h-.04,y)),w,h});
  const box=candidates.map(fit).find(b=>!placed.some(p=>collides(b,p)))||fit(candidates[0]);placed.push(box);result.push({row,...box,labelY:box.y+(distance?.34:0),labelH:.44,distance});
 }return result;
}
