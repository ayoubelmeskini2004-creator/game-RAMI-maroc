const clamp=(value,max)=>Math.max(0,Math.min(max,value));
export function freePosition(request,size,bounds,occupied,gap=6){
  const maxX=Math.max(0,bounds.width-size.width),maxY=Math.max(0,bounds.height-size.height);
  if(size.width>bounds.width||size.height>bounds.height)return null;
  const x=request.x*maxX,y=request.y*maxY;
  const xs=[x,0,maxX,...occupied.flatMap(rect=>[rect.x-size.width-gap,rect.x+rect.width+gap])].map(value=>clamp(value,maxX));
  const ys=[y,0,maxY,...occupied.flatMap(rect=>[rect.y-size.height-gap,rect.y+rect.height+gap])].map(value=>clamp(value,maxY));
  const candidates=xs.flatMap(left=>ys.map(top=>({left,top,distance:(left-x)**2+(top-y)**2})));
  candidates.sort((a,b)=>a.distance-b.distance||a.top-b.top||a.left-b.left);
  const result=candidates.find(p=>occupied.every(rect=>p.left+size.width+gap<=rect.x||rect.x+rect.width+gap<=p.left||p.top+size.height+gap<=rect.y||rect.y+rect.height+gap<=p.top));
  return result?{x:maxX?result.left/maxX:0,y:maxY?result.top/maxY:0}:null;
}
