import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, createRound, drawCard, discardCard, publicGame, privateGame } from '../src/game.js';
import { stageGroups, undoStaging, retrieveStaged, cancelDiscardPickup, startTurnStaging, openingStatus, openingMinimumTotal } from '../src/descente.js';

function fixture() {
  const game = createRound(['a', 'b', 'c']);
  game.stock = buildDeck();
  game.hands = { a: [], b: [], c: [] };
  game.activePlayerId = 'a';
  game.phase = 'discard';
  game.initialDiscard = false;
  function take(rank, suit = 'hearts') {
    const i = game.stock.findIndex((card) => card.rank === rank && card.suit === (rank === 'Joker' ? null : suit));
    assert.ok(i >= 0, `Available face ${rank} ${suit}`);
    return game.stock.splice(i, 1)[0];
  }
  function group(player, type, ranks, suits = 'hearts', jokerFace) {
    const cards = ranks.map((rank, i) => take(rank, Array.isArray(suits) ? suits[i] : suits));
    game.hands[player].push(...cards);
    const joker = cards.find((c) => c.rank === 'Joker');
    return { type, cardIds: cards.map((c) => c.id), ...(joker ? { joker: { cardId: joker.id, ...jokerFace } } : {}) };
  }
  function core(player = 'a') {
    return [group(player, 'suite', ['8', '9', '10']), group(player, 'tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']), group(player, 'suite', ['4', '5', '6'], 'clubs')];
  }
  function extra(player = 'a') { const c = take('2', 'diamonds'); game.hands[player].push(c); return c; }
  function begin(player = 'a') { game.activePlayerId = player; game.phase = 'discard'; startTurnStaging(game, player); }
  const stage = (groups, player = game.activePlayerId) => stageGroups(game, player, { revision: game.revision, groups });
  const discard = (card, player = game.activePlayerId) => discardCard(game, player, { revision: game.revision, cardId: card.id });
  return { game, take, group, core, extra, begin, stage, discard };
}
function invalid(game, operation) {
  const before = structuredClone(game);
  assert.throws(operation, { message: 'Coup invalide' });
  assert.deepEqual(game, before);
}
function conserve(game) {
  const cards = [...game.stock, ...game.discard, ...Object.values(game.hands).flat(), ...Object.values(game.laid).flat().flatMap((g) => g.cards), ...game.staged.flatMap((g) => g.cards)];
  assert.equal(cards.length, 108);
  assert.equal(new Set(cards.map((c) => c.id)).size, 108);
}

test('natural opening can be staged incrementally; only a valid discard commits the entire opening', () => {
  const { game, core, extra, begin, stage, discard } = fixture();
  const groups = core(); const end = extra(); begin();
  stage([groups[0]]);
  assert.equal(openingStatus(game, 'a').qualifyingNaturalPoints, 27);
  assert.equal(game.opened.a, false);
  invalid(game, () => discard(end));
  stage([groups[1]]);
  assert.equal(openingStatus(game, 'a').qualifyingNaturalPoints, 57);
  invalid(game, () => discard(end));
  stage([groups[2]]);
  assert.equal(openingStatus(game, 'a').valid, true);
  assert.equal(game.firstOpening, null);
  assert.equal(game.laid.a.length, 0);
  conserve(game);
  discard(end);
  assert.equal(game.opened.a, true);
  assert.deepEqual(game.firstOpening, { playerId: 'a', total: 72 });
  assert.equal(game.openingTotals.a, 72);
  assert.equal(game.laid.a.length, 3);
  assert.equal(game.staged.length, 0);
  assert.equal(game.phase, 'round-ended');
  assert.equal(game.roundResult.winnerId, 'a');
  assert.equal(game.turnUndo.length, 0);
  conserve(game);
});

test('Jokers require a qualifying 71 natural opening; final first-opener total includes every staged group', () => {
  const { game, core, group, extra, begin, stage, discard } = fixture();
  const groups = core();
  const withJoker = group('a', 'suite', ['V', 'Joker', 'R'], 'hearts', { rank: 'D', suit: 'hearts' });
  const end = extra(); begin();
  invalid(game, () => stage([withJoker]));
  stage(groups);
  stage([withJoker]);
  assert.equal(openingStatus(game, 'a').qualifyingNaturalPoints, 92);
  assert.equal(openingStatus(game, 'a').totalLaidPoints, 102);
  discard(end);
  assert.equal(game.firstOpening.total, 102);
  assert.equal(openingMinimumTotal(game), 103);
  conserve(game);
});

