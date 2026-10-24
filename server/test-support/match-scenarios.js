// Server-only deterministic deals for repeatable full-match tests. No live state is rewritten.
import { buildDeck, createRound, secureShuffle } from '../src/game.js';
import { allTurns } from '../src/turns.js';

export function matchScenario(mode) {
  const plans = new Map();
  const makeRound = (order, previous) => {
    const game = createRound(order, previous);
    let pool = secureShuffle(buildDeck());
    const take = (rank, suit = 'hearts') => {
      const i = pool.findIndex((c) => c.rank === rank && c.suit === (rank === 'Joker' ? null : suit));
      if (i < 0) throw new Error(`Fixture exhausted: ${rank} ${suit}`);
      return pool.splice(i, 1)[0];
    };
    const groups = (specs) => specs.map(([type, ranks, suits, face]) => {
      const cards = ranks.map((rank, i) => take(rank, Array.isArray(suits) ? suits[i] : suits));
      const joker = cards.find((c) => c.rank === 'Joker');
      return { cards, proposal: { type, cardIds: cards.map((c) => c.id), ...(joker ? { joker: { cardId: joker.id, ...face } } : {}) } };
    });
    const hands = Object.fromEntries(order.map((id) => [id, []]));
    let plan;
    if (mode === 'individual') {
      const values = groups([
        ['suite', ['8', '9', '10', 'V'], 'hearts'],
        ['tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']],
        ['suite', ['4', '5', '6'], 'clubs'],
        ['suite', ['A', '2', '3'], 'spades'],
      ]);
      const draw = take('D'), end = take('2', 'diamonds');
      hands[order[0]].push(...values.flatMap((v) => v.cards), end);
      values[0].proposal.cardIds.push(draw.id);
      plan = { winner: order[0], groups: values.map((v) => v.proposal), endId: end.id, winningDraw: draw };
    } else {
      const ordinary = groups([
        ['suite', ['8', '9', '10'], 'hearts'],
        ['tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']],
        ['suite', ['4', '5', '6'], 'clubs'],
      ]);
      const special = groups([
        ['suite', ['A', '2', 'Joker'], 'spades', { rank: '3', suit: 'spades' }],
        ['suite', ['4', '5', '6', '7'], 'diamonds'],
        ['tierce', ['V', 'V', 'V'], ['hearts', 'clubs', 'diamonds']],
        ['suite', ['A', '2', '3'], 'clubs'],
      ]);
      const collage = take('7');
      hands[order[0]].push(...ordinary.flatMap((v) => v.cards));
      hands[order[2]].push(...special.flatMap((v) => v.cards), collage);
      plan = { opener: order[0], winner: order[2], ordinary: ordinary.map((v) => v.proposal), groups: special.map((v) => v.proposal), collageId: collage.id };
    }
    for (const id of order) while (hands[id].length < 14) hands[id].push(pool.pop());
    const extra = pool.pop(); hands[game.starterId].push(extra); plan.firstDiscardId = extra.id;
    if (mode === 'individual') {
      const draws = [];
      let next = (order.indexOf(game.starterId)+1)%order.length;
      while (order[next] !== plan.winner) { draws.push(pool.pop()); next = (next + 1) % order.length; }
      draws.push(plan.winningDraw); pool.push(...draws.reverse());
    }
    game.hands = hands; game.stock = pool;
    plans.set(game.roundId, plan);
    return game;
  };
  return { makeRound, plans };
}

export function physicalCards(game) {
  const turns=allTurns(game), overlays=Object.values(turns).flatMap(turn=>turn.collages);
  const effective = (id, group) => overlays.find((o) => o.ownerId === id && o.groupId === group.id)?.group ?? group;
  return [...game.stock, ...game.discard, ...Object.values(game.hands).flat(),
    ...game.order.flatMap((id) => game.laid[id].flatMap((g) => effective(id, g).cards)),
    ...Object.entries(turns).flatMap(([owner,turn])=>turn.staged.flatMap(g=>effective(owner,g).cards))];
}
