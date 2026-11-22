import { describe, expect, it } from "vitest";
import { WALL_COLUMNS, WALL_ROWS, WALL_TILE_COUNT, wallCell } from "./infinite-wall-layout";

describe("無限攝影牆循環座標", () => {
  it("keeps a bounded pool on the surrounding grid after arbitrarily long drags in every direction", () => {
    for (const x of [-1e9, -12501, -2500, -0.5, 0, 2499, 93247, 1e9]) {
      for (const y of [-1e9, -5201, 0, 7321, 1e9]) {
        const cells = Array.from({ length: WALL_TILE_COUNT }, (_, slot) => wallCell(slot, x, y, 400, 300, 73));
        for (const cell of cells) {
          expect(cell.x).toBeGreaterThanOrEqual(-400);
          expect(cell.x).toBeLessThan(400 * (WALL_COLUMNS - 1));
          expect(cell.y).toBeGreaterThanOrEqual(-300);
          expect(cell.y).toBeLessThan(300 * (WALL_ROWS - 1));
          expect(cell.photoIndex).toBeGreaterThanOrEqual(0);
          expect(cell.photoIndex).toBeLessThan(73);
        }
        expect(new Set(cells.map((cell) => cell.x + ":" + cell.y)).size).toBe(WALL_TILE_COUNT);
      }
    }
  });
  it("reuses the same visible geometry while revealing the next photos after a complete wrap", () => {
    const first = wallCell(7, 100, 100, 400, 300, 73);
    const next = wallCell(7, 100 - 400 * WALL_COLUMNS, 100, 400, 300, 73);
    expect(next.x).toBe(first.x);
    expect(next.y).toBe(first.y);
    expect(next.photoIndex).toBe(first.photoIndex + WALL_COLUMNS);
  });
  it("makes every real photo discoverable even when the album exceeds the recycled pool", () => {
    const found = new Set<number>();
    for (let step = 0; step < 80; step++) {
      for (let slot = 0; slot < WALL_TILE_COUNT; slot++) found.add(wallCell(slot, -step * 400, 0, 400, 300, 80).photoIndex);
    }
    expect(found.size).toBe(80);
  });
  it("supports a single photo without inventing additional image identities", () => {
    for (let slot = 0; slot < WALL_TILE_COUNT; slot++) expect(wallCell(slot, -8372, 19712, 400, 300, 1).photoIndex).toBe(0);
  });
});
