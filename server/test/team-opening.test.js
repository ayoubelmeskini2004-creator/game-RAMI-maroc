import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, createRound, discardCard, drawCard, privateGame, publicGame } from '../src/game.js';
import { validateCombination } from '../src/combinations.js';
import { teamOpeningDonor, validateTeamOpening } from '../src/team-opening.js';
import { startTurnStaging, stageGroups, stageCollage, recoverJoker, retrieveStaged, undoStaging, openingStatus, cancelDiscardPickup } from '../src/descente.js';
import { effectiveGroup, recordedCollageTotal } from '../src/collage.js';

function fixture({ partnerOpened = true, mode = 'teams', donorTotal = 90 } = {}) {
  const game = createRound(['a', 'b', 'c', 'd']);
  Object.assign(game, { stock: buildDeck(), hands: { a: [], b: [], c: [], d: [] }, activePlayerId: 'a', initialDiscard: false, mode,
    teams: { a: 'A', b: 'B', c: 'A', d: 'B' }, opened: { a: false, b: true, c: partnerOpened, d: false },
    openingTotals: { b: 80, ...(partnerOpened ? { c: donorTotal } : {}) }, firstOpening: { playerId: 'b', total: 80 } });
  let serial = 0;
  function take(rank, suit = 'hearts') {
    const i = game.stock.findIndex((c) => c.rank === rank && c.suit === (rank === 'Joker' ? null : suit));
    assert.ok(i >= 0, `available ${rank} ${suit}`); return game.stock.splice(i, 1)[0];
  }
  function hand(rank, suit) { const c = take(rank, suit); game.hands.a.push(c); return c; }
  function proposal(type = 'suite', ranks = ['A', '2', '3'], suits = 'hearts', face) {
    const cards = ranks.map((r, i) => hand(r, Array.isArray(suits) ? suits[i] : suits));
    const joker = cards.find((c) => c.rank === 'Joker');
    return { type, cardIds: cards.map((c) => c.id), ...(joker ? { joker: { cardId: joker.id, ...face } } : {}) };
  }
  function laid(owner, type = 'suite', ranks = ['8', '9', '10'], suits = 'clubs', face) {
    const cards = ranks.map((r, i) => take(r, Array.isArray(suits) ? suits[i] : suits));
    const joker = cards.find((c) => c.rank === 'Joker');
    const result = validateCombination({ type, cardIds: cards.map((c) => c.id), ...(joker ? { joker: { cardId: joker.id, ...face } } : {}) }, cards);
    assert.equal(result.valid, true); const g = { id: `g${++serial}`, type, cards: result.cards }; game.laid[owner].push(g); return g;
  }
  const begin = () => startTurnStaging(game, 'a');
  const stage = (groups) => stageGroups(game, 'a', { revision: game.revision, groups });
  const discard = (c) => discardCard(game, 'a', { revision: game.revision, cardId: c.id });
  const collage = (ownerId, g, c) => stageCollage(game, 'a', { revision: game.revision, ownerId, groupId: g.id, cardIds: [c.id] });
  const recover = (ownerId, g, c) => recoverJoker(game, 'a', { revision: game.revision, ownerId, groupId: g.id, jokerId: g.cards.find((x) => x.rank === 'Joker').id, cardId: c.id });
  const undo = (all = false) => undoStaging(game, 'a', { revision: game.revision, all });
  return { game, take, hand, proposal, laid, begin, stage, discard, collage, recover, undo };
}
function invalid(game, operation) { const before = structuredClone(game); assert.throws(operation, { message: 'Coup invalide' }); assert.deepEqual(game, before); }
function conserve(game) {
  const cards = [...game.stock, ...game.discard, ...Object.values(game.hands).flat(),
    ...game.order.flatMap((id) => game.laid[id].flatMap((g) => effectiveGroup(game, id, g).cards)),
    ...game.staged.flatMap((g) => effectiveGroup(game, game.activePlayerId, g).cards)];
  assert.equal(cards.length, 108); assert.equal(new Set(cards.map((c) => c.id)).size, 108);
}

