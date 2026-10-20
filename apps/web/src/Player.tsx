import { useEffect, useRef, useState, type DragEventHandler } from 'react';
import {
  ArrowUpRight,
  GripVertical,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  formatTime,
  matchDescription,
  matchMoment,
  startMs,
  timestampUrl,
  vodKey,
  type Vod,
} from '@vodsync/core';
import { DRIFT_LIMIT } from './syncSummary';
import { clock as wallClock, formatDelta } from './timeFormat';
import { TimingControls } from './TimingControls';
import { MoveControls, PlatformMark, gripPosition } from './ui';
import { createPlayerClock } from './playerClock';
import { createVodGuard, type PlaybackSnapshot, type StopReason } from './playback';
import { createSeekPreparation, seekPosition, type SeekState } from './seekBarrier';
import { supportsPlayback } from './capabilities';
import { createKickPlayer } from './kickPlayer';
import { loadTwitchSdk as loadSdk, type TwitchEmbed } from './twitchSdk';
import type { GridPosition } from './gridLayout';

// Player messages can be long; the header shows a short label that opens the full text.
function shortError(message: string) {
  if (/started muted/i.test(message)) return 'started muted';
  if (/retrying muted/i.test(message)) return 'retrying muted';
  if (/blocked/i.test(message)) return 'playback blocked';
  if (/too long|timed out/i.test(message)) return 'slow to load';
  if (/not ready to seek/i.test(message)) return 'not ready';
  return 'player problem';
}
type Drawer = 'menu' | 'timing' | 'move' | 'error';

