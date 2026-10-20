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
  decodeSession,
  encodeSession,
  formatTime,
  matchMoment,
  momentAt,
  startMs,
  timelineBounds,
  validateSession,
  vodKey,
  type ClipMarker,
  type Session,
  type Vod,
} from '@vodsync/core';
import type { TwitchAuth } from '@vodsync/providers';
import { resolveRecordingInputs, type InputResult } from './recordingInputs';
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
const TIMELINE_KEY = 'vodsync.timelineCollapsed';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Please retry.');
const narrowQuery = '(max-width: 700px)';
const isNarrow = () => typeof matchMedia === 'function' && matchMedia(narrowQuery).matches;
function gridSession(session: Session): Session {
  return { ...session, view: 'grid' };
}
function initialState(): { session?: Session; error?: string } {
  try {
    const shared = new URLSearchParams(location.hash.slice(1)).get('session');
    if (shared) return { session: gridSession(decodeSession(shared)) };
    const saved = readStorage(SESSION_KEY);
    return saved ? { session: gridSession(validateSession(JSON.parse(saved))) } : {};
  } catch (error) {
    return { error: messageOf(error) };
  }
}
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
  const [leaderKey, setLeaderKey] = useState(initial.session?.leaderKey || '');
  const [moment, setMoment] = useState(initial.session?.momentMs || 0);
  const momentRef = useRef(moment);
  const vodsRef = useRef(vods);
  vodsRef.current = vods;
  momentRef.current = moment;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [results, setResults] = useState<InputResult[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [notice, setNotice] = useState(initial.error || '');
  const [flash, setFlash] = useState('');
  const [modal, setModal] = useState<'settings' | 'help' | null>(null);
  const [draggingKey, setDraggingKey] = useState('');
  const [dropKey, setDropKey] = useState('');
  const [orderAnnouncement, setOrderAnnouncement] = useState('');
  const [removed, setRemoved] = useState<{
    vod: Vod;
    index: number;
    moment: number;
    clips: ClipMarker[];
    shownAt: number;
  }>();
  const [watchMode, setWatchMode] = useState(false);
  const { grid, rows, tracks, positions } = useGridLayout(vods.length);
  const [narrow, setNarrow] = useState(isNarrow);
  const [expanded, setExpanded] = useState(
    () => !isNarrow() && readStorage(TIMELINE_KEY) !== 'true',
  );
  const [localTime, setLocalTime] = useState(false);
  const [zoom, setZoom] = useState<'all' | 'overlap'>('all');
  const [audioKey, setAudioKey] = useState('');
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
  // Keep a short local history of sessions; the newest state replaces older ones.
  function remember() {
    try {
      if (!vods.length) return;
      const next = rememberSession(readRecent(), sessionRef.current());
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
  }, [removed?.vod]);
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
      if (active?.phase === 'preparing') {
        setPlaying(false);
        if (seekBarrier(vods, active.moment, active.serial, next).complete) {
          startRequestedAt.current = Date.now();
          updateCommand({ ...active, phase: active.playing ? 'starting' : 'released' });
        }
        return;
      }
      if (active?.phase === 'starting') {
        const progress = startProgress(vods, active.moment, active.serial, next);
        const decision = startDecision(
          progress,
          Date.now() - startRequestedAt.current,
          active.startAttempt,
        );
        if (decision === 'complete') {
          updateCommand({ ...active, phase: 'released' });
          setPlaying(anyPlaying(vods, active.moment, next));
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
      setPlaying(anyPlaying(vods, momentRef.current, next));
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
    const current = vods.find((v) => vodKey(v) === leaderKey);
    const leader =
      (current && supportsPlayback(current) && covers(current) ? current : undefined) ??
      vods.find((v) => supportsPlayback(v) && covers(v)) ??
      vods.find(covers);
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
  function loadSession(next: Session) {
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
      syncTo(momentAt(vod, handle.getCurrentTime()), !handle.isPaused(), vodKey(vod));
      setAudioKey('');
      setNotice('');
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  function remove(vod: Vod) {
    if (busy) return;
    const key = vodKey(vod);
    const removal = {
      vod,
      index: vods.findIndex((v) => vodKey(v) === key),
      moment,
      clips: clips.filter((clip) => clip.vodKey === key),
      shownAt: Date.now(),
    };
    const next = vods.filter((v) => vodKey(v) !== key);
    setVods(next);
    setClips((current) => current.filter((clip) => clip.vodKey !== key));
    if (audioKey === key) setAudioKey('');
    if (!next.length) {
      clearWorkspace(false);
      setRemoved(removal);
      return;
    }
    setRemoved(removal);
    const { min, max } = timelineBounds(next);
    const nextMoment = Math.max(min, Math.min(max, moment));
    if (leaderKey === key || nextMoment !== moment)
      syncTo(nextMoment, false, leaderKey === key ? vodKey(next[0]) : leaderKey);
  }
  function undoRemove() {
    if (!removed || busy) return;
    if (vods.some((v) => vodKey(v) === vodKey(removed.vod))) {
      setRemoved(undefined);
      return;
    }
    if (vods.length >= MAX_VODS) {
      setNotice('Remove another recording before restoring this one.');
      return;
    }
    const next = [...vods];
    next.splice(Math.min(removed.index, next.length), 0, removed.vod);
    setVods(next);
    setClips((current) => mergeClips(current, removed.clips));
    if (!vods.length) syncTo(removed.moment, false, vodKey(removed.vod));
    setRemoved(undefined);
  }
  function reorder(key: string, position: number) {
    if (busy) return;
    const from = vods.findIndex((v) => vodKey(v) === key);
    const to = Math.max(0, Math.min(vods.length - 1, position));
    if (from < 0 || from === to) return;
    const next = [...vods];
    const [vod] = next.splice(from, 1);
    next.splice(to, 0, vod);
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
    setOrderAnnouncement(`${vod.channel} moved to position ${to + 1} of ${next.length}.`);
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
    history.replaceState(null, '', location.pathname);
  }
  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showFlash(done);
    } catch {
      setNotice('Clipboard access was blocked. Open the link to copy it, or export the session.');
    }
  }
  function share() {
    try {
      const url = new URL(location.href);
      url.search = '';
      url.hash = `session=${encodeSession(session())}`;
      void copy(url.toString(), `Session link copied · ${vods.length} recordings`);
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  function exportSession() {
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(session(), null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vod-sync-session.json';
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
    return anyPlaying(vods, moment, states);
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
    const leader =
      vods.find(
        (v) =>
          supportsPlayback(v) &&
          vodKey(v) === leaderKey &&
          matchMoment(v, moment).state === 'playing',
      ) ?? vods.find((v) => supportsPlayback(v) && matchMoment(v, moment).state === 'playing');
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
      if (event.key.toLowerCase() === 'z' && removed && !event.shiftKey) {
        event.preventDefault();
        undoRemove();
      }
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === '/') {
      if (watchMode) return;
      event.preventDefault();
      (vods.length ? addField : startField).current?.focus();
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
  const startingProgress = starting
    ? startProgress(vods, command.moment, command.serial, playbackStates)
    : null;
  const bufferProgress = preparing
    ? seekBarrier(vods, command.moment, command.serial, playbackStates)
    : null;
  const intent = preparing || starting ? command.playing : playing;
  const coverable = vods.some(
    (vod) => supportsPlayback(vod) && matchMoment(vod, moment).state === 'playing',
  );
  const source = vods.find((vod) => vodKey(vod) === leaderKey);
  // A soloed recording that doesn't cover the moment hands audio back to the source.
  const soloed = vods.find(
    (vod) => vodKey(vod) === audioKey && matchMoment(vod, moment).state === 'playing',
  );
  const audibleKey = soloed ? audioKey : '';
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
        text: `Closed ${removed.vod.channel}`,
        announce: `Closed ${removed.vod.channel}`,
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
    const summary = syncSummary(vods, moment, playbackStates, leaderKey);
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
                  onClick: () => setAudioKey(''),
                },
              ]
            : [],
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
      className={`app ${watchMode ? 'watch-mode' : ''} ${vods.length > 3 ? 'fit-height' : ''} ${vods.length ? '' : 'is-empty'}`}
    >
      <div className="sr-only" role="status" aria-live="polite">
        {orderAnnouncement}
      </div>
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <BrandMark />
          VOD Sync
        </a>
        {!!vods.length && bounds && (
          <>
            <span className="topbar-divider" />
            <span className="session-meta">
              <b>
                {vods.length} recording{vods.length === 1 ? '' : 's'}
              </b>{' '}
              · {formatSpan(bounds.max - bounds.min)}
            </span>
            <div className="add" ref={addForm}>
              <form className="add-field" onSubmit={addRecordings} aria-label="Add recordings">
                <Plus size={16} aria-hidden="true" />
                <label htmlFor="vod-input" className="sr-only">
                  Add recordings
                </label>
                <textarea
                  ref={addField}
                  id="vod-input"
                  rows={1}
                  value={input}
                  spellCheck={false}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Add a VOD, clip or twitch/name at ${clock(moment, localTime)}`}
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
          {vods.length ? (
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
              disabled={!vods.length}
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
              disabled={busy || !vods.length}
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
          {resultRows.map((row) => (
            <div className={`add-row ${row.status}`} key={row.input}>
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
                {(row.status === 'added' || row.status === 'existing') && (
                  <>
                    <PlatformMark platform={row.vod.platform} /> {row.vod.channel}
                    {row.status === 'existing' ? (
                      ' · already in session'
                    ) : (
                      <span className="mono"> {formatTime(row.offsetSeconds)}</span>
                    )}
                  </>
                )}
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
            {SHORTCUTS.map(([keys, label]) => (
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
            loadSession(validateSession(JSON.parse(await file.text())));
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
        {!vods.length ? (
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
            onOpen={loadSession}
            onForget={(savedAt) => {
              const next = recent.filter((entry) => entry.savedAt !== savedAt);
              writeRecent(next);
              setRecent(next);
            }}
            closed={removed?.vod.channel}
            onUndo={undoRemove}
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
            {/* Keep iframe DOM positions stable: moving an iframe reloads Twitch even with React keys. */}
            {[...vods]
              .sort((a, b) => vodKey(a).localeCompare(vodKey(b)))
              .map((vod) => (
                <Player
                  key={vodKey(vod)}
                  vod={vod}
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
                  soloed={audioKey === vodKey(vod)}
                  busy={busy}
                  localTime={localTime}
                  onSolo={() => {
                    setAudioKey(vodKey(vod));
                    showFlash(`Listening to ${vod.channel} only`);
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
                    index: vods.indexOf(vod),
                    position: positions[vods.indexOf(vod)],
                    count: vods.length,
                    disabled: busy || vods.length < 2,
                    dragging: draggingKey === vodKey(vod),
                    target: dropKey === vodKey(vod) && draggingKey !== vodKey(vod),
                    onStart: (event) => {
                      event.dataTransfer.setData('text/plain', vodKey(vod));
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingKey(vodKey(vod));
                      setDropKey(vodKey(vod));
                    },
                    onEnd: () => {
                      setDraggingKey('');
                      setDropKey('');
                    },
                    onOver: (event) => {
                      if (!draggingKey) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropKey(vodKey(vod));
                    },
                    onDrop: (event) => {
                      if (!draggingKey) return;
                      event.preventDefault();
                      reorder(draggingKey, vods.indexOf(vod));
                      setDraggingKey('');
                      setDropKey('');
                    },
                    onMove: (index) => reorder(vodKey(vod), index),
                  }}
                  onRemove={() => remove(vod)}
                />
              ))}
          </div>
        )}
      </main>
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
