import { matchMoment, vodKey, type Vod } from '@vodsync/core';
import type { PlaybackSnapshot } from './playback';
import { supportsPlayback } from './capabilities';

export type SeekState = 'seeking' | 'buffering' | 'ready';
export type SeekProgress = { serial: number; state: SeekState };

// SEEK's position is observed in Twitch's public SDK event payload. Validate it;
// missing payloads can still be confirmed through the SDK's actual clock.
export function seekPosition(event: unknown): number | undefined {
  if (!event || typeof event !== 'object' || !('position' in event)) return;
  const value = event.position;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
}

export function createSeekPreparation(serial: number, target: number, duration: number) {
  let acknowledged = false;
  let stableSince: number | undefined;
  const requiredBuffer = Math.min(2, duration - target);
  return {
    serial,
    target,
    seeked(position: number) {
      acknowledged = Math.abs(position - target) <= 0.5;
      stableSince = undefined;
      return acknowledged;
    },
    sample(seconds: number, bufferSeconds: unknown, paused: boolean, now: number): SeekProgress {
      const atTarget =
        acknowledged || (Number.isFinite(seconds) && Math.abs(seconds - target) <= 0.5);
      const buffered =
        typeof bufferSeconds === 'number' &&
        Number.isFinite(bufferSeconds) &&
        bufferSeconds >= requiredBuffer &&
        requiredBuffer > 0;
      if (!atTarget || !buffered || !paused) stableSince = undefined;
      else stableSince ??= now;
      return {
        serial,
        state:
          stableSince !== undefined && now - stableSince >= 500
            ? 'ready'
            : atTarget
              ? 'buffering'
              : 'seeking',
      };
    },
  };
}

export function seekBarrier(
  vods: Vod[],
  moment: number,
  serial: number,
  snapshots: Record<string, PlaybackSnapshot>,
) {
  const required = vods.filter(
    (vod) => supportsPlayback(vod) && matchMoment(vod, moment).state === 'playing',
  );
  const waiting = required.filter((vod) => {
    const snapshot = snapshots[vodKey(vod)];
    return (
      snapshot?.status !== 'ready' ||
      !snapshot.paused ||
      snapshot.seek?.serial !== serial ||
      snapshot.seek.state !== 'ready'
    );
  });
  return {
    total: required.length,
    ready: required.length - waiting.length,
    waiting,
    complete: !waiting.length,
  };
}
