import test from 'node:test';
import assert from 'node:assert/strict';
import { meldRetrieval } from '../src/table/meld-drag.js';
import { GROUP_DRAG_TYPE } from '../src/table/group-proposal.js';
const group={id:'g',ownerId:'me',cards:[{id:'one'},{id:'two'},{id:'three'}]};
const game={canStage:true,roundId:'r',revision:5,turnRevision:2,staged:[group],laid:{me:[]},collages:[],recoveries:[],blockedGroupIds:[]};
const selection={ownerId:'me',groupId:'g',cardIds:['one','two']};
const data={playerId:'me',roundId:'r',revision:5,turnRevision:2,selections:[selection]};
test('mouse retrieval accepts multiple staged cards or a whole-group handle and independent remote revisions',()=>{
 assert.deepEqual(meldRetrieval(data,game,'me'),[selection]);
 assert.deepEqual(meldRetrieval({...data,...selection},game,'me',GROUP_DRAG_TYPE),[selection]);
 assert.deepEqual(meldRetrieval({...data,revision:3},game,'me'),[selection]);
});
test('foreign, duplicate, stale, committed and recovered source cards cannot be dragged into a private hand',()=>{
 for(const change of [{playerId:'them'},{roundId:'old'},{turnRevision:1,revision:4},{selections:[{...selection,cardIds:['absent']}]},{selections:[{...selection,cardIds:['one','one']}]},{selections:[selection,selection]}])assert.equal(meldRetrieval({...data,...change},game,'me'),null);
 for(const change of [{canStage:false},{staged:[],laid:{me:[group]}},{recoveries:[{ownerId:'me',groupId:'g'}]},{blockedGroupIds:['g']}])assert.equal(meldRetrieval(data,{...game,...change},'me'),null);
});
