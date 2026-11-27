import {norm,geometryDistance} from './core.js';
import {viewportAnchor} from './visible-sites.js';

// WFS feature IDs are not census area_sno values. Join only unique names.
export function surveySites(features,areas,box,point){
 const byName=new Map();
 for(const a of areas){const key=norm(a.area_nm);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(a);}
 return features.flatMap(f=>{
  if(!['Polygon','MultiPolygon'].includes(f.geometry?.type))return [];
  const anchor=viewportAnchor(f.geometry,box);if(!anchor)return [];
  const name=String(f.properties?.name||f.properties?.area_nm||'이름 없음');
  const matches=byName.get(norm(name))||[],area=matches.length===1?matches[0]:null;
  const d=geometryDistance(point,f.geometry);
  return [{id:f.id,boundaryId:f.id,nibrId:area?.area_sno,name,lon:anchor[0],lat:anchor[1],labelLon:anchor[0],labelLat:anchor[1],geometry:f.geometry,
   selected:true,count:null,distance:Number.isFinite(d)?(d<1e-7?0:d):null,distanceStatus:'국립생물자원관 구역 경계',
   reason:area?'선택 월 자료 없음':matches.length?'동명이역 확인 필요':'조사지역명 미일치',siteSource:'국립생물자원관',color:'#7D75E8',edited:false}];
 }).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity));
}

export function applyCounts(rows,features){
 const byId=new Map(features.map(f=>[Number(f.properties.area_sno),f.properties]));
 for(const row of rows){
  if(!row.nibrId)continue;
  const p=byId.get(Number(row.nibrId)),raw=p?.cnt_tot;
  row.count=raw!==null&&raw!==undefined&&String(raw).trim()!==''&&Number.isSafeInteger(Number(raw))&&Number(raw)>=0?Number(raw):null;
  row.reason=row.count===null?'선택 월 자료 없음':'';
 }
 return rows;
}