test('first member of each team still needs ordinary pure groups, 71 naturals and first-opener escalation', () => {
  const { game, proposal, hand, begin, stage, discard } = fixture({ partnerOpened: false });
  const suite = proposal('suite', ['8', '9', '10']);
  const tierce = proposal('tierce', ['R', 'R', 'R'], ['hearts', 'clubs', 'spades']);
  const extra = proposal('suite', ['4', '5', '6'], 'diamonds');
  const ten = proposal('tierce', ['10', '10', '10'], ['clubs', 'diamonds', 'spades']); const end = hand('2', 'clubs');
  begin(); stage([suite]); invalid(game, () => discard(end)); stage([tierce]); invalid(game, () => discard(end));
  stage([extra]); assert.equal(openingStatus(game, 'a').totalLaidPoints, 72); invalid(game, () => discard(end));
  stage([ten]); discard(end); conserve(game);
  assert.equal(game.openingTotals.a, 102); assert.equal(game.openingInheritedFrom.a, undefined);
  assert.equal(game.firstOpening.total, 80); assert.equal(game.opened.c, false);
});

test('the first round opening by a team remains ordinary and records the global escalation reference', () => {
  const { game, proposal, hand, begin, stage, discard } = fixture({ partnerOpened: false });
  game.firstOpening = null; game.opened.b = false; delete game.openingTotals.b;
  const groups = [proposal('suite', ['8', '9', '10']), proposal('tierce', ['R', 'R', 'R'], ['hearts', 'clubs', 'spades']), proposal('suite', ['4', '5', '6'], 'diamonds')];
  const end = hand('2', 'clubs'); begin(); stage(groups); discard(end);
  assert.deepEqual(game.firstOpening, { playerId: 'a', total: 72 }); assert.equal(teamOpeningDonor(game, 'c'), 'a'); conserve(game);
});

for (const joker of [false, true]) test(`partner may open with one ${joker ? 'explicit Joker' : 'natural'} Suite below 71 and escalation`, () => {
  const { game, proposal, hand, begin, stage, discard } = fixture();
  const p = joker ? proposal('suite', ['A', 'Joker', '3'], 'hearts', { rank: '2', suit: 'hearts' }) : proposal();
  const end = hand('2', 'clubs'); begin(); stage([p]);
  const status = openingStatus(game, 'a'); assert.equal(status.valid, true); assert.equal(status.totalLaidPoints, 6);
  assert.equal(status.qualifyingNaturalPoints, joker ? 4 : 6); assert.equal(status.kind, 'team');
  assert.equal(game.opened.a, false); assert.equal(game.openingInheritedFrom.a, undefined);
  discard(end); conserve(game); assert.equal(game.opened.a, true); assert.equal(game.openingTotals.a, 6);
  assert.equal(game.openingInheritedFrom.a, 'c'); assert.equal(recordedCollageTotal(game, 'a'), 90); assert.equal(game.firstOpening.total, 80);
});

test('a Tierce or Carré alone is not a special opening; additional valid groups alongside a Suite are allowed', () => {
  const { game, proposal, hand, begin, stage, discard } = fixture();
  const tierce = proposal('tierce', ['4', '4', '4'], ['clubs', 'diamonds', 'spades']);
  const suite = proposal(); const end = hand('2', 'clubs'); begin(); stage([tierce]); invalid(game, () => discard(end));
  assert.equal(openingStatus(game, 'a').valid, false); stage([suite]); discard(end); assert.equal(game.openingTotals.a, 18); conserve(game);
});

test('team opening validates Joker metadata, physical ownership, duplicates and every additional group without mutation', () => {
  const { game, proposal, hand, begin, stage } = fixture();
  const p = proposal('suite', ['A', 'Joker', '3'], 'hearts', { rank: '2', suit: 'hearts' }); hand('2', 'clubs'); begin();
  for (const bad of [{ ...p, joker: undefined }, { ...p, joker: { ...p.joker, suit: 'spades' } }, { ...p, cardIds: [...p.cardIds, p.cardIds[0]] }]) invalid(game, () => stage([bad]));
  invalid(game, () => stage([p, p]));
  const before = structuredClone(game.hands.a); const result = validateTeamOpening([p, { type: 'tierce', cardIds: ['foreign', 'x', 'y'] }], game.hands.a);
  assert.equal(result.valid, false); assert.deepEqual(game.hands.a, before); conserve(game);
});

