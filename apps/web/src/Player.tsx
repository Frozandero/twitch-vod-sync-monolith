import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react';
import {
  formatTime,
  matchDescription,
  matchMoment,
  timestampUrl,
  vodKey,
  type Vod,
} from '@vodsync/core';
import { createPlayerClock } from './playerClock';
import { createVodGuard, type PlaybackSnapshot, type StopReason } from './playback';

export type PlayerHandle = {
  getSnapshot(): PlaybackSnapshot;
  getCurrentTime(): number;
  isPaused(): boolean;
  seek(time: number): void;
  pause(): void;
  play(): void;
  setMuted(muted: boolean): void;
};
type TwitchPlayer = Omit<PlayerHandle, 'getSnapshot'> & {
  getDuration(): number;
  getVideo(): string;
  getEnded(): boolean;
  addEventListener(event: string, callback: () => void): void;
  removeEventListener(event: string, callback: () => void): void;
};
type TwitchConstructor = {
  new (element: HTMLElement, options: object): TwitchPlayer;
  READY: string;
  PLAYBACK_BLOCKED: string;
  PLAYING: string;
  ENDED: string;
};
declare global {
  interface Window {
    Twitch?: { Player: TwitchConstructor };
  }
}
let sdk: Promise<TwitchConstructor> | undefined;
function loadSdk() {
  if (window.Twitch) return Promise.resolve(window.Twitch.Player);
  if (!sdk)
    sdk = new Promise<TwitchConstructor>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://player.twitch.tv/js/embed/v1.js';
      const timeout = window.setTimeout(() => {
        script.remove();
        sdk = undefined;
        reject(new Error('Twitch player timed out. Retry or open the VOD directly.'));
      }, 15000);
      script.onload = () => {
        clearTimeout(timeout);
        if (window.Twitch) resolve(window.Twitch.Player);
        else {
          sdk = undefined;
          reject(new Error('Twitch player is unavailable.'));
        }
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        sdk = undefined;
        reject(new Error('Twitch player was blocked. Check browser settings or open the VOD.'));
      };
      document.head.appendChild(script);
    });
  return sdk;
}
export type SyncCommand = { moment: number; playing: boolean; leader: string; serial: number };
type Props = {
  vod: Vod;
  source: boolean;
  command: SyncCommand | null;
  moment: number;
  register: (key: string, handle: PlayerHandle | null) => void;
  onSync: (vod: Vod) => void;
  onRemove: () => void;
  onSettings: () => void;
  onStopped: (vod: Vod, reason: StopReason) => void;
};
export function Player({
  vod,
  source,
  command,
  moment,
  register,
  onSync,
  onRemove,
  onSettings,
  onStopped,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<Omit<PlayerHandle, 'getSnapshot'> | null>(null);
  const clock = useRef<ReturnType<typeof createPlayerClock> | null>(null);
  const guard = useRef<ReturnType<typeof createVodGuard> | null>(null);
  const [stopped, setStopped] = useState<{ serial: number | undefined; reason: StopReason }>();
  const [ready, setReady] = useState(false),
    [clockReady, setClockReady] = useState(false),
    [error, setError] = useState(''),
    [muted, setMuted] = useState(true),
    [current, setCurrent] = useState(0),
    [attempt, setAttempt] = useState(0);
  const key = vodKey(vod),
    demo = vod.provenance === 'demo';
  const match = matchMoment(vod, moment);
  const blockedStatus =
    match.state !== 'playing'
      ? match.state
      : stopped?.serial === command?.serial
        ? stopped?.reason
        : undefined;
  const linkOffset = match && match.state !== 'playing' ? match.offsetSeconds : current;
  const commandRef = useRef(command);
  commandRef.current = command;
  const momentRef = useRef(moment);
  momentRef.current = moment;
  const stoppedCallback = useRef(onStopped);
  stoppedCallback.current = onStopped;
  const vodRef = useRef(vod);
  vodRef.current = vod;
  useEffect(() => {
    let alive = true,
      instance: TwitchPlayer | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let readyEvent: string | undefined,
      blockedEvent: string | undefined,
      playingEvent: string | undefined,
      endedEvent: string | undefined,
      readyCallback: (() => void) | undefined,
      blockedCallback: (() => void) | undefined,
      playingCallback: (() => void) | undefined,
      endedCallback: (() => void) | undefined;
    const host = container.current;
    setReady(false);
    setClockReady(false);
    setError('');
    const stop = (reason: StopReason) => {
      if (!alive) return;
      register(key, null);
      player.current = null;
      setReady(false);
      setClockReady(false);
      setStopped({ serial: commandRef.current?.serial, reason });
      if (reason === 'ended') setCurrent(vodRef.current.durationSeconds);
      stoppedCallback.current(vodRef.current, reason);
    };
    if (blockedStatus) {
      const seconds =
        blockedStatus === 'ended' ? vod.durationSeconds : blockedStatus === 'before' ? 0 : null;
      if (seconds !== null) setCurrent(seconds);
      register(key, {
        getSnapshot: () => ({ status: blockedStatus, seconds, paused: true }),
        getCurrentTime: () => {
          throw new Error('Seek to a playable moment before syncing from this recording.');
        },
        isPaused: () => true,
        seek: () => {},
        pause: () => {},
        play: () => {},
        setMuted: () => {},
      });
    } else if (demo) {
      let seconds = 0,
        running = false,
        last = performance.now();
      const update = () => {
        const now = performance.now();
        if (running) seconds = Math.min(vod.durationSeconds, seconds + (now - last) / 1000);
        last = now;
        if (running && seconds >= vod.durationSeconds) {
          running = false;
          stop('ended');
        }
        return seconds;
      };
      const handle: PlayerHandle = {
        getSnapshot: () => ({ status: 'ready', seconds: update(), paused: !running }),
        getCurrentTime: update,
        isPaused: () => {
          update();
          return !running;
        },
        seek: (time) => {
          seconds = time;
          last = performance.now();
          setCurrent(time);
        },
        pause: () => {
          update();
          running = false;
        },
        play: () => {
          last = performance.now();
          running = true;
        },
        setMuted: () => {},
      };
      player.current = handle;
      register(key, handle);
      setReady(true);
      setClockReady(true);
    } else {
      loadSdk()
        .then((PlayerClass) => {
          if (!alive || !host) return;
          const offset = matchMoment(vod, momentRef.current).offsetSeconds;
          instance = new PlayerClass(host, {
            video: `v${vod.id}`,
            width: '100%',
            height: '100%',
            parent: [location.hostname],
            autoplay: false,
            muted: true,
            time: `${Math.floor(offset)}s`,
          });
          const twitch = instance;
          const identity = createVodGuard(vod.id, twitch, () => host.replaceChildren(), stop);
          guard.current = identity;
          const playbackClock = createPlayerClock(() => {
            identity.assertCurrent();
            return twitch.getCurrentTime();
          }, offset);
          clock.current = playbackClock;
          setCurrent(offset);
          readyEvent = PlayerClass.READY;
          blockedEvent = PlayerClass.PLAYBACK_BLOCKED;
          playingEvent = PlayerClass.PLAYING;
          endedEvent = PlayerClass.ENDED;
          readyCallback = () => {
            if (!alive || !instance) return;
            clearTimeout(timer);
            player.current = instance;
            register(key, {
              getSnapshot: () => {
                if (!identity.check()) return { status: 'loading', seconds: null, paused: true };
                const sample = playbackClock.sample();
                return {
                  status: sample.confirmed ? 'ready' : 'loading',
                  seconds: sample.confirmed ? sample.seconds : null,
                  paused: twitch.isPaused(),
                };
              },
              getCurrentTime: playbackClock.getCurrentTime,
              isPaused: () => !identity.check() || twitch.isPaused(),
              seek: (time) => {
                identity.assertCurrent();
                twitch.seek(time);
              },
              pause: () => twitch.pause(),
              play: () => {
                identity.assertCurrent();
                twitch.play();
              },
              setMuted: (silent) => twitch.setMuted(silent),
            });
            setReady(true);
            setError('');
          };
          blockedCallback = () => {
            if (alive) setError('Press play inside the Twitch player, then sync again.');
          };
          playingCallback = () => {
            if (!alive || !identity.check()) return;
            playbackClock.playing();
            setClockReady(true);
            setError('');
          };
          endedCallback = () => {
            if (alive) identity.ended();
          };
          instance.addEventListener(readyEvent, readyCallback);
          instance.addEventListener(blockedEvent, blockedCallback);
          instance.addEventListener(playingEvent, playingCallback);
          instance.addEventListener(endedEvent, endedCallback);
          timer = setTimeout(() => {
            if (alive)
              setError('Twitch is taking too long to load. Retry or open the VOD directly.');
          }, 20000);
        })
        .catch((error) => {
          if (alive) setError(error.message);
        });
    }
    return () => {
      alive = false;
      clearTimeout(timer);
      if (instance && readyEvent && readyCallback)
        instance.removeEventListener(readyEvent, readyCallback);
      if (instance && blockedEvent && blockedCallback)
        instance.removeEventListener(blockedEvent, blockedCallback);
      if (instance && playingEvent && playingCallback)
        instance.removeEventListener(playingEvent, playingCallback);
      if (instance && endedEvent && endedCallback)
        instance.removeEventListener(endedEvent, endedCallback);
      register(key, null);
      player.current = null;
      clock.current = null;
      guard.current = null;
      host?.replaceChildren();
    };
  }, [key, demo, attempt, blockedStatus]);
  useEffect(() => {
    const handle = player.current;
    if (!ready || !handle || !command || blockedStatus) return;
    const target = matchMoment(vod, momentRef.current);
    let retries = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const move = () => {
      try {
        if (guard.current && !guard.current.check()) {
          if (retries++ < 3) timer = setTimeout(move, 700);
          return;
        }
        if (target.state !== 'playing' || !command.playing) handle.pause();
        clock.current?.requested(target.offsetSeconds);
        handle.seek(target.offsetSeconds);
        if (target.state === 'playing' && command.playing) handle.play();
        timer = setTimeout(() => {
          try {
            if (guard.current && !guard.current.check()) return;
            const actual = handle.getCurrentTime();
            setCurrent(clock.current?.sample().seconds ?? actual);
            // READY can precede loaded media. Retry only this requested seek, never ongoing drift.
            if (Math.abs(actual - target.offsetSeconds) > 3 && retries++ < 3) move();
          } catch {
            setError('The player is not ready to seek. Press play, then sync again.');
          }
        }, 700);
      } catch {
        setError('The player is not ready to seek. Press play, then sync again.');
      }
    };
    const silent = command.leader !== key;
    handle.setMuted(silent);
    setMuted(silent);
    move();
    return () => clearTimeout(timer);
  }, [command, ready, vod.correctionSeconds, blockedStatus]);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      try {
        if (clock.current) {
          const position = clock.current.sample();
          setCurrent(position.seconds);
          setClockReady(position.confirmed);
        } else if (player.current) setCurrent(player.current.getCurrentTime());
      } catch {
        /* Loading. */
      }
    }, 500);
    return () => clearInterval(timer);
  }, [ready]);
  return (
    <article
      className={`player-tile ${source ? 'is-source' : ''}`}
      aria-label={`${vod.channel} player`}
    >
      <div className="player-heading">
        <strong title={vod.title}>{vod.channel}</strong>
        <time>{formatTime(current)}</time>
        <div className="player-actions">
          <button
            className={`sync-button ${source ? 'selected' : ''}`}
            disabled={!ready || !clockReady}
            onClick={() => onSync(vod)}
            title={
              clockReady
                ? `Sync all players to ${vod.channel}`
                : 'Press play inside Twitch to enable sync from this recording'
            }
          >
            <RefreshCw size={13} />
            <span>Sync</span>
          </button>
          <button
            className="icon-button"
            disabled={!ready}
            aria-label={`${muted ? 'Unmute' : 'Mute'} ${vod.channel}`}
            onClick={() => {
              player.current?.setMuted(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button
            className="icon-button"
            onClick={onSettings}
            aria-label={`Settings for ${vod.channel}`}
            title="Recording settings"
          >
            <SlidersHorizontal size={14} />
          </button>
          <a
            className="icon-button"
            href={timestampUrl(vod, linkOffset)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${vod.channel} VOD`}
            title={
              match && match.state !== 'playing'
                ? `Open VOD boundary · ${matchDescription(match)}`
                : `Go to timestamp ${formatTime(linkOffset)}`
            }
          >
            <ExternalLink size={14} />
          </a>
          <button className="icon-button" onClick={onRemove} aria-label={`Remove ${vod.channel}`}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="player-frame">
        {demo ? (
          <div className="demo-screen">
            <span>Simulated recording</span>
            <strong>{vod.channel}</strong>
            <time>{formatTime(current)}</time>
            <input
              aria-label={`${vod.channel} demo position`}
              type="range"
              min="0"
              max={vod.durationSeconds - 1}
              value={current}
              onChange={(e) => player.current?.seek(Number(e.target.value))}
            />
          </div>
        ) : (
          <div className="twitch-embed" ref={container} />
        )}
        {blockedStatus && (
          <div className="boundary-state">
            <strong>
              {blockedStatus === 'before'
                ? 'This VOD hasn’t started'
                : blockedStatus === 'changed'
                  ? 'Twitch tried to switch VODs'
                  : 'This VOD has ended'}
            </strong>
            <p>
              {blockedStatus === 'changed'
                ? 'Playback stopped to keep the correct recording.'
                : match.state === 'playing'
                  ? 'Seek to an earlier moment to replay.'
                  : matchDescription(match)}
            </p>
            {blockedStatus === 'changed' && (
              <button className="button" onClick={() => setStopped(undefined)}>
                Reload original VOD
              </button>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="player-error" role="status">
          {error}
          <button className="text-button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
    </article>
  );
}
