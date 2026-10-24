import test from 'node:test';
import assert from 'node:assert/strict';
import { validDiscardDrag } from '../src/table/hand-order.js';
test('discard drag requires the current visible top, matching deal/revision, owner and draw permission',()=>{
  const game={roundId:'r',revision:8,canDraw:true,discardTop:{id:'top'}};const data={roundId:'r',revision:8,playerId:'a',cardId:'top'};
  assert.equal(validDiscardDrag(data,game,'a'),true);
  for(const patch of[{cardId:'buried'},{revision:7},{roundId:'old'},{playerId:'b'}])assert.equal(validDiscardDrag({...data,...patch},game,'a'),false);
  assert.equal(validDiscardDrag(data,{...game,canDraw:false},'a'),false);
});
