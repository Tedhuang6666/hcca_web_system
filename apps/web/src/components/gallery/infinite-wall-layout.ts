export type WallCamera = { x: number; y: number; scale: number };
export type WallSize = { width: number; height: number };

/** Each photo has one position; moving the camera never creates duplicate photos. */
export function wallLayout(ratios: number[], viewport: WallSize) {
  const cellWidth = viewport.width < 768 ? Math.min(280, viewport.width * 0.72) : Math.min(380, viewport.width * 0.31);
  const cellHeight = cellWidth * 0.88 + 48;
  const columns = Math.max(1, Math.min(ratios.length, 8, Math.ceil(Math.sqrt(ratios.length * 1.4))));
  const tiles = ratios.map((ratio, index) => {
    const width = Math.min(cellWidth - 48, (cellHeight - 96) * ratio);
    const height = width / ratio;
    return {
      x: 32 + index % columns * cellWidth + (cellWidth - width - 24) / 2,
      y: 32 + Math.floor(index / columns) * cellHeight + (cellHeight - height - 52) / 2,
      width: width + 24,
      height: height + 52,
    };
  });
  return { tiles, width: columns * cellWidth + 64, height: Math.ceil(ratios.length / columns) * cellHeight + 64 };
}

export function fitWall(wall: WallSize, viewport: WallSize): WallCamera {
  const scale = Math.min(1, viewport.width / wall.width, viewport.height / wall.height);
  return { x: (viewport.width - wall.width * scale) / 2, y: (viewport.height - wall.height * scale) / 2, scale };
}

export function constrainCamera(camera: WallCamera, wall: WallSize, viewport: WallSize): WallCamera {
  const scale = Math.max(fitWall(wall, viewport).scale * 0.75, Math.min(3, camera.scale));
  const width = wall.width * scale, height = wall.height * scale;
  return {
    scale,
    x: width <= viewport.width ? (viewport.width - width) / 2 : Math.max(viewport.width - width, Math.min(0, camera.x)),
    y: height <= viewport.height ? (viewport.height - height) / 2 : Math.max(viewport.height - height, Math.min(0, camera.y)),
  };
}

export function zoomCamera(camera: WallCamera, factor: number, anchor: { x: number; y: number }, wall: WallSize, viewport: WallSize): WallCamera {
  const scale = Math.max(fitWall(wall, viewport).scale * 0.75, Math.min(3, camera.scale * factor));
  const ratio = scale / camera.scale;
  return constrainCamera({ scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio }, wall, viewport);
}
