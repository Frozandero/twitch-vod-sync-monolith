import { startMs, timelineBounds, type Vod } from '@vodsync/core';

export type Range = { min: number; max: number };

const MINUTE = 60000;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MINUTE);

// The span every recording covers, or undefined when no moment is shared by all.
export function overlapRange(vods: Vod[]): Range | undefined {
  if (vods.length < 2) return;
  const min = Math.max(...vods.map(startMs));
  const max = Math.min(...vods.map((vod) => startMs(vod) + vod.durationSeconds * 1000));
  return max > min ? { min, max } : undefined;
}

export function viewRange(vods: Vod[], zoom: 'all' | 'overlap'): Range {
  return (zoom === 'overlap' && overlapRange(vods)) || timelineBounds(vods);
}

// Round-numbered ruler ticks inside the range, roughly `target` of them.
export function rulerTicks(range: Range, target = 6, offsetMs = 0): number[] {
  const span = range.max - range.min;
  if (!(span > 0)) return [];
  const step = STEPS.find((s) => span / s <= target) ?? STEPS[STEPS.length - 1];
  // Align ticks to the displayed zone so labels land on round local times too.
  const first = Math.ceil((range.min + offsetMs) / step) * step - offsetMs;
  const ticks: number[] = [];
  for (let t = first; t <= range.max; t += step) ticks.push(t);
  return ticks;
}

export const percentOf = (range: Range, ms: number) =>
  ((ms - range.min) / (range.max - range.min)) * 100;
