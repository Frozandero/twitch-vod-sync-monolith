import { useLayoutEffect, useRef } from 'react';

// Choose the largest equal 16:9 videos that fit, including Twitch's 400×300 minimum.
// If the minimum sizes cannot all fit, keep their proportions and scroll the workspace.
function playerWidth(count: number, width: number, height: number, chrome: number) {
  const gap = 3;
  const maxColumns = Math.min(count, Math.max(1, Math.floor((width + gap) / (402 + gap))));
  let best = 0;
  for (let columns = 1; columns <= maxColumns; columns++) {
    const rows = Math.ceil(count / columns);
    const videoHeight = (height - (rows - 1) * gap) / rows - chrome;
    if (videoHeight < 300) continue;
    const candidate = Math.min((width - (columns - 1) * gap) / columns, videoHeight * (16 / 9) + 2);
    if (candidate >= 402) best = Math.max(best, candidate);
  }
  return best || (width - (maxColumns - 1) * gap) / maxColumns;
}

export function useWatchLayout(enabled: boolean, count: number) {
  const workspace = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const host = workspace.current;
    const grid = host?.querySelector<HTMLElement>('.player-grid');
    if (!enabled || !host || !grid || !count) return;
    const fit = () => {
      const padding = getComputedStyle(host);
      const width =
        host.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
      const height =
        host.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
      const heading = grid.querySelector('.player-heading')?.getBoundingClientRect().height ?? 36;
      const error = Math.max(
        0,
        ...Array.from(
          grid.querySelectorAll('.player-error'),
          (node) => node.getBoundingClientRect().height,
        ),
      );
      const size = `${Math.floor(playerWidth(count, width, height, heading + error + 2) * 100) / 100}px`;
      if (grid.style.getPropertyValue('--watch-player-width') !== size)
        grid.style.setProperty('--watch-player-width', size);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    observer.observe(grid);
    return () => {
      observer.disconnect();
      grid.style.removeProperty('--watch-player-width');
    };
  }, [enabled, count]);
  return workspace;
}
