export const WALL_COLUMNS = 5;
export const WALL_ROWS = 5;
export const WALL_TILE_COUNT = WALL_COLUMNS * WALL_ROWS;

export function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

/** Recycle a fixed pool of cells, retaining their position in the unbounded photo sequence. */
export function wallCell(slot: number, x: number, y: number, cellWidth: number, cellHeight: number, count: number) {
  const column = slot % WALL_COLUMNS;
  const row = Math.floor(slot / WALL_COLUMNS);
  const rawX = column * cellWidth + x;
  const rawY = row * cellHeight + y;
  const wrapX = Math.floor((rawX + cellWidth) / (cellWidth * WALL_COLUMNS));
  const wrapY = Math.floor((rawY + cellHeight) / (cellHeight * WALL_ROWS));
  return {
    x: rawX - wrapX * cellWidth * WALL_COLUMNS,
    y: rawY - wrapY * cellHeight * WALL_ROWS,
    photoIndex: positiveModulo(column - wrapX * WALL_COLUMNS
      + (row - wrapY * WALL_ROWS) * WALL_COLUMNS, count),
  };
}
