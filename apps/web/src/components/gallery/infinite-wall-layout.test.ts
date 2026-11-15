import { describe, expect, it } from "vitest";
import { constrainCamera, wallLayout, zoomCamera, MIN_WALL_SCALE, MAX_WALL_SCALE } from "./infinite-wall-layout";

describe("無邊照片牆", () => {
  it("repeats one or three photos across the full viewport at every allowed zoom", () => {
    for (const count of [1, 3]) for (const size of [{ width: 390, height: 550 }, { width: 1440, height: 700 }]) {
      for (const scale of [MIN_WALL_SCALE, 1, MAX_WALL_SCALE]) {
        const camera = { x: -1234567, y: 987654, scale };
        const { tiles } = wallLayout(Array(count).fill(1.5), size, camera);
        const visible = tiles.filter((tile) => tile.x * scale + camera.x < size.width && (tile.x + tile.width) * scale + camera.x > 0
          && tile.y * scale + camera.y < size.height && (tile.y + tile.height) * scale + camera.y > 0);
        expect(tiles.length).toBeLessThan(100);
        expect(visible.length).toBeGreaterThanOrEqual(1);
        expect(Math.min(...tiles.map((tile) => tile.x * scale + camera.x))).toBeLessThan(0);
        expect(Math.max(...tiles.map((tile) => (tile.x + tile.width) * scale + camera.x))).toBeGreaterThan(size.width);
        expect(Math.min(...tiles.map((tile) => tile.y * scale + camera.y))).toBeLessThan(0);
        expect(Math.max(...tiles.map((tile) => (tile.y + tile.height) * scale + camera.y))).toBeGreaterThan(size.height);
        expect(tiles.every((tile) => tile.photoIndex >= 0 && tile.photoIndex < count)).toBe(true);
      }
    }
  });

  it("reveals every real photo as the grid is dragged and keeps portrait frames within their cells", () => {
    const size = { width: 1440, height: 700 }, found = new Set<number>();
    for (let step = 0; step < 80; step++) {
      const { tiles } = wallLayout(Array.from({ length: 80 }, (_, index) => index % 2 ? 2 / 3 : 3 / 2), size, { x: -step * size.width * 0.3, y: 0, scale: 1 });
      for (const tile of tiles) { found.add(tile.photoIndex); expect(tile.height).toBeLessThan(size.height * 0.36); }
    }
    expect(found.size).toBe(80);
  });

  it("keeps the zoom anchor stationary and allows dragging beyond the original collection", () => {
    const camera = { x: -600, y: -400, scale: 1 }, anchor = { x: 200, y: 300 };
    const next = zoomCamera(camera, 1.5, anchor);
    expect((anchor.x - next.x) / next.scale).toBe((anchor.x - camera.x) / camera.scale);
    expect((anchor.y - next.y) / next.scale).toBe((anchor.y - camera.y) / camera.scale);
    expect(constrainCamera({ x: -1e9, y: 1e9, scale: 1 })).toEqual({ x: -1e9, y: 1e9, scale: 1 });
    expect(zoomCamera(camera, 100, anchor).scale).toBe(MAX_WALL_SCALE);
    expect(zoomCamera(camera, 0.0001, anchor).scale).toBe(MIN_WALL_SCALE);
  });
});
