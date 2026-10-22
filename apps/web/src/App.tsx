import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  Maximize2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCw,
  Share2,
  Undo2,
  X,
} from 'lucide-react';
import {
  MAX_VODS,
  decodeLiveSession,
  decodeSession,
  encodeLiveSession,
  encodeSession,
  isLiveSession,
  liveKey,
  validateLiveSession,
  formatTime,
  groupLanes,
  laneKey,
  laneVod,
  laneVods,
  matchMoment,
  momentAt,
  startMs,
  timelineBounds,
  validateSession,
  vodKey,
  type ClipMarker,
  type Lane,
  type LiveChannel,
  type LiveSession,
  type Session,
  type Vod,
} from '@vodsync/core';
import type { TwitchAuth } from '@vodsync/providers';
import { resolveRecordingInputs, type InputResult } from './recordingInputs';
import { opensLive, resolveLiveInputs, type LiveInputResult } from './liveInputs';
import { LiveBar, LiveGrid, useLiveStatus, type LiveState } from './LiveView';
import {
  beginLogin,
  configuredClientId,
  disconnect,
  redirectUri,
  restoreAuth,
  validateAuth,
} from './auth';
import { Player, type PlayerHandle, type SyncCommand } from './Player';
import { PlaybackBar, type BarStatus } from './PlaybackBar';
import type { PlaybackSnapshot, StopReason } from './playback';
import { seekBarrier } from './seekBarrier';
import { anyPlaying, startDecision, startProgress } from './playbackStart';
import { readStorage, writeStorage } from './storage';
import { supportsPlayback } from './capabilities';
import { useGridLayout } from './useGridLayout';
import { driftSeconds, syncSummary } from './syncSummary';
import { overlapRange, viewRange } from './timelineScale';
import { clock, formatDelta, formatSpan } from './timeFormat';
import { readRecent, rememberSession, writeRecent, type RecentSession } from './recentSessions';
import { StartScreen, splitInputs } from './StartScreen';
import { BrandMark, Kbd, PlatformMark, claimsKey } from './ui';

const SESSION_KEY = 'vodsync.session.v1'; // Preserve and migrate existing workspaces.
const LIVE_KEY = 'vodsync.live.v1';
const TIMELINE_KEY = 'vodsync.timelineCollapsed';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Please retry.');
const narrowQuery = '(max-width: 700px)';
const isNarrow = () => typeof matchMedia === 'function' && matchMedia(narrowQuery).matches;
function gridSession(session: Session): Session {
  return { ...session, view: 'grid' };
}
function initialState(): { session?: Session; live?: LiveSession; error?: string } {
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    const shared = hash.get('session');
    if (shared) return { session: gridSession(decodeSession(shared)) };
    const sharedLive = hash.get('live');
    if (sharedLive) return { live: decodeLiveSession(sharedLive) };
    const saved = readStorage(SESSION_KEY);
    if (saved) return { session: gridSession(validateSession(JSON.parse(saved))) };
    const savedLive = readStorage(LIVE_KEY);
    return savedLive ? { live: validateLiveSession(JSON.parse(savedLive)) } : {};
  } catch (error) {
    return { error: messageOf(error) };
  }
}
// A new or loaded live session gives sound to its first channel only.
const firstSound = (channels: LiveChannel[]): Record<string, boolean> =>
  channels.length ? { [liveKey(channels[0])]: true } : {};
const shortInput = (input: string) => input.replace(/^https?:\/\/(www\.|m\.)?/i, '');
function mergeClips(current: ClipMarker[], added: ClipMarker[]) {
  const known = new Set(current.map((clip) => `${clip.platform}:${clip.id}`));
  return [...current, ...added.filter((clip) => !known.has(`${clip.platform}:${clip.id}`))];
}
const REPO_URL = 'https://github.com/Frozandero/twitch-vod-sync-monolith';
const SHORTCUTS: [string[], string][] = [
  [['Space'], 'Play or pause'],
  [['J', 'L'], '±10 s'],
  [['←', '→'], '±5 s'],
  [['S'], 'Resync'],
  [['T'], 'Timeline'],
  [['F', 'Esc'], 'Watch mode'],
  [['/'], 'Add'],
  [['⌘Z'], 'Undo close'],
];

// Live sessions have no clock to skip, resync or show on a timeline.
const LIVE_SHORTCUTS = new Set(['Play or pause', 'Watch mode', 'Add', 'Undo close']);

// Panels open as compact rows below the top bar. Twitch pauses an embed that anything covers
// or that is pushed mostly out of view, so nothing here may float or grow tall.
function Panel({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const node = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    node.current
      ?.querySelector<HTMLElement>('input, button:not(.panel-close), a[href]')
      ?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={node}
      className="top-panel"
      aria-labelledby="panel-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close();
      }}
    >
      <h2 id="panel-title">{title}</h2>
      <div className="panel-body">{children}</div>
      <button className="icon-btn small panel-close" aria-label={`Close ${title}`} onClick={close}>
        <X size={14} />
      </button>
    </section>
  );
}

