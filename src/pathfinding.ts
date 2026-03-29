/** A* pathfinding and reachable-tile computation for grid-based movement. */

import { TileMap } from "./tilemap";

export interface GridPos {
  col: number;
  row: number;
}

// ── Reachable tiles (BFS within movement range) ────────────────────────────

/**
 * Returns all tiles reachable from `start` within `maxSteps` moves.
 * Movement is 4-directional (no diagonals). Solid tiles block movement.
 */
export function getReachableTiles(
  map: TileMap,
  start: GridPos,
  maxSteps: number,
): Map<string, number> {
  const key = (c: number, r: number) => `${c},${r}`;
  const reachable = new Map<string, number>(); // key -> cost
  const queue: { col: number; row: number; cost: number }[] = [
    { col: start.col, row: start.row, cost: 0 },
  ];
  reachable.set(key(start.col, start.row), 0);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const d of dirs) {
      const nc = cur.col + d.dc;
      const nr = cur.row + d.dr;
      const nCost = cur.cost + 1;
      if (nCost > maxSteps) continue;
      if (map.isSolid(nc, nr)) continue;
      const k = key(nc, nr);
      if (reachable.has(k) && reachable.get(k)! <= nCost) continue;
      reachable.set(k, nCost);
      queue.push({ col: nc, row: nr, cost: nCost });
    }
  }
  return reachable;
}

// ── A* pathfinding ─────────────────────────────────────────────────────────

interface AStarNode {
  col: number;
  row: number;
  g: number; // cost from start
  f: number; // g + heuristic
  parent: AStarNode | null;
}

/**
 * A* pathfinding from `start` to `goal` on a tile grid.
 * Returns the path as an array of grid positions (start excluded, goal included),
 * or null if no path exists. Respects `maxSteps` movement budget.
 */
export function findPath(
  map: TileMap,
  start: GridPos,
  goal: GridPos,
  maxSteps: number,
): GridPos[] | null {
  if (map.isSolid(goal.col, goal.row)) return null;
  if (start.col === goal.col && start.row === goal.row) return [];

  const key = (c: number, r: number) => `${c},${r}`;
  const heuristic = (c: number, r: number) =>
    Math.abs(c - goal.col) + Math.abs(r - goal.row);

  const open: AStarNode[] = [
    { col: start.col, row: start.row, g: 0, f: heuristic(start.col, start.row), parent: null },
  ];
  const closed = new Set<string>();

  while (open.length > 0) {
    // Find lowest f-cost node
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open[bestIdx];
    open.splice(bestIdx, 1);

    if (cur.col === goal.col && cur.row === goal.row) {
      // Reconstruct path
      const path: GridPos[] = [];
      let node: AStarNode | null = cur;
      while (node && !(node.col === start.col && node.row === start.row)) {
        path.push({ col: node.col, row: node.row });
        node = node.parent;
      }
      return path.reverse();
    }

    const k = key(cur.col, cur.row);
    if (closed.has(k)) continue;
    closed.add(k);

    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];

    for (const d of dirs) {
      const nc = cur.col + d.dc;
      const nr = cur.row + d.dr;
      const ng = cur.g + 1;
      if (ng > maxSteps) continue;
      if (map.isSolid(nc, nr)) continue;
      if (closed.has(key(nc, nr))) continue;

      const nf = ng + heuristic(nc, nr);
      // Check if already in open with better cost
      const existing = open.find((n) => n.col === nc && n.row === nr);
      if (existing && existing.g <= ng) continue;

      open.push({ col: nc, row: nr, g: ng, f: nf, parent: cur });
    }
  }

  return null; // No path found
}
