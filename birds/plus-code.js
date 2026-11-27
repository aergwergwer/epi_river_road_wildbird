// Open Location Code conversion uses Google's bundled Apache-2.0 implementation.
export function parsePlusCode(input,olc=globalThis.OpenLocationCode){
 if(!olc)throw Error('플러스 코드 해석기를 불러오지 못했습니다. 새로고침해 주세요.');
 const text=String(input||'').normalize('NFKC').trim();
 if(!text||text.length>300)throw Error('긴 플러스 코드 또는 짧은 플러스 코드를 입력해 주세요.');
 const parts=text.split(/[\s,]+/),codes=parts.filter(part=>part.includes('+'));
 if(codes.length!==1||!olc.isValid(codes[0]))throw Error('플러스 코드 형식이 올바르지 않습니다. + 기호와 코드 문자를 확인해 주세요.');
 const code=codes[0].toUpperCase(),locality=parts.filter(part=>part!==codes[0]).join(' ');
 return {code,locality,short:olc.isShort(code)};
}
export function decodePlusCode(input,reference=null,olc=globalThis.OpenLocationCode){
 const parsed=parsePlusCode(input,olc);let fullCode=parsed.code;
 if(parsed.short){
  if(!reference||[reference.lat,reference.lon].some(value=>value==null||String(value).trim()==='')||!Number.isFinite(Number(reference.lat))||!Number.isFinite(Number(reference.lon))||Math.abs(Number(reference.lat))>90||Math.abs(Number(reference.lon))>180)throw Error('짧은 플러스 코드는 가까운 기준 지역·장소를 선택하거나 기준 위경도를 입력해야 합니다.');
  fullCode=olc.recoverNearest(parsed.code,Number(reference.lat),Number(reference.lon));
 }
 if(!olc.isFull(fullCode))throw Error('위치를 확정할 수 있는 플러스 코드가 아닙니다.');
 const area=olc.decode(fullCode);
 return {lat:area.latitudeCenter,lon:area.longitudeCenter,fullCode,short:parsed.short,locality:parsed.locality,input:String(input).trim(),bounds:{south:area.latitudeLo,west:area.longitudeLo,north:area.latitudeHi,east:area.longitudeHi}};
}