export default function App() {
  const [initial] = useState(initialState);
  const [vods, setVods] = useState<Vod[]>(initial.session?.vods || []);
  const [clips, setClips] = useState<ClipMarker[]>(initial.session?.clips || []);
  // A live session replaces the recording workspace: channels at their own live edge.
  const [live, setLive] = useState<LiveChannel[]>(initial.live?.channels || []);
  const [livePlaying, setLivePlaying] = useState(false);
  // Sound per channel, set when a session starts; missing channels are muted.
  const [liveSound, setLiveSound] = useState<Record<string, boolean>>(() =>
    firstSound(initial.live?.channels || []),
  );
  const [liveSolo, setLiveSolo] = useState('');
  const [liveStates, setLiveStates] = useState<Record<string, LiveState>>({});
  const [liveRemoved, setLiveRemoved] = useState<{
    channel: LiveChannel;
    index: number;
    shownAt: number;
  }>();
  const [leaderKey, setLeaderKey] = useState(initial.session?.leaderKey || '');
  const [moment, setMoment] = useState(initial.session?.momentMs || 0);
  const momentRef = useRef(moment);
  const vodsRef = useRef(vods);
  vodsRef.current = vods;
  momentRef.current = moment;
  // A streamer's recordings share one lane: one tile and one timeline row.
  const lanes = groupLanes(vods);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [results, setResults] = useState<(InputResult | LiveInputResult)[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [notice, setNotice] = useState(initial.error || '');
  const [flash, setFlash] = useState('');
  const [modal, setModal] = useState<'settings' | 'help' | null>(null);
  const [draggingKey, setDraggingKey] = useState('');
  const [dropKey, setDropKey] = useState('');
  const [orderAnnouncement, setOrderAnnouncement] = useState('');
  // The last closed lane: all of its recordings and its former position.
  const [removed, setRemoved] = useState<{
    vods: Vod[];
    name: string;
    index: number;
    moment: number;
    clips: ClipMarker[];
    shownAt: number;
  }>();
  const [watchMode, setWatchMode] = useState(false);
  const { grid, rows, tracks, positions } = useGridLayout(lanes.length);
  const [narrow, setNarrow] = useState(isNarrow);
  const [expanded, setExpanded] = useState(
    () => !isNarrow() && readStorage(TIMELINE_KEY) !== 'true',
  );
  const [localTime, setLocalTime] = useState(false);
  const [zoom, setZoom] = useState<'all' | 'overlap'>('all');
  const [audioKey, setAudioKey] = useState('');
  // Speakers set by hand, by streamer lane. They survive seeks and syncs; solo resets them.
  const [sound, setSound] = useState<Record<string, boolean>>({});
  const [recent, setRecent] = useState<RecentSession[]>(() => readRecent());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const resultsNode = useRef<HTMLDivElement>(null);
  const addField = useRef<HTMLTextAreaElement>(null);
  const startField = useRef<HTMLTextAreaElement>(null);
  const addForm = useRef<HTMLDivElement>(null);
  const [auth, setAuth] = useState<TwitchAuth>();
  const [clientId, setClientId] = useState(
    configuredClientId || readStorage('vodsync.clientId') || '',
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playbackStates, setPlaybackStates] = useState<Record<string, PlaybackSnapshot>>({});
  const leaderRef = useRef(leaderKey);
  leaderRef.current = leaderKey;
  const playerStopped = useCallback((vod: Vod, reason: StopReason) => {
    if (vodKey(vod) !== leaderRef.current) return;
    setPlaying(false);
    if (
      reason === 'ended' &&
      commandRef.current?.phase !== 'preparing' &&
      commandRef.current?.phase !== 'starting'
    )
      setMoment(startMs(vod) + vod.durationSeconds * 1000);
  }, []);
  const [command, setCommand] = useState<SyncCommand | null>(() =>
    initial.session
      ? {
          moment: initial.session.momentMs,
          playing: false,
          leader: initial.session.leaderKey,
          serial: 0,
          startAttempt: 0,
          phase: 'preparing',
        }
      : null,
  );
  const commandRef = useRef(command);
  commandRef.current = command;
  const [seekStartedAt, setSeekStartedAt] = useState(Date.now);
  const startRequestedAt = useRef(0);
  function updateCommand(next: SyncCommand | null) {
    commandRef.current = next;
    setCommand(next);
  }
  const handles = useRef(new Map<string, PlayerHandle>());
  const importInput = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const serial = useRef(0);
  const demo = vods.some((v) => v.provenance === 'demo');
  const register = useCallback((key: string, handle: PlayerHandle | null) => {
    if (handle) handles.current.set(key, handle);
    else handles.current.delete(key);
  }, []);
  const updateDuration = useCallback((key: string, seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 31536000) return;
    // Session UTC moments have millisecond precision. Round inward so a tiny
    // media-duration rounding difference cannot demand nonexistent end buffer.
    const duration = Math.floor(seconds * 1000) / 1000;
    if (duration <= 0) return;
    // Kick's broadcast metadata can overestimate the finished playlist. Use the
    // loaded media's actual end for coverage and buffer requirements.
    setVods((current) =>
      current.map((vod) =>
        vod.platform === 'kick' && vodKey(vod) === key && vod.durationSeconds !== duration
          ? { ...vod, durationSeconds: duration }
          : vod,
      ),
    );
  }, []);
  const session = (): Session =>
    validateSession({ version: 2, vods, leaderKey, momentMs: moment, view: 'grid', clips });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const liveSession = (): LiveSession =>
    validateLiveSession({ version: 2, kind: 'live', channels: live });
  const liveOnline = useLiveStatus(live, auth);
  const mutedKeys = new Set(live.filter((channel) => !liveSound[liveKey(channel)]).map(liveKey));
  const updateLiveState = useCallback((key: string, state: LiveState) => {
    setLiveStates((current) => (current[key] === state ? current : { ...current, [key]: state }));
  }, []);

  useEffect(() => {
    restoreAuth()
      .then(setAuth)
      .catch((error) => setNotice(messageOf(error)))
      .finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    if (!auth) return;
    const timer = setInterval(
      () => {
        validateAuth(auth).catch((error) => {
          disconnect();
          setAuth(undefined);
          setNotice(messageOf(error));
        });
      },
      55 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, [auth]);
  useEffect(() => {
    if (!vods.length) {
      writeStorage(SESSION_KEY, null);
      return;
    }
    try {
      writeStorage(SESSION_KEY, JSON.stringify(session()));
    } catch {
      /* Transient state while changing recordings. */
    }
  }, [vods, leaderKey, moment, clips]);
  useEffect(() => {
    if (!live.length) {
      writeStorage(LIVE_KEY, null);
      return;
    }
    try {
      writeStorage(LIVE_KEY, JSON.stringify(liveSession()));
    } catch {
      /* Transient state while changing channels. */
    }
  }, [live]);
  // Keep a short local history of sessions; the newest state replaces older ones.
  function remember() {
    try {
      const entry = live.length ? liveSession() : vods.length ? sessionRef.current() : undefined;
      if (!entry) return;
      const next = rememberSession(readRecent(), entry);
      writeRecent(next);
      setRecent(next);
    } catch {
      /* A transient session cannot be remembered yet. */
    }
  }
  // Remember additions and source changes; closing recordings alone isn't a new session.
  const rememberedKeys = useRef(new Set<string>());
  useEffect(() => {
    const current = new Set(vods.map(vodKey));
    const shrank =
      current.size < rememberedKeys.current.size &&
      [...current].every((key) => rememberedKeys.current.has(key));
    rememberedKeys.current = current;
    if (vods.length && !shrank) remember();
  }, [vods.map(vodKey).join('|'), leaderKey]);
  const rememberedLive = useRef(new Set<string>());
  useEffect(() => {
    const current = new Set(live.map(liveKey));
    const shrank =
      current.size < rememberedLive.current.size &&
      [...current].every((key) => rememberedLive.current.has(key));
    rememberedLive.current = current;
    if (live.length && !shrank) remember();
  }, [live.map(liveKey).join('|')]);
  useEffect(() => {
    const save = () => remember();
    addEventListener('pagehide', save);
    return () => removeEventListener('pagehide', save);
  });
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => {
    if (!vods.length) return;
    const bounds = timelineBounds(vods);
    const clamped = Math.max(bounds.min, Math.min(bounds.max, momentRef.current));
    // A loaded Kick playlist may end before its metadata said it did. Keep
    // restored near-end selections valid for the seeker and session export.
    if (clamped !== momentRef.current) syncTo(clamped, false);
  }, [vods]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(narrowQuery);
    const change = () => {
      setNarrow(query.matches);
      if (query.matches) setExpanded(false);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  // Hide the undo prompt after a while; ⌘Z keeps working until the next close.
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved((r) => (r ? { ...r, shownAt: 0 } : r)), 12000);
    return () => clearTimeout(timer);
  }, [removed?.vods]);
  useEffect(() => {
    if (!liveRemoved) return;
    const timer = setTimeout(() => setLiveRemoved((r) => (r ? { ...r, shownAt: 0 } : r)), 12000);
    return () => clearTimeout(timer);
  }, [liveRemoved?.channel]);
  // Close the add results when the user moves on; keep failures until dismissed.
  useEffect(() => {
    if (!resultsOpen) return;
    // Results sit in the page flow; close them after a click lands so nothing shifts under it.
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!addForm.current?.contains(target) && !resultsNode.current?.contains(target))
        setResultsOpen(false);
    };
    // Clicking into a player iframe blurs the window rather than reaching the document.
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const blur = () => {
      blurTimer = setTimeout(() => setResultsOpen(false), 400);
    };
    document.addEventListener('click', away, true);
    addEventListener('blur', blur);
    return () => {
      document.removeEventListener('click', away, true);
      removeEventListener('blur', blur);
      clearTimeout(blurTimer);
    };
  }, [resultsOpen]);
  useEffect(() => {
    if (!resultsOpen) return;
    const settled = !busy && results.length && results.every((r) => r.status !== 'failed');
    if (!settled) return;
    const timer = setTimeout(() => setResultsOpen(false), 6000);
    return () => clearTimeout(timer);
  }, [resultsOpen, busy, results]);
  useEffect(() => {
    if (!watchMode) return;
    setMenuOpen(false);
    setModal(null);
    setResultsOpen(false);
  }, [watchMode]);
  // Follow the last synced player's clock without repeatedly seeking the others.
  useEffect(() => {
    if (!vods.length) return;
    const timer = setInterval(() => {
      const next: Record<string, PlaybackSnapshot> = {};
      for (const vod of vods) {
        const key = vodKey(vod);
        try {
          next[key] = handles.current.get(key)?.getSnapshot() ?? {
            status: 'loading',
            seconds: null,
            paused: true,
          };
        } catch {
          next[key] = { status: 'loading', seconds: null, paused: true };
        }
      }
      setPlaybackStates(next);
      const active = commandRef.current;
      // Each lane plays only its recording at the moment; the others have no player.
      const shown = laneVods(vods, active?.moment ?? momentRef.current);
      if (active?.phase === 'preparing') {
        setPlaying(false);
        if (seekBarrier(shown, active.moment, active.serial, next).complete) {
          startRequestedAt.current = Date.now();
          updateCommand({ ...active, phase: active.playing ? 'starting' : 'released' });
        }
        return;
      }
      if (active?.phase === 'starting') {
        const progress = startProgress(shown, active.moment, active.serial, next);
        const decision = startDecision(
          progress,
          Date.now() - startRequestedAt.current,
          active.startAttempt,
        );
        if (decision === 'complete') {
          updateCommand({ ...active, phase: 'released' });
          setPlaying(anyPlaying(shown, active.moment, next));
          const source = vods.find((vod) => vodKey(vod) === active.leader);
          if (source && next[active.leader]?.status === 'ended')
            setMoment(startMs(source) + source.durationSeconds * 1000);
        } else if (decision === 'retry') {
          // Retry the whole group at the same moment so a late start cannot leave one behind.
          syncTo(active.moment, true, active.leader, active.startAttempt + 1);
        } else if (decision === 'failed') {
          cancelSeek();
          setNotice(
            `${progress.waiting.map((vod) => vod.channel).join(', ')} didn’t start. Everyone is paused. Press play inside that player, then sync from it.`,
          );
        }
        return;
      }
      const source = vods.find((v) => vodKey(v) === leaderKey),
        state = next[leaderKey];
      setPlaying(anyPlaying(laneVods(vods, momentRef.current), momentRef.current, next));
      if (
        source &&
        state?.status === 'ready' &&
        !state.paused &&
        state.seconds !== null &&
        state.seconds >= 0 &&
        state.seconds < source.durationSeconds
      )
        setMoment(momentAt(source, state.seconds));
    }, 500);
    return () => clearInterval(timer);
  }, [leaderKey, vods]);

  function syncTo(nextMoment: number, nextPlaying = false, leader = leaderKey, startAttempt = 0) {
    updateCommand({
      moment: nextMoment,
      playing: nextPlaying,
      leader,
      serial: ++serial.current,
      startAttempt,
      phase: 'preparing',
    });
    // Freeze every existing player immediately; asynchronous readiness never moves the shared clock.
    for (const handle of handles.current.values()) {
      try {
        handle.pause();
      } catch {
        /* A loading iframe will pause when READY arrives. */
      }
    }
    setSeekStartedAt(Date.now());
    setMoment(nextMoment);
    setLeaderKey(leader);
    setPlaying(false);
  }
  function cancelSeek() {
    const active = commandRef.current;
    if (!active) return;
    updateCommand({ ...active, playing: false, phase: 'cancelled' });
    for (const handle of handles.current.values()) {
      try {
        handle.pause();
      } catch {
        /* Unavailable players remain stopped. */
      }
    }
    setPlaying(false);
  }
  function playIntent() {
    const active = commandRef.current;
    return active?.phase === 'preparing' || active?.phase === 'starting'
      ? active.playing
      : playersArePlaying();
  }
  // Keep the current source when it covers the moment; otherwise prefer a playable recording.
  function leaderAt(time: number) {
    const covers = (v: Vod) => matchMoment(v, time).state === 'playing';
    const shown = laneVods(vods, time);
    const current = shown.find((v) => vodKey(v) === leaderKey);
    const leader =
      (current && supportsPlayback(current) && covers(current) ? current : undefined) ??
      shown.find((v) => supportsPlayback(v) && covers(v)) ??
      shown.find(covers);
    return leader ? vodKey(leader) : leaderKey;
  }
  function seekShared(time: number) {
    if (!vods.length) return;
    const { min, max } = timelineBounds(vods);
    const target = Math.max(min, Math.min(max, time));
    // A new seek supersedes old guidance, so line-up progress and Cancel stay visible.
    setNotice('');
    syncTo(target, playIntent(), leaderAt(target));
  }
  function skip(seconds: number) {
    seekShared(
      (commandRef.current?.phase === 'preparing' ? commandRef.current.moment : moment) +
        seconds * 1000,
    );
  }
  function showFlash(text: string) {
    clearTimeout(flashTimer.current);
    setFlash(text);
    flashTimer.current = setTimeout(() => setFlash(''), 2400);
  }
  function resetLive() {
    setLive([]);
    setLivePlaying(false);
    setLiveSound({});
    setLiveSolo('');
    setLiveStates({});
    setLiveRemoved(undefined);
  }
  function loadLive(next: LiveSession, play = false) {
    clearWorkspace(false);
    setLive(next.channels);
    setLiveSound(firstSound(next.channels));
    setLivePlaying(play);
  }
  function loadSession(next: Session) {
    resetLive();
    const clean = gridSession(next);
    setVods(clean.vods);
    setClips(clean.clips);
    setRemoved(undefined);
    setDraggingKey('');
    setDropKey('');
    setPlaybackStates({});
    setResults([]);
    setResultsOpen(false);
    setNotice('');
    setAudioKey('');
    setSound({});
    syncTo(clean.momentMs, false, clean.leaderKey);
  }
  async function addRecordings(event?: FormEvent) {
    event?.preventDefault();
    if (busy || authLoading) return;
    setNotice('');
    const inputs = splitInputs(input);
    if (!inputs.length) {
      setNotice('Paste a VOD, clip, twitch/name, or kick/name.');
      return;
    }
    if (inputs.length > MAX_VODS) {
      setNotice('Too many links in one request. Add them in smaller batches.');
      return;
    }
    setBusy(true);
    setPending(inputs);
    setResults([]);
    setResultsOpen(true);
    try {
      if (opensLive(inputs, vods.length, live.length)) {
        const result = await resolveLiveInputs(inputs, live, auth);
        if (result.added && !live.length) {
          // A new live session starts playing; the add was the user's gesture.
          setRemoved(undefined);
          setLiveRemoved(undefined);
          setLiveSound(firstSound(result.channels));
          setLiveSolo('');
          setLiveStates({});
          setLivePlaying(true);
        }
        if (result.added) setLive(result.channels);
        setInput(result.failures.map((failure) => failure.input).join('\n'));
        setResults(result.results);
      } else {
        const result = await resolveRecordingInputs(
          inputs,
          { vods, momentMs: moment, leaderKey },
          auth,
        );
        if (result.added) {
          setVods(result.vods);
          setClips((current) => mergeClips(current, result.clips));
          syncTo(result.momentMs, false, result.leaderKey);
        }
        setInput(result.failures.map((failure) => failure.input).join('\n'));
        setResults(result.results);
      }
    } catch (error) {
      setNotice(messageOf(error));
      setResultsOpen(false);
    }
    setPending([]);
    setBusy(false);
  }
  function syncFrom(vod: Vod) {
    try {
      const handle = handles.current.get(vodKey(vod));
      if (!handle) throw new Error('Wait for this player to load.');
      // Solo audio ends when another player becomes the source; Resync keeps it.
      if (vodKey(vod) !== leaderKey) setAudioKey('');
      syncTo(momentAt(vod, handle.getCurrentTime()), !handle.isPaused(), vodKey(vod));
      setNotice('');
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  // Closing a streamer closes every recording in their lane.
  function remove(lane: Lane) {
    if (busy) return;
    const keys = new Set(lane.vods.map(vodKey));
    const removal = {
      vods: lane.vods,
      name: lane.vods[0].channel,
      index: lanes.findIndex((l) => l.key === lane.key),
      moment,
      clips: clips.filter((clip) => keys.has(clip.vodKey)),
      shownAt: Date.now(),
    };
    const next = vods.filter((v) => !keys.has(vodKey(v)));
    setVods(next);
    setClips((current) => current.filter((clip) => !keys.has(clip.vodKey)));
    if (audioKey === lane.key) setAudioKey('');
    if (!next.length) {
      clearWorkspace(false);
      setRemoved(removal);
      return;
    }
    setRemoved(removal);
    const { min, max } = timelineBounds(next);
    const nextMoment = Math.max(min, Math.min(max, moment));
    const sourceClosed = keys.has(leaderKey);
    if (sourceClosed || nextMoment !== moment)
      syncTo(nextMoment, false, sourceClosed ? vodKey(next[0]) : leaderKey);
  }
  function removeLive(channel: LiveChannel) {
    if (busy) return;
    const key = liveKey(channel);
    const next = live.filter((c) => liveKey(c) !== key);
    setLive(next);
    setLiveRemoved({ channel, index: live.indexOf(channel), shownAt: Date.now() });
    if (liveSolo === key) setLiveSolo('');
    if (!next.length) {
      setLivePlaying(false);
      setWatchMode(false);
      history.replaceState(null, '', location.pathname);
      return;
    }
    const neighbour = next[Math.min(live.indexOf(channel), next.length - 1)];
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-live-key="${CSS.escape(liveKey(neighbour))}"] .tile-close`,
        )
        ?.focus({ preventScroll: true }),
    );
  }
  function undoLiveRemove() {
    if (!liveRemoved || busy) return;
    if (vods.length || live.some((c) => liveKey(c) === liveKey(liveRemoved.channel))) {
      setLiveRemoved(undefined);
      return;
    }
    if (live.length >= MAX_VODS) {
      setNotice('Remove another channel before restoring this one.');
      return;
    }
    const next = [...live];
    next.splice(Math.min(liveRemoved.index, next.length), 0, liveRemoved.channel);
    setLive(next);
    setLiveRemoved(undefined);
  }
  function reorderLive(key: string, position: number) {
    if (busy) return;
    const from = live.findIndex((c) => liveKey(c) === key);
    const to = Math.max(0, Math.min(live.length - 1, position));
    if (from < 0 || from === to) return;
    const next = [...live];
    const [channel] = next.splice(from, 1);
    next.splice(to, 0, channel);
    setLive(next);
    if (new URLSearchParams(location.hash.slice(1)).has('live')) {
      try {
        const url = new URL(location.href);
        url.hash = `live=${encodeLiveSession({ version: 2, kind: 'live', channels: next })}`;
        history.replaceState(null, '', url);
      } catch (error) {
        setNotice(messageOf(error));
      }
    }
    setOrderAnnouncement(`${channel.name} moved to position ${to + 1} of ${next.length}.`);
  }
  function undoRemove() {
    if (!removed || busy) return;
    if (live.length) {
      setRemoved(undefined);
      return;
    }
    const known = new Set(vods.map(vodKey));
    const missing = removed.vods.filter((v) => !known.has(vodKey(v)));
    if (!missing.length) {
      setRemoved(undefined);
      return;
    }
    if (vods.length + missing.length > MAX_VODS) {
      setNotice('Remove another recording before restoring this one.');
      return;
    }
    const restored = { key: laneKey(missing[0]), vods: missing };
    const next = [...lanes];
    next.splice(Math.min(removed.index, next.length), 0, restored);
    setVods(next.flatMap((lane) => lane.vods));
    setClips((current) => mergeClips(current, removed.clips));
    if (!vods.length) syncTo(removed.moment, false, vodKey(laneVod(restored, removed.moment)));
    setRemoved(undefined);
  }
  // Moves a whole lane; the session keeps each lane's recordings together.
  function reorder(key: string, position: number) {
    if (busy) return;
    const from = lanes.findIndex((lane) => lane.key === key);
    const to = Math.max(0, Math.min(lanes.length - 1, position));
    if (from < 0 || from === to) return;
    const order = [...lanes];
    const [lane] = order.splice(from, 1);
    order.splice(to, 0, lane);
    const next = order.flatMap((item) => item.vods);
    setVods(next);
    // A loaded share takes precedence over local storage on refresh.
    if (new URLSearchParams(location.hash.slice(1)).has('session')) {
      try {
        const url = new URL(location.href);
        url.hash = `session=${encodeSession({ ...session(), vods: next })}`;
        history.replaceState(null, '', url);
      } catch (error) {
        setNotice(messageOf(error));
      }
    }
    setOrderAnnouncement(`${lane.vods[0].channel} moved to position ${to + 1} of ${order.length}.`);
  }
  function clearWorkspace(keepInRecent = true) {
    if (busy) return;
    if (keepInRecent) remember();
    setVods([]);
    setClips([]);
    setRemoved(undefined);
    setDraggingKey('');
    setDropKey('');
    setPlaybackStates({});
    updateCommand(null);
    setLeaderKey('');
    setMoment(0);
    setResults([]);
    setResultsOpen(false);
    setPlaying(false);
    setWatchMode(false);
    setAudioKey('');
    setSound({});
    resetLive();
    history.replaceState(null, '', location.pathname);
  }
  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('');
      showFlash(done);
    } catch {
      setNotice('Clipboard access was blocked. Open the link to copy it, or export the session.');
    }
  }
  function share() {
    try {
      const url = new URL(location.href);
      url.search = '';
      if (live.length) {
        url.hash = `live=${encodeLiveSession(liveSession())}`;
        void copy(url.toString(), `Live session link copied · ${live.length} channels`);
        return;
      }
      url.hash = `session=${encodeSession(session())}`;
      void copy(url.toString(), `Session link copied · ${vods.length} recordings`);
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  function exportSession() {
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(live.length ? liveSession() : session(), null, 2)], {
          type: 'application/json',
        }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = live.length ? 'streamsync-live.json' : 'streamsync-session.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  function playersArePlaying() {
    const states: Record<string, PlaybackSnapshot> = {};
    for (const vod of vods) {
      try {
        const state = handles.current.get(vodKey(vod))?.getSnapshot();
        if (state) states[vodKey(vod)] = state;
      } catch {
        /* An unavailable player is not playing. */
      }
    }
    return anyPlaying(laneVods(vods, moment), moment, states);
  }
  function playback() {
    const active = commandRef.current;
    if (active?.phase === 'preparing') {
      updateCommand({ ...active, playing: !active.playing });
      return;
    }
    if (active?.phase === 'starting' || playersArePlaying()) {
      cancelSeek();
      return;
    }
    const playable = laneVods(vods, moment).filter(
      (v) => supportsPlayback(v) && matchMoment(v, moment).state === 'playing',
    );
    const leader = playable.find((v) => vodKey(v) === leaderKey) ?? playable[0];
    if (!leader) {
      setNotice('No recording covers this moment. Seek to a recorded part of the timeline.');
      return;
    }
    setNotice('');
    syncTo(moment, true, vodKey(leader));
  }
  function setTimeline(open: boolean) {
    setExpanded(open);
    if (!narrow) writeStorage(TIMELINE_KEY, String(!open));
  }
  function resync() {
    // Like the header Sync button, wait for a line-up or start to finish first.
    const phase = commandRef.current?.phase;
    if (phase === 'preparing' || phase === 'starting') return;
    const source = vods.find((vod) => vodKey(vod) === leaderKey);
    if (source) syncFrom(source);
  }

  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus({ preventScroll: true });
  }
  // Run a top-bar menu action; the row closes first so it never lingers.
  function menuAction(run: () => void) {
    return () => {
      closeMenu();
      run();
    };
  }

  // Shortcuts never take keys from fields, menus or focused controls that use them.
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcuts.current = (event) => {
    if (event.defaultPrevented || event.altKey) return;
    if (event.key === 'Escape') {
      if (resultsOpen) setResultsOpen(false);
      else if (menuOpen) closeMenu();
      else if (modal) setModal(null);
      else if (watchMode) setWatchMode(false);
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const emptyStart = event.target === startField.current && !input;
    if (claimsKey(event.target, event.key) && !(mod && emptyStart)) return;
    if (mod) {
      if (event.key.toLowerCase() === 'z' && (removed || liveRemoved) && !event.shiftKey) {
        event.preventDefault();
        if (removed) undoRemove();
        else undoLiveRemove();
      }
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === '/') {
      if (watchMode) return;
      event.preventDefault();
      (vods.length || live.length ? addField : startField).current?.focus();
      return;
    }
    if (live.length) {
      const liveActions: Record<string, () => void> = {
        ' ': () => setLivePlaying((on) => !on),
        f: () => setWatchMode((on) => !on),
      };
      if (!liveActions[key]) return;
      event.preventDefault();
      liveActions[key]();
      return;
    }
    if (!vods.length) return;
    const actions: Record<string, () => void> = {
      ' ': playback,
      j: () => skip(-10),
      l: () => skip(10),
      ArrowLeft: () => skip(-5),
      ArrowRight: () => skip(5),
      t: () => setTimeline(!expanded),
      f: () => setWatchMode((on) => !on),
      s: resync,
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => shortcuts.current(event);
    addEventListener('keydown', listen);
    return () => removeEventListener('keydown', listen);
  }, []);

  const preparing = command?.phase === 'preparing';
  const starting = command?.phase === 'starting';
  // The recording each lane's player shows at the selected moment.
  const shown = laneVods(vods, moment);
  const startingProgress = starting
    ? startProgress(laneVods(vods, command.moment), command.moment, command.serial, playbackStates)
    : null;
  const bufferProgress = preparing
    ? seekBarrier(laneVods(vods, command.moment), command.moment, command.serial, playbackStates)
    : null;
  const intent = preparing || starting ? command.playing : playing;
  const coverable = shown.some(
    (vod) => supportsPlayback(vod) && matchMoment(vod, moment).state === 'playing',
  );
  const source = vods.find((vod) => vodKey(vod) === leaderKey);
  // Solo audio follows a streamer across their recordings. One that doesn't cover the
  // moment hands audio back to the source.
  const soloed = shown.find(
    (vod) => laneKey(vod) === audioKey && matchMoment(vod, moment).state === 'playing',
  );
  const audibleKey = soloed ? vodKey(soloed) : '';
  const bounds = vods.length ? timelineBounds(vods) : undefined;
  const overlap = overlapRange(vods);
  const range = vods.length
    ? viewRange(vods, zoom === 'overlap' && overlap ? 'overlap' : 'all')
    : undefined;
  const dismiss = (run: () => void) => ({ label: 'Dismiss', icon: <X size={15} />, onClick: run });
  function barStatus(): BarStatus {
    if (notice)
      return {
        tone: 'signal',
        icon: 'alert',
        text: notice,
        title: notice,
        announce: notice,
        actions: [dismiss(() => setNotice(''))],
      };
    if (bufferProgress && bufferProgress.total > 0) {
      const slow = Date.now() - seekStartedAt > 15000;
      const waiting = bufferProgress.waiting.map((vod) => vod.channel).join(', ');
      return {
        icon: 'spin',
        title: waiting ? `Waiting on ${waiting}` : undefined,
        announce: slow ? 'Still lining up' : 'Lining up',
        text: (
          <>
            <b>{slow ? 'Still lining up' : 'Lining up'}</b>{' '}
            <span className="mono">
              {bufferProgress.ready}/{bufferProgress.total}
            </span>
            {waiting && <> · {waiting}</>}
          </>
        ),
        actions: [
          ...(slow && command
            ? [
                {
                  label: 'Retry',
                  icon: <RotateCw size={15} />,
                  onClick: () => syncTo(command.moment, command.playing, command.leader),
                },
              ]
            : []),
          { label: 'Cancel', icon: <X size={15} />, onClick: cancelSeek },
        ],
      };
    }
    if (startingProgress && startingProgress.total > 0)
      return {
        icon: 'spin',
        title: startingProgress.waiting.map((vod) => vod.channel).join(', '),
        announce: 'Starting',
        text: (
          <>
            <b>Starting</b>{' '}
            <span className="mono">
              {startingProgress.started}/{startingProgress.total}
            </span>{' '}
            · try <span className="mono">{(command?.startAttempt ?? 0) + 1}/3</span>
          </>
        ),
        actions: [{ label: 'Cancel start', icon: <X size={15} />, onClick: cancelSeek }],
      };
    if (removed?.shownAt)
      return {
        tone: 'ink',
        text: `Closed ${removed.name}`,
        announce: `Closed ${removed.name}`,
        actions: [
          { label: 'Undo (⌘Z)', icon: <Undo2 size={15} />, onClick: undoRemove },
          dismiss(() => setRemoved((r) => (r ? { ...r, shownAt: 0 } : r))),
        ],
      };
    if (flash) return { tone: 'success', icon: 'check', text: flash, announce: flash };
    if (!coverable)
      return {
        text: 'No recording covers this moment',
        announce: 'No recording covers this moment',
      };
    const summary = syncSummary(shown, moment, playbackStates, leaderKey);
    return {
      // Drift values change every half second; the summary isn't announced.
      text: (
        <>
          {summary.inSync > 0 && (
            <span className="summary-item">
              <i className="dot success" /> {summary.inSync} in sync
            </span>
          )}
          {summary.drifting.map(({ vod, drift }) => (
            <span className="summary-item" key={vodKey(vod)}>
              <i className="dot warning" /> {vod.channel}{' '}
              <span className="mono warning">{formatDelta(drift)}</span>
            </span>
          ))}
          {summary.unverified > 0 && (
            <span className="summary-item">{summary.unverified} not verified</span>
          )}
          {soloed && <span className="summary-item">listening to {soloed.channel}</span>}
        </>
      ),
      actions:
        source && summary.drifting.length
          ? [
              {
                label: `Resync to ${source.channel} (S)`,
                icon: <RefreshCw size={15} />,
                onClick: resync,
              },
            ]
          : audioKey
            ? [
                {
                  label: 'Follow the source audio',
                  icon: <X size={15} />,
                  onClick: () => {
                    setAudioKey('');
                    setSound({});
                  },
                },
              ]
            : [],
    };
  }
  function liveBarStatus(): BarStatus {
    if (notice)
      return {
        tone: 'signal',
        icon: 'alert',
        text: notice,
        title: notice,
        announce: notice,
        actions: [dismiss(() => setNotice(''))],
      };
    if (liveRemoved?.shownAt)
      return {
        tone: 'ink',
        text: `Closed ${liveRemoved.channel.name}`,
        announce: `Closed ${liveRemoved.channel.name}`,
        actions: [
          { label: 'Undo (⌘Z)', icon: <Undo2 size={15} />, onClick: undoLiveRemove },
          dismiss(() => setLiveRemoved((r) => (r ? { ...r, shownAt: 0 } : r))),
        ],
      };
    if (flash) return { tone: 'success', icon: 'check', text: flash, announce: flash };
    const states = live.map((channel) => liveStates[liveKey(channel)]);
    const count = (state: LiveState) => states.filter((s) => s === state).length;
    const listening = live.find((channel) => liveKey(channel) === liveSolo);
    return {
      text: (
        <>
          {count('live') > 0 && (
            <span className="summary-item">
              <i className="dot success" /> {count('live')} live
            </span>
          )}
          {count('loading') > 0 && <span className="summary-item">{count('loading')} loading</span>}
          {count('unverified') > 0 && (
            <span className="summary-item">{count('unverified')} unverified</span>
          )}
          {count('paused') > 0 && <span className="summary-item">{count('paused')} paused</span>}
          {count('offline') > 0 && <span className="summary-item">{count('offline')} offline</span>}
          {count('blocked') + count('error') > 0 && (
            <span className="summary-item">
              <i className="dot warning" /> {count('blocked') + count('error')} need attention
            </span>
          )}
          {listening && <span className="summary-item">listening to {listening.name}</span>}
        </>
      ),
    };
  }
  const resultRows = busy
    ? pending.map((item) => ({ input: item, status: 'pending' as const }))
    : results;
  const playLabel = preparing
    ? command.playing
      ? 'Stay paused after lining up'
      : 'Play when ready'
    : intent
      ? 'Pause all'
      : 'Play all';
  return (
    <div
      className={`app ${watchMode ? 'watch-mode' : ''} ${lanes.length > 3 || live.length > 3 ? 'fit-height' : ''} ${vods.length || live.length ? '' : 'is-empty'}`}
    >
      <div className="sr-only" role="status" aria-live="polite">
        {orderAnnouncement}
      </div>
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <BrandMark />
          StreamSync
        </a>
        {(live.length > 0 || (!!vods.length && bounds)) && (
          <>
            <span className="topbar-divider" />
            <span className="session-meta">
              {live.length ? (
                <b>
                  {live.length} live channel{live.length === 1 ? '' : 's'}
                </b>
              ) : (
                bounds && (
                  <>
                    <b>
                      {vods.length} recording{vods.length === 1 ? '' : 's'}
                    </b>{' '}
                    · {formatSpan(bounds.max - bounds.min)}
                  </>
                )
              )}
            </span>
            <div className="add" ref={addForm}>
              <form
                className="add-field"
                onSubmit={addRecordings}
                aria-label={live.length ? 'Add channels' : 'Add recordings'}
              >
                <Plus size={16} aria-hidden="true" />
                <label htmlFor="vod-input" className="sr-only">
                  {live.length ? 'Add channels' : 'Add recordings'}
                </label>
                <textarea
                  ref={addField}
                  id="vod-input"
                  rows={1}
                  value={input}
                  spellCheck={false}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    live.length
                      ? 'Add a twitch/name or kick/name channel'
                      : `Add a VOD, clip or twitch/name at ${clock(moment, localTime)}`
                  }
                  aria-describedby={resultsOpen ? 'add-results' : undefined}
                  disabled={busy}
                  onFocus={() => results.length && setResultsOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void addRecordings();
                    }
                  }}
                />
                {busy ? (
                  <LoaderCircle className="spin" size={15} aria-label="Looking up" />
                ) : (
                  <Kbd>/</Kbd>
                )}
              </form>
            </div>
          </>
        )}
        <div className="topbar-actions">
          {vods.length || live.length ? (
            <>
              <button
                className="ghost-btn share-btn"
                onClick={share}
                aria-label="Share link"
                title="Copy a link to this session"
              >
                <Share2 size={15} aria-hidden="true" />
                <span>Share link</span>
              </button>
              <button
                className="inverse-btn"
                onClick={() => setWatchMode(true)}
                title="Watch mode (F)"
              >
                <Maximize2 size={15} />
                <span>Watch mode</span>
                <Kbd>F</Kbd>
              </button>
            </>
          ) : (
            <>
              <button
                className="ghost-btn"
                onClick={() => importInput.current?.click()}
                disabled={busy}
              >
                Import session
              </button>
              <a className="ghost-btn" href={`${REPO_URL}#use`} target="_blank" rel="noreferrer">
                How syncing works <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </>
          )}
          <button
            ref={menuButton}
            className="icon-btn"
            aria-label="More options"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'top-menu' : undefined}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </header>
      {menuOpen && (
        <div
          className="top-menu"
          id="top-menu"
          role="group"
          aria-label="More options"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeMenu();
          }}
        >
          <div className="drawer-body">
            <button
              className="drawer-btn"
              disabled={busy}
              onClick={menuAction(() => importInput.current?.click())}
            >
              Import session
            </button>
            <button
              className="drawer-btn"
              disabled={!vods.length && !live.length}
              onClick={menuAction(exportSession)}
            >
              Export session
            </button>
            <button className="drawer-btn" onClick={menuAction(() => setModal('settings'))}>
              Twitch connection
            </button>
            <button className="drawer-btn" onClick={menuAction(() => setModal('help'))}>
              Help and shortcuts
            </button>
            <a
              className="drawer-btn"
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              onClick={closeMenu}
            >
              GitHub
            </a>
            <button
              className="drawer-btn danger"
              disabled={busy || (!vods.length && !live.length)}
              onClick={menuAction(() => clearWorkspace())}
            >
              Clear workspace
            </button>
          </div>
          <button className="icon-btn small" aria-label="Close more options" onClick={closeMenu}>
            <X size={14} />
          </button>
        </div>
      )}
      {resultsOpen && !!resultRows.length && (
        <div className="add-results" id="add-results" role="status" ref={resultsNode}>
          {resultRows.map((row, index) => (
            <div className={`add-row ${row.status}`} key={`${index}:${row.input}`}>
              <span className="add-icon" aria-hidden="true">
                {row.status === 'pending' ? (
                  <LoaderCircle className="spin" size={14} />
                ) : row.status === 'added' ? (
                  <Check size={14} />
                ) : row.status === 'existing' ? (
                  '–'
                ) : (
                  <X size={14} />
                )}
              </span>
              <span className="add-text">
                <span className="mono">{shortInput(row.input)}</span>
                {row.status === 'failed' && <span className="add-error">{row.error}</span>}
              </span>
              <span className="add-detail">
                {row.status === 'pending' && 'Looking up'}
                {(row.status === 'added' || row.status === 'existing') &&
                  ('vod' in row ? (
                    <>
                      <PlatformMark platform={row.vod.platform} /> {row.vod.channel}
                      {row.status === 'existing' ? (
                        ' · already in session'
                      ) : row.state === 'before' ? (
                        ` · starts ${clock(startMs(row.vod), localTime)}`
                      ) : row.state === 'ended' ? (
                        ` · ended ${clock(startMs(row.vod) + row.vod.durationSeconds * 1000, localTime)}`
                      ) : (
                        <span className="mono"> {formatTime(row.offsetSeconds)}</span>
                      )}
                    </>
                  ) : (
                    <>
                      <PlatformMark platform={row.channel.platform} /> {row.channel.name}
                      {row.status === 'existing'
                        ? ' · already in session'
                        : row.live
                          ? ' · live'
                          : ' · offline, starts when live'}
                    </>
                  ))}
                {row.status === 'failed' && (
                  <button
                    className="text-btn"
                    onClick={() => {
                      // Failed inputs are already back in the field; select this one.
                      const field = addField.current;
                      setResultsOpen(false);
                      if (!field) return;
                      field.focus();
                      const at = field.value.indexOf(row.input);
                      if (at >= 0) field.setSelectionRange(at, at + row.input.length);
                    }}
                  >
                    Edit
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {modal === 'settings' && (
        <Panel title="Twitch connection" close={() => setModal(null)}>
          {auth ? (
            <>
              <span>Connected</span>
              <button
                className="outline-btn"
                onClick={() => {
                  disconnect();
                  setAuth(undefined);
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <label className="panel-field">
                Client ID
                <input
                  className="field"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Twitch application Client ID"
                  autoComplete="off"
                />
              </label>
              <button
                className="primary-btn"
                onClick={() => {
                  try {
                    writeStorage('vodsync.clientId', clientId);
                    beginLogin(clientId);
                  } catch (error) {
                    setNotice(messageOf(error));
                    setModal(null);
                  }
                }}
              >
                Connect
              </button>
              <span className="panel-note">
                Redirect URL <code>{redirectUri()}</code>
              </span>
              <a
                className="panel-link"
                href={`${REPO_URL}#optional-official-twitch-connection`}
                target="_blank"
                rel="noreferrer"
              >
                Setup <ArrowUpRight size={14} />
              </a>
            </>
          )}
        </Panel>
      )}
      {modal === 'help' && (
        <Panel title="Shortcuts" close={() => setModal(null)}>
          <dl className="shortcuts">
            {(live.length
              ? SHORTCUTS.filter(([, label]) => LIVE_SHORTCUTS.has(label))
              : SHORTCUTS
            ).map(([keys, label]) => (
              <div key={label}>
                <dt>
                  {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
          <a className="panel-link" href={`${REPO_URL}#use`} target="_blank" rel="noreferrer">
            Guide <ArrowUpRight size={14} />
          </a>
        </Panel>
      )}
      <input
        className="sr-only"
        ref={importInput}
        tabIndex={-1}
        type="file"
        accept="application/json,.json"
        aria-label="Session JSON file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 200000) throw new Error('Session file is too large.');
            const data: unknown = JSON.parse(await file.text());
            if (isLiveSession(data)) loadLive(validateLiveSession(data));
            else loadSession(validateSession(data));
          } catch (error) {
            setNotice(messageOf(error));
          }
          e.target.value = '';
        }}
      />
      {demo && (
        <div className="demo-banner">
          <span>Demo · simulated players and sample timing</span>
          <button className="text-btn" onClick={() => clearWorkspace()}>
            Close demo
          </button>
        </div>
      )}
      <main className="workspace">
        {live.length ? (
          <LiveGrid
            channels={live}
            playing={livePlaying}
            mutedKeys={mutedKeys}
            online={liveOnline}
            busy={busy}
            onMute={(channel, muted) => {
              setLiveSolo('');
              setLiveSound((current) => ({ ...current, [liveKey(channel)]: !muted }));
            }}
            onSolo={(channel, mode) => {
              const only = mode === 'only';
              setLiveSolo(only ? liveKey(channel) : '');
              setLiveSound(
                Object.fromEntries(live.map((c) => [liveKey(c), (c === channel) === only])),
              );
              showFlash(
                only
                  ? `Listening to ${channel.name} only`
                  : `Muted ${channel.name}, unmuted the rest`,
              );
            }}
            onCopy={(channel, url) => void copy(url, `${channel.name} channel link copied`)}
            onRemove={removeLive}
            onReorder={reorderLive}
            onState={updateLiveState}
          />
        ) : !vods.length ? (
          <StartScreen
            field={startField}
            input={input}
            onInput={setInput}
            onSubmit={addRecordings}
            busy={busy}
            pending={pending}
            results={results}
            notice={notice}
            recent={recent}
            onOpen={(entry) =>
              isLiveSession(entry)
                ? loadLive(validateLiveSession(entry))
                : loadSession(entry as Session)
            }
            onForget={(savedAt) => {
              const next = recent.filter((entry) => entry.savedAt !== savedAt);
              writeRecent(next);
              setRecent(next);
            }}
            closed={removed?.name ?? liveRemoved?.channel.name}
            onUndo={removed ? undoRemove : undoLiveRemove}
          />
        ) : (
          <div
            ref={grid}
            className={`player-grid ${draggingKey ? 'is-reordering' : ''}`}
            style={{
              gridTemplateColumns: `repeat(${tracks}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(auto, 1fr))`,
            }}
          >
            {/* Keep iframe DOM positions stable: moving an iframe reloads Twitch even with React keys.
                A lane's tile is replaced in place when the moment moves to its next recording. */}
            {[...lanes]
              .sort((a, b) => a.key.localeCompare(b.key))
              .map((lane) => ({ lane, vod: laneVod(lane, moment), index: lanes.indexOf(lane) }))
              .map(({ lane, vod, index }) => (
                <Player
                  key={vodKey(vod)}
                  vod={vod}
                  part={{ index: lane.vods.indexOf(vod), count: lane.vods.length }}
                  source={vodKey(vod) === leaderKey}
                  command={command}
                  moment={moment}
                  register={register}
                  onSync={syncFrom}
                  onStopped={playerStopped}
                  onDuration={updateDuration}
                  drift={driftSeconds(vod, moment, playbackStates[vodKey(vod)])}
                  sourceName={source?.channel ?? 'the source'}
                  audioKey={audibleKey}
                  sound={sound[lane.key]}
                  onSound={(on) => setSound((current) => ({ ...current, [lane.key]: on }))}
                  busy={busy}
                  localTime={localTime}
                  onSolo={(mode) => {
                    if (mode === 'only') {
                      setAudioKey(lane.key);
                      setSound({});
                      showFlash(`Listening to ${vod.channel} only`);
                      return;
                    }
                    // Everyone else is set by hand, so it holds like any speaker choice.
                    setAudioKey('');
                    setSound(Object.fromEntries(lanes.map((l) => [l.key, l.key !== lane.key])));
                    showFlash(`Muted ${vod.channel}, unmuted the rest`);
                  }}
                  onSeekTo={(offset, correction) => {
                    // A just-flushed offset hasn't reached state yet; seek with it anyway.
                    const timed =
                      correction === undefined ? vod : { ...vod, correctionSeconds: correction };
                    setNotice('');
                    syncTo(momentAt(timed, offset), false, vodKey(vod));
                  }}
                  onJump={seekShared}
                  onCorrect={(seconds) => {
                    // A pending nudge can flush after its recording closed; never restore it.
                    const current = vodsRef.current;
                    if (!current.some((v) => vodKey(v) === vodKey(vod))) return;
                    const next = current.map((v) =>
                      vodKey(v) === vodKey(vod) ? { ...v, correctionSeconds: seconds } : v,
                    );
                    const nextBounds = timelineBounds(next);
                    const resume = playIntent();
                    setVods(next);
                    setNotice('');
                    syncTo(
                      Math.max(nextBounds.min, Math.min(nextBounds.max, momentRef.current)),
                      resume,
                    );
                  }}
                  onCopy={(url) => void copy(url, `${vod.channel} timestamp link copied`)}
                  order={{
                    index,
                    position: positions[index],
                    count: lanes.length,
                    disabled: busy || lanes.length < 2,
                    dragging: draggingKey === lane.key,
                    target: dropKey === lane.key && draggingKey !== lane.key,
                    onStart: (event) => {
                      event.dataTransfer.setData('text/plain', lane.key);
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingKey(lane.key);
                      setDropKey(lane.key);
                    },
                    onEnd: () => {
                      setDraggingKey('');
                      setDropKey('');
                    },
                    onOver: (event) => {
                      if (!draggingKey) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropKey(lane.key);
                    },
                    onDrop: (event) => {
                      if (!draggingKey) return;
                      event.preventDefault();
                      reorder(draggingKey, index);
                      setDraggingKey('');
                      setDropKey('');
                    },
                    onMove: (position) => reorder(lane.key, position),
                  }}
                  onRemove={() => remove(lane)}
                />
              ))}
          </div>
        )}
      </main>
      {!!live.length && (
        <LiveBar
          playing={livePlaying}
          onPlayback={() => setLivePlaying((on) => !on)}
          status={liveBarStatus()}
          watchMode={watchMode}
          onExitWatch={() => setWatchMode(false)}
        />
      )}
      {!!vods.length && range && (
        <PlaybackBar
          vods={vods}
          clips={clips}
          moment={moment}
          playing={intent}
          canPlay={intent || preparing || starting || coverable}
          playLabel={playLabel}
          onPlayback={playback}
          onSkip={skip}
          localTime={localTime}
          onLocalTime={setLocalTime}
          zoom={zoom === 'overlap' && overlap ? 'overlap' : 'all'}
          onZoom={setZoom}
          overlap={overlap}
          range={range}
          expanded={expanded}
          onExpanded={setTimeline}
          watchMode={watchMode}
          onExitWatch={() => setWatchMode(false)}
          status={barStatus()}
          leaderKey={leaderKey}
          playbackStates={playbackStates}
          onSeek={seekShared}
          onRemove={remove}
        />
      )}
    </div>
  );
}
