import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  FileUp,
  Info,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  Settings2,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  MAX_VODS,
  decodeSession,
  encodeSession,
  formatTime,
  matchMoment,
  momentAt,
  parseMedia,
  parseTime,
  startMs,
  timelineBounds,
  validateSession,
  vodKey,
  type Session,
  type Vod,
} from '@vodsync/core';
import { resolveMedia, type TwitchAuth } from '@vodsync/providers';
import {
  beginLogin,
  configuredClientId,
  disconnect,
  redirectUri,
  restoreAuth,
  validateAuth,
} from './auth';
import { Player, type PlayerHandle, type SyncCommand } from './Player';
import { Timeline } from './Timeline';
import type { PlaybackSnapshot, StopReason } from './playback';
import { readStorage, writeStorage } from './storage';

const SESSION_KEY = 'vodsync.session.v1'; // Preserve and migrate existing workspaces.
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Please retry.');
function twitchSession(session: Session): Session {
  const vods = session.vods.filter((v) => v.platform === 'twitch');
  if (!vods.length) throw new Error('This release supports Twitch recordings only.');
  const { min, max } = timelineBounds(vods);
  return {
    ...session,
    view: 'grid',
    vods,
    momentMs: Math.max(min, Math.min(max, session.momentMs)),
    leaderKey: vods.some((v) => vodKey(v) === session.leaderKey)
      ? session.leaderKey
      : vodKey(vods[0]),
  };
}
function initialState(): { session?: Session; error?: string } {
  try {
    const shared = new URLSearchParams(location.hash.slice(1)).get('session');
    if (shared) return { session: twitchSession(decodeSession(shared)) };
    const saved = readStorage(SESSION_KEY);
    return saved ? { session: twitchSession(validateSession(JSON.parse(saved))) } : {};
  } catch (error) {
    return { error: messageOf(error) };
  }
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => {
      el.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
      aria-label={title}
    >
      <div className="modal-content">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={close}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export default function App() {
  const [initial] = useState(initialState);
  const [vods, setVods] = useState<Vod[]>(initial.session?.vods || []);
  const [leaderKey, setLeaderKey] = useState(initial.session?.leaderKey || '');
  const [moment, setMoment] = useState(initial.session?.momentMs || 0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<{ input: string; error: string }[]>([]);
  const [notice, setNotice] = useState(initial.error || '');
  const [modal, setModal] = useState<'settings' | 'help' | null>(null);
  const [editing, setEditing] = useState<Vod>();
  const [watchMode, setWatchMode] = useState(false);
  const [auth, setAuth] = useState<TwitchAuth>();
  const [clientId, setClientId] = useState(
    configuredClientId || readStorage('vodsync.clientId') || '',
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playbackStates, setPlaybackStates] = useState<Record<string, PlaybackSnapshot>>({});
  const leaderRef = useRef(leaderKey);
  leaderRef.current = leaderKey;
  const playerStopped = useCallback((vod: Vod, reason: StopReason) => {
    if (vodKey(vod) !== leaderRef.current) return;
    setPlaying(false);
    if (reason === 'ended') setMoment(startMs(vod) + vod.durationSeconds * 1000);
  }, []);
  const [command, setCommand] = useState<SyncCommand | null>(() =>
    initial.session
      ? {
          moment: initial.session.momentMs,
          playing: false,
          leader: initial.session.leaderKey,
          serial: 0,
        }
      : null,
  );
  const handles = useRef(new Map<string, PlayerHandle>());
  const importInput = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const serial = useRef(0);
  const demo = vods.some((v) => v.provenance === 'demo');
  const register = useCallback((key: string, handle: PlayerHandle | null) => {
    if (handle) handles.current.set(key, handle);
    else handles.current.delete(key);
  }, []);
  const session = (): Session =>
    validateSession({ version: 2, vods, leaderKey, momentMs: moment, view: 'grid' });

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
  }, [vods, leaderKey, moment]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWatchMode(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
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
      const source = vods.find((v) => vodKey(v) === leaderKey),
        state = next[leaderKey];
      setPlaying(state?.status === 'ready' && !state.paused);
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

  function syncTo(nextMoment: number, nextPlaying = false, leader = leaderKey) {
    setMoment(nextMoment);
    setLeaderKey(leader);
    setPlaying(nextPlaying);
    setCommand({ moment: nextMoment, playing: nextPlaying, leader, serial: ++serial.current });
  }
  function loadSession(next: Session) {
    const clean = twitchSession(next);
    setVods(clean.vods);
    setPlaybackStates({});
    setFailures([]);
    setNotice('');
    syncTo(clean.momentMs, false, clean.leaderKey);
  }
  async function addRecordings(event?: FormEvent) {
    event?.preventDefault();
    setNotice('');
    setFailures([]);
    const inputs = [
      ...new Set(
        input
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (!inputs.length) {
      setNotice('Paste a Twitch VOD URL, timestamped URL, clip, or VOD ID.');
      return;
    }
    if (inputs.length > MAX_VODS) {
      setNotice('Too many links in one request. Add them in smaller batches.');
      return;
    }
    setBusy(true);
    const results: PromiseSettledResult<Awaited<ReturnType<typeof resolveMedia>>>[] = [];
    for (let i = 0; i < inputs.length; i += 4)
      results.push(
        ...(await Promise.allSettled(
          inputs.slice(i, i + 4).map(async (url) => {
            if (parseMedia(url).platform !== 'twitch')
              throw new Error('Twitch links only for now.');
            return resolveMedia(url, auth);
          }),
        )),
      );
    const next = new Map(vods.filter((v) => v.provenance !== 'demo').map((v) => [vodKey(v), v]));
    const errors: typeof failures = [];
    let anchor: { vod: Vod; offsetSeconds: number; input: string } | undefined;
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push({
          input: inputs[i],
          error: messageOf(result.reason).replace(
            /(?:Add timing details manually|add timing details manually|add timing manually)\.?/g,
            'connect Twitch in Settings.',
          ),
        });
        return;
      }
      const { vod, offsetSeconds } = result.value;
      try {
        momentAt(vod, offsetSeconds);
      } catch (error) {
        errors.push({ input: inputs[i], error: messageOf(error) });
        return;
      }
      if (!next.has(vodKey(vod)) && next.size >= MAX_VODS) {
        errors.push({ input: inputs[i], error: 'This session is too large.' });
        return;
      }
      const added = { ...vod, correctionSeconds: next.get(vodKey(vod))?.correctionSeconds ?? 0 };
      next.set(vodKey(vod), added);
      if (!anchor) anchor = { vod: added, offsetSeconds, input: inputs[i] };
    });
    if (anchor) {
      setVods([...next.values()]);
      const first = anchor as { vod: Vod; offsetSeconds: number; input: string };
      const ref = parseMedia(first.input);
      if (!vods.length || demo || ref.kind === 'clip' || /[?&](t|time)=/.test(first.input))
        syncTo(momentAt(first.vod, first.offsetSeconds), false, vodKey(first.vod));
      else syncTo(moment, false, leaderKey);
      setInput(errors.map((e) => e.input).join('\n'));
    }
    setFailures(errors);
    setBusy(false);
  }
  function syncFrom(vod: Vod) {
    try {
      const handle = handles.current.get(vodKey(vod));
      if (!handle) throw new Error('Wait for this player to load.');
      syncTo(momentAt(vod, handle.getCurrentTime()), !handle.isPaused(), vodKey(vod));
      setNotice('');
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  function remove(vod: Vod) {
    if (busy) return;
    const next = vods.filter((v) => vodKey(v) !== vodKey(vod));
    setVods(next);
    if (!next.length) {
      clearWorkspace();
      return;
    }
    const { min, max } = timelineBounds(next);
    syncTo(
      Math.max(min, Math.min(max, moment)),
      false,
      leaderKey === vodKey(vod) ? vodKey(next[0]) : leaderKey,
    );
  }
  function clearWorkspace() {
    if (busy) return;
    setVods([]);
    setPlaybackStates({});
    setCommand(null);
    setLeaderKey('');
    setMoment(0);
    setFailures([]);
    setPlaying(false);
    setWatchMode(false);
    history.replaceState(null, '', location.pathname);
  }
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      clearTimeout(copyTimer.current);
      setCopied(label);
      copyTimer.current = setTimeout(() => setCopied(''), 2200);
    } catch {
      setNotice('Clipboard access was blocked. Open the link to copy it, or export the session.');
    }
  }
  function share() {
    try {
      const url = new URL(location.href);
      url.search = '';
      url.hash = `session=${encodeSession(session())}`;
      void copy(url.toString(), 'session');
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
  function playback() {
    const leader =
      vods.find((v) => vodKey(v) === leaderKey && matchMoment(v, moment).state === 'playing') ??
      vods.find((v) => matchMoment(v, moment).state === 'playing');
    if (!leader) {
      setNotice('No recording covers this moment. Seek to a recorded part of the timeline.');
      return;
    }
    syncTo(moment, !playing, vodKey(leader));
  }

  return (
    <div className={`app-shell ${watchMode ? 'watch-mode' : ''}`}>
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          VOD <span>Sync</span>
        </a>
        <div className="app-actions">
          <button
            className="button"
            aria-label="Share session"
            onClick={share}
            disabled={!vods.length}
          >
            {copied === 'session' ? <Check size={14} /> : <Share2 size={14} />}
            <span>{copied === 'session' ? 'Copied' : 'Share'}</span>
          </button>
          <button
            className="button watch-button"
            aria-label="Watch mode"
            onClick={() => setWatchMode(true)}
            disabled={!vods.length}
          >
            <Maximize2 size={14} />
            <span>Watch mode</span>
          </button>
          <details className="menu">
            <summary className="icon-button" aria-label="More options">
              <MoreHorizontal size={20} />
            </summary>
            <div className="menu-content">
              <button onClick={() => importInput.current?.click()} disabled={busy}>
                <FileUp size={15} />
                Import session
              </button>
              <button onClick={exportSession} disabled={!vods.length}>
                <Download size={15} />
                Export session
              </button>
              <button onClick={() => setModal('settings')}>
                <Settings2 size={15} />
                Twitch connection
              </button>
              <button onClick={() => setModal('help')}>
                <Info size={15} />
                Help
              </button>
              <a
                href="https://github.com/Frozandero/twitch-vod-sync-monolith"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
                GitHub
              </a>
              <button onClick={clearWorkspace} disabled={busy || !vods.length}>
                <Trash2 size={15} />
                Clear workspace
              </button>
            </div>
          </details>
        </div>
      </header>
      {watchMode && (
        <button className="exit-watch button" onClick={() => setWatchMode(false)}>
          <Minimize2 size={14} />
          Exit watch mode <kbd>Esc</kbd>
        </button>
      )}
      <input
        className="visually-hidden"
        ref={importInput}
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
      <form className="add-bar" onSubmit={addRecordings}>
        <label htmlFor="vod-input">Twitch URLs</label>
        <textarea
          id="vod-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste VODs, timestamped URLs, or clips · one per line"
          rows={1}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void addRecordings();
            }
          }}
        />
        <button className="button primary" type="submit" disabled={busy || authLoading}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={16} />}{' '}
          {busy ? 'Loading…' : 'Add'}
        </button>
      </form>
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!!failures.length && (
        <div className="lookup-errors" role="alert">
          {failures.map((failure, i) => (
            <div key={i}>
              <strong>{failure.input}</strong>
              <span>{failure.error}</span>
            </div>
          ))}
        </div>
      )}
      {demo && (
        <div className="demo-banner">
          <span>Demo · simulated players and sample timing</span>
          <button className="text-button" onClick={clearWorkspace}>
            Close demo <X size={13} />
          </button>
        </div>
      )}
      <main className={`workspace ${!vods.length ? 'empty' : ''}`}>
        {!vods.length ? (
          <div className="empty-state">
            <h1>Add Twitch recordings</h1>
            <p>Paste links above. Sync from any player, or drag the timeline to choose a moment.</p>
          </div>
        ) : (
          <div className="player-grid">
            {vods.map((vod) => (
              <Player
                key={vodKey(vod)}
                vod={vod}
                source={vodKey(vod) === leaderKey}
                command={command}
                moment={moment}
                register={register}
                onSync={syncFrom}
                onStopped={playerStopped}
                onRemove={() => remove(vod)}
                onSettings={() => {
                  if (!busy) setEditing(vod);
                }}
              />
            ))}
          </div>
        )}
      </main>
      {!!vods.length && (
        <Timeline
          vods={vods}
          moment={moment}
          playing={playing}
          playbackStates={playbackStates}
          onSeek={(time) => {
            const leader = vods.find((v) => matchMoment(v, time).state === 'playing');
            syncTo(time, false, leader ? vodKey(leader) : leaderKey);
          }}
          onPlayback={playback}
          onRemove={remove}
        />
      )}
      {editing && (
        <Modal title={editing.channel} close={() => setEditing(undefined)}>
          <RecordingSettings
            vod={editing}
            moment={moment}
            onSeek={(time) => {
              syncTo(momentAt(editing, parseTime(time)), false, vodKey(editing));
              setEditing(undefined);
            }}
            onCorrect={(seconds) => {
              const next = vods.map((v) =>
                vodKey(v) === vodKey(editing) ? { ...v, correctionSeconds: seconds } : v,
              );
              const bounds = timelineBounds(next);
              setVods(next);
              syncTo(Math.max(bounds.min, Math.min(bounds.max, moment)), false);
              setEditing(undefined);
            }}
          />
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal title="Twitch connection" close={() => setModal(null)}>
          <div className="form-stack">
            <p>
              Public lookup is used by default. Connect a registered Twitch application to use the
              official API instead.
            </p>
            {auth ? (
              <>
                <p>Connected to Twitch.</p>
                <button
                  className="button"
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
                <label>
                  Public Client ID
                  <input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Twitch application Client ID"
                    autoComplete="off"
                  />
                </label>
                <p>
                  Register an app in the{' '}
                  <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">
                    Twitch developer console
                  </a>{' '}
                  with this redirect URL:
                </p>
                <code>{redirectUri()}</code>
                <small>
                  No client secret. Credentials stay in this tab and are excluded from shared
                  sessions.
                </small>
                <button
                  className="button primary"
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
                  Connect Twitch
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="Using VOD Sync" close={() => setModal(null)}>
          <div className="help-content">
            <p>
              Paste Twitch VOD URLs or IDs, timestamped URLs, or clips. The first recording sets the
              initial moment. Adding a timestamped URL or clip selects that moment in its parent
              VOD.
            </p>
            <p>
              <strong>Grid:</strong> seek any player, then click its Sync button. The others jump to
              the same broadcast time and follow its play/pause state. The chosen player supplies
              audio; each player also has its own mute button.
            </p>
            <p>
              <strong>Timeline:</strong> click or drag along the timeline to seek all recordings.
              The range covers every recording, including gaps. The play button starts recordings
              that cover the selected moment. Thin lines mark the selection; thicker markers show
              reported player positions. Ahead/behind labels show drift; a player with no reported
              clock is marked Not verified.
            </p>
            <p>
              <strong>Timestamp links:</strong> use the go-to icon next to a timeline timestamp or
              above a player. Hide or show the timeline with its toggle; playback continues. Use a
              recording’s settings to change its timestamp or correct a fixed delay.
            </p>
            <p>
              Watch mode hides setup controls; Escape leaves it. Ads and buffering can shift
              playback, so sync again when needed. Finished players are removed to stop Up Next;
              seek earlier to replay the original VOD. Expired/private videos, missing clip parents,
              and edited uploads may not work. Twitch players require at least 400 × 300 pixels;
              small screens can scroll inside the player.
            </p>
            <p>
              Kick and manual metadata entry are deferred. Public Twitch lookup is undocumented and
              can change.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RecordingSettings({
  vod,
  moment,
  onSeek,
  onCorrect,
}: {
  vod: Vod;
  moment: number;
  onSeek: (time: string) => void;
  onCorrect: (seconds: number) => void;
}) {
  const match = matchMoment(vod, moment);
  const [time, setTime] = useState(
    formatTime(Math.min(match.offsetSeconds, vod.durationSeconds - 1)),
  );
  const [correction, setCorrection] = useState(String(vod.correctionSeconds));
  const [error, setError] = useState('');
  return (
    <div className="form-stack">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onSeek(time);
          } catch (error) {
            setError(messageOf(error));
          }
        }}
      >
        <label>
          Seek all from this VOD
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label={`${vod.channel} timestamp`}
            placeholder="00:00:00"
          />
        </label>
        <button className="button primary" type="submit">
          Seek all
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const seconds = Number(correction);
          if (!Number.isFinite(seconds) || Math.abs(seconds) > 86400) {
            setError('Enter a correction within 24 hours.');
            return;
          }
          onCorrect(seconds);
        }}
      >
        <label>
          Timing adjustment · seconds
          <input
            type="number"
            step="0.1"
            min="-86400"
            max="86400"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
          />
        </label>
        <small>Positive values shift the recording start later.</small>
        <button className="button" type="submit">
          Apply adjustment
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
