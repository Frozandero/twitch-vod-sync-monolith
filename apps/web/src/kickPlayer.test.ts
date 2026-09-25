import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vod } from '@vodsync/core';
import { resolveKickPlayback } from '@vodsync/providers';
import { bufferAhead, createKickPlayer, mediaPosition } from './kickPlayer';

vi.mock('@vodsync/providers', () => ({ resolveKickPlayback: vi.fn() }));

const ranges = (pairs: number[][]): TimeRanges => ({
  length: pairs.length,
  start: (i) => pairs[i][0],
  end: (i) => pairs[i][1],
});

describe('Kick player lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  function setup(source: Promise<string>) {
    class Video extends EventTarget {
      paused = true;
      currentTime = 0;
      duration = 600;
      readyState = 0;
      seeking = false;
      ended = false;
      muted = true;
      src = '';
      buffered = ranges([]);
      setAttribute() {}
      removeAttribute() {
        this.src = '';
      }
      canPlayType() {
        return 'probably';
      }
      pause = vi.fn(() => {
        this.paused = true;
      });
      play = vi.fn(async () => {
        this.paused = false;
      });
      load = vi.fn();
      remove = vi.fn();
    }
    const video = new Video();
    vi.stubGlobal('document', { createElement: () => video });
    vi.mocked(resolveKickPlayback).mockReturnValue(source);
    const callbacks = {
      ready: vi.fn(),
      playing: vi.fn(),
      play: vi.fn(),
      ended: vi.fn(),
      duration: vi.fn(),
      muted: vi.fn(),
      blocked: vi.fn(),
      error: vi.fn(),
    };
    const player = createKickPlayer(
      { append: vi.fn() } as unknown as HTMLElement,
      { channel: 'test' } as Vod,
      100,
      false,
      callbacks,
    );
    return { video, callbacks, player };
  }
  it('does not attach a source that resolves after removal', async () => {
    let resolve!: (source: string) => void;
    const { video, player, callbacks } = setup(
      new Promise((r) => {
        resolve = r;
      }),
    );
    player.destroy();
    resolve('https://stream.kick.com/test.m3u8');
    await Promise.resolve();
    expect(video.src).toBe('');
    video.dispatchEvent(new Event('playing'));
    expect(callbacks.playing).not.toHaveBeenCalled();
  });
  it('does not start loading after its timeout already failed', async () => {
    vi.useFakeTimers();
    let resolve!: (source: string) => void;
    const { video, player, callbacks } = setup(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await vi.advanceTimersByTimeAsync(25000);
    resolve('https://stream.kick.com/test.m3u8');
    await Promise.resolve();
    expect(video.src).toBe('');
    expect(callbacks.error).toHaveBeenCalledOnce();
    player.play();
    expect(video.play).not.toHaveBeenCalled();
    player.destroy();
  });
  it('confirms playing through the event, not a fulfilled play promise', async () => {
    const { video, player, callbacks } = setup(
      Promise.resolve('https://stream.kick.com/test.m3u8'),
    );
    await Promise.resolve();
    player.play();
    await Promise.resolve();
    expect(callbacks.playing).not.toHaveBeenCalled();
    video.dispatchEvent(new Event('playing'));
    expect(callbacks.playing).toHaveBeenCalledOnce();
    player.destroy();
  });
  it('treats a cancelled pending play as cancellation, not a blocked or failed start', async () => {
    const { video, player, callbacks } = setup(
      Promise.resolve('https://stream.kick.com/test.m3u8'),
    );
    let reject!: (reason: unknown) => void;
    video.play.mockImplementation(
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    );
    player.play();
    player.pause();
    reject(new DOMException('Paused', 'AbortError'));
    await Promise.resolve();
    expect(callbacks.blocked).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
    player.destroy();
  });
});
describe('native Kick media readiness', () => {
  it('does not confuse buffered video elsewhere with the selected moment', () => {
    expect(
      bufferAhead(
        ranges([
          [0, 20],
          [100, 120],
        ]),
        90,
      ),
    ).toBe(0);
    expect(
      bufferAhead(
        ranges([
          [0, 20],
          [100, 120],
        ]),
        100,
      ),
    ).toBe(20);
    expect(
      bufferAhead(
        ranges([
          [0, 20],
          [100, 120],
        ]),
        119.5,
      ),
    ).toBe(0.5);
    expect(
      bufferAhead(
        ranges([
          [0, 20],
          [100, 120],
        ]),
        120,
      ),
    ).toBe(0);
    expect(bufferAhead(ranges([]), 0)).toBe(0);
  });
  it('never confirms a requested clock before actual media arrives', () => {
    const video = { currentTime: 300, readyState: 1, seeking: false, ended: false };
    expect(mediaPosition(video)).toBeNull();
    expect(mediaPosition({ ...video, readyState: 4, seeking: true })).toBeNull();
    expect(mediaPosition({ ...video, readyState: 4, ended: true })).toBeNull();
    expect(mediaPosition({ ...video, readyState: 4, currentTime: NaN })).toBeNull();
    expect(mediaPosition({ ...video, readyState: 2 })).toBe(300);
    expect(mediaPosition({ ...video, readyState: 2, currentTime: 0 })).toBe(0);
  });
});
