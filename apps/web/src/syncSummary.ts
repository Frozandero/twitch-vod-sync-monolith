import { matchMoment, vodKey, type Vod } from '@vodsync/core';
import { supportsPlayback } from './capabilities';
import type { PlaybackSnapshot } from './playback';

// Seconds the player's verified clock is ahead (+) or behind (−) the selected moment.
export function driftSeconds(vod: Vod, moment: number, playback?: PlaybackSnapshot) {
  const match = matchMoment(vod, moment);
  if (match.state !== 'playing' || !supportsPlayback(vod)) return null;
  if (playback?.status !== 'ready' || playback.seconds === null) return null;
  return playback.seconds - match.offsetSeconds;
}

export const DRIFT_LIMIT = 2;

export function syncSummary(
  vods: Vod[],
  moment: number,
  states: Record<string, PlaybackSnapshot>,
  leaderKey: string,
) {
  let inSync = 0;
  let unverified = 0;
  const drifting: { vod: Vod; drift: number }[] = [];
  for (const vod of vods) {
    if (matchMoment(vod, moment).state !== 'playing' || !supportsPlayback(vod)) continue;
    const drift = driftSeconds(vod, moment, states[vodKey(vod)]);
    if (drift === null) unverified++;
    else if (vodKey(vod) !== leaderKey && Math.abs(drift) > DRIFT_LIMIT)
      drifting.push({ vod, drift });
    else inSync++;
  }
  return { inSync, unverified, drifting };
}
