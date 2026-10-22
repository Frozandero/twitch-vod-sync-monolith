import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  TriangleAlert,
} from 'lucide-react';
import type { ClipMarker, Lane, Vod } from '@vodsync/core';
import type { PlaybackSnapshot } from './playback';
import { Timeline } from './Timeline';
import type { Range } from './timelineScale';
import { clock, dayLabel, formatSpan } from './timeFormat';
import { Kbd, Segmented } from './ui';

export type StatusAction = { label: string; icon: ReactNode; onClick: () => void };
export type BarStatus = {
  tone?: 'muted' | 'ink' | 'warning' | 'signal' | 'success';
  icon?: 'spin' | 'check' | 'alert';
  text: ReactNode;
  title?: string;
  actions?: StatusAction[];
  // What a screen reader should hear when this status appears. The sync summary
  // leaves it empty because its drift values change every half second.
  announce?: string;
};

// The bar's single status line: notices, progress, undo and summaries all land here.
export function StatusSlot({ status }: { status: BarStatus }) {
  return (
    <>
      {/* A stable live region: only the announcement text changes. */}
      <span className="sr-only" role="status">
        {status.announce}
      </span>
      <div className={`status-slot ${status.tone ?? 'muted'}`} title={status.title}>
        {status.icon === 'spin' && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
        {status.icon === 'check' && <Check size={14} aria-hidden="true" />}
        {status.icon === 'alert' && <TriangleAlert size={14} aria-hidden="true" />}
        <span className="status-text">{status.text}</span>
        {!!status.actions?.length && (
          <span className="status-actions">
            {status.actions.map((action) => (
              <button
                key={action.label}
                className="icon-btn"
                aria-label={action.label}
                title={action.label}
                onClick={action.onClick}
              >
                {action.icon}
              </button>
            ))}
          </span>
        )}
      </div>
    </>
  );
}

export function PlaybackBar({
  vods,
  clips,
  moment,
  playing,
  canPlay,
  playLabel,
  onPlayback,
  onSkip,
  localTime,
  onLocalTime,
  zoom,
  onZoom,
  overlap,
  range,
  expanded,
  onExpanded,
  watchMode,
  onExitWatch,
  status,
  leaderKey,
  playbackStates,
  onSeek,
  onRemove,
}: {
  vods: Vod[];
  clips: ClipMarker[];
  moment: number;
  playing: boolean;
  canPlay: boolean;
  playLabel: string;
  onPlayback: () => void;
  onSkip: (seconds: number) => void;
  localTime: boolean;
  onLocalTime: (local: boolean) => void;
  zoom: 'all' | 'overlap';
  onZoom: (zoom: 'all' | 'overlap') => void;
  overlap: Range | undefined;
  range: Range;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  watchMode: boolean;
  onExitWatch: () => void;
  status: BarStatus;
  leaderKey: string;
  playbackStates: Record<string, PlaybackSnapshot>;
  onSeek: (moment: number) => void;
  onRemove: (lane: Lane) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  // Collapsing the timeline discards an uncommitted seek preview.
  useEffect(() => {
    if (!expanded) setDraft(null);
  }, [expanded]);
  const shown = draft ?? moment;
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className={`playbar ${expanded ? 'expanded' : ''}`} aria-label="Playback">
      <div className="playbar-row">
        <div className="transport">
          <button
            className="icon-btn"
            aria-label="Back 10 seconds"
            title="Back 10 s (J)"
            onClick={() => onSkip(-10)}
          >
            <RotateCcw size={17} />
          </button>
          <button
            className="play-btn"
            aria-label={playLabel}
            title={`${playLabel} (Space)`}
            disabled={!canPlay}
            onClick={onPlayback}
          >
            {playing ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-btn"
            aria-label="Forward 10 seconds"
            title="Forward 10 s (L)"
            onClick={() => onSkip(10)}
          >
            <RotateCw size={17} />
          </button>
        </div>
        <div className="clock">
          <time className="clock-time" dateTime={new Date(shown).toISOString()}>
            {clock(shown, localTime)}
          </time>
          <span className="clock-date">{dayLabel(shown, localTime)}</span>
          <Segmented
            label="Clock timezone"
            value={localTime ? 'local' : 'utc'}
            onChange={(value) => onLocalTime(value === 'local')}
            options={[
              { value: 'utc', label: 'UTC' },
              { value: 'local', label: 'Local', title: `Local time (${localZone})` },
            ]}
          />
        </div>
        <span className="bar-divider" />
        <StatusSlot status={status} />
        <div className="bar-right">
          <Segmented
            label="Timeline zoom"
            value={zoom}
            onChange={onZoom}
            options={[
              { value: 'all', label: 'All', title: 'Show every recording' },
              {
                value: 'overlap',
                label: overlap ? `Overlap ${formatSpan(overlap.max - overlap.min)}` : 'Overlap',
                title: overlap
                  ? 'Zoom to the part every recording covers'
                  : 'No moment is covered by every recording',
                disabled: !overlap,
              },
            ]}
          />
          <button
            className="ghost-btn"
            aria-expanded={expanded}
            aria-controls={expanded ? 'timeline-lanes' : undefined}
            title={`${expanded ? 'Hide' : 'Show'} timeline (T)`}
            onClick={() => onExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            <span>Timeline</span>
            <Kbd>T</Kbd>
          </button>
          {watchMode && (
            <button className="ghost-btn" title="Exit watch mode (Esc)" onClick={onExitWatch}>
              <Minimize2 size={15} />
              <span>Exit</span>
              <Kbd>Esc</Kbd>
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <Timeline
          vods={vods}
          clips={clips}
          range={range}
          moment={moment}
          draft={draft}
          onDraft={setDraft}
          localTime={localTime}
          leaderKey={leaderKey}
          playbackStates={playbackStates}
          onSeek={onSeek}
          onRemove={onRemove}
        />
      )}
    </section>
  );
}
