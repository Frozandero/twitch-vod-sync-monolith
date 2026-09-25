import { describe, expect, it } from 'vitest';
import { decodeSession, encodeSession, momentAt, vodKey, type Vod } from '@vodsync/core';
import { alignment } from './playback';
import { seekBarrier } from './seekBarrier';
import { anyPlaying, startProgress } from './playbackStart';

const twitch: Vod = {
  platform: 'twitch',
  id: '123',
  url: 'https://www.twitch.tv/videos/123',
  channel: 'one',
  title: 'one',
  startedAt: '2026-09-25T00:00:00Z',
  durationSeconds: 600,
  correctionSeconds: 0,
  provenance: 'twitch-public',
};
const kick: Vod = {
  ...twitch,
  platform: 'kick',
  id: '01a0cb24-ca08-7953-9e4a-ae201b03b8ef',
  url: 'https://kick.com/aikobliss/videos/01a0cb24-ca08-7953-9e4a-ae201b03b8ef',
  provenance: 'kick-public',
};
const moment = momentAt(twitch, 100);
describe('mixed provider sessions', () => {
  it('waits for Twitch buffering without waiting for external Kick playback', () => {
    expect(seekBarrier([twitch, kick], moment, 4, {})).toMatchObject({ total: 1, complete: false });
    expect(
      seekBarrier([twitch, kick], moment, 4, {
        [vodKey(twitch)]: {
          status: 'ready',
          seconds: 100,
          paused: true,
          seek: { serial: 4, state: 'ready' },
        },
      }),
    ).toMatchObject({ total: 1, complete: true });
    expect(seekBarrier([kick], moment, 4, {})).toMatchObject({ total: 0, complete: true });
  });
  it('confirms only supported players and never pretends Kick is playing', () => {
    const running = { status: 'ready' as const, seconds: 100, paused: false, startedSerial: 4 };
    expect(startProgress([twitch, kick], moment, 4, { [vodKey(twitch)]: running })).toMatchObject({
      total: 1,
      complete: true,
    });
    expect(anyPlaying([kick], moment, { [vodKey(kick)]: running })).toBe(false);
    expect(alignment(kick, moment, running)).toEqual({ state: 'external', label: 'Link only' });
    expect(alignment(kick, momentAt(kick, 0) - 1000).state).toBe('before');
    expect(alignment(kick, momentAt(kick, 0) + 600000).state).toBe('ended');
  });
  it('round-trips a mixed session with a Kick source and keeps provider URLs', () => {
    const session = {
      version: 2 as const,
      vods: [kick, twitch],
      leaderKey: vodKey(kick),
      momentMs: moment,
      view: 'grid' as const,
    };
    const restored = decodeSession(encodeSession(session));
    expect(restored.vods.map(vodKey)).toEqual([vodKey(kick), vodKey(twitch)]);
    expect(restored.leaderKey).toBe(vodKey(kick));
    expect(restored.vods[0].url).toBe(kick.url);
  });
});
