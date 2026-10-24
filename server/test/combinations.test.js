import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, createRound } from '../src/game.js';
import { validateCombination, validateOpening } from '../src/combinations.js';

const deck = buildDeck();
const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const ring = [...ranks, 'A'];
const card = (rank, suit = 'hearts', copy = 0) => deck.filter((c) => c.rank === rank && c.suit === suit)[copy];
const joker = deck.find((c) => c.rank === 'Joker');
const jokers = deck.filter((c) => c.rank === 'Joker');
const group = (type, cards, assignment) => ({ type, cardIds: cards.map((c) => c.id), ...(assignment ? { joker: { cardId: joker.id, ...assignment } } : {}) });
function suite(sequence, suit = 'hearts') {
  const used = new Map();
  return sequence.map((rank) => { const copy = used.get(rank) ?? 0; used.set(rank, copy + 1); return card(rank, suit, copy); });
}
const set = (rank, colors = suits.slice(0, 3)) => colors.map((suit) => card(rank, suit));
const evaluate = (proposal) => validateCombination(proposal, deck);
const assertInvalid = (proposal, code) => {
  const result = evaluate(proposal);
  assert.equal(result.valid, false);
  assert.equal(result.naturalPoints, 0);
  assert.equal(result.totalPoints, 0);
  if (code) assert.equal(result.errors[0].code, code);
  return result;
};
const value = (rank, index) => rank === 'A' ? index === 0 ? 1 : 10 : ['V', 'D', 'R'].includes(rank) ? 10 : Number(rank);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('every natural Suite window of lengths 3–14 works in each suit, with positional Ace scores', () => {
  let checked = 0;
  for (const suit of suits) {
    for (let length = 3; length <= 14; length++) {
      for (let start = 0; start <= 14 - length; start++) {
        const sequence = ring.slice(start, start + length);
        const result = evaluate(group('suite', suite(sequence, suit)));
        assert.equal(result.valid, true, `${suit}: ${sequence}`);
        assert.equal(result.pure, true);
        const expected = sequence.reduce((sum, rank, offset) => sum + value(rank, start + offset), 0);
        assert.equal(result.naturalPoints, expected);
        assert.equal(result.totalPoints, expected);
        assert.deepEqual(result.cards.map((c) => c.id), suite(sequence, suit).map((c) => c.id));
        checked++;
      }
    }
  }
  assert.equal(checked, 312);
});

test('every Suite window permits one explicitly assigned Joker in every position', () => {
  let checked = 0;
  for (const suit of suits) {
    for (let length = 3; length <= 14; length++) {
      for (let start = 0; start <= 14 - length; start++) {
        const sequence = ring.slice(start, start + length);
        const naturals = suite(sequence, suit);
        for (let position = 0; position < length; position++) {
          const physical = naturals.map((c, i) => i === position ? joker : c);
          const result = evaluate(group('suite', physical, { rank: sequence[position], suit }));
          assert.equal(result.valid, true, `${suit}: ${sequence}, Joker ${position}`);
          assert.equal(result.pure, false);
          const total = sequence.reduce((sum, rank, offset) => sum + value(rank, start + offset), 0);
          const replacedPoints = value(sequence[position], start + position);
          assert.equal(result.totalPoints, total);
          assert.equal(result.naturalPoints, total - replacedPoints);
          assert.deepEqual(result.cards[position].substitution, { rank: sequence[position], suit });
          assert.equal(result.cards[position].id, joker.id);
          assert.equal(result.cards[position].rank, 'Joker');
          assert.equal(result.cards[position].points, replacedPoints);
          checked++;
        }
      }
    }
  }
  assert.equal(checked, 2080);
});

test('Suites reject wraparound, gaps, unordered cards, extra cards, mixed suits and repeated ranks', () => {
  for (const sequence of [['R', 'A', '2'], ['D', 'R', 'A', '2'], ['A', '3', '4'], ['3', '2', 'A'], ['2', '4', '3'], ['R', 'D', 'V']]) {
    assertInvalid(group('suite', suite(sequence)), 'NON_CONSECUTIVE_SUITE');
  }
  assertInvalid(group('suite', suite(['2', '3'])), 'INVALID_SIZE');
  assertInvalid(group('suite', [...suite(ring), card('2', 'hearts', 1)]), 'INVALID_SIZE');
  assertInvalid(group('suite', [card('2'), card('3'), card('4', 'clubs')]), 'MIXED_SUITS');
  assertInvalid(group('suite', [card('2'), card('2', 'hearts', 1), card('3')]), 'NON_CONSECUTIVE_SUITE');
  assertInvalid(group('suite', [card('A'), card('A', 'hearts', 1), card('2')]), 'NON_CONSECUTIVE_SUITE');
  assertInvalid(group('suite', [card('A'), card('2'), card('3'), card('A', 'hearts', 1)]), 'NON_CONSECUTIVE_SUITE');
});

