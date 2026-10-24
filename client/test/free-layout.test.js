import test from 'node:test';
import assert from 'node:assert/strict';
import { freePosition } from '../src/table/free-layout.js';
import { suitShapes } from '../src/table/suit-shapes.js';
test('free placement retains a clear requested position and moves only the colliding drop',()=>{
 const bounds={width:620,height:240},size={width:110,height:65};const desired={x:.5,y:.5};
 assert.deepEqual(freePosition(desired,size,bounds,[]),desired);
 const occupied=[{x:250,y:80,width:120,height:70}];const before=structuredClone(occupied);
 const position=freePosition(desired,size,bounds,occupied);assert.notDeepEqual(position,desired);assert.deepEqual(occupied,before);
 const rect={x:position.x*(620-110),y:position.y*(240-65)};
 assert.ok(rect.x+110+6<=250||rect.x>=370+6||rect.y+65+6<=80||rect.y>=150+6);
 assert.equal(freePosition(desired,size,{width:110,height:65},[{x:0,y:0,width:110,height:65}]),null);
});
test('four distinct classic SVG suit silhouettes are defined without font or decorative glyph substitution',()=>{
 assert.deepEqual(Object.keys(suitShapes).sort(),['clubs','diamonds','hearts','spades']);
 assert.equal(new Set(Object.values(suitShapes)).size,4);
 for(const path of Object.values(suitShapes))assert.match(path,/^M[0-9 ,CLHVZ-]+$/i);
});
