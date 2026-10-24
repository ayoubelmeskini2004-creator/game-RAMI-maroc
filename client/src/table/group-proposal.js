import { validateCombination } from '../../../server/src/combinations.js';
const ranks = ['A','2','3','4','5','6','7','8','9','10','V','D','R','A'];
// Only a proposal for convenience. The server always validates it again.
export function naturalProposal(cards) {
  if (cards.some((card) => card.rank === 'Joker')) return null;
  const stable = [...cards].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const type of ['tierce','carre']) {
    const proposal = { type, cardIds: stable.map((card)=>card.id) };
    if (validateCombination(proposal,cards).valid) return proposal;
  }
  for (let start=0; start<=14-cards.length; start++) {
    const remaining = [...stable]; const ordered=[];
    for (const rank of ranks.slice(start,start+cards.length)) {
      const index=remaining.findIndex((card)=>card.rank===rank);
      if(index<0) break;
      ordered.push(...remaining.splice(index,1));
    }
    const proposal={type:'suite',cardIds:ordered.map((card)=>card.id)};
    if(!remaining.length && validateCombination(proposal,cards).valid) return proposal;
  }
  return null;
}
export function dropPosition(event) {
  const rect=event.currentTarget.getBoundingClientRect();
  return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
}
export const GROUP_DRAG_TYPE='application/x-rami-group';
