import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Pause, Play } from 'lucide-react';
import {
  formatTime,
  matchDescription,
  matchMoment,
  startMs,
  timelineBounds,
  vodKey,
  type Vod,
} from '@vodsync/core';
import { readStorage, writeStorage } from './storage';
import { alignment, type PlaybackSnapshot } from './playback';

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);
export function Timeline({
  vods,
  moment,
  playing,
  playbackStates,
  onSeek,
  onPlayback,
}: {
  vods: Vod[];
  moment: number;
  playing: boolean;
  playbackStates: Record<string, PlaybackSnapshot>;
  onSeek: (moment: number) => void;
  onPlayback: () => void;
}) {
  const { min, max } = timelineBounds(vods);
  const [draft, setDraft] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(
    () => readStorage('vodsync.timelineCollapsed') === 'true',
  );
  const shown = draft ?? moment;
  const duration = (max - min) / 1000;
  function commit() {
    if (draft !== null) {
      onSeek(draft);
      setDraft(null);
    }
  }
  return (
    <section
      className={`timeline ${collapsed ? 'collapsed' : ''}`}
      aria-label="Shared broadcast timeline"
    >
      <div className="timeline-toolbar">
        <button
          className="icon-button"
          aria-label={playing ? 'Pause all players' : 'Play matching players'}
          title={playing ? 'Pause all players' : 'Play matching players'}
          onClick={onPlayback}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <time>
          {new Date(shown).toISOString().slice(0, 10)} <strong>{clock(shown)}</strong> UTC
        </time>
        {!collapsed && <span>Drag to seek all recordings</span>}
        <button
          className="text-button timeline-toggle"
          aria-expanded={!collapsed}
          aria-controls="timeline-seeker-area"
          onClick={() => {
            setDraft(null);
            setCollapsed(!collapsed);
            writeStorage('vodsync.timelineCollapsed', String(!collapsed));
          }}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {collapsed ? 'Show timeline' : 'Hide timeline'}
        </button>
      </div>
      <div id="timeline-seeker-area" hidden={collapsed}>
        <div className="timeline-ruler">
          <span>{clock(min)}</span>
          <span>{clock((min + max) / 2)}</span>
          <span>{clock(max)}</span>
        </div>
        <div className="timeline-lanes">
          {vods.map((vod) => {
            const match = matchMoment(vod, shown);
            const playback = playbackStates[vodKey(vod)];
            const sync = alignment(vod, shown, playback);
            const actualMoment =
              playback?.status === 'ready' && playback.seconds !== null
                ? startMs(vod) + playback.seconds * 1000
                : null;
            const description =
              match.state !== 'playing'
                ? matchDescription(match)
                : `Selected timestamp ${formatTime(match.offsetSeconds)} · ${sync.label || 'Player within 2 seconds'}`;
            return (
              <div className={`timeline-row ${match.state}`} key={vodKey(vod)}>
                <span title={vod.channel}>{vod.channel}</span>
                <div className="timeline-track">
                  <div
                    className={`timeline-range ${sync.state === 'aligned' ? 'active' : sync.state === 'drifted' ? 'drifted' : ''}`}
                    title={`${vod.channel}: ${clock(startMs(vod))}–${clock(startMs(vod) + vod.durationSeconds * 1000)}`}
                    style={{
                      left: `${((startMs(vod) - min) / (max - min)) * 100}%`,
                      width: `${(vod.durationSeconds / duration) * 100}%`,
                    }}
                  />
                  <i
                    title="Selected broadcast moment"
                    style={{ left: `${((shown - min) / (max - min)) * 100}%` }}
                  />
                  {actualMoment !== null && (
                    <b
                      className={`actual-playhead ${sync.state}`}
                      role="img"
                      aria-label={`${vod.channel} player position ${formatTime(playback!.seconds!)}`}
                      title={`Player: ${formatTime(playback!.seconds!)}${sync.label ? ` · ${sync.label}` : ''}`}
                      style={{
                        left: `${Math.max(0, Math.min(100, ((actualMoment - min) / (max - min)) * 100))}%`,
                      }}
                    />
                  )}
                </div>
                <div className={`timeline-position ${sync.state}`} title={description}>
                  <time>{formatTime(match.offsetSeconds)}</time>
                  {sync.label && <small>{sync.label}</small>}
                </div>
                <a
                  className="icon-button timeline-link"
                  href={match.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={
                    match.state === 'playing'
                      ? `Go to ${vod.channel} at ${formatTime(match.offsetSeconds)}`
                      : `Open ${vod.channel} VOD ${match.state === 'before' ? 'start' : 'end'} — ${matchDescription(match)}`
                  }
                  title={
                    match.state === 'playing'
                      ? `Go to timestamp ${formatTime(match.offsetSeconds)}`
                      : `Open VOD ${match.state === 'before' ? 'start' : 'end'} · ${matchDescription(match)}`
                  }
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            );
          })}
          <input
            className="timeline-seeker"
            type="range"
            aria-label="Seek all recordings"
            min={0}
            max={duration}
            step="1"
            value={(shown - min) / 1000}
            aria-valuetext={`${clock(shown)} UTC`}
            onChange={(e) => setDraft(min + Number(e.target.value) * 1000)}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
        </div>
      </div>
    </section>
  );
}
