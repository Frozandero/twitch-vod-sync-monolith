export type GridPosition = { row: number; column: number; span: number };

// Balance rows by recording count while respecting the existing player minimum.
// Fractional tracks let short rows fill the width without moving any media nodes.
export function gridLayout(count: number, width: number, minimumWidth = 402, gap = 6) {
  const capacity = Math.max(1, Math.floor((width + gap) / (minimumWidth + gap)));
  const rows = Math.max(1, Math.ceil(count / capacity), Math.floor(Math.sqrt(count)));
  const columns = Math.max(1, Math.ceil(count / rows));
  const shortRow = Math.floor(count / rows);
  const tracks = shortRow > 0 && shortRow !== columns ? columns * shortRow : columns;
  const positions: GridPosition[] = [];
  let remaining = count;
  for (let row = 1; row <= rows; row++) {
    const size = Math.ceil(remaining / (rows - row + 1));
    const span = tracks / size;
    for (let column = 0; column < size; column++)
      positions.push({ row, column: column * span + 1, span });
    remaining -= size;
  }
  return { rows, columns, tracks, positions };
}
