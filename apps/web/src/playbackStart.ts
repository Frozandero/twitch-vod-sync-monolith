import { matchMoment, vodKey, type Vod } from '@vodsync/core';
import type { PlaybackSnapshot } from './playback';

export function startProgress(
  vods: Vod[],
  moment: number,
  serial: number,
  snapshots: Record<string, PlaybackSnapshot>,
) {
  const required = vods.filter((vod) => matchMoment(vod, moment).state === 'playing');
  const waiting = required.filter((vod) => {
    const state = snapshots[vodKey(vod)];
    return !(
      state?.startedSerial === serial &&
      ((state.status === 'ready' && !state.paused) || state.status === 'ended')
    );
  });
  return {
    total: required.length,
    started: required.length - waiting.length,
    waiting,
    complete: !waiting.length,
    blocked: waiting.some((vod) => snapshots[vodKey(vod)]?.playbackBlocked),
    loading: waiting.some((vod) => {
      const state = snapshots[vodKey(vod)];
      return !state || state.status === 'loading' || !state.paused;
    }),
  };
}

export function startDecision(
  progress: ReturnType<typeof startProgress>,
  elapsedMs: number,
  attempt: number,
) {
  if (progress.complete) return 'complete';
  // Give genuinely buffering players longer; a silent, paused player missed play().
  if (!progress.blocked && elapsedMs < (progress.loading ? 10000 : 2500)) return 'wait';
  return attempt < 2 ? 'retry' : 'failed';
}

export function anyPlaying(
  vods: Vod[],
  moment: number,
  snapshots: Record<string, PlaybackSnapshot>,
) {
  return vods.some((vod) => {
    const state = snapshots[vodKey(vod)];
    return (
      matchMoment(vod, moment).state === 'playing' && state?.status === 'ready' && !state.paused
    );
  });
}
