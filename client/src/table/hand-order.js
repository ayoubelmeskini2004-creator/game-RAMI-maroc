// Private presentation order only. Absent IDs remain as anchors for staged undo.
export const CARD_DRAG_TYPE = 'application/x-rami-card';
export const DISCARD_DRAG_TYPE = 'application/x-rami-discard';
export function validDiscardDrag(data,game,playerId) {
  return !!data && game.canDraw && data.playerId===playerId && data.roundId===game.roundId && data.revision===game.revision && data.cardId===game.discardTop?.id;
}
export function reconcileOrder(order, cards) {
  const ids = [...new Set(Array.isArray(order) ? order.filter((id) => typeof id === 'string') : [])];
  const seen = new Set(ids);
  for (const { id } of cards) if (!seen.has(id)) { ids.push(id); seen.add(id); }
  return ids;
}
export function orderedHand(order, cards) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return reconcileOrder(order, cards).flatMap((id) => byId.has(id) ? [byId.get(id)] : []);
}
export function replaceVisibleOrder(order, cards, visibleIds) {
  const anchors = reconcileOrder(order, cards);
  const visible = new Set(cards.map((card) => card.id));
  if (visibleIds.length !== visible.size || new Set(visibleIds).size !== visible.size || visibleIds.some((id) => !visible.has(id))) return anchors;
  let index = 0;
  return anchors.map((id) => visible.has(id) ? visibleIds[index++] : id);
}
export function moveCard(order, cards, cardId, beforeId = null) {
  return moveCards(order, cards, [cardId], beforeId);
}
export function moveCards(order, cards, cardIds, beforeId = null) {
  const ids = orderedHand(order, cards).map((card) => card.id);
  const selected = new Set(cardIds);
  if (!cardIds.length || selected.size !== cardIds.length || cardIds.some((id) => !ids.includes(id)) || beforeId !== null && !ids.includes(beforeId)) return reconcileOrder(order, cards);
  const moving = ids.filter((id) => selected.has(id));
  const next = ids.filter((id) => !selected.has(id));
  const boundary = beforeId === null ? ids.length : ids.indexOf(beforeId);
  const index = ids.slice(0, boundary).filter((id) => !selected.has(id)).length;
  next.splice(index, 0, ...moving);
  return replaceVisibleOrder(order, cards, next);
}
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
const compare = (a, b) => suits.indexOf(a.suit) - suits.indexOf(b.suit) || ranks.indexOf(a.rank) - ranks.indexOf(b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Deterministic heuristic: Carrés/Tierces first, then longest natural Suites.
// Physical duplicates stay distinct; Jokers stay at the end, without substitution.
export function automaticOrder(cards) {
  let remaining = [...cards].sort(compare);
  const result = [];
  for (const rank of ranks) {
    while (true) {
      const group = suits.map((suit) => remaining.find((card) => card.rank === rank && card.suit === suit)).filter(Boolean);
      if (group.length < 3) break;
      result.push(...group);
      const used = new Set(group.map((card) => card.id));
      remaining = remaining.filter((card) => !used.has(card.id));
    }
  }
  for (const suit of suits) {
    while (true) {
      let best = [];
      for (let start = 0; start < 13; start++) {
        const run = [];
        for (let value = start; value <= 13; value++) {
          const card = remaining.find((item) => item.suit === suit && item.rank === ranks[value % 13] && !run.includes(item));
          if (!card) break;
          run.push(card);
        }
        if (run.length >= 3 && run.length > best.length) best = run;
      }
      if (!best.length) break;
      result.push(...best);
      const used = new Set(best.map((card) => card.id));
      remaining = remaining.filter((card) => !used.has(card.id));
    }
  }
  return [...result, ...remaining.filter((card) => card.rank !== 'Joker').sort(compare), ...remaining.filter((card) => card.rank === 'Joker').sort(compare)].map((card) => card.id);
}
export function validHandDrag(data, source, game, playerId, { privateOrder = false } = {}) {
  const ids = data?.cardIds ?? [data?.cardId];
  const current = data?.revision === game.revision || Number.isSafeInteger(data?.turnRevision) && data.turnRevision === game.turnRevision && Number.isSafeInteger(data.revision) && data.revision >= 0 && data.revision <= game.revision;
  return !!data && data.cardId === source && data.playerId === playerId && data.roundId === game.roundId && (privateOrder || current) && Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.includes(source) && ids.every((id) => game.hand.some((card) => card.id === id));
}
export function readOrder(storage, key) {
  try { const value = JSON.parse(storage.getItem(key)); return Array.isArray(value) ? value : []; } catch { return []; }
}