test('later openers compare total to the first opener, never to a higher later opening', () => {
  const { game, core, group, extra, begin, stage, discard } = fixture();
  const a = core(); const aEnd = extra('a');
  const b = [group('b', 'suite', ['9', '10', 'V', 'D', 'R'], 'diamonds'), group('b', 'tierce', ['R', 'R', 'R'], ['hearts', 'clubs', 'spades'])];
  const bEnd = extra('b');
  const c = [group('c', 'suite', ['8', '9', '10', 'V'], 'spades'), group('c', 'tierce', ['8', '8', '8'], ['hearts', 'clubs', 'diamonds']), group('c', 'suite', ['3', '4', '5'], 'hearts')];
  const cEnd = game.stock.splice(game.stock.findIndex((card) => card.rank === '2' && card.suit === 'clubs'), 1)[0]; game.hands.c.push(cEnd);
  begin('a'); stage(a); discard(aEnd);
  assert.equal(game.firstOpening.total, 72);
  begin('b'); stage(b);
  assert.equal(openingStatus(game, 'b').totalLaidPoints, 79);
  discard(bEnd);
  assert.equal(game.firstOpening.total, 72);
  assert.equal(game.openingTotals.b, 79);
  begin('c'); stage(c);
  assert.equal(openingStatus(game, 'c').totalLaidPoints, 73);
  assert.equal(openingStatus(game, 'c').valid, true);
  discard(cEnd);
  assert.equal(game.openingTotals.c, 73);
  assert.equal(game.firstOpening.total, 72);
  conserve(game);
});

test('first reference is the final staged total after undo, while later escalation compares laid rather than natural points', () => {
  for (const later of [false, true]) {
    const { game, core, group, extra, begin, stage, discard } = fixture();
    const groups = core();
    const joker = group('a', 'suite', ['V', 'Joker', 'R'], 'hearts', { rank: 'D', suit: 'hearts' });
    const end = extra(); begin();
    if (later) game.firstOpening = { playerId: 'b', total: 100 };
    stage(groups); stage([joker]);
    if (later) {
      assert.equal(openingStatus(game, 'a').qualifyingNaturalPoints, 92);
      assert.equal(openingStatus(game, 'a').totalLaidPoints, 102);
      assert.equal(openingStatus(game, 'a').valid, true);
      discard(end);
      assert.equal(game.firstOpening.total, 100);
      assert.equal(game.openingTotals.a, 102);
    } else {
      undoStaging(game, 'a', { revision: game.revision, all: false });
      discard(end);
      assert.equal(game.firstOpening.total, 72);
      assert.equal(game.openingTotals.a, 72);
    }
    conserve(game);
  }
});

test('later opening equal to the first total fails atomically, even with 71 qualifying naturals', () => {
  const { game, core, extra, begin, stage, discard } = fixture();
  const groups = core(); const end = extra(); begin();
  game.firstOpening = { playerId: 'b', total: 72 };
  stage(groups);
  assert.equal(openingStatus(game, 'a').minimumTotal, 73);
  assert.equal(openingStatus(game, 'a').qualifyingNaturalPoints, 72);
  assert.equal(openingStatus(game, 'a').valid, false);
  invalid(game, () => discard(end));
  assert.equal(game.activePlayerId, 'a');
  assert.equal(game.phase, 'discard');
  assert.equal(game.staged.length, 3);
  assert.equal(game.opened.a, false);
});

test('already-opened player adds a small group on a later turn without opening requirements', () => {
  const { game, group, extra, begin, stage, discard } = fixture();
  const small = group('a', 'suite', ['A', '2', '3']); const end = extra();
  game.opened.a = true; game.firstOpening = { playerId: 'a', total: 102 };
  begin(); stage([small]); discard(end);
  assert.equal(game.laid.a.length, 1);
  assert.equal(game.firstOpening.total, 102);
  conserve(game);
});

test('first mandatory discard forbids staging, undo, retrieval, and discard pickup', () => {
  const { game, core, extra, begin, stage } = fixture();
  const groups = core(); const end = extra(); begin(); game.initialDiscard = true; game.starterId='a';
  invalid(game, () => stage(groups));
  invalid(game, () => undoStaging(game, 'a', { revision: game.revision, all: true }));
  invalid(game, () => retrieveStaged(game, 'a', { revision: game.revision, groupId: 'anything' }));
  invalid(game, () => drawCard(game, 'a', { revision: game.revision, source: 'discard', openingGroups: groups }));
  discardCard(game, 'a', { revision: game.revision, cardId: end.id });
  assert.equal(game.firstOpening, null);
  assert.equal(game.opened.a, false);
});

