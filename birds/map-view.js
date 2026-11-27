const R=6378137,EARTH=6371008.8,rad=x=>x*Math.PI/180,deg=x=>x*180/Math.PI;
export const project=([lon,lat])=>[R*rad(lon),R*Math.log(Math.tan(Math.PI/4+rad(lat)/2))];
export const unproject=([x,y])=>[deg(x/R),deg(2*Math.atan(Math.exp(y/R))-Math.PI/2)];
export function destination([lon,lat],km,bearing){const d=km*1000/EARTH,b=rad(bearing),p=rad(lat),l=rad(lon);const p2=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(b));const l2=l+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(p2));return [deg(l2),deg(p2)];}
export function radiusView({lat,lon,radius},width,height){
 if(![lat,lon,radius,width,height].every(Number.isFinite)||Math.abs(lat)>80||Math.abs(lon)>180||radius<=0||width<=0||height<=0)throw Error('지도 좌표·반경·크기를 확인해 주세요.');
 const c=project([lon,lat]),aspect=width/height,points=Array.from({length:360},(_,i)=>project(destination([lon,lat],radius,i)));
 const dx=Math.max(...points.map(p=>Math.abs(p[0]-c[0]))),dy=Math.max(...points.map(p=>Math.abs(p[1]-c[1])));
 const halfH=Math.max(dy,dx/aspect)*1.045,halfW=halfH*aspect,sw=unproject([c[0]-halfW,c[1]-halfH]),ne=unproject([c[0]+halfW,c[1]+halfH]);
 const west=unproject([c[0]-halfW,c[1]]),east=unproject([c[0]+halfW,c[1]]),north=unproject([c[0],c[1]+halfH]),south=unproject([c[0],c[1]-halfH]);
 return {bounds:[[sw[1],sw[0]],[ne[1],ne[0]]],center:[lat,lon],span: {west,east,north,south},projectedWidth:halfW*2,projectedHeight:halfH*2};
}
export function inputLocation(lat,lon,radius){const q={lat:Number(lat),lon:Number(lon),radius:Number(radius)};if([lat,lon,radius].some(v=>String(v).trim()==='')||![q.lat,q.lon,q.radius].every(Number.isFinite)||Math.abs(q.lat)>80||Math.abs(q.lon)>180||q.radius<=0)return null;return q;}
