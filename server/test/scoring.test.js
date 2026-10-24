import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, createRound, discardCard, drawCard } from '../src/game.js';
import { stageGroups, startTurnStaging, recoverJoker } from '../src/descente.js';
import { validateCombination } from '../src/combinations.js';
import { createMatch, recordRound, roundResult, validThreshold } from '../src/scoring.js';

function fixture({ opened = true, mode = 'individual' } = {}) {
  const game = createRound(['a', 'b', 'c', 'd']);
  Object.assign(game, { stock: buildDeck(), hands: { a: [], b: [], c: [], d: [] }, activePlayerId: 'a', initialDiscard: false,
    mode, teams: { a: 'A', b: 'B', c: 'A', d: 'B' }, opened: { a: opened, b: true, c: false, d: false } });
  const take = (rank, suit = 'hearts') => {
    const i = game.stock.findIndex((c) => c.rank === rank && c.suit === (rank === 'Joker' ? null : suit));
    assert.ok(i >= 0); return game.stock.splice(i, 1)[0];
  };
  const hand = (rank, suit) => { const c = take(rank, suit); game.hands.a.push(c); return c; };
  const begin = () => startTurnStaging(game, 'a');
  const discard = (card) => discardCard(game, 'a', { revision: game.revision, cardId: card.id });
  const stage = (groups) => stageGroups(game, 'a', { revision: game.revision, groups });
  return { game, take, hand, begin, discard, stage };
}
function conserve(game) {
  const cards = [...game.stock, ...game.discard, ...Object.values(game.hands).flat(), ...Object.values(game.laid).flat().flatMap((g) => g.cards)];
  assert.equal(cards.length, 108); assert.equal(new Set(cards.map((c) => c.id)).size, 108);
}
function invalid(game, action) { const before = structuredClone(game); assert.throws(action, { message: 'Coup invalide' }); assert.deepEqual(game, before); }

test('only a legal last discard ends the round, and all further game actions are frozen', () => {
  const { game, hand, begin, stage, discard } = fixture();
  const cards = ['A', '2', '3'].map((r) => hand(r)); begin();
  invalid(game, () => stage([{ type: 'suite', cardIds: cards.map((c) => c.id) }]));
  const end = hand('Joker'); begin(); stage([{ type: 'suite', cardIds: cards.map((c) => c.id) }]);
  assert.equal(game.roundResult, null); assert.equal(game.phase, 'discard'); discard(end); conserve(game);
  assert.equal(game.discard.at(-1).id, end.id); assert.equal(game.roundResult.winnerId, 'a'); assert.equal(game.roundResult.totalDescent, false);
  assert.equal(game.roundResult.penalties.a, 0); assert.equal(game.phase, 'round-ended');
  invalid(game, () => drawCard(game, 'a', { revision: game.revision, source: 'stock' }));
  invalid(game, () => discard(end)); invalid(game, () => stage([]));
});

test('opened losers pay ten per card including Jokers; unopened losers pay exactly 100 at any hand size', () => {
  for (const count of [0, 1, 7, 15]) {
    const { game, hand, take, begin, discard } = fixture();
    game.hands.b.push(take('Joker'), take('R', 'spades'), take('2', 'clubs'));
    for (let i = 0; i < count; i++) game.hands.c.push(game.stock.pop());
    const end = hand('3'); begin(); discard(end); conserve(game);
    assert.deepEqual(game.roundResult.penalties, { a: 0, b: 30, c: 100, d: 100 });
  }
});

test('ordinary same-turn total opening doubles all losing player penalties only', () => {
  const { game, hand, take, begin, stage, discard } = fixture({ opened: false });
  game.hands.b.push(take('Joker'), take('D', 'clubs'));
  const suite = ['8', '9', '10'].map((r) => hand(r));
  const tierce = ['clubs', 'diamonds', 'spades'].map((s) => hand('R', s));
  const extra = ['4', '5', '6'].map((r) => hand(r, 'clubs')); const end = hand('Joker'); begin();
  stage([{ type: 'suite', cardIds: suite.map((c) => c.id) }, { type: 'tierce', cardIds: tierce.map((c) => c.id) }, { type: 'suite', cardIds: extra.map((c) => c.id) }]);
  discard(end); conserve(game); assert.equal(game.roundResult.totalDescent, true);
  assert.deepEqual(game.roundResult.penalties, { a: 0, b: 40, c: 200, d: 200 });
});

