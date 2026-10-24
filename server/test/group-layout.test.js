import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, privateGame } from '../src/game.js';
import { moveGroup, validPosition } from '../src/group-layout.js';
test('owners may move committed groups outside their turn, without changing cards, scores or game revision',()=>{
  const game=createRound(['a','b']);game.activePlayerId='b';game.laid.a=[{id:'g',type:'suite',cards:[{id:'public',rank:'A',suit:'hearts',points:1}]}];
  const before=structuredClone(game);moveGroup(game,'a',{groupId:'g',position:{x:.8,y:.25},revision:-1});
  assert.deepEqual(game.laid,before.laid);assert.deepEqual(game.hands,before.hands);assert.deepEqual(game.openingTotals,before.openingTotals);assert.equal(game.revision,before.revision);assert.equal(game.activePlayerId,'b');
  assert.deepEqual(privateGame(game,'b').groupPositions.g,{x:.8,y:.25});assert.equal(game.layoutRevision,1);
});
test('foreign ownership, missing/stale groups and non-finite positions are rejected without mutation',()=>{
  const game=createRound(['a','b']);game.laid.a=[{id:'g',cards:[]}];
  for(const [player,payload]of [['b',{groupId:'g',position:{x:0,y:0}}],['a',{groupId:'unknown',position:{x:0,y:0}}],['a',{groupId:'g',position:{x:Infinity,y:0}}],['a',{groupId:'g',position:{x:-.1,y:0}}],['a',{groupId:'g',position:{x:0,y:1.1}}],['a',{groupId:'g',position:{x:'0',y:0}}]]){
    const before=structuredClone(game);assert.throws(()=>moveGroup(game,player,payload),{message:'Coup invalide'});assert.deepEqual(game,before);
  }
  assert.equal(Boolean(validPosition(null)),false);
});
test('only the active owner may move their staged group and projections are detached',()=>{
  const game=createRound(['a','b']);game.activePlayerId='a';game.contextPlayerId='a';game.mustDiscard.a=true;game.staged=[{id:'staged',cards:[]}];
  moveGroup(game,'a',{groupId:'staged',position:{x:0,y:1}});
  const view=privateGame(game,'a');view.groupPositions.staged.x=1;assert.equal(game.groupPositions.staged.x,0);
  game.activePlayerId='b';game.mustDiscard.a=false;assert.throws(()=>moveGroup(game,'a',{groupId:'staged',position:{x:0,y:0}}),{message:'Coup invalide'});
});
