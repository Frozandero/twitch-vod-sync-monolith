import { describe, expect, it } from 'vitest';
import { startMs, vodKey, type Vod } from '@vodsync/core';
import { anyPlaying, startDecision, startProgress } from './playbackStart';
import type { PlaybackSnapshot } from './playback';

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
const other = { ...vod, id: '2' };
const moment = startMs(vod) + 100000;
const running: PlaybackSnapshot = {
  status: 'ready',
  seconds: 100,
  paused: false,
  startedSerial: 4,
};
const paused: PlaybackSnapshot = { status: 'ready', seconds: 100, paused: true };
const progress = (second: PlaybackSnapshot, serial = 4) =>
  startProgress([vod, other], moment, serial, { [vodKey(vod)]: running, [vodKey(other)]: second });

describe('confirmed group startup', () => {
  it('does not report success when only the source starts', () => {
    expect(progress(paused)).toMatchObject({
      total: 2,
      started: 1,
      complete: false,
      waiting: [other],
    });
  });
  it('requires PLAYING acknowledgment, not merely an unpaused buffering player', () => {
    expect(progress({ ...paused, paused: false }).complete).toBe(false);
    expect(progress(running).complete).toBe(true);
  });
  it('rejects acknowledgment from an older start request', () => {
    expect(progress(running, 5)).toMatchObject({ started: 0, complete: false });
  });
  it('rejects a player that pauses again before the rest start', () => {
    expect(progress({ ...running, paused: true }).complete).toBe(false);
  });
  it('accepts very short remaining footage that played and ended before the next poll', () => {
    expect(progress({ ...running, status: 'ended', paused: true }).complete).toBe(true);
    expect(progress({ ...paused, status: 'ended' }).complete).toBe(false);
    expect(progress({ ...running, status: 'changed' }).complete).toBe(false);
  });
  it('excludes before-start and exact-end recordings, and releases after removing a failed target', () => {
    const before = { ...other, startedAt: '2026-09-25T01:00:00Z' };
    const ended = { ...vod, id: '3', durationSeconds: 100 };
    expect(
      startProgress([vod, before, ended], moment, 4, { [vodKey(vod)]: running }),
    ).toMatchObject({ total: 1, complete: true });
    expect(startProgress([vod], moment, 4, { [vodKey(vod)]: running }).complete).toBe(true);
  });
  it('waits for normal SDK delay, then retries a silently ignored play request', () => {
    expect(startDecision(progress(paused), 2499, 0)).toBe('wait');
    expect(startDecision(progress(paused), 2500, 0)).toBe('retry');
    expect(startDecision(progress(paused), 2500, 1)).toBe('retry');
    expect(startDecision(progress(paused), 2500, 2)).toBe('failed');
  });
  it('gives actual buffering/loading more time without accepting it as successful playback', () => {
    for (const state of [
      { ...paused, paused: false },
      { ...paused, status: 'loading' as const },
    ]) {
      expect(startDecision(progress(state), 9999, 0)).toBe('wait');
      expect(startDecision(progress(state), 10000, 0)).toBe('retry');
    }
  });
  it('handles explicit blocked playback immediately and still caps attempts', () => {
    const blocked = progress({ ...paused, playbackBlocked: true });
    expect(startDecision(blocked, 100, 0)).toBe('retry');
    expect(startDecision(blocked, 100, 2)).toBe('failed');
  });
  it('completes a successful or empty group regardless of elapsed timeout', () => {
    expect(startDecision(progress(running), 20000, 2)).toBe('complete');
    expect(startDecision(startProgress([], moment, 4, {}), 20000, 2)).toBe('complete');
  });
});

describe('timeline play/pause state', () => {
  it('shows pause when a target plays while the source is paused or ended', () => {
    for (const source of [paused, { ...paused, status: 'ended' as const }])
      expect(
        anyPlaying([vod, other], moment, { [vodKey(vod)]: source, [vodKey(other)]: running }),
      ).toBe(true);
  });
  it('ignores unavailable and out-of-range players and shows play when all are paused', () => {
    expect(anyPlaying([vod], moment, { [vodKey(vod)]: paused })).toBe(false);
    expect(anyPlaying([vod], moment, {})).toBe(false);
    expect(anyPlaying([vod], startMs(vod) + 600000, { [vodKey(vod)]: running })).toBe(false);
  });
});
