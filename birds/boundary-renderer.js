import {polygons} from './core.js';

// Use the same projected vertices for the preview and the exported PNG.
export function drawBoundaries(ctx,map,rows,width,height,transparency=80){
 const size=map.getSize(),sx=width/size.x,sy=height/size.y;
 ctx.clearRect(0,0,width,height);
 ctx.fillStyle=`rgba(125,117,232,${1-Math.max(0,Math.min(100,transparency))/100})`;
 ctx.strokeStyle='#7D75E8';ctx.lineWidth=Math.max(2,width/1100*3);ctx.lineJoin='round';ctx.lineCap='round';
 for(const row of rows.filter(r=>r.selected))for(const poly of polygons(row.geometry)){
  ctx.beginPath();
  for(const ring of poly){
   ring.forEach(([lon,lat],i)=>{const p=map.latLngToContainerPoint([lat,lon]);if(i)ctx.lineTo(p.x*sx,p.y*sy);else ctx.moveTo(p.x*sx,p.y*sy);});
   ctx.closePath();
  }
  ctx.fill('evenodd');ctx.stroke();
 }
}

export function boundaryImage(map,rows,transparency=80){
 const size=map.getSize(),canvas=document.createElement('canvas');
 canvas.width=1600;canvas.height=Math.round(1600*size.y/size.x);
 drawBoundaries(canvas.getContext('2d'),map,rows,canvas.width,canvas.height,transparency);
 return canvas.toDataURL('image/png');
}