test('14-card Suite uses distinct physical end Aces and totals 95 natural points', () => {
  const cards = suite(ring);
  assert.notEqual(cards[0].id, cards[13].id);
  const result = evaluate(group('suite', cards));
  assert.equal(result.totalPoints, 95);
  assert.equal(result.cards[0].points, 1);
  assert.equal(result.cards[13].points, 10);
  cards[13] = cards[0];
  assertInvalid(group('suite', cards), 'DUPLICATE_CARD');
});

test('every rank forms a Tierce from any three distinct suits, and a Carré with all four', () => {
  for (const rank of ranks) {
    const single = rank === 'A' || ['V', 'D', 'R'].includes(rank) ? 10 : Number(rank);
    for (const omitted of suits) {
      const result = evaluate(group('tierce', set(rank, suits.filter((s) => s !== omitted))));
      assert.equal(result.valid, true);
      assert.equal(result.naturalPoints, 3 * single);
      assert.equal(result.totalPoints, 3 * single);
    }
    const result = evaluate(group('carre', set(rank, suits)));
    assert.equal(result.valid, true);
    assert.equal(result.totalPoints, 4 * single);
  }
});

test('Tierce and Carré enforce exact size, identical ranks and distinct suits despite two decks', () => {
  assertInvalid(group('tierce', set('8', suits)), 'INVALID_SIZE');
  assertInvalid(group('tierce', set('8', suits.slice(0, 2))), 'INVALID_SIZE');
  assertInvalid(group('carre', set('8')), 'INVALID_SIZE');
  assertInvalid(group('carre', [...set('8', suits), card('8', 'hearts', 1)]), 'INVALID_SIZE');
  assertInvalid(group('carre', [...set('8', suits), joker], { rank: '8', suit: 'hearts' }), 'INVALID_SIZE');
  assertInvalid(group('tierce', [card('8'), card('8', 'clubs'), card('9', 'diamonds')]), 'MIXED_RANKS');
  assertInvalid(group('tierce', [card('8'), card('8', 'hearts', 1), card('8', 'clubs')]), 'DUPLICATE_SUIT');
  assertInvalid(group('carre', [card('8'), card('8', 'hearts', 1), card('8', 'clubs'), card('8', 'spades')]), 'DUPLICATE_SUIT');
});

test('every rank permits a specified missing suit in Joker Tierces and Carrés', () => {
  for (const rank of ranks) {
    const single = rank === 'A' || ['V', 'D', 'R'].includes(rank) ? 10 : Number(rank);
    for (const suit of suits) {
      const otherSuits = suits.filter((s) => s !== suit);
      for (const type of ['tierce', 'carre']) {
        const naturals = set(rank, otherSuits.slice(0, type === 'tierce' ? 2 : 3));
        const result = evaluate(group(type, [...naturals, joker], { rank, suit }));
        assert.equal(result.valid, true);
        assert.equal(result.naturalPoints, naturals.length * single);
        assert.equal(result.totalPoints, (naturals.length + 1) * single);
        assert.equal(result.cards.at(-1).points, single);
        assert.deepEqual(result.cards.at(-1).substitution, { rank, suit });
      }
    }
  }
});

