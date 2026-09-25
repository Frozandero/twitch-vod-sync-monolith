import { useEffect, useRef, useState, type DragEventHandler, type ReactNode } from 'react';
import {
  ExternalLink,
  GripVertical,
  LoaderCircle,
  RefreshCw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
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
import { createSeekPreparation, seekPosition, type SeekState } from './seekBarrier';
import { supportsPlayback } from './capabilities';
import { createKickPlayer } from './kickPlayer';
import type { GridPosition } from './gridLayout';

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
  getPlaybackStats(): { bufferSize?: number } | null;
  addEventListener(event: string, callback: (event?: unknown) => void): void;
  removeEventListener(event: string, callback: (event?: unknown) => void): void;
};
type TwitchConstructor = {
  new (element: HTMLElement, options: object): TwitchPlayer;
  READY: string;
  PLAYBACK_BLOCKED: string;
  PLAYING: string;
  PLAY: string;
  SEEK: string;
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
export type SyncCommand = {
  moment: number;
  playing: boolean;
  leader: string;
  serial: number;
  startAttempt: number;
  phase: 'preparing' | 'starting' | 'released' | 'cancelled';
};
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
  onDuration: (key: string, seconds: number) => void;
  workspaceControls?: ReactNode;
  order: {
    index: number;
    position: GridPosition;
    count: number;
    disabled: boolean;
    dragging: boolean;
    target: boolean;
    onStart: DragEventHandler<HTMLButtonElement>;
    onEnd: DragEventHandler<HTMLButtonElement>;
    onOver: DragEventHandler<HTMLElement>;
    onDrop: DragEventHandler<HTMLElement>;
    onMove: (index: number) => void;
    onArrange: () => void;
  };
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
  onDuration,
  workspaceControls,
  order,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<Omit<PlayerHandle, 'getSnapshot'> | null>(null);
  const clock = useRef<ReturnType<typeof createPlayerClock> | null>(null);
  const guard = useRef<ReturnType<typeof createVodGuard> | null>(null);
  const preparation = useRef<ReturnType<typeof createSeekPreparation> | null>(null);
  const snapshot = useRef<(() => PlaybackSnapshot) | null>(null);
  const startedSerial = useRef<number | undefined>(undefined);
  const playbackBlocked = useRef(false);
  const forceMuted = useRef(false);
  const [seekState, setSeekState] = useState<SeekState>('seeking');
  const [stopped, setStopped] = useState<{ serial: number | undefined; reason: StopReason }>();
  const [ready, setReady] = useState(false),
    [clockReady, setClockReady] = useState(false),
    [error, setError] = useState(''),
    [muted, setMuted] = useState(true),
    [current, setCurrent] = useState(0),
    [attempt, setAttempt] = useState(0);
  const key = vodKey(vod),
    demo = vod.provenance === 'demo';
  const external = !supportsPlayback(vod);
  const match = matchMoment(vod, moment);
  const holding =
    !external &&
    (command?.phase === 'preparing' || command?.phase === 'starting') &&
    match.state === 'playing';
  const canPlay = command?.phase === 'starting' || command?.phase === 'released';
  const holdLabel =
    command?.phase === 'starting'
      ? 'Starting playback…'
      : seekState === 'ready'
        ? 'Ready · waiting for other VODs'
        : 'Buffering selected moment…';
  const blockedStatus =
    match.state !== 'playing'
      ? match.state
      : stopped?.serial === command?.serial
        ? stopped?.reason
        : undefined;
  const linkOffset = external || match.state !== 'playing' ? match.offsetSeconds : current;
  const commandRef = useRef(command);
  commandRef.current = command;
  const momentRef = useRef(moment);
  momentRef.current = moment;
  const stoppedCallback = useRef(onStopped);
  stoppedCallback.current = onStopped;
  const durationCallback = useRef(onDuration);
  durationCallback.current = onDuration;
  const vodRef = useRef(vod);
  vodRef.current = vod;
  useEffect(() => {
    if (external) return;
    let alive = true,
      instance: TwitchPlayer | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let kick: ReturnType<typeof createKickPlayer> | undefined;
    let readyEvent: string | undefined,
      blockedEvent: string | undefined,
      playingEvent: string | undefined,
      playEvent: string | undefined,
      seekEvent: string | undefined,
      endedEvent: string | undefined,
      readyCallback: (() => void) | undefined,
      blockedCallback: (() => void) | undefined,
      playingCallback: (() => void) | undefined,
      playCallback: (() => void) | undefined,
      seekCallback: ((event?: unknown) => void) | undefined,
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
        getSnapshot: () => ({
          status: blockedStatus,
          seconds,
          paused: true,
          startedSerial: startedSerial.current,
        }),
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
        getSnapshot: () => ({
          status: 'ready',
          seconds: update(),
          paused: !running,
          startedSerial: startedSerial.current,
          seek: preparation.current?.sample(
            seconds,
            vod.durationSeconds - seconds,
            !running,
            performance.now(),
          ),
        }),
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
          startedSerial.current = commandRef.current?.serial;
        },
        setMuted: () => {},
      };
      player.current = handle;
      snapshot.current = handle.getSnapshot;
      register(key, handle);
      setReady(true);
      setClockReady(true);
    } else if (vod.platform === 'kick' && host) {
      setCurrent(matchMoment(vod, momentRef.current).offsetSeconds);
      kick = createKickPlayer(
        host,
        vod,
        matchMoment(vod, momentRef.current).offsetSeconds,
        attempt > 0,
        {
          ready: () => {
            if (!alive || !kick) return;
            const media = kick;
            const handle: PlayerHandle = {
              ...media,
              getSnapshot: () => {
                const sample = media.sample();
                return {
                  status: sample.seconds === null ? 'loading' : 'ready',
                  seconds: sample.seconds,
                  paused: media.isPaused(),
                  startedSerial: startedSerial.current,
                  playbackBlocked: playbackBlocked.current,
                  seek:
                    commandRef.current?.phase === 'preparing'
                      ? preparation.current?.sample(
                          sample.seconds ?? NaN,
                          sample.seconds === null ? 0 : sample.bufferSeconds,
                          media.isPaused(),
                          performance.now(),
                        )
                      : undefined,
                };
              },
            };
            player.current = handle;
            snapshot.current = handle.getSnapshot;
            register(key, handle);
            setReady(true);
          },
          play: () => {
            if (commandRef.current?.phase === 'preparing') kick?.pause();
          },
          playing: () => {
            if (!alive) return;
            if (commandRef.current?.phase === 'preparing') {
              kick?.pause();
              return;
            }
            startedSerial.current = commandRef.current?.serial;
            playbackBlocked.current = false;
            setClockReady(true);
            setError(
              forceMuted.current ? 'Started muted. Use the speaker button to enable sound.' : '',
            );
          },
          ended: () => stop('ended'),
          duration: (seconds) => {
            if (alive) durationCallback.current(key, seconds);
          },
          muted: (value) => {
            if (alive) setMuted(value);
          },
          blocked: () => {
            if (!alive) return;
            playbackBlocked.current = true;
            if (commandRef.current?.phase === 'starting' && !forceMuted.current) {
              forceMuted.current = true;
              kick?.setMuted(true);
              setError('Playback was blocked. Retrying muted.');
            } else
              setError('Playback was blocked. Press play inside this player, then Sync from it.');
          },
          error: (message) => {
            if (alive) {
              setError(message);
              setClockReady(false);
            }
          },
        },
      );
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
          playEvent = PlayerClass.PLAY;
          seekEvent = PlayerClass.SEEK;
          endedEvent = PlayerClass.ENDED;
          readyCallback = () => {
            if (!alive || !instance) return;
            clearTimeout(timer);
            player.current = instance;
            const handle: PlayerHandle = {
              getSnapshot: () => {
                if (!identity.check()) return { status: 'loading', seconds: null, paused: true };
                const preparing =
                  commandRef.current?.phase === 'preparing' ? preparation.current : null;
                const seek = preparing?.sample(
                  twitch.getCurrentTime(),
                  twitch.getPlaybackStats()?.bufferSize,
                  twitch.isPaused(),
                  performance.now(),
                );
                if (seek?.state === 'ready' && preparing) playbackClock.seeked(preparing.target);
                const sample = playbackClock.sample();
                return {
                  status: sample.confirmed ? 'ready' : 'loading',
                  seconds: sample.confirmed ? sample.seconds : null,
                  paused: twitch.isPaused(),
                  startedSerial: startedSerial.current,
                  playbackBlocked: playbackBlocked.current,
                  seek,
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
            };
            snapshot.current = handle.getSnapshot;
            register(key, handle);
            setReady(true);
            setError('');
          };
          blockedCallback = () => {
            if (!alive) return;
            playbackBlocked.current = true;
            if (commandRef.current?.phase === 'starting' && !forceMuted.current) {
              forceMuted.current = true;
              twitch.setMuted(true);
              setMuted(true);
              setError('Twitch blocked playback. Retrying muted.');
            } else
              setError(
                'Twitch blocked playback. Press play inside this player, then Sync from it.',
              );
          };
          playingCallback = () => {
            if (!alive || !identity.check()) return;
            if (commandRef.current?.phase === 'preparing') {
              twitch.pause();
              return;
            }
            playbackClock.playing();
            startedSerial.current = commandRef.current?.serial;
            playbackBlocked.current = false;
            setClockReady(true);
            setError(
              forceMuted.current ? 'Started muted. Use the speaker button to enable sound.' : '',
            );
          };
          playCallback = () => {
            if (alive && commandRef.current?.phase === 'preparing') twitch.pause();
          };
          seekCallback = (event) => {
            if (!alive || !identity.check()) return;
            const position = seekPosition(event);
            if (position === undefined || position >= vodRef.current.durationSeconds) return;
            if (commandRef.current?.phase === 'preparing' && !preparation.current?.seeked(position))
              return;
            playbackClock.seeked(position);
          };
          endedCallback = () => {
            if (alive) identity.ended();
          };
          instance.addEventListener(readyEvent, readyCallback);
          instance.addEventListener(blockedEvent, blockedCallback);
          instance.addEventListener(playingEvent, playingCallback);
          instance.addEventListener(playEvent, playCallback);
          instance.addEventListener(seekEvent, seekCallback);
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
      kick?.destroy();
      if (instance && readyEvent && readyCallback)
        instance.removeEventListener(readyEvent, readyCallback);
      if (instance && blockedEvent && blockedCallback)
        instance.removeEventListener(blockedEvent, blockedCallback);
      if (instance && playingEvent && playingCallback)
        instance.removeEventListener(playingEvent, playingCallback);
      if (instance && playEvent && playCallback)
        instance.removeEventListener(playEvent, playCallback);
      if (instance && seekEvent && seekCallback)
        instance.removeEventListener(seekEvent, seekCallback);
      if (instance && endedEvent && endedCallback)
        instance.removeEventListener(endedEvent, endedCallback);
      register(key, null);
      player.current = null;
      clock.current = null;
      guard.current = null;
      preparation.current = null;
      snapshot.current = null;
      host?.replaceChildren();
    };
  }, [key, demo, external, attempt, blockedStatus]);
  useEffect(() => {
    const handle = player.current;
    if (!ready || !handle || !command || blockedStatus || command.phase === 'cancelled') return;
    const target = matchMoment(
      vod,
      command.phase === 'preparing' ? command.moment : momentRef.current,
    );
    const pending = createSeekPreparation(
      command.serial,
      target.offsetSeconds,
      vod.durationSeconds,
    );
    preparation.current = pending;
    startedSerial.current = undefined;
    playbackBlocked.current = false;
    setSeekState('seeking');
    let retries = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const move = () => {
      try {
        if (guard.current && !guard.current.check()) {
          if (retries++ < 5) timer = setTimeout(move, 1500);
          return;
        }
        handle.pause();
        clock.current?.requested(target.offsetSeconds);
        handle.seek(target.offsetSeconds);
        timer = setTimeout(() => {
          try {
            if (guard.current && !guard.current.check()) return;
            const state = snapshot.current?.();
            // An acknowledged seek can have a stale paused clock. Let its buffer fill.
            if (state?.seek?.state === 'seeking' && retries++ < 5) move();
          } catch {
            setError('The player is not ready to seek. Press play, then sync again.');
          }
        }, 1500);
      } catch {
        setError('The player is not ready to seek. Press play, then sync again.');
      }
    };
    const silent = command.phase === 'preparing' || command.leader !== key || forceMuted.current;
    handle.setMuted(silent);
    setMuted(silent);
    move();
    return () => {
      clearTimeout(timer);
      if (preparation.current === pending) preparation.current = null;
    };
  }, [command?.serial, ready, vod.correctionSeconds, vod.durationSeconds, blockedStatus]);
  useEffect(() => {
    const handle = player.current;
    if (!ready || !handle || !command || blockedStatus) return;
    if (!canPlay) {
      handle.pause();
      return;
    }
    if (guard.current && !guard.current.check()) return;
    const silent = command.leader !== key || forceMuted.current;
    handle.setMuted(silent);
    setMuted(silent);
    if (!command.playing) {
      handle.pause();
      return;
    }
    // Twitch's visibility report lags iframe resizing (e.g. the wait row closing).
    // Allow its normal visibility check to settle before requesting playback.
    let frame: number | undefined;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        if (!guard.current || guard.current.check()) handle.play();
      });
    }, 500);
    return () => {
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [canPlay, command?.serial, command?.playing, ready, blockedStatus]);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      try {
        const state = snapshot.current?.();
        if (state?.seek) setSeekState(state.seek.state);
        if (clock.current) {
          const position = clock.current.sample();
          setCurrent(position.seconds);
          setClockReady(position.confirmed);
        } else if (state) {
          if (state.seconds !== null) setCurrent(state.seconds);
          setClockReady(state.status === 'ready');
        }
      } catch {
        /* Loading. */
      }
    }, 500);
    return () => clearInterval(timer);
  }, [ready]);
  return (
    <article
      className={`player-tile ${source ? 'is-source' : ''} ${order.dragging ? 'is-dragging' : ''} ${order.target ? 'is-drop-target' : ''}`}
      aria-label={`${vod.channel} player`}
      data-vod-key={key}
      style={{
        order: order.index,
        gridRow: order.position.row,
        gridColumn: `${order.position.column} / span ${order.position.span}`,
      }}
      onDragOver={order.onOver}
      onDrop={order.onDrop}
    >
      <div className="player-heading">
        <button
          className="icon-button reorder-handle"
          aria-label={`Reorder ${vod.channel}, position ${order.index + 1} of ${order.count}`}
          aria-haspopup="dialog"
          title="Drag to reorder, or click to arrange. Arrow keys move; Home/End move to first/last."
          disabled={order.disabled}
          draggable={!order.disabled}
          onDragStart={order.onStart}
          onDragEnd={order.onEnd}
          onClick={order.onArrange}
          onKeyDown={(event) => {
            const position =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? order.count - 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? order.index - 1
                    : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                      ? order.index + 1
                      : null;
            if (position === null) return;
            event.preventDefault();
            order.onMove(position);
          }}
        >
          <GripVertical size={15} />
        </button>
        <strong title={vod.title}>{vod.channel}</strong>
        {vod.platform === 'kick' && <span className="provider-label">Kick</span>}
        {holding && !blockedStatus && (
          <span className="seek-hold" role="status" title={holdLabel} aria-label={holdLabel}>
            <LoaderCircle className="spin" size={14} />
          </span>
        )}
        <time>{formatTime(external ? match.offsetSeconds : current)}</time>
        <div className="player-actions">
          {!external && (
            <>
              <button
                className={`sync-button ${source ? 'selected' : ''}`}
                disabled={!ready || !clockReady || holding}
                onClick={() => onSync(vod)}
                title={
                  clockReady
                    ? `Sync all players to ${vod.channel}`
                    : 'Wait for the player to load, or press play to enable sync'
                }
              >
                <RefreshCw size={13} />
                <span>Sync</span>
              </button>
              <button
                className="icon-button"
                disabled={!ready || holding}
                aria-label={`${muted ? 'Unmute' : 'Mute'} ${vod.channel}`}
                onClick={() => {
                  player.current?.setMuted(!muted);
                  forceMuted.current = false;
                  setError('');
                  setMuted(!muted);
                }}
              >
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
            </>
          )}
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
          {workspaceControls && <div className="workspace-controls">{workspaceControls}</div>}
        </div>
      </div>
      <div className="player-frame">
        {external ? (
          <div className="external-recording">
            <strong>{vod.title}</strong>
            <time>{formatTime(match.offsetSeconds)}</time>
            <p>{matchDescription(match)}</p>
            <a className="button" href={match.url} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              {match.state === 'playing'
                ? 'Open on Kick at this time'
                : `Open Kick VOD ${match.state === 'before' ? 'start' : 'end'}`}
            </a>
            <button className="text-button" onClick={onSettings}>
              Choose source timestamp
            </button>
            <small>In-app playback is unavailable for this recording.</small>
          </div>
        ) : demo ? (
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
          <div
            className={vod.platform === 'kick' ? 'kick-player' : 'twitch-embed'}
            ref={container}
          />
        )}
        {!external && blockedStatus && (
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
