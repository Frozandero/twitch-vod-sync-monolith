import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Pause, Play, X } from 'lucide-react';
import {
  formatTime,
  matchDescription,
  matchMoment,
  startMs,
  timelineBounds,
  vodKey,
  type Vod,
} from '@vodsync/core';
import { alignment, type PlaybackSnapshot } from './playback';
import { supportsPlayback } from './capabilities';

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (ms: number, local: boolean) => {
  const date = new Date(ms);
  return local
    ? [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join(':')
    : date.toISOString().slice(11, 19);
};
const calendarDate = (ms: number, local: boolean) => {
  const date = new Date(ms);
  return local
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : date.toISOString().slice(0, 10);
};
export function TimelineToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="icon-button timeline-toggle"
      aria-label={collapsed ? 'Show timeline' : 'Hide timeline'}
      title={collapsed ? 'Show timeline' : 'Hide timeline'}
      aria-expanded={!collapsed}
      aria-controls="timeline-seeker-area"
      onClick={onToggle}
    >
      {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );
}

export function Timeline({
  vods,
  moment,
  playing,
  preparing,
  playbackStates,
  onSeek,
  onPlayback,
  onRemove,
  collapsed,
}: {
  vods: Vod[];
  moment: number;
  playing: boolean;
  preparing: boolean;
  playbackStates: Record<string, PlaybackSnapshot>;
  onSeek: (moment: number) => void;
  onPlayback: () => void;
  onRemove: (vod: Vod) => void;
  collapsed: boolean;
}) {
  const { min, max } = timelineBounds(vods);
  const [draft, setDraft] = useState<number | null>(null);
  const [localTime, setLocalTime] = useState(false);
  useEffect(() => {
    if (collapsed) setDraft(null);
  }, [collapsed]);
  const shown = draft ?? moment;
  const zoneLabel = localTime ? 'Local' : 'UTC';
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const duration = (max - min) / 1000;
  function commit() {
    if (draft !== null) {
      onSeek(draft);
      setDraft(null);
    }
  }
  return (
    <section className="timeline" aria-label="Shared broadcast timeline" hidden={collapsed}>
      <div className="timeline-toolbar">
        {!collapsed && (
          <>
            <button
              className="icon-button"
              aria-label={
                preparing
                  ? playing
                    ? 'Stay paused after buffering'
                    : 'Play when all VODs are ready'
                  : playing
                    ? 'Pause all players'
                    : 'Play matching players'
              }
              title={
                preparing
                  ? playing
                    ? 'Stay paused after buffering'
                    : 'Play when all VODs are ready'
                  : playing
                    ? 'Pause all players'
                    : 'Play matching players'
              }
              onClick={onPlayback}
              disabled={
                !playing &&
                !preparing &&
                !vods.some(
                  (vod) => supportsPlayback(vod) && matchMoment(vod, moment).state === 'playing',
                )
              }
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <div className="timeline-clock">
              <time dateTime={new Date(shown).toISOString()}>
                {calendarDate(shown, localTime)} <strong>{clock(shown, localTime)}</strong>
              </time>
              <button
                className="timezone-toggle"
                aria-label="Show timeline in local time"
                aria-pressed={localTime}
                title={
                  localTime
                    ? `Local time (${localZone}). Click to show UTC.`
                    : `Click to show local time (${localZone}).`
                }
                onClick={() => setLocalTime((local) => !local)}
              >
                {zoneLabel}
              </button>
            </div>
            <span>Drag to select a moment</span>
          </>
        )}
      </div>
      <div id="timeline-seeker-area" hidden={collapsed}>
        <div className="timeline-ruler">
          <span>{clock(min, localTime)}</span>
          <span>{clock((min + max) / 2, localTime)}</span>
          <span>{clock(max, localTime)}</span>
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
                <div className="timeline-recording">
                  <button
                    className="icon-button timeline-remove"
                    aria-label={`Remove ${vod.channel}`}
                    title={`Remove ${vod.channel} recording`}
                    onClick={() => onRemove(vod)}
                  >
                    <X size={13} />
                  </button>
                  <span title={vod.channel}>{vod.channel}</span>
                </div>
                <div className="timeline-track">
                  <div
                    className={`timeline-range ${sync.state === 'aligned' ? 'active' : sync.state === 'drifted' ? 'drifted' : ''}`}
                    title={`${vod.channel}: ${clock(startMs(vod), localTime)}–${clock(startMs(vod) + vod.durationSeconds * 1000, localTime)} ${zoneLabel}${localTime ? ` (${localZone})` : ''}`}
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
            aria-valuetext={`${calendarDate(shown, localTime)} ${clock(shown, localTime)} ${localTime ? `local time (${localZone})` : 'UTC'}`}
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
