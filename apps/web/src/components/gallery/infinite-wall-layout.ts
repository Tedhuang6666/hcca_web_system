export type WallCamera = { x: number; y: number; scale: number };
export type WallSize = { width: number; height: number };
export const MIN_WALL_SCALE = 0.65;
export const MAX_WALL_SCALE = 3;

function positiveModulo(value: number, count: number) {
  return ((value % count) + count) % count;
}

/** Recycle the surrounding grid, including repeated photos when the collection is small. */
export function wallLayout(ratios: number[], viewport: WallSize, camera: WallCamera) {
  if (!ratios.length) return { tiles: [] };
  const cellWidth = viewport.width < 768 ? Math.max(190, viewport.width * 0.66) : viewport.width * 0.3;
  const cellHeight = Math.max(180, viewport.height * 0.36);
  const firstColumn = Math.floor(-camera.x / (cellWidth * camera.scale)) - 1;
  const firstRow = Math.floor(-camera.y / (cellHeight * camera.scale)) - 1;
  const columns = Math.ceil(viewport.width / (cellWidth * camera.scale)) + 3;
  const rows = Math.ceil(viewport.height / (cellHeight * camera.scale)) + 3;
  const tiles = Array.from({ length: columns * rows }, (_, slot) => {
    const column = firstColumn + slot % columns;
    const row = firstRow + Math.floor(slot / columns);
    const photoIndex = positiveModulo(column + row * 7, ratios.length);
    const size = [1.03, 0.78, 0.94, 0.86, 1.02][positiveModulo(column + row * 3, 5)];
    const width = Math.min(cellWidth * size - 32, (cellHeight - 80) * ratios[photoIndex]);
    const height = width / ratios[photoIndex];
    return {
      key: row + ":" + column, photoIndex,
      x: column * cellWidth + (cellWidth - width - 24) / 2,
      y: row * cellHeight + (cellHeight - height - 52) / 2,
      width: width + 24, height: height + 52,
    };
  });
  return { tiles };
}

export function constrainCamera(camera: WallCamera): WallCamera {
  return { ...camera, scale: Math.max(MIN_WALL_SCALE, Math.min(MAX_WALL_SCALE, camera.scale)) };
}

export function zoomCamera(camera: WallCamera, factor: number, anchor: { x: number; y: number }): WallCamera {
  const scale = constrainCamera({ ...camera, scale: camera.scale * factor }).scale;
  const ratio = scale / camera.scale;
  return { scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
}