test('Joker assignments must identify one exact missing face, never infer an ambiguous end or suit', () => {
  const ambiguousSuite = group('suite', [joker, card('5'), card('6')]);
  assertInvalid(ambiguousSuite, 'INVALID_JOKER_ASSIGNMENT');
  assertInvalid(group('tierce', [card('8'), card('8', 'clubs'), joker]), 'INVALID_JOKER_ASSIGNMENT');
  // A 5,6,Joker declaration may be 4,5,6 or 5,6,7; order and assignment resolve it explicitly.
  assert.equal(evaluate(group('suite', [joker, card('5'), card('6')], { rank: '4', suit: 'hearts' })).valid, true);
  assert.equal(evaluate(group('suite', [card('5'), card('6'), joker], { rank: '7', suit: 'hearts' })).valid, true);
  for (const assignment of [null, [], {}, { cardId: joker.id, rank: '4' }, { cardId: joker.id, suit: 'hearts' }, { cardId: joker.id, rank: 'Joker', suit: 'hearts' }, { cardId: 'unknown', rank: '4', suit: 'hearts' }, { cardId: card('5').id, rank: '4', suit: 'hearts' }]) {
    assertInvalid({ ...ambiguousSuite, joker: assignment }, 'INVALID_JOKER_ASSIGNMENT');
  }
  assertInvalid(group('suite', [joker, card('5'), card('6')], { rank: '7', suit: 'hearts' }), 'NON_CONSECUTIVE_SUITE');
  assertInvalid(group('suite', [joker, card('5'), card('6')], { rank: '4', suit: 'clubs' }), 'MIXED_SUITS');
  assertInvalid(group('tierce', [card('8'), card('8', 'clubs'), joker], { rank: '9', suit: 'spades' }), 'MIXED_RANKS');
  assertInvalid(group('tierce', [card('8'), card('8', 'clubs'), joker], { rank: '8', suit: 'hearts' }), 'DUPLICATE_SUIT');
  assertInvalid(group('carre', [...set('8'), joker], { rank: '8', suit: 'clubs' }), 'DUPLICATE_SUIT');
  assertInvalid(group('suite', suite(['3', '4', '5']), { rank: '2', suit: 'hearts' }), 'UNEXPECTED_JOKER_ASSIGNMENT');
});

test('two or more Jokers are forbidden in every group', () => {
  for (const type of ['suite', 'tierce', 'carre']) {
    const cards = type === 'carre' ? [card('8'), card('8', 'clubs'), ...jokers.slice(0, 2)] : [card('8'), ...jokers.slice(0, 2)];
    assertInvalid(group(type, cards, { rank: '8', suit: 'diamonds' }), 'TOO_MANY_JOKERS');
  }
});

test('English face aliases normalize to the engine’s French V/D/R without changing physical IDs', () => {
  const cards = [{ id: 'jack', rank: 'J', suit: 'clubs' }, { id: 'queen', rank: 'Q', suit: 'clubs' }, { id: 'king', rank: 'K', suit: 'clubs' }];
  const result = validateCombination(group('suite', cards), cards);
  assert.equal(result.valid, true);
  assert.equal(result.totalPoints, 30);
  assert.deepEqual(result.cards.map((c) => c.rank), ['V', 'D', 'R']);
  assert.equal(evaluate(group('suite', [card('D'), joker, card('A')], { rank: 'K', suit: 'hearts' })).totalPoints, 30);
});

test('malformed, missing, sparse, unknown and repeated physical IDs fail without trusting declared faces', () => {
  for (const proposal of [null, [], {}, { type: 'unknown' }, { type: 'suite', cardIds: null }, { type: 'suite', cardIds: Array(3) }]) assertInvalid(proposal);
  assertInvalid({ type: 'suite', cardIds: ['x', 'y', 'z'] }, 'UNKNOWN_CARD');
  assertInvalid({ type: 'suite', cardIds: [card('2').id, card('2').id, card('3').id] }, 'DUPLICATE_CARD');
  const correct = group('suite', suite(['2', '3', '4']));
  for (const cards of [null, {}, [null], [card('2'), card('2')], [{ id: '', rank: '2', suit: 'hearts' }], [{ id: 'bad', rank: {}, suit: 'hearts' }], [{ id: 'bad', rank: '1', suit: 'hearts' }], [{ id: 'bad', rank: 'A', suit: 'purple' }], [{ id: 'bad', rank: 'Joker', suit: 'hearts' }]]) {
    assert.equal(validateCombination(correct, cards).valid, false);
  }
  const forged = { ...group('suite', suite(['2', '4', '6'])), rank: 'A', points: 1000, totalPoints: 1000, cards: suite(['2', '3', '4']) };
  assertInvalid(forged, 'NON_CONSECUTIVE_SUITE');
});

function openingAt(points) {
  const extra = {
    69: { sequence: ['7', '8', 'Joker'], replaces: '9' },
    70: { sequence: ['7', 'Joker', '9'], replaces: '8' },
    71: { sequence: ['8', '9', 'Joker'], replaces: '10' },
    72: { sequence: ['8', 'Joker', '10'], replaces: '9' },
  }[points];
  const cards = extra.sequence.map((rank) => rank === 'Joker' ? joker : card(rank, 'clubs', rank === '9' ? 1 : 0));
  return [group('suite', suite(['8', '9', '10'])), group('tierce', set('9', ['clubs', 'diamonds', 'spades'])), group('suite', cards, { rank: extra.replaces, suit: 'clubs' })];
}