test('an invalid unopened finish never partially commits or scores', () => {
  const { game, hand, begin, stage, discard } = fixture({ opened: false });
  const cards = ['A', '2', '3'].map((r) => hand(r)), end = hand('4', 'clubs'); begin(); stage([{ type: 'suite', cardIds: cards.map((c) => c.id) }]);
  invalid(game, () => discard(end)); assert.equal(game.roundResult, null);
});

test('recovered Joker cannot be the final discard, but its legal reuse can precede a winning discard', () => {
  const { game, hand, take, begin, stage, discard } = fixture();
  const cards = [take('8', 'diamonds'), take('Joker'), take('10', 'diamonds')];
  const joker = cards[1]; const result = validateCombination({ type: 'suite', cardIds: cards.map((c) => c.id), joker: { cardId: joker.id, rank: '9', suit: 'diamonds' } }, cards);
  game.laid.b.push({ id: 'source', type: 'suite', cards: result.cards });
  const natural = hand('9', 'diamonds'), four = hand('4', 'clubs'), six = hand('6', 'clubs'), end = hand('2'); begin();
  recoverJoker(game, 'a', { revision: game.revision, ownerId: 'b', groupId: 'source', jokerId: joker.id, cardId: natural.id });
  invalid(game, () => discard(joker)); invalid(game, () => discard(end));
  stage([{ type: 'suite', cardIds: [four.id, joker.id, six.id], joker: { cardId: joker.id, rank: '5', suit: 'clubs' } }]); discard(end); conserve(game);
  assert.equal(game.roundResult.winnerId, 'a');
});

test('team finish scores both teammates and total-descent doubling spares the winning teammate', () => {
  for (const openedPartner of [false, true]) {
    const { game, hand, take, begin, stage, discard } = fixture({ opened: false, mode: 'teams' });
    // First teammate opens ordinarily; for special case use already committed partner metadata.
    game.opened.c = true; game.openingTotals.c = 90;
    const cards = ['A', '2', '3'].map((r) => hand(r)); const end = hand('Joker');
    game.hands.c.push(take('R', 'clubs'), take('Joker')); game.opened.c = openedPartner;
    game.hands.b.push(take('2', 'spades')); begin();
    if (!openedPartner) { game.opened.a = true; } // Previously opened winner: ordinary finish without doubling.
    stage([{ type: 'suite', cardIds: cards.map((c) => c.id) }]); discard(end); conserve(game);
    assert.equal(game.roundResult.winnerTeam, 'A');
    assert.equal(game.roundResult.penalties.c, openedPartner ? 20 : 100);
    assert.equal(game.roundResult.penalties.b, openedPartner ? 20 : 10);
    assert.equal(game.roundResult.penalties.d, openedPartner ? 200 : 100);
    const match = createMatch(game.order.map((id) => ({ id, name: id, team: game.teams[id] })), 'teams', 500);
    recordRound(match, game.roundResult, 1000);
    assert.equal(match.history[0].teamPenalties.A, openedPartner ? 20 : 100);
    assert.equal(match.history[0].teamPenalties.B, openedPartner ? 220 : 110);
  }
});

