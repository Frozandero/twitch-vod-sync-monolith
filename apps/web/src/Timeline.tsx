import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import {
  formatTime,
  matchDescription,
  matchMoment,
  startMs,
  vodKey,
  type ClipMarker,
  type Vod,
} from '@vodsync/core';
import type { PlaybackSnapshot } from './playback';
import { DRIFT_LIMIT, driftSeconds } from './syncSummary';
import { percentOf, rulerTicks, type Range } from './timelineScale';
import { calendarDate, clock, formatDelta, shortClock } from './timeFormat';
import { Kbd, PlatformMark } from './ui';

const zoneOffset = (ms: number, local: boolean) =>
  local ? -new Date(ms).getTimezoneOffset() * 60000 : 0;

export function Timeline({
  vods,
  clips,
  range,
  moment,
  draft,
  onDraft,
  localTime,
  leaderKey,
  playbackStates,
  onSeek,
  onRemove,
  onClose,
  sheet,
}: {
  vods: Vod[];
  clips: ClipMarker[];
  range: Range;
  moment: number;
  draft: number | null;
  onDraft: (moment: number | null) => void;
  localTime: boolean;
  leaderKey: string;
  playbackStates: Record<string, PlaybackSnapshot>;
  onSeek: (moment: number) => void;
  onRemove: (vod: Vod) => void;
  onClose: () => void;
  sheet: boolean;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  // As a phone sheet the timeline is modal: move focus into it and return it on close.
  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, [sheet]);
  const shown = draft ?? moment;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const zone = localTime ? 'local time' : 'UTC';
  const inView = shown >= range.min && shown <= range.max;
  const selected = Math.max(0, Math.min(100, percentOf(range, shown)));
  const ticks = rulerTicks(range, 6, zoneOffset(range.min, localTime));
  const span = (range.max - range.min) / 1000;
  const byKey = new Map(vods.map((vod) => [vodKey(vod), vod]));
  function commit() {
    if (draftRef.current === null) return;
    onSeek(draftRef.current);
    onDraft(null);
  }
  return (
    <div
      className="timeline"
      id="timeline-lanes"
      role={sheet ? 'dialog' : undefined}
      aria-modal={sheet || undefined}
      aria-labelledby={sheet ? 'timeline-heading' : undefined}
    >
      <div className="tl-sheet-head">
        <h2 id="timeline-heading">Timeline</h2>
        <button
          ref={closeButton}
          className="icon-btn"
          aria-label="Close timeline"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="tl-head">
        <div className="tl-key">
          <button type="button" className="tl-key-button" aria-describedby="timeline-key">
            Key
          </button>
          <div className="tl-key-pop" id="timeline-key" role="tooltip">
            <span>
              <i className="key-selected" /> Selected moment
            </span>
            <span>
              <i className="key-aligned" /> Player within {DRIFT_LIMIT} s
            </span>
            <span>
              <i className="key-drifted" /> Player drifting
            </span>
            <span>
              <i className="key-clip" /> Clip moment
            </span>
            <span className="key-shortcuts">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> 5 s <Kbd>J</Kbd>
              <Kbd>L</Kbd> 10 s
            </span>
          </div>
        </div>
        <div className="tl-ruler" aria-hidden="true">
          {ticks
            .filter((tick) => !inView || Math.abs(percentOf(range, tick) - selected) > 7)
            .map((tick) => (
              <span key={tick} style={{ left: `${percentOf(range, tick)}%` }}>
                {shortClock(tick, localTime)}
              </span>
            ))}
          {inView && (
            <b className="tl-moment" style={{ left: `${selected}%` }}>
              {clock(shown, localTime)}
            </b>
          )}
        </div>
        <span />
      </div>
      <div className="tl-body">
        {vods.map((vod) => {
          const key = vodKey(vod);
          const match = matchMoment(vod, shown);
          const playback = playbackStates[key];
          const drift = driftSeconds(vod, shown, playback);
          const actual =
            playback?.status === 'ready' && playback.seconds !== null
              ? startMs(vod) + playback.seconds * 1000
              : null;
          const start = percentOf(range, startMs(vod));
          const end = percentOf(range, startMs(vod) + vod.durationSeconds * 1000);
          const left = Math.max(0, start);
          const width = Math.max(0, Math.min(100, end) - left);
          const source = key === leaderKey;
          return (
            <div className={`tl-row ${match.state}`} key={key}>
              <div className="tl-name" title={vod.title}>
                <PlatformMark platform={vod.platform} />
                <span>{vod.channel}</span>
              </div>
              <div className="tl-track">
                {width > 0 && (
                  <span
                    className="tl-range"
                    title={`${vod.channel}: ${clock(startMs(vod), localTime)}–${clock(startMs(vod) + vod.durationSeconds * 1000, localTime)} ${localTime ? 'local' : 'UTC'}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                )}
                {inView && <span className="tl-selected" style={{ left: `${selected}%` }} />}
                {actual !== null && actual >= range.min && actual <= range.max && (
                  <span
                    className={`tl-player ${drift !== null && Math.abs(drift) > DRIFT_LIMIT ? 'drifted' : 'aligned'}`}
                    role="img"
                    aria-label={`${vod.channel} player at ${formatTime(playback!.seconds!)}`}
                    title={`Player ${formatTime(playback!.seconds!)}${drift !== null ? ` · ${formatDelta(drift)}` : ''}`}
                    style={{ left: `${percentOf(range, actual)}%` }}
                  />
                )}
              </div>
              <div className="tl-meta" title={matchDescription(match)}>
                {match.state === 'playing' ? (
                  <time>{formatTime(match.offsetSeconds)}</time>
                ) : (
                  <span className="tl-boundary">
                    {match.state === 'before' ? 'not started' : 'ended'}
                  </span>
                )}
                {drift !== null && !source && (
                  <span className={`tl-delta ${Math.abs(drift) > DRIFT_LIMIT ? 'drifted' : ''}`}>
                    {formatDelta(drift)}
                  </span>
                )}
                <span className="tl-meta-actions">
                  <a
                    className="icon-btn small"
                    href={match.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={
                      match.state === 'playing'
                        ? `Open ${vod.channel} at ${formatTime(match.offsetSeconds)}`
                        : `Open ${vod.channel} VOD ${match.state === 'before' ? 'start' : 'end'}`
                    }
                    title={
                      match.state === 'playing'
                        ? `Open at ${formatTime(match.offsetSeconds)}`
                        : `Open VOD ${match.state === 'before' ? 'start' : 'end'} · ${matchDescription(match)}`
                    }
                  >
                    <ArrowUpRight size={14} />
                  </a>
                  <button
                    className="icon-btn small subtle"
                    aria-label={`Close ${vod.channel}`}
                    title={`Close ${vod.channel}`}
                    onClick={() => onRemove(vod)}
                  >
                    <X size={14} />
                  </button>
                </span>
              </div>
            </div>
          );
        })}
        <div className="tl-overlay">
          <input
            className="tl-seeker"
            type="range"
            aria-label="Seek all recordings"
            min={0}
            max={span}
            step="1"
            value={Math.max(0, Math.min(span, (shown - range.min) / 1000))}
            aria-valuetext={`${calendarDate(shown, localTime)} ${clock(shown, localTime)} ${zone}`}
            onChange={(e) => onDraft(range.min + Number(e.target.value) * 1000)}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          {clips.map((clip) => {
            const vod = byKey.get(clip.vodKey);
            if (!vod) return null;
            const at = startMs(vod) + clip.offsetSeconds * 1000;
            if (at < range.min || at > range.max) return null;
            const row = vods.indexOf(vod);
            return (
              <button
                key={`${clip.platform}:${clip.id}`}
                type="button"
                className="tl-clip"
                aria-label={`Go to clip ${clip.id} at ${formatTime(clip.offsetSeconds)} in ${vod.channel}`}
                title={`Clip ${clip.id} · ${vod.channel} ${formatTime(clip.offsetSeconds)}`}
                style={{
                  left: `${percentOf(range, at)}%`,
                  top: `calc(${row} * var(--tl-row) + var(--tl-clip-y))`,
                }}
                onClick={() => onSeek(at)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
