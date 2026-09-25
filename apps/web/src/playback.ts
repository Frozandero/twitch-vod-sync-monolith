import { formatGap, matchMoment, type Vod } from '@vodsync/core';
import type { SeekProgress } from './seekBarrier';
import { supportsPlayback } from './capabilities';

export type StopReason = 'ended' | 'changed';
export type PlaybackSnapshot = {
  status: 'loading' | 'ready' | 'before' | StopReason;
  seconds: number | null;
  paused: boolean;
  startedSerial?: number;
  playbackBlocked?: boolean;
  seek?: SeekProgress;
};

type GuardedPlayer = { getVideo(): string; getEnded(): boolean; pause(): void };

// A paused Twitch embed can still run its Up Next countdown. Detach it, and
// reject all further reads, before another VOD's clock can enter this session.
export function createVodGuard(
  id: string,
  player: GuardedPlayer,
  detach: () => void,
  onStop: (reason: StopReason) => void,
) {
  let stopped: StopReason | undefined;
  function stop(reason: StopReason) {
    if (stopped) return;
    stopped = reason;
    try {
      player.pause();
    } catch {
      // Detaching must still happen when the iframe no longer accepts commands.
    }
    try {
      detach();
    } finally {
      onStop(reason);
    }
  }
  function check() {
    if (stopped) return false;
    const actual = String(player.getVideo() || '').replace(/^v/, '');
    if (actual && actual !== id) {
      stop('changed');
      return false;
    }
    if (actual === id && player.getEnded()) {
      stop('ended');
      return false;
    }
    return actual === id;
  }
  return {
    check,
    ended: () =>
      stop(String(player.getVideo() || '').replace(/^v/, '') === id ? 'ended' : 'changed'),
    assertCurrent: () => {
      if (!check()) throw new Error('This Twitch recording is stopped or still loading.');
    },
  };
}

export function alignment(vod: Vod, moment: number, playback?: PlaybackSnapshot) {
  const match = matchMoment(vod, moment);
  if (match.state !== 'playing')
    return { state: match.state, label: match.state === 'before' ? 'Not started' : 'Finished' };
  if (!supportsPlayback(vod)) return { state: 'external', label: 'Link only' };
  if (playback?.status === 'changed') return { state: 'changed', label: 'Wrong VOD stopped' };
  if (playback?.status === 'ended') return { state: 'ended', label: 'Finished' };
  if (playback?.status !== 'ready' || playback.seconds === null)
    return { state: 'loading', label: 'Not verified' };
  const drift = playback.seconds - match.offsetSeconds;
  if (Math.abs(drift) <= 2) return { state: 'aligned', label: '' };
  return {
    state: 'drifted',
    label: `${formatGap(Math.abs(drift))} ${drift < 0 ? 'behind' : 'ahead'}`,
  };
}
