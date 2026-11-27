import {norm,geometryDistance} from './core.js';
export function assignBoundaryDistances(rows,features,point){
 const byName=new Map();for(const f of features){if(!['Polygon','MultiPolygon'].includes(f.geometry?.type))continue;const k=norm(f.properties?.name||f.properties?.area_nm);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(f);}
 for(const row of rows){row.distance=null;row.distanceStatus='경계 미확인';const matches=byName.get(norm(row.name))||[];let feature=matches.length===1?matches[0]:null;
  if(row.boundaryId)feature=matches.find(f=>f.id===row.boundaryId)||feature;
  if(!feature&&matches.length>1){const containing=matches.filter(f=>geometryDistance([row.lon,row.lat],f.geometry)<1e-7);if(containing.length===1)feature=containing[0];}
  if(!feature)continue;const d=geometryDistance(point,feature.geometry);if(!Number.isFinite(d))continue;row.distance=d<1e-7?0:d;row.distanceStatus='국립생물자원관 구역 경계';row.boundaryId=feature.id;
 }return rows;
}