test('undo latest and undo all restore exact hands and staged state without touching the draw', () => {
  const { game, core, extra, begin, stage } = fixture();
  const groups = core(); extra(); begin(); const baseline = structuredClone(game.hands.a);
  stage([groups[0]]); const first = structuredClone({ hand: game.hands.a, staged: game.staged });
  stage([groups[1]]);
  undoStaging(game, 'a', { revision: game.revision, all: false });
  assert.deepEqual(game.hands.a, first.hand); assert.deepEqual(game.staged, first.staged);
  stage(groups.slice(1));
  undoStaging(game, 'a', { revision: game.revision, all: true });
  assert.deepEqual(game.hands.a, baseline);
  assert.equal(game.staged.length, 0);
  assert.equal(game.phase, 'discard');
  assert.equal(game.turnUndo.length, 0);
  invalid(game, () => undoStaging(game, 'a', { revision: game.revision, all: false }));
  conserve(game);
});

test('whole-group retrieval is reversible; endpoint retrieval revalidates, gaps and short groups are rejected', () => {
  const { game, group, extra, begin, stage } = fixture();
  const run = group('a', 'suite', ['7', '8', '9', '10']); extra(); begin(); stage([run]);
  const id = game.staged[0].id;
  invalid(game, () => retrieveStaged(game, 'a', { revision: game.revision, groupId: id, cardId: run.cardIds[1] }));
  retrieveStaged(game, 'a', { revision: game.revision, groupId: id, cardId: run.cardIds[0] });
  assert.equal(game.staged[0].cards.length, 3);
  assert.equal(game.hands.a.some((card) => card.id === run.cardIds[0]), true);
  invalid(game, () => retrieveStaged(game, 'a', { revision: game.revision, groupId: id, cardId: run.cardIds[1] }));
  retrieveStaged(game, 'a', { revision: game.revision, groupId: id });
  assert.equal(game.staged.length, 0);
  undoStaging(game, 'a', { revision: game.revision, all: false });
  assert.equal(game.staged[0].cards.length, 3);
  conserve(game);
});

test('retrieving one card from a new Carré creates a valid Tierce; committed groups are immutable', () => {
  const { game, group, extra, begin, stage, discard } = fixture();
  game.opened.a = true;
  const carre = group('a', 'carre', ['9', '9', '9', '9'], ['hearts', 'clubs', 'diamonds', 'spades']); const end = extra(); begin(); stage([carre]);
  const id = game.staged[0].id;
  retrieveStaged(game, 'a', { revision: game.revision, groupId: id, cardId: carre.cardIds[0] });
  assert.equal(game.staged[0].type, 'tierce');
  discard(end);
  begin();
  invalid(game, () => retrieveStaged(game, 'a', { revision: game.revision, groupId: id }));
  assert.equal(game.laid.a[0].cards.length, 3);
  conserve(game);
});

test('retrieval may invalidate aggregate opening, but discard cannot commit it; undo restores eligibility', () => {
  const { game, core, extra, begin, stage, discard } = fixture();
  const groups = core(); const end = extra(); begin(); stage(groups);
  retrieveStaged(game, 'a', { revision: game.revision, groupId: game.staged[1].id });
  assert.equal(openingStatus(game, 'a').valid, false);
  invalid(game, () => discard(end));
  undoStaging(game, 'a', { revision: game.revision, all: false });
  discard(end);
  assert.equal(game.opened.a, true);
});

test('unopened discard pickup stays private in hand until a valid opening and own final discard',()=>{
 const {game,core,extra,begin,take}=fixture();const groups=core();const end=extra();begin();game.phase='draw';game.mustDiscard.a=false;
 const top=take('3','spades');const cards=[take('A','spades'),take('2','spades')];game.hands.a.push(...cards);groups.push({type:'suite',cardIds:[...cards.map(c=>c.id),top.id]});game.discard.push(top);
 drawCard(game,'a',{revision:game.revision,source:'discard'});
 assert.equal(game.opened.a,false);assert.equal(game.activePlayerId,'b');assert.equal(privateGame(game,'a').canStage,true);
 invalid(game,()=>discardCard(game,'a',{revision:game.revision,cardId:end.id}));
 stageGroups(game,'a',{revision:game.revision,groups});discardCard(game,'a',{revision:game.revision,cardId:end.id});
 assert.equal(game.opened.a,true);assert.equal(game.laid.a.length,4);assert.equal(game.activePlayerId,'b');conserve(game);
});

test('discard pickup cannot supply a mandatory pure group and escalation is enforced at own discard',()=>{
 const f=fixture();const groups=f.core(),end=f.extra();f.begin();f.game.phase='draw';f.game.mustDiscard.a=false;
 const index=f.game.hands.a.findIndex(card=>card.id===groups[1].cardIds[0]);f.game.discard.push(f.game.hands.a.splice(index,1)[0]);
 drawCard(f.game,'a',{revision:f.game.revision,source:'discard',openingGroups:groups});
 invalid(f.game,()=>discardCard(f.game,'a',{revision:f.game.revision,cardId:end.id}));
 const other=fixture();const core=other.core(),last=other.extra();other.begin();other.game.phase='draw';other.game.mustDiscard.a=false;other.game.discard.push(other.game.stock.pop());other.game.firstOpening={playerId:'b',total:72};
 drawCard(other.game,'a',{revision:other.game.revision,source:'discard',openingGroups:core});
 invalid(other.game,()=>discardCard(other.game,'a',{revision:other.game.revision,cardId:last.id}));
});

