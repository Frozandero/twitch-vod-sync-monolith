import { useLayoutEffect, useRef, useState } from 'react';

// Locate the last header in the first row without changing the grid or moving iframes.
export function useGridColumns(count: number) {
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const measure = () => {
      const tracks = getComputedStyle(node).gridTemplateColumns.split(' ');
      setColumns(Math.max(1, tracks.filter((track) => parseFloat(track) > 0).length));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [count]);
  return { grid, columns };
}
