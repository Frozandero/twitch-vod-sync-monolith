import { describe, expect, it, vi } from 'vitest';
import { startMs, type Vod } from '@vodsync/core';
import { alignment, createVodGuard } from './playback';

const vod: Vod = {
  id: '2882233662',
  platform: 'twitch',
  url: 'https://www.twitch.tv/videos/2882233662',
  startedAt: '2026-09-23T21:41:28Z',
  durationSeconds: 33305,
  correctionSeconds: 0,
  title: 'Regression recording',
  channel: 'xQc',
  provenance: 'twitch-public',
};
function setup() {
  const player = { getVideo: vi.fn(() => vod.id), getEnded: vi.fn(() => false), pause: vi.fn() };
  const detach = vi.fn(),
    stopped = vi.fn();
  return { player, detach, stopped, guard: createVodGuard(vod.id, player, detach, stopped) };
}
describe('Twitch VOD identity and end guard', () => {
  it('accepts the requested recording with either SDK ID format', () => {
    const { player, guard, detach } = setup();
    expect(guard.check()).toBe(true);
    player.getVideo.mockReturnValue(`v${vod.id}`);
    expect(guard.check()).toBe(true);
    expect(detach).not.toHaveBeenCalled();
  });
  it('does not treat a loading empty ID as another recording', () => {
    const { player, guard, detach } = setup();
    player.getVideo.mockReturnValue('');
    expect(guard.check()).toBe(false);
    expect(detach).not.toHaveBeenCalled();
    player.getVideo.mockReturnValue(vod.id);
    expect(guard.check()).toBe(true);
  });
  it('detaches on ENDED instead of leaving an Up Next countdown paused', () => {
    const { player, guard, detach, stopped } = setup();
    guard.ended();
    expect(player.pause).toHaveBeenCalledOnce();
    expect(detach).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalledWith('ended');
    expect(() => guard.assertCurrent()).toThrow();
  });
  it('also catches a missed end event through getEnded', () => {
    const { player, guard, detach, stopped } = setup();
    player.getEnded.mockReturnValue(true);
    expect(guard.check()).toBe(false);
    expect(detach).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalledWith('ended');
  });
  it('rejects the exact Up Next replacement observed in the supplied session', () => {
    const { player, guard, detach, stopped } = setup();
    player.getVideo.mockReturnValue('2882100152');
    const readClock = vi.fn();
    expect(() => {
      guard.assertCurrent();
      readClock();
    }).toThrow();
    expect(readClock).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalledWith('changed');
  });
  it('latches termination across repeated events and later ID changes', () => {
    const { player, guard, detach, stopped } = setup();
    guard.ended();
    player.getVideo.mockReturnValue('2882100152');
    guard.ended();
    guard.check();
    expect(detach).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalledExactlyOnceWith('ended');
  });
  it('still removes the frame if pause fails', () => {
    const { player, guard, detach, stopped } = setup();
    player.pause.mockImplementation(() => {
      throw new Error('Frame unavailable');
    });
    guard.ended();
    expect(detach).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalledWith('ended');
  });
});
describe('timeline playback alignment', () => {
  const moment = startMs(vod) + 3600000;
  it('does not call metadata overlap a verified sync without a player clock', () => {
    expect(alignment(vod, moment).state).toBe('loading');
    expect(alignment(vod, moment, { status: 'loading', seconds: null, paused: true }).label).toBe(
      'Not verified',
    );
  });
  it('shows a paused player behind the selected moment', () => {
    expect(alignment(vod, moment, { status: 'ready', seconds: 3558, paused: true })).toEqual({
      state: 'drifted',
      label: '0h 0m 42s behind',
    });
  });
  it('shows a player ahead instead of drawing it on the selected cursor', () => {
    expect(alignment(vod, moment, { status: 'ready', seconds: 3640, paused: false })).toEqual({
      state: 'drifted',
      label: '0h 0m 40s ahead',
    });
  });
  it('tolerates the independent clock sampling interval', () => {
    expect(alignment(vod, moment, { status: 'ready', seconds: 3601.5, paused: false }).state).toBe(
      'aligned',
    );
  });
  it('never calls a switched or ended player aligned', () => {
    expect(alignment(vod, moment, { status: 'changed', seconds: null, paused: true }).state).toBe(
      'changed',
    );
    expect(
      alignment(vod, moment, { status: 'ended', seconds: vod.durationSeconds, paused: true }).state,
    ).toBe('ended');
  });
  it('preserves exact before/start/end boundaries', () => {
    expect(alignment(vod, startMs(vod) - 1).state).toBe('before');
    expect(alignment(vod, startMs(vod), { status: 'ready', seconds: 0, paused: true }).state).toBe(
      'aligned',
    );
    expect(alignment(vod, startMs(vod) + vod.durationSeconds * 1000).state).toBe('ended');
  });
});
