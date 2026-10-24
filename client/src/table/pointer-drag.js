export const DRAG_THRESHOLD = 6;
export function pastDragThreshold(start, point) {
  return Math.hypot(point.x-start.x,point.y-start.y)>=DRAG_THRESHOLD;
}
export function handInsertion(cards, x) {
  for(let index=0;index<cards.length;index++) {
    const end=cards[index+1]?.left??cards[index].right;
    if(x<(cards[index].left+end)/2)return cards[index].id;
  }
  return null;
}
