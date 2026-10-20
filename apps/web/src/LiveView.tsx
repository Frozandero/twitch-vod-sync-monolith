import { useEffect, useRef, useState, type DragEventHandler } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  GripVertical,
  LoaderCircle,
  Minimize2,
  MoreHorizontal,
  Pause,
  Play,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { channelUrl, liveKey, type LiveChannel } from '@vodsync/core';
import { resolveLiveChannel, type TwitchAuth } from '@vodsync/providers';
import type { GridPosition } from './gridLayout';
import { StatusSlot, type BarStatus } from './PlaybackBar';
import { loadTwitchSdk, type TwitchEmbed } from './twitchSdk';
import { useGridLayout } from './useGridLayout';
import { Kbd, PlatformMark } from './ui';

// Live channels play at their own live edge: shared play, pause and mute, no timeline.
export type LiveState = 'loading' | 'live' | 'paused' | 'offline' | 'blocked' | 'error';
type Drawer = 'menu' | 'move';
const platformName = (channel: LiveChannel) => (channel.platform === 'twitch' ? 'Twitch' : 'Kick');

// Whether each channel is broadcasting now, refreshed every minute while the page is
// visible. Kick embeds can't report it themselves, and offline channels wait on it.
export function useLiveStatus(channels: LiveChannel[], auth?: TwitchAuth) {
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const keys = channels.map(liveKey).join('|');
  useEffect(() => {
    if (!channels.length) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      const next: Record<string, boolean> = {};
      for (let i = 0; i < channels.length; i += 4) {
        const batch = channels.slice(i, i + 4);
        const results = await Promise.allSettled(
          batch.map((channel) =>
            resolveLiveChannel(`${channel.platform}/${channel.channel}`, auth),
          ),
        );
        results.forEach((result, j) => {
          if (result.status === 'fulfilled') next[liveKey(batch[j])] = result.value.live;
        });
      }
      if (alive) setOnline((current) => ({ ...current, ...next }));
    };
    void check();
    const timer = setInterval(() => void check(), 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [keys, auth]);
  return online;
}

type Order = {
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

function LivePlayer({
  channel,
  playing,
  muted,
  online,
  soloed,
  busy,
  onMute,
  onSolo,
  onCopy,
  onRemove,
  onState,
  order,
}: {
  channel: LiveChannel;
  playing: boolean;
  muted: boolean;
  // From the status lookup; undefined until the first answer.
  online: boolean | undefined;
  soloed: boolean;
  busy: boolean;
  onMute: (muted: boolean) => void;
  onSolo: () => void;
  onCopy: (url: string) => void;
  onRemove: () => void;
  onState: (key: string, state: LiveState) => void;
  order: Order;
}) {
  const key = liveKey(channel);
  const url = channelUrl(channel);
  const kick = channel.platform === 'kick';
  const [twitchState, setTwitchState] = useState<LiveState>('loading');
  const [latency, setLatency] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const embed = useRef<TwitchEmbed | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const drawerNode = useRef<HTMLDivElement>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const onMuteRef = useRef(onMute);
  onMuteRef.current = onMute;
  const drawerId = `live-drawer-${channel.platform}-${channel.channel}`;

  // Kick's embed has no API: it plays while shown and is recreated to change sound.
  const state: LiveState = kick
    ? online === false
      ? 'offline'
      : playing
        ? 'live'
        : 'paused'
    : online === false && twitchState !== 'live'
      ? 'offline'
      : twitchState;
  useEffect(() => onState(key, state), [key, state]);

  useEffect(() => {
    if (kick) return;
    let alive = true;
    let instance: TwitchEmbed | undefined;
    const node = host.current;
    const listeners: [string, () => void][] = [];
    setTwitchState('loading');
    loadTwitchSdk()
      .then((PlayerClass) => {
        if (!alive || !node) return;
        instance = new PlayerClass(node, {
          channel: channel.channel,
          width: '100%',
          height: '100%',
          parent: [location.hostname],
          autoplay: playingRef.current,
          muted: mutedRef.current,
        });
        const twitch = instance;
        let retriedMuted = false;
        const on = (event: string, callback: () => void) => {
          twitch.addEventListener(event, callback);
          listeners.push([event, callback]);
        };
        on(PlayerClass.READY, () => {
          if (!alive) return;
          embed.current = twitch;
          twitch.setMuted(mutedRef.current);
          if (playingRef.current) twitch.play();
          else {
            twitch.pause();
            setTwitchState('paused');
          }
        });
        on(PlayerClass.PLAYING, () => alive && setTwitchState('live'));
        on(PlayerClass.PAUSE, () => alive && setTwitchState('paused'));
        on(PlayerClass.OFFLINE, () => alive && setTwitchState('offline'));
        on(PlayerClass.ENDED, () => alive && setTwitchState('offline'));
        on(PlayerClass.ONLINE, () => {
          if (!alive) return;
          setTwitchState(playingRef.current ? 'loading' : 'paused');
          if (playingRef.current) twitch.play();
        });
        on(PlayerClass.PLAYBACK_BLOCKED, () => {
          if (!alive) return;
          // Browsers block unmuted starts without a gesture; try once more without sound.
          if (!retriedMuted && !mutedRef.current) {
            retriedMuted = true;
            twitch.setMuted(true);
            onMuteRef.current(true);
            twitch.play();
            return;
          }
          setTwitchState('blocked');
        });
      })
      .catch(() => alive && setTwitchState('error'));
    return () => {
      alive = false;
      for (const [event, callback] of listeners) instance?.removeEventListener(event, callback);
      embed.current = null;
      node?.replaceChildren();
    };
  }, [kick, channel.channel, attempt]);

  // Follow the shared play/pause and this player's sound without rebuilding the embed.
  useEffect(() => {
    const twitch = embed.current;
    if (!twitch) return;
    if (playing) twitch.play();
    else twitch.pause();
  }, [playing]);
  useEffect(() => {
    embed.current?.setMuted(muted);
  }, [muted]);
  // Twitch can hold a start for the viewer (a content-classification notice, or a browser
  // autoplay block). Say so instead of looking stuck; never click through it.
  useEffect(() => {
    if (kick || !playing || (twitchState !== 'loading' && twitchState !== 'paused')) return;
    const timer = setTimeout(() => setTwitchState('blocked'), 8000);
    return () => clearTimeout(timer);
  }, [kick, playing, twitchState]);
  useEffect(() => {
    if (kick || twitchState !== 'live') {
      setLatency(null);
      return;
    }
    const sample = () => {
      const value = embed.current?.getPlaybackStats()?.hlsLatencyBroadcaster;
      setLatency(typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
    };
    sample();
    const timer = setInterval(sample, 2000);
    return () => clearInterval(timer);
  }, [kick, twitchState]);

  function toggleDrawer(kind: Drawer, trigger: HTMLElement) {
    drawerTrigger.current = trigger;
    setDrawer((open) => (open === kind ? null : kind));
  }
  function closeDrawer() {
    setDrawer(null);
    requestAnimationFrame(() => {
      const trigger = drawerTrigger.current?.isConnected
        ? drawerTrigger.current
        : moreButton.current;
      trigger?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (!drawer) return;
    drawerNode.current
      ?.querySelector<HTMLElement>('button:not(:disabled), select')
      ?.focus({ preventScroll: true });
  }, [drawer]);

  const chip =
    state === 'loading'
      ? { text: 'loading', tone: 'muted', spin: true }
      : state === 'paused'
        ? { text: 'paused', tone: 'muted' }
        : state === 'offline'
          ? { text: 'offline', tone: 'muted', title: `Starts when ${channel.name} goes live` }
          : state === 'blocked'
            ? {
                text: 'press play',
                tone: 'warning',
                title:
                  'Twitch is waiting for you: press play inside this player, or confirm its content notice.',
              }
            : state === 'error'
              ? {
                  text: 'player problem',
                  tone: 'signal',
                  title: 'Reload the player from its ⋯ menu.',
                }
              : null;
  return (
    <article
      className={`tile ${order.dragging ? 'is-dragging' : ''} ${order.target ? 'is-drop-target' : ''}`}
      aria-label={`${channel.name} live player`}
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
          aria-label={`Reorder ${channel.name}, position ${order.index + 1} of ${order.count}`}
          aria-expanded={drawer === 'move'}
          aria-controls={drawer ? drawerId : undefined}
          title="Drag to reorder, or click to choose a position. Arrow keys move; Home/End move to first/last."
          disabled={order.disabled}
          draggable={!order.disabled}
          onDragStart={order.onStart}
          onDragEnd={order.onEnd}
          onClick={(event) => toggleDrawer('move', event.currentTarget)}
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
          <GripVertical size={14} />
        </button>
        <PlatformMark platform={channel.platform} />
        <strong className="tile-name" title={channel.name}>
          {channel.name}
        </strong>
        <span className="tile-spacer" />
        {chip && (
          <span className={`tile-status ${chip.tone}`} title={chip.title}>
            {chip.spin && <LoaderCircle className="spin" size={12} aria-hidden="true" />}
            <span>{chip.text}</span>
          </span>
        )}
        <a
          className="tile-time"
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${channel.name} on ${platformName(channel)}`}
          title={
            latency === null
              ? `Open on ${platformName(channel)}`
              : `${latency.toFixed(1)} s behind the broadcaster · open on ${platformName(channel)}`
          }
        >
          {state === 'live' && <i className="live-dot" aria-hidden="true" />}
          <span>
            {state === 'live' ? (latency === null ? 'live' : `${latency.toFixed(1)} s`) : 'channel'}
          </span>
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
        <div className="tile-actions">
          <button
            className={`icon-btn ${muted ? 'subtle' : 'on'}`}
            aria-label={`${muted ? 'Unmute' : 'Mute'} ${channel.name}`}
            title={muted ? 'Unmute' : 'Mute'}
            onClick={() => onMute(!muted)}
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button
            ref={moreButton}
            className={`icon-btn ${drawer === 'menu' ? 'on' : ''}`}
            aria-label={`More for ${channel.name}`}
            aria-expanded={drawer === 'menu'}
            aria-controls={drawer ? drawerId : undefined}
            onClick={(event) => toggleDrawer('menu', event.currentTarget)}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>
      {drawer && (
        <div
          ref={drawerNode}
          className="tile-drawer"
          id={drawerId}
          role="group"
          aria-label={`${channel.name} ${drawer === 'menu' ? 'actions' : 'move'}`}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeDrawer();
          }}
        >
          <div className="drawer-body">
            {drawer === 'menu' ? (
              <>
                <button
                  className="drawer-btn"
                  disabled={soloed}
                  onClick={() => {
                    onSolo();
                    closeDrawer();
                  }}
                >
                  Listen to {channel.name} only
                </button>
                <button
                  className="drawer-btn"
                  onClick={() => {
                    onCopy(url);
                    closeDrawer();
                  }}
                >
                  Copy channel link
                </button>
                <button
                  className="drawer-btn"
                  disabled={order.disabled}
                  onClick={() => setDrawer('move')}
                >
                  Move to position
                </button>
                <button
                  className="drawer-btn"
                  onClick={() => {
                    setAttempt((n) => n + 1);
                    closeDrawer();
                  }}
                >
                  <RotateCw size={13} aria-hidden="true" />
                  Reload player
                </button>
                <button className="drawer-btn danger" disabled={busy} onClick={onRemove}>
                  Close {channel.name}
                </button>
              </>
            ) : (
              <div className="drawer-move">
                <label>
                  Position
                  <select
                    className="field"
                    value={order.index}
                    disabled={order.disabled}
                    onChange={(event) => order.onMove(Number(event.target.value))}
                  >
                    {Array.from({ length: order.count }, (_, position) => (
                      <option key={position} value={position}>
                        {position + 1} of {order.count}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="icon-btn"
                  aria-label={`Move ${channel.name} earlier`}
                  title="Move earlier"
                  disabled={order.disabled || order.index === 0}
                  onClick={() => order.onMove(order.index - 1)}
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Move ${channel.name} later`}
                  title="Move later"
                  disabled={order.disabled || order.index === order.count - 1}
                  onClick={() => order.onMove(order.index + 1)}
                >
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-btn small"
            aria-label={`Close ${channel.name} ${drawer === 'menu' ? 'actions' : 'move'}`}
            onClick={closeDrawer}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="tile-frame">
        {kick ? (
          state === 'live' ? (
            // Recreated (not re-sourced) to apply Kick's documented muted parameter.
            <iframe
              key={`${muted}-${attempt}`}
              className="kick-embed"
              src={`https://player.kick.com/${encodeURIComponent(channel.channel)}?autoplay=true&muted=${muted}`}
              title={`${channel.name} on Kick`}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="frame-panel">
              <strong>{state === 'offline' ? `${channel.name} is offline` : 'Paused'}</strong>
              <span>
                {state === 'offline'
                  ? 'Starts when the stream goes live'
                  : 'Kick rejoins the live edge when you press play'}
              </span>
            </div>
          )
        ) : (
          <div className="twitch-embed" ref={host} />
        )}
      </div>
    </article>
  );
}

export function LiveGrid({
  channels,
  playing,
  mutedKeys,
  online,
  soloKey,
  busy,
  onMute,
  onSolo,
  onCopy,
  onRemove,
  onReorder,
  onState,
}: {
  channels: LiveChannel[];
  playing: boolean;
  mutedKeys: Set<string>;
  online: Record<string, boolean>;
  soloKey: string;
  busy: boolean;
  onMute: (channel: LiveChannel, muted: boolean) => void;
  onSolo: (channel: LiveChannel) => void;
  onCopy: (channel: LiveChannel, url: string) => void;
  onRemove: (channel: LiveChannel) => void;
  onReorder: (key: string, position: number) => void;
  onState: (key: string, state: LiveState) => void;
}) {
  const { grid, rows, tracks, positions } = useGridLayout(channels.length);
  const [draggingKey, setDraggingKey] = useState('');
  const [dropKey, setDropKey] = useState('');
  return (
    <div
      ref={grid}
      className={`player-grid ${draggingKey ? 'is-reordering' : ''}`}
      style={{
        gridTemplateColumns: `repeat(${tracks}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(auto, 1fr))`,
      }}
    >
      {/* Keep iframe DOM positions stable: moving an iframe reloads it even with React keys. */}
      {[...channels]
        .sort((a, b) => liveKey(a).localeCompare(liveKey(b)))
        .map((channel) => {
          const key = liveKey(channel);
          const index = channels.indexOf(channel);
          return (
            <LivePlayer
              key={key}
              channel={channel}
              playing={playing}
              muted={mutedKeys.has(key)}
              online={online[key]}
              soloed={soloKey === key}
              busy={busy}
              onMute={(muted) => onMute(channel, muted)}
              onSolo={() => onSolo(channel)}
              onCopy={(url) => onCopy(channel, url)}
              onRemove={() => onRemove(channel)}
              onState={onState}
              order={{
                index,
                position: positions[index],
                count: channels.length,
                disabled: busy || channels.length < 2,
                dragging: draggingKey === key,
                target: dropKey === key && draggingKey !== key,
                onStart: (event) => {
                  event.dataTransfer.setData('text/plain', key);
                  event.dataTransfer.effectAllowed = 'move';
                  setDraggingKey(key);
                  setDropKey(key);
                },
                onEnd: () => {
                  setDraggingKey('');
                  setDropKey('');
                },
                onOver: (event) => {
                  if (!draggingKey) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropKey(key);
                },
                onDrop: (event) => {
                  if (!draggingKey) return;
                  event.preventDefault();
                  onReorder(draggingKey, index);
                  setDraggingKey('');
                  setDropKey('');
                },
                onMove: (position) => onReorder(key, position),
              }}
            />
          );
        })}
    </div>
  );
}

export function LiveBar({
  playing,
  onPlayback,
  status,
  watchMode,
  onExitWatch,
}: {
  playing: boolean;
  onPlayback: () => void;
  status: BarStatus;
  watchMode: boolean;
  onExitWatch: () => void;
}) {
  const label = playing ? 'Pause all' : 'Play all';
  return (
    <section className="playbar" aria-label="Playback">
      <div className="playbar-row">
        <div className="transport">
          <button
            className="play-btn"
            aria-label={label}
            title={`${label} (Space)`}
            onClick={onPlayback}
          >
            {playing ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
          </button>
        </div>
        <span className="live-badge">
          <i className="live-dot" aria-hidden="true" />
          Live
        </span>
        <span className="bar-divider" />
        <StatusSlot status={status} />
        <div className="bar-right">
          {watchMode && (
            <button className="ghost-btn" title="Exit watch mode (Esc)" onClick={onExitWatch}>
              <Minimize2 size={15} />
              <span>Exit</span>
              <Kbd>Esc</Kbd>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