test('successful opening-from-discard commits on own discard and preserves top-only pickup for opened players', () => {
  const { game, core, extra, begin, take } = fixture();
  const groups = core(); const end = extra(); begin(); game.phase = 'draw'; game.mustDiscard.a=false;
  const buried = take('9', 'spades'), top = take('4', 'spades'); const cards=[take('2','spades'),take('3','spades')];game.hands.a.push(...cards);groups.push({type:'suite',cardIds:[...cards.map(c=>c.id),top.id]}); game.discard.push(buried, top);
  drawCard(game, 'a', { revision: game.revision, source: 'discard', openingGroups: groups });
  assert.deepEqual(game.discard, [buried]);
  game.activePlayerId = 'a'; game.phase = 'discard';
  discardCard(game, 'a', { revision: game.revision, cardId: end.id });
  assert.equal(game.opened.a, true);
  assert.equal(game.firstOpening.total, 81);
  game.activePlayerId = 'a'; game.phase = 'draw'; game.mustDiscard.a=false;
  drawCard(game, 'a', { revision: game.revision, source: 'discard' });
  assert.equal(game.hands.a.at(-1).id, end.id);
  assert.equal(game.discard.at(-1).id, buried.id);
  conserve(game);
});

test('private projections expose staged faces but never hand, baseline or undo history to opponents', () => {
  const { game, core, extra, begin, stage } = fixture();
  const groups = core(); const secret = extra(); begin(); stage(groups);
  const publicState = publicGame(game), opponent = privateGame(game, 'b');
  assert.equal(publicState.staged.length, 3);
  assert.equal(publicState.counts.a, 1);
  assert.equal(JSON.stringify(opponent).includes(secret.id), false);
  assert.equal(JSON.stringify(publicState).includes(secret.id), false);
  for (const view of [publicState, opponent]) {
    assert.equal('turnUndo' in view, false); assert.equal('turnBaseHand' in view, false);
  }
  publicState.staged[0].cards[0].rank = 'A';
  assert.equal(game.staged[0].cards[0].rank, '8');
  undoStaging(game, 'a', { revision: game.revision, all: true });
  assert.equal(publicGame(game).staged.length, 0);
  assert.equal(JSON.stringify(privateGame(game, 'b')).includes(groups[0].cardIds[0]), false);
  conserve(game);
});

test('staging rejects foreign identities, wrong phases/revisions, duplicate physical IDs and missing discard cards', () => {
  const { game, core, extra, begin, stage } = fixture(); const groups = core(); extra(); begin();
  invalid(game, () => stageGroups(game, 'b', { revision: game.revision, groups }));
  invalid(game, () => stageGroups(game, 'a', { revision: game.revision - 1, groups }));
  invalid(game, () => stageGroups(game, 'a', { revision: game.revision, groups: [groups[0], groups[0]] }));
  invalid(game, () => stageGroups(game, 'a', { revision: game.revision, groups: null }));
  game.phase = 'round-ended'; invalid(game, () => stage(groups)); game.phase = 'discard';
  stage(groups);
  invalid(game, () => stage(groups));
  invalid(game, () => retrieveStaged(game, 'b', { revision: game.revision, groupId: game.staged[0].id }));
  invalid(game, () => retrieveStaged(game, 'a', { revision: game.revision, groupId: 'invented' }));
  invalid(game, () => undoStaging(game, 'a', { revision: game.revision, all: 'true' }));
  invalid(game, () => cancelDiscardPickup(game, 'a', { revision: game.revision }));
  const noDiscard = fixture(); const only = noDiscard.group('a', 'suite', ['2', '3', '4']); noDiscard.begin();
  invalid(noDiscard.game, () => noDiscard.stage([only]));
});

test('discard revalidates every staged group and rejects corrupted state without partially committing', () => {
  const { game, core, extra, begin, stage, discard } = fixture();
  const groups = core(); const end = extra(); begin(); stage(groups);
  game.staged[2].cards[1].rank = 'R';
  invalid(game, () => discard(end));
  assert.equal(game.laid.a.length, 0);
  assert.equal(game.firstOpening, null);
  assert.equal(game.opened.a, false);
  assert.equal(game.phase, 'discard');
});