test('ordinary team Descente totale leaves an unopened winning teammate at 100 rather than 200', () => {
  const { game, hand, take, begin, stage, discard } = fixture({ opened: false, mode: 'teams' });
  game.hands.b.push(take('Joker'), take('D', 'diamonds')); game.hands.c.push(take('2', 'spades'));
  const suite = ['8', '9', '10'].map((r) => hand(r));
  const tierce = ['clubs', 'diamonds', 'spades'].map((s) => hand('R', s));
  const extra = ['4', '5', '6'].map((r) => hand(r, 'clubs')); const end = hand('Joker'); begin();
  stage([{ type: 'suite', cardIds: suite.map((c) => c.id) }, { type: 'tierce', cardIds: tierce.map((c) => c.id) }, { type: 'suite', cardIds: extra.map((c) => c.id) }]);
  discard(end); conserve(game);
  assert.equal(game.roundResult.totalDescent, true); assert.equal(game.roundResult.winnerTeam, 'A');
  assert.deepEqual(game.roundResult.penalties, { a: 0, b: 40, c: 100, d: 200 });
});

test('threshold rejects fractional, nonnumeric, nonpositive and unsafe values', () => {
  for (const value of [0, -1, 1.5, '500', null, NaN, Infinity, 1000000001]) assert.equal(validThreshold(value), false);
  for (const value of [1, 500, 1000000000]) assert.equal(validThreshold(value), true);
});

const players = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: id, team: i % 2 ? 'B' : 'A' }));
const result = (round, penalties) => ({ round, winnerId: 'a', winnerTeam: null, totalDescent: false, penalties });
test('cumulative individual threshold ends match with the lowest total, including exact threshold', () => {
  const match = createMatch(players, 'individual', 100);
  recordRound(match, result(1, { a: 0, b: 30, c: 40, d: 50 }), 1000);
  assert.equal(match.finished, false); assert.equal(match.nextRoundAt, 16000);
  recordRound(match, result(2, { a: 20, b: 80, c: 0, d: 50 }), 2000);
  assert.equal(match.finished, true); assert.equal(match.winner, 'a'); assert.equal(match.nextRoundAt, null);
  assert.deepEqual(match.totals, { a: 20, b: 110, c: 40, d: 100 });
  assert.deepEqual(match.history[0].totals, { a: 0, b: 30, c: 40, d: 50 });
  assert.throws(() => recordRound(match, result(3, { a: 0, b: 0, c: 0, d: 0 }), 3000));
});

test('a tied lowest total extends the match until a later round breaks the tie', () => {
  const match = createMatch(players, 'individual', 100);
  recordRound(match, result(1, { a: 0, b: 0, c: 100, d: 200 }), 1000);
  assert.equal(match.tied, true); assert.equal(match.finished, false); assert.equal(match.nextRoundAt, 16000);
  recordRound(match, result(2, { a: 0, b: 0, c: 10, d: 0 }), 2000); assert.equal(match.tied, true);
  recordRound(match, result(3, { a: 20, b: 0, c: 10, d: 0 }), 3000);
  assert.equal(match.winner, 'b'); assert.equal(match.finished, true); assert.equal(match.history.length, 3);
});

test('team threshold compares team sums, continues tied teams and stores detached historical totals', () => {
  const match = createMatch(players, 'teams', 100);
  recordRound(match, result(1, { a: 0, b: 40, c: 100, d: 60 }), 0);
  assert.equal(match.tied, true); assert.equal(match.finished, false);
  assert.deepEqual(match.history[0].teamTotals, { A: 100, B: 100 });
  recordRound(match, result(2, { a: 0, b: 10, c: 0, d: 10 }), 15000);
  assert.equal(match.finished, true); assert.equal(match.winner, 'A');
  assert.deepEqual(match.history[0].teamTotals, { A: 100, B: 100 });
});

test('a completed round cannot be counted twice and history never includes card faces or hands', () => {
  const match = createMatch(players, 'individual', 500); const entry = result(1, { a: 0, b: 10, c: 20, d: 30 });
  recordRound(match, entry, 0); entry.penalties.b = 999; assert.equal(match.history[0].penalties.b, 10);
  const before = structuredClone(match); assert.throws(() => recordRound(match, entry, 1)); assert.deepEqual(match, before);
  assert.equal(JSON.stringify(match).includes('hands'), false);
});
