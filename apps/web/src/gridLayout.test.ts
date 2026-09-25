import { describe, expect, it } from 'vitest';
import { gridLayout } from './gridLayout';

function rowSizes(count: number, width = 1904, minimum = 530) {
  const layout = gridLayout(count, width, minimum);
  return Array.from(
    { length: layout.rows },
    (_, index) => layout.positions.filter((position) => position.row === index + 1).length,
  );
}
describe('automatic player grid', () => {
  it('groups four desktop recordings into two full rows', () => {
    expect(rowSizes(4)).toEqual([2, 2]);
  });
  it('preserves one-row layouts for up to three recordings when space permits', () => {
    for (const count of [1, 2, 3]) expect(rowSizes(count)).toEqual([count]);
  });
  it('balances incomplete rows instead of leaving an isolated last recording', () => {
    expect(rowSizes(5)).toEqual([3, 2]);
    expect(rowSizes(6)).toEqual([3, 3]);
    expect(rowSizes(7)).toEqual([3, 2, 2]);
    expect(rowSizes(8)).toEqual([3, 3, 2]);
  });
  it('stacks players on small screens and respects the minimum width on tablets', () => {
    expect(rowSizes(4, 380, 402)).toEqual([1, 1, 1, 1]);
    expect(rowSizes(5, 1008, 402)).toEqual([2, 2, 1]);
    expect(rowSizes(4, 790, 402)).toEqual([1, 1, 1, 1]);
  });
  it('handles an empty or not-yet-measured grid', () => {
    expect(gridLayout(0, 0).positions).toEqual([]);
    expect(rowSizes(4, 0)).toEqual([1, 1, 1, 1]);
  });
  it('fills every row once without overlap or gaps for all supported session sizes', () => {
    for (let count = 1; count <= 100; count++) {
      for (const width of [380, 820, 1400, 1920, 2560, 3840]) {
        const layout = gridLayout(count, width);
        expect(layout.positions).toHaveLength(count);
        for (let row = 1; row <= layout.rows; row++) {
          const positions = layout.positions.filter((position) => position.row === row);
          let next = 1;
          for (const position of positions) {
            expect(position.column).toBe(next);
            expect(Number.isInteger(position.span)).toBe(true);
            next += position.span;
          }
          expect(next).toBe(layout.tracks + 1);
        }
      }
    }
  });
});