for (const points of [69, 70, 71, 72]) {
  test(`opening at ${points} natural points ${points >= 71 ? 'passes' : 'fails'}, regardless of Joker’s extra score`, () => {
    const result = validateOpening(openingAt(points), deck);
    assert.equal(result.valid, points >= 71);
    assert.equal(result.qualifyingNaturalPoints, points);
    assert.ok(result.totalLaidPoints > 71);
    assert.deepEqual(result.mandatorySuiteIndices, [0]);
    assert.deepEqual(result.mandatoryTierceIndices, [1]);
    assert.equal(result.groups[2].mandatoryEligible, false);
    if (points < 71) assert.deepEqual(result.errors.map((e) => e.code), ['INSUFFICIENT_NATURAL_POINTS']);
  });
}

test('a fully natural 71-point opening passes and unused hand cards do not contribute', () => {
  const groups = [group('suite', suite(['8', '9', '10'])), group('tierce', set('8', ['clubs', 'diamonds', 'spades'])), group('suite', suite(['2', '3', '4', '5', '6'], 'clubs'))];
  const result = validateOpening(groups, deck);
  assert.equal(result.valid, true);
  assert.equal(result.qualifyingNaturalPoints, 71);
  assert.equal(result.totalLaidPoints, 71);
  assert.equal(validateOpening(groups.slice(0, 2), deck).qualifyingNaturalPoints, 51);
  assert.equal(validateOpening(groups.slice(0, 2), deck).valid, false);
});

test('a pure Carré cannot satisfy the exact mandatory Tierce requirement', () => {
  const result = validateOpening([group('suite', suite(['8', '9', '10', 'V'])), group('carre', set('R', suits))], deck);
  assert.equal(result.qualifyingNaturalPoints, 77);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'MISSING_PURE_TIERCE'));
});

test('Joker groups cannot satisfy either mandatory pure-group requirement', () => {
  const jokerSuite = group('suite', [card('8'), card('9'), joker], { rank: '10', suit: 'hearts' });
  const noPureSuite = validateOpening([jokerSuite, group('tierce', set('R')), group('carre', set('D', suits))], deck);
  assert.ok(noPureSuite.qualifyingNaturalPoints >= 71);
  assert.equal(noPureSuite.valid, false);
  assert.ok(noPureSuite.errors.some((e) => e.code === 'MISSING_PURE_SUITE'));
  const jokerTierce = group('tierce', [card('R', 'clubs'), card('R', 'spades'), joker], { rank: 'R', suit: 'diamonds' });
  const noPureTierce = validateOpening([group('suite', suite(['8', '9', '10', 'V'])), jokerTierce, group('carre', set('D', suits))], deck);
  assert.ok(noPureTierce.qualifyingNaturalPoints >= 71);
  assert.equal(noPureTierce.valid, false);
  assert.ok(noPureTierce.errors.some((e) => e.code === 'MISSING_PURE_TIERCE'));
});

test('a just-taken discard disqualifies its whole group from mandatory requirements, not natural scoring', () => {
  const groups = openingAt(71);
  for (const [groupIndex, missing] of [[0, 'MISSING_PURE_SUITE'], [1, 'MISSING_PURE_TIERCE']]) {
    const result = validateOpening(groups, deck, { discardTakenCardId: groups[groupIndex].cardIds[0] });
    assert.equal(result.valid, false);
    assert.equal(result.qualifyingNaturalPoints, 71);
    assert.equal(result.groups[groupIndex].mandatoryEligible, false);
    assert.ok(result.errors.some((e) => e.code === missing));
  }
  const fromExtraGroup = validateOpening(groups, deck, { discardTakenCardId: groups[2].cardIds[0] });
  assert.equal(fromExtraGroup.valid, true);
  assert.equal(fromExtraGroup.qualifyingNaturalPoints, 71);
  assert.equal(fromExtraGroup.totalLaidPoints, 81);
  assert.equal(validateOpening(groups, deck, { discardTakenCardId: joker.id }).valid, true);
  assert.equal(validateOpening(groups, deck, { discardTakenCardId: card('A', 'spades').id }).valid, true);
});