test('Carré without Suite cannot open, and the initial mandatory discard still forbids a special opening', () => {
  const { game, proposal, hand, begin, stage, discard } = fixture();
  const square = proposal('carre', ['4', '4', '4', '4'], ['hearts', 'clubs', 'diamonds', 'spades']);
  const suite = proposal(), end = hand('2', 'clubs'); begin(); stage([square]); invalid(game, () => discard(end));
  game.initialDiscard = true; invalid(game, () => stage([suite])); game.initialDiscard = false;
  stage([suite]); discard(end); conserve(game);
});

test('no exception from an opponent, staged partner, individual-mode labels, missing total or malformed teams', () => {
  for (const change of [
    (g) => { g.opened.c = false; }, (g) => { g.mode = 'individual'; },
    (g) => { delete g.openingTotals.c; }, (g) => { g.teams.c = 'B'; },
    (g) => { g.openingInheritedFrom.c = 'a'; },
  ]) {
    const { game, proposal, hand, begin, stage, discard } = fixture(); change(game);
    const p = proposal(); const end = hand('2', 'clubs'); begin(); stage([p]);
    assert.equal(teamOpeningDonor(game, 'a'), null); invalid(game, () => discard(end));
  }
});

test('partner opening never automatically grants Collage or Joker rights before the player stages their own Suite', () => {
  const { game, laid, hand, proposal, begin, stage, collage, recover } = fixture();
  const partner = laid('c'), source = laid('b', 'suite', ['8', 'Joker', '10'], 'diamonds', { rank: '9', suit: 'diamonds' });
  const seven = hand('7', 'clubs'), nine = hand('9', 'diamonds'); const p = proposal(); hand('2', 'spades'); begin();
  invalid(game, () => collage('c', partner, seven)); invalid(game, () => recover('b', source, nine));
  assert.deepEqual(privateGame(game, 'a').collageTargets, []); assert.equal(privateGame(game, 'a').canRecoverJoker, false);
  stage([p]); collage('c', partner, seven); recover('b', source, nine); conserve(game);
  assert.equal(game.opened.a, false); assert.equal(privateGame(game, 'a').canRecoverJoker, true);
});

for (const total of [79, 80, 81]) test(`same-turn opponent Collage uses donor total ${total}, not the special Suite total`, () => {
  const { game, laid, hand, proposal, begin, stage, collage, discard } = fixture({ donorTotal: total });
  const target = laid('b'); const seven = hand('7', 'clubs'), end = hand('2', 'spades'); const p = proposal(); begin(); stage([p]);
  if (total <= 80) invalid(game, () => collage('b', target, seven)); else collage('b', target, seven);
  discard(end); conserve(game); assert.equal(recordedCollageTotal(game, 'a'), total);
  assert.equal(privateGame(game, 'a').collageTargets.includes('b'), total > 80);
  assert.equal(game.openingTotals.a, 6);
});

test('a large special opening cannot replace a low inherited total for opponent eligibility', () => {
  const { game, laid, hand, proposal, begin, stage, collage } = fixture({ donorTotal: 71 });
  const target = laid('b'), seven = hand('7', 'clubs');
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'A'];
  const p = proposal('suite', ranks); hand('2', 'spades'); begin(); stage([p]);
  assert.equal(openingStatus(game, 'a').totalLaidPoints, 95); invalid(game, () => collage('b', target, seven));
});

test('opponent comparison also uses an opponent special opener’s inherited total', () => {
  const { game, laid, hand, proposal, begin, stage, collage } = fixture();
  game.opened.d = true; game.openingTotals.d = 100; game.openingTotals.b = 6; game.openingInheritedFrom.b = 'd';
  const target = laid('b'), seven = hand('7', 'clubs'), p = proposal(); hand('2', 'spades'); begin(); stage([p]);
  assert.equal(recordedCollageTotal(game, 'b'), 100); invalid(game, () => collage('b', target, seven));
  game.openingTotals.c = 101; collage('b', target, seven); conserve(game);
});

test('removing the only special Suite revokes provisional rights and blocks previously staged Collage atomically', () => {
  const { game, laid, hand, proposal, begin, stage, collage, discard, undo } = fixture();
  const target = laid('c'), seven = hand('7', 'clubs'), end = hand('2', 'spades'); const p = proposal(); begin(); stage([p]); collage('c', target, seven);
  retrieveStaged(game, 'a', { revision: game.revision, groupId: game.staged[0].id });
  invalid(game, () => discard(end)); invalid(game, () => collage('c', target, game.hands.a.find((c) => c.id === p.cardIds[0])));
  assert.equal(privateGame(game, 'a').canRecoverJoker, false); undo(); discard(end); conserve(game);
});

