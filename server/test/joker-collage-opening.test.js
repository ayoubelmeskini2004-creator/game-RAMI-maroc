import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound,buildDeck,discardCard,drawCard,privateGame } from '../src/game.js';
import { stageGroups,stageCollage,startTurnStaging,openingStatus,recoverJoker } from '../src/descente.js';
import { extendGroup,jokerExtensions } from '../src/collage.js';
import { validateCombination } from '../src/combinations.js';
function fixture(){
 const g=createRound(['a','b']);Object.assign(g,{stock:buildDeck(),hands:{a:[],b:[]},initialDiscard:false,activePlayerId:'a',phase:'discard',mustDiscard:{a:true,b:false}});
 const take=(rank,suit='hearts')=>{const i=g.stock.findIndex(c=>c.rank===rank&&c.suit===(rank==='Joker'?null:suit));assert.ok(i>=0);return g.stock.splice(i,1)[0];};
 const group=(type,ranks,suits='hearts',face)=>{const cards=ranks.map((r,i)=>take(r,Array.isArray(suits)?suits[i]:suits));g.hands.a.push(...cards);const joker=cards.find(c=>c.rank==='Joker');return{type,cardIds:cards.map(c=>c.id),...(joker?{joker:{cardId:joker.id,...face}}:{})};};
 const core=()=>[group('suite',['8','9','10']),group('tierce',['R','R','R'],['clubs','diamonds','spades']),group('suite',['4','5','6'],'clubs')];
 const begin=()=>startTurnStaging(g,'a');const stage=groups=>stageGroups(g,'a',{revision:g.revision,groups});
 return{g,take,group,core,begin,stage};
}
test('a Joker extends a Suite or Tierce with an explicit legal face, never a second Joker',()=>{
 for(const [type,ranks,suits] of [['suite',['4','5','6'],'hearts'],['tierce',['D','D','D'],['hearts','clubs','spades']]]){
  const {g,take,group}=fixture();const p=group(type,ranks,suits);const result=validateCombination(p,g.hands.a);const base={id:'g',type,cards:result.cards},joker=take('Joker');const choices=jokerExtensions(base,joker);assert.equal(choices.length,type==='suite'?2:1);
  const expanded=extendGroup(base,[joker],choices[0].side,choices[0].joker);assert.equal(expanded.cards.length,4);assert.equal(expanded.cards.filter(c=>c.rank==='Joker').length,1);assert.ok(expanded.cards.find(c=>c.rank==='Joker').points>0);
  assert.equal(jokerExtensions(expanded,take('Joker')).length,0);assert.equal(base.cards.length,3);
 }
});
test('the first opening counts all additional Joker combinations, freezes at commit and excludes later Collage',()=>{
 const {g,take,group,core,begin,stage}=fixture();const groups=core();groups.push(group('suite',['9','10','Joker'],'diamonds',{rank:'V',suit:'diamonds'}));const end=take('2','spades'),extension=take('D','diamonds');g.hands.a.push(end,extension);g.firstOpening={playerId:'b',total:100};begin();stage(groups);
 assert.equal(openingStatus(g,'a').qualifyingNaturalPoints,91);assert.equal(openingStatus(g,'a').totalLaidPoints,101);discardCard(g,'a',{revision:g.revision,cardId:end.id});assert.equal(g.openingTotals.a,101);
 drawCard(g,'a',{revision:g.revision,source:'stock'});stageCollage(g,'a',{revision:g.revision,ownerId:'a',groupId:g.laid.a.at(-1).id,cardIds:[extension.id]});discardCard(g,'a',{revision:g.revision,cardId:g.hands.a[0].id});assert.equal(g.openingTotals.a,101);
});
test('a staged Joker can exceed the opening reference but cannot replace the 71 natural points',()=>{
 const {g,take,group,core,begin,stage}=fixture();const groups=core();groups.push(group('suite',['8','9','10'],'diamonds'));const joker=take('Joker'),end=take('2','spades');g.hands.a.push(joker,end);g.firstOpening={playerId:'b',total:108};begin();stage(groups);assert.equal(openingStatus(g,'a').valid,false);
 stageCollage(g,'a',{revision:g.revision,ownerId:'a',groupId:g.staged.at(-1).id,cardIds:[joker.id],joker:{cardId:joker.id,rank:'V',suit:'diamonds'},side:'append'});assert.equal(openingStatus(g,'a').totalLaidPoints,109);discardCard(g,'a',{revision:g.revision,cardId:end.id});assert.equal(g.openingTotals.a,109);
 const f=fixture();const short=f.group('suite',['8','9','10']);const j=f.take('Joker'),spare=f.take('2');f.g.hands.a.push(j,spare);f.begin();f.stage([short]);const before=structuredClone(f.g);assert.throws(()=>stageCollage(f.g,'a',{revision:f.g.revision,ownerId:'a',groupId:f.g.staged[0].id,cardIds:[j.id],joker:{cardId:j.id,rank:'V',suit:'hearts'}}));assert.deepEqual(f.g,before);
});
test('a Joker-inclusive first descent equal to the reference still fails the one-point escalation',()=>{
 const {g,take,group,core,begin,stage}=fixture();const groups=core();groups.push(group('suite',['9','10','Joker'],'diamonds',{rank:'V',suit:'diamonds'}));const end=take('2','spades');g.hands.a.push(end);g.firstOpening={playerId:'b',total:101};begin();stage(groups);
 assert.equal(openingStatus(g,'a').totalLaidPoints,101);assert.equal(openingStatus(g,'a').valid,false);const before=structuredClone(g);assert.throws(()=>discardCard(g,'a',{revision:g.revision,cardId:end.id}));assert.deepEqual(g,before);assert.equal(g.openingTotals.a,undefined);
});

test('a recovered Joker reused through Collage satisfies its replay obligation without changing opening totals',()=>{
 const {g,take,begin}=fixture();g.opened={a:true,b:true};g.openingTotals={a:100,b:90};g.firstOpening={playerId:'b',total:90};
 const target=['5','6','7'].map(r=>take(r,'clubs'));g.laid.a=[{id:'target',type:'suite',cards:validateCombination({type:'suite',cardIds:target.map(c=>c.id)},target).cards}];
 const source=[take('8'),take('9'),take('Joker')],joker=source[2];g.laid.b=[{id:'source',type:'suite',cards:validateCombination({type:'suite',cardIds:source.map(c=>c.id),joker:{cardId:joker.id,rank:'10',suit:'hearts'}},source).cards}];const natural=take('10'),end=take('2','spades');g.hands.a.push(natural,end);begin();
 recoverJoker(g,'a',{revision:g.revision,ownerId:'b',groupId:'source',jokerId:joker.id,cardId:natural.id});stageCollage(g,'a',{revision:g.revision,ownerId:'a',groupId:'target',cardIds:[joker.id],joker:{cardId:joker.id,rank:'8',suit:'clubs'}});assert.deepEqual(privateGame(g,'a').pendingRecoveredJokerIds,[]);discardCard(g,'a',{revision:g.revision,cardId:end.id});
 assert.equal(g.laid.a[0].cards.at(-1).id,joker.id);assert.equal(g.laid.b[0].cards.at(-1).id,natural.id);assert.equal(g.openingTotals.a,100);assert.equal(g.openingTotals.b,90);
});
