import { describe, expect, it } from 'vitest';
import { startMs, vodKey, type Vod } from '@vodsync/core';
import { createSeekPreparation, seekBarrier, seekPosition } from './seekBarrier';
import type { PlaybackSnapshot } from './playback';

describe('paused seek preparation', () => {
  it('does not accept an old buffer at the previous timestamp', () => {
    const seek = createSeekPreparation(4, 100, 600);
    expect(seek.sample(50, 30, true, 0).state).toBe('seeking');
    expect(seek.sample(50, 30, true, 10000).state).toBe('seeking');
  });
  it('waits for a fresh, stable buffer after the matching seek event despite a stale paused clock', () => {
    const seek = createSeekPreparation(4, 100, 600);
    seek.seeked(100);
    expect(seek.sample(50, 0, true, 0).state).toBe('buffering');
    expect(seek.sample(50, 2, true, 1000).state).toBe('buffering');
    expect(seek.sample(50, 2, true, 1499).state).toBe('buffering');
    expect(seek.sample(50, 2, true, 1500)).toEqual({ serial: 4, state: 'ready' });
  });
  it('can confirm the actual clock when SEEK has no usable payload', () => {
    const seek = createSeekPreparation(4, 100, 600);
    seek.sample(100, 2, true, 0);
    expect(seek.sample(100, 2, true, 500).state).toBe('ready');
  });
  it('resets readiness when the buffer empties or playback starts early', () => {
    const seek = createSeekPreparation(4, 100, 600);
    seek.sample(100, 2, true, 0);
    expect(seek.sample(100, 0, true, 500).state).toBe('buffering');
    seek.sample(100, 3, true, 1000);
    expect(seek.sample(100, 3, false, 1500).state).toBe('buffering');
    expect(seek.sample(100, 3, true, 2000).state).toBe('buffering');
    expect(seek.sample(100, 3, true, 2500).state).toBe('ready');
  });
  it('requires only the remaining footage when less than two seconds remain', () => {
    const seek = createSeekPreparation(4, 599, 600);
    seek.sample(599, 1, true, 0);
    expect(seek.sample(599, 1, true, 500).state).toBe('ready');
  });
  it('does not reuse an acknowledgment after a different seek', () => {
    const seek = createSeekPreparation(4, 100, 600);
    seek.seeked(100);
    seek.sample(50, 3, true, 0);
    seek.seeked(200);
    expect(seek.sample(50, 3, true, 500).state).toBe('seeking');
  });
  it('never treats missing, non-numeric, or infinite buffer data as ready', () => {
    const seek = createSeekPreparation(4, 100, 600);
    for (const buffer of [undefined, null, '20', NaN, Infinity, -1]) {
      seek.sample(100, buffer, true, 0);
      expect(seek.sample(100, buffer, true, 500).state).not.toBe('ready');
    }
  });
  it('validates seek event payloads, including the zero timestamp', () => {
    expect(seekPosition({ position: 0 })).toBe(0);
    expect(seekPosition({ position: 123.5 })).toBe(123.5);
    for (const event of [
      null,
      undefined,
      {},
      { position: '100' },
      { position: -1 },
      { position: NaN },
      { position: Infinity },
    ])
      expect(seekPosition(event)).toBeUndefined();
  });
});

const vod: Vod = {
  platform: 'twitch',
  id: '1',
  url: 'https://www.twitch.tv/videos/1',
  channel: 'one',
  title: 'one',
  startedAt: '2026-09-25T00:00:00Z',
  correctionSeconds: 0,
  durationSeconds: 600,
  provenance: 'twitch-public',
};
const ready: PlaybackSnapshot = {
  status: 'ready',
  seconds: 100,
  paused: true,
  seek: { serial: 4, state: 'ready' },
};
describe('shared seek barrier', () => {
  const other = { ...vod, id: '2' };
  const moment = startMs(vod) + 100000;
  it('waits for the slowest matching player', () => {
    const snapshots = { [vodKey(vod)]: ready };
    expect(seekBarrier([vod, other], moment, 4, snapshots)).toMatchObject({
      total: 2,
      ready: 1,
      complete: false,
    });
    expect(
      seekBarrier([vod, other], moment, 4, { ...snapshots, [vodKey(other)]: ready }).complete,
    ).toBe(true);
  });
  it('cannot release a new seek using an old command acknowledgment', () => {
    expect(seekBarrier([vod], moment, 5, { [vodKey(vod)]: ready }).complete).toBe(false);
  });
  it('excludes before-start and exact-end VODs from the wait', () => {
    const before = { ...other, startedAt: '2026-09-25T01:00:00Z' };
    const ended = { ...vod, id: '3', durationSeconds: 100 };
    expect(seekBarrier([vod, before, ended], moment, 4, { [vodKey(vod)]: ready })).toMatchObject({
      total: 1,
      ready: 1,
      complete: true,
    });
  });
  it('does not count an ended, switched, loading or still-playing embed as buffered', () => {
    for (const status of ['ended', 'changed', 'loading'] as const)
      expect(seekBarrier([vod], moment, 4, { [vodKey(vod)]: { ...ready, status } }).complete).toBe(
        false,
      );
    expect(
      seekBarrier([vod], moment, 4, { [vodKey(vod)]: { ...ready, paused: false } }).complete,
    ).toBe(false);
  });
  it('releases when the unready recording is removed and handles empty gaps', () => {
    expect(seekBarrier([vod], moment, 4, { [vodKey(vod)]: ready }).complete).toBe(true);
    expect(seekBarrier([vod], startMs(vod) + 600000, 4, {})).toMatchObject({
      total: 0,
      complete: true,
    });
  });
});