test('special discard pickup commits its Suite and inherited eligibility before passing', () => {
  const {game,hand,take,begin}=fixture();const a=hand('A'),two=hand('2');hand('2','clubs');const top=take('3');
  game.discard.push(take('R','spades'),top);begin();game.phase='draw';game.mustDiscard.a=false;
  drawCard(game,'a',{source:'discard',revision:game.revision,openingGroups:[{type:'suite',cardIds:[a.id,two.id,top.id]}]});
  assert.equal(game.opened.a,false);
  discardCard(game,'a',{revision:game.revision,cardId:game.hands.a[0].id});
  assert.equal(game.opened.a,true);assert.equal(game.openingTotals.a,6);assert.equal(game.openingInheritedFrom.a,'c');
  assert.equal(privateGame(game,'a').canCancelDiscard,false);assert.notEqual(game.activePlayerId,'a');
  invalid(game,()=>undoStaging(game,'a',{revision:game.revision,all:true}));
  invalid(game,()=>cancelDiscardPickup(game,'a',{revision:game.revision}));conserve(game);
});

test('Joker discard can complete a special Suite while invalid pickup stays fully atomic', () => {
  const { game, hand, take, discard } = fixture(); const one = hand('A'), three = hand('3'), end = hand('2', 'clubs'), joker = take('Joker');
  game.discard.push(joker); game.phase = 'draw';game.mustDiscard.a=false;
  const p = { type: 'suite', cardIds: [one.id, joker.id, three.id], joker: { cardId: joker.id, rank: '2', suit: 'hearts' } };
  invalid(game, () => drawCard(game, 'a', { source: 'discard', revision: game.revision, openingGroups: [{ ...p, joker: undefined }] }));
  drawCard(game, 'a', { source: 'discard', revision: game.revision, openingGroups: [p] }); assert.notEqual(game.activePlayerId, 'a'); discard(end); conserve(game);
  assert.equal(game.openingTotals.a, 6);
});

test('mixed special opening, teammate Collage and recovered Joker reuse undo and commit together', () => {
  const { game, laid, hand, proposal, begin, stage, collage, recover, undo, discard } = fixture();
  const target = laid('c'), source = laid('b', 'suite', ['8', 'Joker', '10'], 'diamonds', { rank: '9', suit: 'diamonds' });
  const seven = hand('7', 'clubs'), nine = hand('9', 'diamonds'), four = hand('4', 'spades'), six = hand('6', 'spades'), end = hand('2', 'clubs');
  const p = proposal(); begin(); const baseline = structuredClone(game.hands.a);
  stage([p]); collage('c', target, seven); recover('b', source, nine); const joker = game.hands.a.at(-1);
  const reuse = { type: 'suite', cardIds: [four.id, joker.id, six.id], joker: { cardId: joker.id, rank: '5', suit: 'spades' } };
  invalid(game, () => discard(end)); stage([reuse]); conserve(game); undo(true); conserve(game);
  assert.deepEqual(game.hands.a, baseline); assert.equal(game.opened.a, false); assert.equal(game.openingInheritedFrom.a, undefined);
  stage([p]); collage('c', target, seven); recover('b', source, nine); stage([reuse]); discard(end); conserve(game);
  assert.equal(game.openingTotals.a, 21); assert.equal(recordedCollageTotal(game, 'a'), 90);
  assert.equal(game.laid.c[0].cards.length, 4); assert.equal(game.laid.b[0].cards[1].id, nine.id);
});

test('public and per-player views keep hands and turn history private with special eligibility and staged groups', () => {
  const { game, hand, proposal, begin, stage } = fixture(); const p = proposal(), secret = hand('2', 'clubs'); begin(); stage([p]);
  const mine = privateGame(game, 'a'), theirs = privateGame(game, 'b');
  assert.equal(mine.teamOpeningEligible, true); assert.equal(mine.openingStatus.kind, 'team');
  assert.equal(JSON.stringify(theirs).includes(secret.id), false); assert.equal(JSON.stringify(publicGame(game)).includes(secret.id), false);
  assert.equal(publicGame(game).turnUndo, undefined); assert.equal(theirs.openingStatus, null); conserve(game);
});