export type PlayerHandle = {
  getSnapshot(): PlaybackSnapshot;
  getCurrentTime(): number;
  isPaused(): boolean;
  seek(time: number): void;
  pause(): void;
  play(): void;
  setMuted(muted: boolean): void;
};
type TwitchPlayer = TwitchEmbed;
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
  onStopped: (vod: Vod, reason: StopReason) => void;
  onDuration: (key: string, seconds: number) => void;
  // Verified drift against the selected moment, sampled with the shared clock.
  drift: number | null;
  sourceName: string;
  // The recording that currently plays sound, or '' to follow the source.
  audioKey: string;
  soloed: boolean;
  busy: boolean;
  localTime: boolean;
  onSolo: () => void;
  onSeekTo: (offsetSeconds: number, correctionSeconds?: number) => void;
  onJump: (moment: number) => void;
  onCorrect: (seconds: number) => void;
  onCopy: (url: string) => void;
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
  onStopped,
  onDuration,
  drift,
  sourceName,
  audioKey,
  soloed,
  busy,
  localTime,
  onSolo,
  onSeekTo,
  onJump,
  onCorrect,
  onCopy,
  order,
}: Props) {
  const moreButton = useRef<HTMLButtonElement>(null);
  const drawerNode = useRef<HTMLDivElement>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
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
  const drawerId = `drawer-${vod.platform}-${vod.id}`;
  function toggleDrawer(kind: Drawer, trigger: HTMLElement) {
    drawerTrigger.current = trigger;
    setDrawer((open) => (open === kind || (kind === 'menu' && open === 'timing') ? null : kind));
  }
  function closeDrawer() {
    setDrawer(null);
    // The trigger may be gone (a cleared error label); fall back to the ⋯ button.
    requestAnimationFrame(() => {
      const trigger = drawerTrigger.current?.isConnected
        ? drawerTrigger.current
        : moreButton.current;
      trigger?.focus({ preventScroll: true });
    });
  }
  // Move focus into a drawer as it opens or changes view.
  useEffect(() => {
    if (!drawer || drawer === 'timing') return;
    drawerNode.current
      ?.querySelector<HTMLElement>('button:not(:disabled), select, input')
      ?.focus({ preventScroll: true });
  }, [drawer]);
  // A resolved error closes its details so the next one never opens unprompted. The
  // drawer is already gone by then, so remember whether focus was inside it.
  const focusInDrawer = useRef(false);
  useEffect(() => {
    if (error || drawer !== 'error') return;
    setDrawer(null);
    const lost = !document.activeElement || document.activeElement === document.body;
    if (focusInDrawer.current && lost) moreButton.current?.focus({ preventScroll: true });
    focusInDrawer.current = false;
  }, [error, drawer]);
  const openDrawer = drawer === 'error' && !error ? null : drawer;
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
  // A soloed player keeps the audio across seeks; otherwise the source plays sound.
  const audioRef = useRef(audioKey);
  audioRef.current = audioKey;
  const audible = (leader: string) =>
    audioRef.current ? audioRef.current === key : leader === key;
  useEffect(() => {
    const handle = player.current;
    if (!ready || !handle || !command || blockedStatus || command.phase === 'preparing') return;
    const silent = !audible(command.leader) || forceMuted.current;
    try {
      handle.setMuted(silent);
      setMuted(silent);
    } catch {
      /* The player will apply audio on its next command. */
    }
  }, [audioKey]);
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
    const silent = command.phase === 'preparing' || !audible(command.leader) || forceMuted.current;
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
    const silent = !audible(command.leader) || forceMuted.current;
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
  const end = startMs(vod) + vod.durationSeconds * 1000;
  const time = formatTime(external ? match.offsetSeconds : current);
  const link = timestampUrl(vod, linkOffset);
  const platformName = vod.platform === 'kick' ? 'Kick' : 'Twitch';
  const status: {
    text: string;
    tone: string;
    spin?: boolean;
    title?: string;
    detail?: boolean;
  } | null = error
    ? { text: shortError(error), tone: /muted/i.test(error) ? 'muted' : 'signal', detail: true }
    : holding && !blockedStatus
      ? {
          text:
            command?.phase === 'starting'
              ? 'starting'
              : seekState === 'ready'
                ? 'ready'
                : 'buffering',
          tone: 'muted',
          spin: command?.phase === 'starting' || seekState !== 'ready',
          title: holdLabel,
        }
      : external
        ? { text: 'link only', tone: 'muted' }
        : blockedStatus === 'before'
          ? { text: 'not started', tone: 'muted' }
          : blockedStatus === 'ended'
            ? { text: 'ended', tone: 'muted' }
            : blockedStatus === 'changed'
              ? { text: 'stopped', tone: 'warning' }
              : drift !== null && Math.abs(drift) > DRIFT_LIMIT
                ? {
                    text: formatDelta(drift),
                    tone: 'warning',
                    title: `This player is ${formatDelta(drift)} from the selected moment`,
                  }
                : null;
  const boundary =
    !external && blockedStatus
      ? blockedStatus === 'before'
        ? {
            title: `Starts in ${formatTime(match.gapSeconds)}`,
            detail: `Live at ${wallClock(startMs(vod), localTime)}${localTime ? '' : ' UTC'}`,
            action: 'Move everyone to its start',
            run: () => onJump(startMs(vod)),
          }
        : blockedStatus === 'changed'
          ? {
              title: 'Twitch switched to another video',
              detail: 'Stopped to keep the clock right',
              action: `Reload ${vod.channel}’s VOD`,
              run: () => setStopped(undefined),
            }
          : {
              title:
                match.state === 'ended'
                  ? `Ended ${formatTime(match.gapSeconds)} earlier`
                  : 'This VOD has ended',
              detail: 'Seek earlier to bring it back',
              action: 'Go to its last minute',
              run: () => onJump(end - Math.min(60000, (vod.durationSeconds * 1000) / 2)),
            }
      : null;
  return (
    <article
      className={`tile ${source ? 'is-source' : ''} ${order.dragging ? 'is-dragging' : ''} ${order.target ? 'is-drop-target' : ''}`}
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
      <div className="tile-head">
        <button
          className="icon-btn reorder-handle"
          aria-label={`Reorder ${vod.channel}, position ${order.index + 1} of ${order.count}`}
          aria-expanded={openDrawer === 'move'}
          aria-controls={openDrawer ? drawerId : undefined}
          title="Drag to reorder, or click to choose a position. Arrow keys move; Home/End move to first/last."
          disabled={order.disabled}
          draggable={!order.disabled}
          onDragStart={order.onStart}
          onDragEnd={order.onEnd}
          onClick={(event) => toggleDrawer('move', event.currentTarget)}
          onKeyDown={(event) => {
            const position = gripPosition(event.key, order.index, order.count);
            if (position === null) return;
            event.preventDefault();
            order.onMove(position);
          }}
        >
          <GripVertical size={14} />
        </button>
        <PlatformMark platform={vod.platform} />
        <strong className="tile-name" title={vod.title}>
          {vod.channel}
        </strong>
        {source && (
          <span className="tile-source" title="Reference clock and audio for the session">
            source
          </span>
        )}
        <span className="tile-spacer" />
        {/* Announce player problems once; the visible label stays short. */}
        <span className="sr-only" role="status">
          {error && `${vod.channel}: ${error}`}
        </span>
        {status?.detail ? (
          <button
            type="button"
            className={`tile-status ${status.tone}`}
            aria-expanded={openDrawer === 'error'}
            aria-controls={openDrawer ? drawerId : undefined}
            aria-label={`${vod.channel}: ${error}`}
            onClick={(event) => toggleDrawer('error', event.currentTarget)}
          >
            <span>{status.text}</span>
          </button>
        ) : (
          status && (
            <span className={`tile-status ${status.tone}`} title={status.title}>
              {status.spin && <LoaderCircle className="spin" size={12} aria-hidden="true" />}
              <span>{status.text}</span>
            </span>
          )
        )}
        <a
          className="tile-time"
          href={link}
          target="_blank"
          rel="noreferrer"
          aria-label={
            match.state === 'playing' || external
              ? `Open ${vod.channel} on ${platformName} at ${formatTime(linkOffset)}`
              : `Open ${vod.channel} VOD ${match.state === 'before' ? 'start' : 'end'} on ${platformName} — ${matchDescription(match)}`
          }
          title={
            match.state === 'playing' || external
              ? `Open on ${platformName} at ${formatTime(linkOffset)}`
              : `Open VOD ${match.state === 'before' ? 'start' : 'end'} · ${matchDescription(match)}`
          }
        >
          <time>{time}</time>
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
        <div className="tile-actions">
          {!external && (
            <>
              <button
                className="icon-btn"
                aria-label={`Sync everyone to ${vod.channel}`}
                disabled={!ready || !clockReady || holding}
                onClick={() => onSync(vod)}
                title={
                  clockReady
                    ? 'Sync everyone to this moment'
                    : 'Wait for the player to load, or press play to enable sync'
                }
              >
                <RefreshCw size={15} />
              </button>
              <button
                className={`icon-btn ${muted ? 'subtle' : 'on'}`}
                disabled={!ready || holding}
                aria-label={`${muted ? 'Unmute' : 'Mute'} ${vod.channel}`}
                title={muted ? 'Unmute' : 'Mute'}
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
            ref={moreButton}
            className={`icon-btn ${drawer === 'menu' || drawer === 'timing' ? 'on' : ''}`}
            aria-label={`More for ${vod.channel}`}
            aria-expanded={drawer === 'menu' || drawer === 'timing'}
            aria-controls={openDrawer ? drawerId : undefined}
            onClick={(event) => toggleDrawer('menu', event.currentTarget)}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>
      {/* The drawer pushes the video down instead of covering it: Twitch pauses covered embeds. */}
      {openDrawer && (
        <div
          ref={drawerNode}
          className="tile-drawer"
          id={drawerId}
          role="group"
          aria-label={`${vod.channel} ${drawer === 'menu' ? 'actions' : drawer}`}
          onFocus={() => (focusInDrawer.current = true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) focusInDrawer.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeDrawer();
          }}
        >
          <div className="drawer-body">
            {drawer === 'menu' && (
              <>
                <button
                  className="drawer-btn"
                  disabled={busy}
                  title={busy ? 'Wait for the recordings being added' : undefined}
                  onClick={() => setDrawer('timing')}
                >
                  Timing
                </button>
                <button
                  className="drawer-btn"
                  disabled={external || !ready || soloed}
                  onClick={() => {
                    onSolo();
                    closeDrawer();
                  }}
                >
                  Listen to {vod.channel} only
                </button>
                <button
                  className="drawer-btn"
                  onClick={() => {
                    onCopy(link);
                    closeDrawer();
                  }}
                >
                  Copy timestamp link
                </button>
                <button
                  className="drawer-btn"
                  disabled={order.disabled}
                  onClick={() => setDrawer('move')}
                >
                  Move to position
                </button>
                <button className="drawer-btn danger" disabled={busy} onClick={onRemove}>
                  Close {vod.channel}
                </button>
              </>
            )}
            {drawer === 'timing' && (
              <TimingControls
                vod={vod}
                moment={moment}
                drift={drift}
                source={source}
                sourceName={sourceName}
                onSeek={onSeekTo}
                onCorrect={onCorrect}
                onDone={closeDrawer}
              />
            )}
            {drawer === 'move' && (
              <MoveControls
                name={vod.channel}
                index={order.index}
                count={order.count}
                disabled={order.disabled}
                onMove={order.onMove}
              />
            )}
            {drawer === 'error' && (
              <>
                <p className="drawer-message">{error}</p>
                <button
                  className="drawer-btn"
                  onClick={() => {
                    closeDrawer();
                    setError('');
                    setAttempt((n) => n + 1);
                  }}
                >
                  <RotateCw size={13} aria-hidden="true" />
                  Reload player
                </button>
              </>
            )}
          </div>
          <button
            className="icon-btn small"
            aria-label={`Close ${vod.channel} ${drawer === 'menu' ? 'actions' : drawer}`}
            onClick={closeDrawer}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="tile-frame">
        {external ? (
          <div className="frame-panel">
            <strong>Can’t play this recording here</strong>
            <span>The link still follows the selected moment</span>
            <a className="outline-btn" href={match.url} target="_blank" rel="noreferrer">
              Open at {formatTime(match.offsetSeconds)}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
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
        {boundary && (
          <div className="frame-panel boundary">
            <strong>{boundary.title}</strong>
            <span>{boundary.detail}</span>
            <button className="outline-btn" onClick={boundary.run}>
              {boundary.action}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
