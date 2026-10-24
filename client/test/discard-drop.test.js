import test from 'node:test';
import assert from 'node:assert/strict';
import { discardDrop } from '../src/table/discard-drop.js';
import { validHandDrag } from '../src/table/hand-order.js';
const game={roundId:'round',revision:8,hand:[{id:'taken'},{id:'other'},{id:'recovered'}],canDiscard:true,canCancelDiscard:true,cancelPickupCardId:'taken',recoveredJokerIds:['recovered']};
const drag=id=>({playerId:'me',roundId:'round',revision:8,cardId:id,cardIds:[id]});
test('exact physical pickup returns while another card is a normal discard',()=>{
 assert.deepEqual(discardDrop(drag('taken'),game,'me'),{event:'game:cancel-discard',cardId:'taken'});
 assert.deepEqual(discardDrop(drag('other'),game,'me'),{event:'game:discard',cardId:'other'});
 assert.equal(discardDrop(drag('taken'),{...game,canCancelDiscard:false,cancelPickupReason:'La Défausse a changé.'},'me').error,'La Défausse a changé.');
 assert.equal(discardDrop(drag('other'),{...game,cancelPickupCardId:null},'me').event,'game:discard');
});
test('discard destinations reject multiple, foreign, removed, wrong round and recovered Joker cards',()=>{
 for(const data of [{...drag('other'),cardIds:['other','taken']},{...drag('other'),playerId:'them'},{...drag('other'),roundId:'old'},drag('absent'),drag('recovered')])assert.ok(discardDrop(data,game,'me').error);
 assert.ok(discardDrop(drag('other'),{...game,canDiscard:false},'me').error);
});
test('private ordering survives remote revisions but never another player, distribution or missing card',()=>{
 const data={...drag('other'),revision:2};
 assert.equal(validHandDrag(data,'other',game,'me'),false);
 assert.equal(validHandDrag(data,'other',game,'me',{privateOrder:true}),true);
 for(const changed of [{playerId:'them'},{roundId:'old'},{cardId:'absent',cardIds:['absent']},{cardIds:['other','absent']}])assert.equal(validHandDrag({...data,...changed},'other',game,'me',{privateOrder:true}),false);
});
test('gameplay drags tolerate independent remote changes only with the unchanged personal version',()=>{
 const state={...game,turnRevision:3},data={...drag('other'),revision:4,turnRevision:3};
 assert.equal(validHandDrag(data,'other',state,'me'),true);
 for(const changed of [{turnRevision:2},{turnRevision:undefined},{revision:9},{roundId:'old'},{cardIds:['absent','other']}])assert.equal(validHandDrag({...data,...changed},'other',state,'me'),false);
});
