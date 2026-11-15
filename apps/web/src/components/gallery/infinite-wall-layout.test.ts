import { describe, expect, it } from "vitest";
import { constrainCamera, fitWall, wallLayout, zoomCamera } from "./infinite-wall-layout";

describe("照片牆視角", () => {
  it("positions every photo once, keeps portrait and landscape frames apart and fits the entire wall", () => {
    for (const count of [1, 3, 80, 1000]) {
      for (const viewport of [{ width: 390, height: 550 }, { width: 1440, height: 700 }]) {
        const wall = wallLayout(Array.from({ length: count }, (_, index) => index % 2 ? 2 / 3 : 3 / 2), viewport);
        expect(wall.tiles).toHaveLength(count);
        expect(new Set(wall.tiles.map((tile) => tile.x + ":" + tile.y)).size).toBe(count);
        const camera = fitWall(wall, viewport);
        for (const tile of wall.tiles) {
          expect(tile.x * camera.scale + camera.x).toBeGreaterThanOrEqual(0);
          expect(tile.y * camera.scale + camera.y).toBeGreaterThanOrEqual(0);
          expect((tile.x + tile.width) * camera.scale + camera.x).toBeLessThanOrEqual(viewport.width);
          expect((tile.y + tile.height) * camera.scale + camera.y).toBeLessThanOrEqual(viewport.height);
        }
      }
    }
  });

  it("keeps the zoom anchor stationary until the camera reaches an edge", () => {
    const wall = { width: 3000, height: 2000 }, viewport = { width: 1000, height: 700 };
    const camera = { x: -600, y: -400, scale: 1 }, anchor = { x: 200, y: 300 };
    const next = zoomCamera(camera, 1.5, anchor, wall, viewport);
    expect((anchor.x - next.x) / next.scale).toBe((anchor.x - camera.x) / camera.scale);
    expect((anchor.y - next.y) / next.scale).toBe((anchor.y - camera.y) / camera.scale);
  });

  it("prevents losing the wall after long drags and limits extreme zoom", () => {
    const wall = { width: 3000, height: 2000 }, viewport = { width: 1000, height: 700 };
    expect(constrainCamera({ x: -1e9, y: 1e9, scale: 1 }, wall, viewport)).toEqual({ x: -2000, y: 0, scale: 1 });
    expect(zoomCamera({ x: 0, y: 0, scale: 1 }, 100, { x: 0, y: 0 }, wall, viewport).scale).toBe(3);
    expect(zoomCamera({ x: 0, y: 0, scale: 1 }, 0.0001, { x: 0, y: 0 }, wall, viewport).scale).toBeGreaterThan(0);
  });
});
