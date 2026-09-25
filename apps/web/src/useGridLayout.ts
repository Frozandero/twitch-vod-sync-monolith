import { useLayoutEffect, useRef, useState } from 'react';
import { gridLayout } from './gridLayout';

export function useGridLayout(count: number) {
  const grid = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, minimum: 402, gap: 6 });
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      const width = node.clientWidth;
      const minimum = parseFloat(style.getPropertyValue('--player-min-width')) || 402;
      const gap = parseFloat(style.columnGap) || 0;
      setSize((previous) =>
        previous.width === width && previous.minimum === minimum && previous.gap === gap
          ? previous
          : { width, minimum, gap },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [count]);
  return { grid, ...gridLayout(count, size.width, size.minimum, size.gap) };
}
