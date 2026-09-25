import { describe, expect, it } from 'vitest';
import { createPlayerClock } from './playerClock';

describe('Twitch clock startup', () => {
  it('shows the requested time without synchronizing from an unconfirmed zero', () => {
    const clock = createPlayerClock(() => 0, 7200);
    expect(clock.sample()).toEqual({ seconds: 7200, confirmed: false });
    expect(() => clock.getCurrentTime()).toThrow('Press play');
    clock.requested(3600);
    expect(clock.sample().seconds).toBe(3600);
  });

  it('accepts a reported position and a subsequent user seek to zero', () => {
    let position = 7200;
    const clock = createPlayerClock(() => position, 0);
    expect(clock.getCurrentTime()).toBe(7200);
    position = 0;
    expect(clock.getCurrentTime()).toBe(0);
  });

  it('accepts zero once playback has actually started', () => {
    const clock = createPlayerClock(() => 0, 7200);
    clock.playing();
    expect(clock.getCurrentTime()).toBe(0);
  });

  it('rejects invalid player positions', () => {
    const clock = createPlayerClock(() => NaN, 7200);
    clock.playing();
    expect(() => clock.getCurrentTime()).toThrow('not reported');
  });

  it('uses an acknowledged paused seek until Twitch publishes the new clock', () => {
    let position = 50;
    const clock = createPlayerClock(() => position, 50);
    clock.seeked(100);
    expect(clock.getCurrentTime()).toBe(100);
    clock.playing();
    expect(clock.getCurrentTime()).toBe(100);
    position = 100.25;
    expect(clock.getCurrentTime()).toBe(100.25);
    position = 110;
    expect(clock.getCurrentTime()).toBe(110);
  });

  it('accepts acknowledged zero and ignores malformed acknowledgments', () => {
    const clock = createPlayerClock(() => 100, 100);
    clock.seeked(0);
    expect(clock.getCurrentTime()).toBe(0);
    clock.seeked(NaN);
    clock.seeked(-1);
    expect(clock.getCurrentTime()).toBe(0);
  });
});
