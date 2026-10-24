import { allTurns } from './turns.js';
const check = (condition) => { if (!condition) throw new Error('Coup invalide'); };
export function validPosition(position) {
  return position && Number.isFinite(position.x) && Number.isFinite(position.y)
    && position.x >= 0 && position.x <= 1 && position.y >= 0 && position.y <= 1;
}
// Layout is public but independent of gameplay revision. Only the owner can move it.
export function moveGroup(game, playerId, payload) {
  check(game && Object.hasOwn(game.hands, playerId) && validPosition(payload?.position));
  const group = game.laid[playerId].find((item) => item.id === payload.groupId)
    ?? allTurns(game)[playerId]?.staged.find((item) => item.id === payload.groupId);
  check(group);
  game.groupPositions ??= {};
  game.groupPositions[group.id] = { x: payload.position.x, y: payload.position.y };
  game.layoutRevision = (game.layoutRevision ?? 0) + 1;
}
