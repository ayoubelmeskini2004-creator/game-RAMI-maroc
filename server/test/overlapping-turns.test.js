import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, buildDeck, drawCard, discardCard, privateGame, publicGame } from '../src/game.js';
import { stageGroups, stageCollage, undoStaging } from '../src/descente.js';
import { actOnTurn, emptyTurn } from '../src/turns.js';
import { validateCombination } from '../src/combinations.js';
import { physicalCards } from '../test-support/match-scenarios.js';
function fixture(order=['a','b']) {
  const game=createRound(order);Object.assign(game,{stock:buildDeck(),hands:Object.fromEntries(order.map(id=>[id,[]])),starterId:order.at(-1),activePlayerId:'a',initialDiscard:false,phase:'draw',contextPlayerId:null,turns:{},mustDiscard:Object.fromEntries(order.map(id=>[id,false])),...emptyTurn()});
  const take=(rank,suit='hearts')=>{const index=game.stock.findIndex(c=>c.rank===rank&&c.suit===(rank==='Joker'?null:suit));assert.ok(index>=0);return game.stock.splice(index,1)[0];};
  const hand=(who,rank,suit)=>{const c=take(rank,suit);game.hands[who].push(c);return c;};
  const group=(who,ranks,suits='hearts',type='suite')=>({type,cardIds:ranks.map((rank,i)=>hand(who,rank,Array.isArray(suits)?suits[i]:suits).id)});
  const fill=()=>{for(const id of order)while(game.hands[id].length<14)game.hands[id].push(game.stock.pop());};
  const draw=(who,source='stock',extra={})=>drawCard(game,who,{source,revision:game.revision,...extra});
  const act=(who,operation,payload)=>actOnTurn(game,who,{...payload,revision:game.revision},operation);
  const discard=(who,id)=>discardCard(game,who,{cardId:id,revision:game.revision});
  const conserve=()=>{const cards=physicalCards(game);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);};
  return {game,take,hand,group,fill,draw,act,discard,conserve};
}
const invalid=(game,fn)=>{const before=structuredClone(game);assert.throws(fn,{message:'Coup invalide'});assert.deepEqual(game,before);};
for(const count of[2,3,4])test(`${count} players may all draw before any normal discard, with clockwise rights and individual obligations`,()=>{
  const f=fixture(['a','b','c','d'].slice(0,count));f.fill();
  for(const id of f.game.order){f.draw(id);assert.equal(f.game.hands[id].length,15);assert.equal(f.game.mustDiscard[id],true);f.conserve();}
  assert.equal(f.game.activePlayerId,'a');invalid(f.game,()=>f.draw('a'));
  f.discard('b',f.game.hands.b[0].id);assert.equal(f.game.mustDiscard.a,true);assert.equal(f.game.activePlayerId,'a');
  invalid(f.game,()=>f.draw('b'));f.discard('a',f.game.hands.a[0].id);f.draw('a');
  assert.equal(f.game.activePlayerId,'b');f.draw('b');f.conserve();
});
test('independent staged groups, undo and privacy survive other players drawing and acting',()=>{
  const f=fixture();const a=f.group('a',['4','5','6']),b=f.group('b',['7','8','9'],'clubs');f.fill();f.draw('a');f.draw('b');
  f.act('a',stageGroups,{groups:[a]});f.act('b',stageGroups,{groups:[b]});
  const view=publicGame(f.game);assert.deepEqual(new Set(view.staged.map(g=>g.ownerId)),new Set(['a','b']));
  const bBefore=privateGame(f.game,'b');f.act('a',undoStaging,{all:true});
  assert.deepEqual(privateGame(f.game,'b').hand,bBefore.hand);assert.equal(publicGame(f.game).staged.length,1);assert.equal(privateGame(f.game,'b').canUndo,true);
  for(const card of f.game.hands.a)assert.equal(JSON.stringify(privateGame(f.game,'b')).includes(card.id),false);f.conserve();
});
test('a second actor cannot modify a group reserved by provisional Collage; undo releases it',()=>{
  const f=fixture();const baseCards=['8','9','10'].map(rank=>f.take(rank));const base={id:'base',type:'suite',cards:validateCombination({type:'suite',cardIds:baseCards.map(c=>c.id)},baseCards).cards};f.game.laid.a.push(base);
  const seven=f.hand('a','7'),jack=f.hand('b','V');f.fill();f.game.opened={a:true,b:true};f.game.openingTotals={a:80,b:90};f.draw('a');f.draw('b');
  f.act('a',stageCollage,{ownerId:'a',groupId:'base',cardIds:[seven.id]});
  invalid(f.game,()=>f.act('b',stageCollage,{ownerId:'a',groupId:'base',cardIds:[jack.id]}));
  assert.ok(privateGame(f.game,'b').blockedGroupIds.includes('base'));
  f.act('a',undoStaging,{all:true});f.act('b',stageCollage,{ownerId:'a',groupId:'base',cardIds:[jack.id]});f.conserve();
});
test('direct discard-to-group upgrades a Tierce to Carré for every natural rank without changing its base',()=>{
  for(const rank of['A','2','3','4','5','6','7','8','9','10','V','D','R']){
    const f=fixture();const cards=['hearts','spades','diamonds'].map(suit=>f.take(rank,suit));
    f.game.laid.a.push({id:'set',type:'tierce',cards:validateCombination({type:'tierce',cardIds:cards.map(c=>c.id)},cards).cards});
    const top=f.take(rank,'clubs');f.game.discard.push(top);f.fill();f.game.opened.a=true;f.game.openingTotals.a=71;
    const base=structuredClone(f.game.laid.a[0]);f.draw('a','discard',{cardId:top.id,target:{ownerId:'a',groupId:'set'}});
    assert.deepEqual(f.game.laid.a[0],base);const overlay=privateGame(f.game,'a').collages[0];assert.equal(overlay.group.type,'carre');assert.equal(overlay.group.cards.length,4);
    f.discard('a',f.game.hands.a[0].id);assert.equal(f.game.laid.a[0].type,'carre');assert.deepEqual(f.game.laid.a[0].cards.slice(0,3),base.cards);f.conserve();
  }
});
test('invalid direct collage and stale top-card ID roll back both pickup and target modification',()=>{
  const f=fixture();const cards=['hearts','spades','diamonds'].map(suit=>f.take('9',suit));f.game.laid.a.push({id:'set',type:'tierce',cards:validateCombination({type:'tierce',cardIds:cards.map(c=>c.id)},cards).cards});f.game.discard.push(f.take('9','hearts'));f.fill();f.game.opened.a=true;f.game.openingTotals.a=71;
  invalid(f.game,()=>f.draw('a','discard',{cardId:'stale'}));invalid(f.game,()=>f.draw('a','discard',{target:{ownerId:'a',groupId:'set'}}));f.conserve();
});
test('a Joker Tierce keeps its explicit substitution when a natural fourth suit is added',()=>{
  const f=fixture();const cards=[f.take('Joker'),f.take('9','spades'),f.take('9','diamonds')];
  const result=validateCombination({type:'tierce',cardIds:cards.map(c=>c.id),joker:{cardId:cards[0].id,rank:'9',suit:'hearts'}},cards);f.game.laid.a.push({id:'set',type:'tierce',cards:result.cards});
  const top=f.take('9','clubs');f.game.discard.push(top);f.fill();f.game.opened.a=true;f.game.openingTotals.a=71;f.draw('a','discard',{cardId:top.id,target:{ownerId:'a',groupId:'set'}});
  assert.deepEqual(publicGame(f.game).collages[0].group.cards[0].substitution,{rank:'9',suit:'hearts'});f.conserve();
});
test('a winning discard restores other pending groups before penalties and freezes both action streams',()=>{
  const f=fixture();const a=f.group('a',['4','5','6']),b=f.group('b',['7','8','9'],'clubs');f.hand('b','2','spades');f.game.opened={a:true,b:true};f.game.openingTotals={a:80,b:90};f.draw('a');f.draw('b');
  const end=f.game.hands.a.at(-1).id;f.act('a',stageGroups,{groups:[a]});f.act('b',stageGroups,{groups:[b]});f.discard('a',end);
  assert.equal(f.game.roundResult.winnerId,'a');assert.equal(f.game.hands.b.length,5);assert.equal(f.game.roundResult.penalties.b,50);assert.equal(publicGame(f.game).staged.length,0);
  invalid(f.game,()=>f.draw('b'));invalid(f.game,()=>f.discard('b',f.game.hands.b[0].id));f.conserve();
});
test('2v2 overlapping preparations preserve individual opening, partner exception and teammate Tierce upgrade',()=>{
  const f=fixture(['a','b','c','d']);f.game.mode='teams';f.game.teams={a:'A',b:'B',c:'A',d:'B'};
  const core=[f.group('a',['8','9','10']),f.group('a',['R','R','R'],['clubs','diamonds','spades'],'tierce'),f.group('a',['4','5','6'],'clubs')];
  const one=f.hand('c','A','spades'),two=f.hand('c','2','spades'),joker=f.hand('c','Joker'),king=f.hand('c','R','hearts');
  const suite={type:'suite',cardIds:[one.id,two.id,joker.id],joker:{cardId:joker.id,rank:'3',suit:'spades'}};f.fill();
  for(const id of f.game.order)f.draw(id);
  f.act('a',stageGroups,{groups:core});invalid(f.game,()=>f.act('c',stageGroups,{groups:[suite]}));
  f.discard('a',f.game.hands.a[0].id);assert.equal(f.game.opened.c,false);assert.equal(privateGame(f.game,'c').teamOpeningEligible,true);
  f.act('c',stageGroups,{groups:[suite]});const tierce=f.game.laid.a.find(group=>group.type==='tierce');
  f.act('c',stageCollage,{ownerId:'a',groupId:tierce.id,cardIds:[king.id]});
  f.discard('c',f.game.hands.c[0].id);assert.equal(f.game.openingInheritedFrom.c,'a');assert.equal(f.game.openingTotals.c,6);assert.equal(f.game.laid.a.find(group=>group.id===tierce.id).type,'carre');
  assert.equal(f.game.mustDiscard.b,true);assert.equal(f.game.mustDiscard.d,true);f.conserve();
});
test('concurrent ordinary openings recheck the first committed total without erasing the other preparation',()=>{
  const f=fixture();
  const a=[f.group('a',['8','9','10']),f.group('a',['R','R','R'],['clubs','diamonds','spades'],'tierce'),f.group('a',['4','5','6'],'clubs'),f.group('a',['V','D','R'])];
  const b=[f.group('b',['8','9','10'],'diamonds'),f.group('b',['R','R','R'],['hearts','clubs','diamonds'],'tierce'),f.group('b',['4','5','6'],'spades')];
  f.fill();f.draw('a');f.draw('b');f.act('a',stageGroups,{groups:a});f.act('b',stageGroups,{groups:b});
  assert.equal(privateGame(f.game,'b').openingStatus.valid,true);
  f.discard('a',f.game.hands.a[0].id);assert.equal(f.game.firstOpening.total,102);
  assert.equal(privateGame(f.game,'b').openingStatus.minimumTotal,103);
  invalid(f.game,()=>f.discard('b',f.game.hands.b[0].id));assert.equal(publicGame(f.game).staged.length,3);
  f.act('b',undoStaging,{all:true});assert.equal(f.game.hands.b.length,15);f.conserve();
});
test('Descente totale during another pending preparation doubles penalties after restoring its cards',()=>{
  const f=fixture();
  const a=[f.group('a',['8','9','10']),f.group('a',['R','R','R'],['clubs','diamonds','spades'],'tierce'),f.group('a',['4','5','6'],'clubs'),f.group('a',['A','2','3','4','5'],'spades')];
  const b=f.group('b',['7','8','9'],'clubs');f.hand('b','2','diamonds');f.game.opened.b=true;f.game.openingTotals.b=71;f.game.firstOpening={playerId:'b',total:71};
  f.draw('a');f.draw('b');const final=f.game.hands.a.at(-1).id;
  f.act('a',stageGroups,{groups:a});f.act('b',stageGroups,{groups:[b]});f.discard('a',final);
  assert.equal(f.game.roundResult.totalDescent,true);assert.equal(f.game.roundResult.penalties.a,0);assert.equal(f.game.roundResult.penalties.b,100);assert.equal(f.game.hands.b.length,5);f.conserve();
});
