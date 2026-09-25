import type { Vod } from '@vodsync/core';
import { resolveKickPlayback } from '@vodsync/providers';
import type Hls from 'hls.js';

// Only count the range containing the actual clock, never a later buffered island.
export function bufferAhead(ranges: TimeRanges, seconds: number) {
  if (!Number.isFinite(seconds)) return 0;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= seconds && ranges.end(i) > seconds) return ranges.end(i) - seconds;
  }
  return 0;
}

// HLS audio/video timestamps can start a frame after an exact seek. Seek to
// that real buffered frame; never count a gap as buffered or skip a larger gap.
export function bufferedSeekTarget(ranges: TimeRanges, seconds: number) {
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    if (start > seconds && start - seconds <= 0.05) return start;
  }
  return seconds;
}

export function mediaPosition(
  video: Pick<HTMLVideoElement, 'currentTime' | 'readyState' | 'seeking' | 'ended'>,
) {
  return !video.seeking &&
    !video.ended &&
    video.readyState >= 2 &&
    Number.isFinite(video.currentTime) &&
    video.currentTime >= 0
    ? video.currentTime
    : null;
}

type Callbacks = {
  ready(): void;
  playing(): void;
  play(): void;
  ended(): void;
  duration(seconds: number): void;
  muted(value: boolean): void;
  blocked(): void;
  error(message: string): void;
};

export function createKickPlayer(
  host: HTMLElement,
  vod: Vod,
  offset: number,
  refresh: boolean,
  callbacks: Callbacks,
) {
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.autoplay = false;
  video.setAttribute('aria-label', `${vod.channel} Kick VOD`);
  host.append(video);
  let alive = true,
    failed = false,
    hls: Hls | undefined,
    initialized = false,
    requested: number | undefined = offset;
  const events = new AbortController();
  const listen = (name: string, callback: () => void) =>
    video.addEventListener(name, callback, { signal: events.signal });
  const timer = setTimeout(
    () => fail('Kick is taking too long to load. Retry or open the VOD directly.'),
    25000,
  );
  function fail(message: string) {
    if (!alive || failed) return;
    failed = true;
    clearTimeout(timer);
    video.pause();
    hls?.destroy();
    hls = undefined;
    video.removeAttribute('src');
    video.load();
    callbacks.error(message);
  }
  function reportDuration() {
    if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 31536000)
      callbacks.duration(video.duration);
  }
  listen('durationchange', reportDuration);
  listen('loadedmetadata', () => {
    if (initialized || failed) return;
    initialized = true;
    clearTimeout(timer);
    reportDuration();
    callbacks.ready();
  });
  listen('play', callbacks.play);
  listen('playing', callbacks.playing);
  listen('ended', () => {
    video.pause();
    callbacks.ended();
  });
  listen('volumechange', () => callbacks.muted(video.muted));
  listen('error', () => fail('Kick video could not be played. Retry or open the VOD on Kick.'));

  async function load() {
    const source = await resolveKickPlayback(vod, refresh);
    if (!alive || failed) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari can play HLS without the MediaSource adapter.
      video.src = source;
    } else {
      const { default: HlsClass } = await import('hls.js');
      if (!alive || failed) return;
      if (!HlsClass.isSupported())
        throw new Error('This browser cannot play Kick video. Open the VOD on Kick.');
      hls = new HlsClass({
        startPosition: offset,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        backBufferLength: 15,
        capLevelToPlayerSize: true,
      });
      hls.on(HlsClass.Events.LEVEL_LOADED, (_event, data) => {
        if (data.details.live) fail('Kick returned a live stream instead of a recording.');
      });
      hls.on(HlsClass.Events.ERROR, (_event, data) => {
        // hls.js already performs bounded network retries. Never expose media URLs in errors.
        if (data.fatal) fail('Kick video could not be loaded. Retry or open the VOD on Kick.');
      });
      hls.attachMedia(video);
      hls.loadSource(source);
    }
  }
  void load().catch((error: unknown) =>
    fail(error instanceof Error ? error.message : 'Kick video is unavailable.'),
  );
  return {
    getCurrentTime() {
      const seconds = failed ? null : mediaPosition(video);
      if (seconds === null) throw new Error('Kick has not reported a playback position yet.');
      return seconds;
    },
    sample: () => {
      const seconds = failed ? null : mediaPosition(video);
      const buffered = bufferAhead(video.buffered, video.currentTime);
      if (
        requested !== undefined &&
        seconds !== null &&
        video.paused &&
        Math.abs(seconds - requested) <= 0.5
      ) {
        if (buffered > 0) requested = undefined;
        else {
          const frame = bufferedSeekTarget(video.buffered, seconds);
          if (frame !== seconds) {
            video.currentTime = frame;
            return { seconds: null, bufferSeconds: 0 };
          }
        }
      }
      return { seconds, bufferSeconds: buffered };
    },
    isPaused: () => video.paused,
    seek(time: number) {
      if (alive && !failed) {
        requested = time;
        video.currentTime = time;
      }
    },
    pause() {
      video.pause();
    },
    play() {
      if (!alive || failed) return;
      void video.play().catch((error: unknown) => {
        if (!alive || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (error instanceof DOMException && error.name === 'NotAllowedError') callbacks.blocked();
        else fail('Kick video could not start. Retry or open the VOD on Kick.');
      });
    },
    setMuted(value: boolean) {
      video.muted = value;
    },
    destroy() {
      alive = false;
      clearTimeout(timer);
      events.abort();
      video.pause();
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
      video.remove();
    },
  };
}
