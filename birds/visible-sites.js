import {norm,polygons,geometryDistance} from './core.js';
const inside=([x,y],[w,s,e,n])=>x>=w&&x<=e&&y>=s&&y<=n;
function clip(a,b,box){let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1];for(const [p,q]of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dy,a[1]-box[1]],[dy,box[3]-a[1]]]){if(p===0){if(q<0)return null;}else{const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;}}return [a[0]+dx*(lo+hi)/2,a[1]+dy*(lo+hi)/2];}
export function viewportAnchor(geometry,box){
 for(const poly of polygons(geometry))for(const ring of poly)for(let i=1;i<ring.length;i++){const p=clip(ring[i-1],ring[i],box);if(p)return p;}
 const center=[(box[0]+box[2])/2,(box[1]+box[3])/2];return geometryDistance(center,geometry)===0?center:null;
}
export function visibleSites(candidates,features,box){
 const byName=new Map(),anchors=new Map();for(const f of features){if(!['Polygon','MultiPolygon'].includes(f.geometry?.type))continue;const key=norm(f.properties?.name||f.properties?.area_nm);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(f);const a=viewportAnchor(f.geometry,box);if(a)anchors.set(f,a);}
 const result=[],used=new Set(),ids=new Set();
 for(const row of candidates){const matches=byName.get(norm(row.name))||[];let f=matches.length===1?matches[0]:matches.find(f=>geometryDistance([row.lon,row.lat],f.geometry)<1e-7);const a=f?anchors.get(f):null;if(f&&!a)continue;if(!f&&!inside([row.lon,row.lat],box))continue;
  const id=f?.id||row.id;if(ids.has(id))continue;ids.add(id);if(f)used.add(f);
  const label=inside([row.lon,row.lat],box)?[row.lon,row.lat]:a;result.push({...row,boundaryId:f?.id,labelLon:label[0],labelLat:label[1],siteSource:'국립생물자원관'});
 }
 for(const [f,a]of anchors)if(!used.has(f)){const name=f.properties?.name||f.properties?.area_nm;result.push({id:'boundary-'+f.id,boundaryId:f.id,name,lon:a[0],lat:a[1],labelLon:a[0],labelLat:a[1],selected:true,count:null,distance:null,reason:'연결 자료 없음',edited:false,color:'#2A8270',siteSource:'국립생물자원관 경계 보완'});}
 return result;
}
