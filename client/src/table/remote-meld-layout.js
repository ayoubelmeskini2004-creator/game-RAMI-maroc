// Project stored positions into a readable spectator view without changing them.
// Keep each anchor where possible; only move a colliding group down, never shrink cards.
export function remoteMeldLayout(groups, width, anchorHeight = 240, gap = 10) {
  const placed = [];
  const positions = {};
  for (const { id, position, width: groupWidth, height } of groups) {
    const x = Math.max(0, Math.min(1, position.x)) * Math.max(0, width - groupWidth);
    let y = Math.max(0, Math.min(1, position.y)) * Math.max(0, anchorHeight - height);
    for (;;) {
      const collisions = placed.filter(box => x < box.x + box.width + gap
        && x + groupWidth + gap > box.x && y < box.y + box.height + gap && y + height + gap > box.y);
      if (!collisions.length) break;
      y = Math.max(...collisions.map(box => box.y + box.height + gap));
    }
    positions[id] = { left: x, top: y };
    placed.push({ x, y, width: groupWidth, height });
  }
  return { positions, height: Math.max(anchorHeight, ...placed.map(box => box.y + box.height + gap)) };
}