test('another eligible pure group may satisfy the mandatory requirement when one contains the discard', () => {
  const groups = [...openingAt(71), group('suite', suite(['2', '3', '4'], 'spades')), group('tierce', set('R'))];
  const takenSuite = validateOpening(groups, deck, { discardTakenCardId: groups[0].cardIds[0] });
  assert.equal(takenSuite.valid, true);
  assert.deepEqual(takenSuite.mandatorySuiteIndices, [3]);
  const takenTierce = validateOpening(groups, deck, { discardTakenCardId: groups[1].cardIds[0] });
  assert.equal(takenTierce.valid, true);
  assert.deepEqual(takenTierce.mandatoryTierceIndices, [4]);
});

test('two physical copies may be laid in separate groups, but reusing any physical ID is forbidden', () => {
  const groups = [group('suite', suite(['8', '9', '10'])), group('tierce', [card('9', 'hearts', 1), card('9', 'clubs'), card('9', 'spades')]), group('suite', suite(['V', 'D', 'R'], 'diamonds'))];
  assert.equal(validateOpening(groups, deck).valid, true);
  const reused = structuredClone(groups);
  reused[1].cardIds[0] = groups[0].cardIds[1];
  const failure = validateOpening(reused, deck);
  assert.equal(failure.valid, false);
  assert.equal(failure.errors[0].code, 'REUSED_CARD');
  assert.equal(failure.qualifyingNaturalPoints, 0);
  const jokerReuse = [...openingAt(71), group('tierce', [card('R', 'hearts'), card('R', 'clubs'), joker], { rank: 'R', suit: 'spades' })];
  assert.equal(validateOpening(jokerReuse, deck).errors[0].code, 'REUSED_CARD');
});

test('discard provenance follows the physical ID, not another copy of the same face', () => {
  const groups = [
    group('suite', suite(['8', '9', '10'])),
    group('tierce', [card('9', 'hearts', 1), card('9', 'clubs'), card('9', 'spades')]),
    group('suite', suite(['V', 'D', 'R'], 'diamonds')),
    group('tierce', set('8', ['clubs', 'diamonds', 'spades'])),
  ];
  const result = validateOpening(groups, deck, { discardTakenCardId: card('9', 'hearts', 1).id });
  assert.equal(result.valid, true);
  assert.equal(result.groups[0].mandatoryEligible, true);
  assert.equal(result.groups[1].mandatoryEligible, false);
  assert.deepEqual(result.mandatorySuiteIndices, [0, 2]);
  assert.deepEqual(result.mandatoryTierceIndices, [3]);
});

test('opening rejects malformed context/groups and never exposes a partial valid score', () => {
  for (const groups of [null, {}, [], Array(1), [{ type: 'suite', cardIds: [] }], [...openingAt(71), { type: 'bad' }]]) {
    const result = validateOpening(groups, deck);
    assert.equal(result.valid, false);
    assert.equal(result.qualifyingNaturalPoints, 0);
    assert.equal(result.totalLaidPoints, 0);
  }
  for (const options of [null, [], { discardTakenCardId: 42 }, { discardTakenCardId: 'not-in-hand' }]) {
    assert.equal(validateOpening(openingAt(71), deck, options).valid, false);
  }
  const missingBoth = validateOpening([group('carre', set('R', suits)), group('carre', set('D', suits))], deck);
  assert.equal(missingBoth.qualifyingNaturalPoints, 80);
  assert.deepEqual(missingBoth.errors.map((e) => e.code), ['MISSING_PURE_SUITE', 'MISSING_PURE_TIERCE']);
});

test('validation is deterministic, never mutates proposals or live game state, and returns detached cards', () => {
  const game = createRound(['alice', 'bob']);
  const before = structuredClone(game);
  freeze(game);
  const hand = game.hands.alice;
  const unknown = group('suite', suite(['2', '3', '4']));
  validateCombination(unknown, hand);
  validateOpening([unknown], hand);
  assert.deepEqual(game, before);
  const proposals = freeze(openingAt(71));
  const catalogue = freeze(structuredClone(deck));
  const options = freeze({ discardTakenCardId: proposals[2].cardIds[0] });
  const first = validateOpening(proposals, catalogue, options);
  assert.deepEqual(first, validateOpening(proposals, catalogue, options));
  first.groups[2].cards.at(-1).substitution.rank = 'A';
  first.groups[0].cards[0].rank = 'A';
  assert.equal(validateOpening(proposals, catalogue, options).totalLaidPoints, 81);
  assert.equal(proposals[2].joker.rank, '10');
  assert.equal(catalogue.find((c) => c.id === proposals[0].cardIds[0]).rank, '8');
});
