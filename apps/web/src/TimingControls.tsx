import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Minus, Plus, RotateCcw } from 'lucide-react';
import { formatTime, matchMoment, parseTime, type Vod } from '@vodsync/core';
import { DRIFT_LIMIT } from './syncSummary';
import { formatDelta } from './timeFormat';

const LIMIT = 86400;
const signed = (seconds: number) =>
  `${seconds > 0 ? '+' : seconds < 0 ? '−' : ''}${Math.abs(seconds).toFixed(1)} s`;
const parseOffset = (text: string) =>
  Number(text.replace(/−/g, '-').replace(/[^\d.+-]/g, '') || NaN);

// Timing opens inside the player's header (Twitch pauses an embed that anything covers): the
// time becomes the jump field in place, and the offset controls open left of the toggle.
// Fixed offsets apply after the stepper settles, so a run of nudges lines up once.
export function TimingControls({
  vod,
  moment,
  drift,
  source,
  sourceName,
  toggle,
  onSeek,
  onCorrect,
  onDone,
}: {
  vod: Vod;
  moment: number;
  drift: number | null;
  source: boolean;
  sourceName: string;
  // The header's Timing button, kept between the offset controls and the jump field.
  toggle: ReactNode;
  onSeek: (offsetSeconds: number, correctionSeconds?: number) => void;
  onCorrect: (seconds: number) => void;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const jump = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState(() => {
    const match = matchMoment(vod, moment);
    return formatTime(Math.min(match.offsetSeconds, Math.max(0, vod.durationSeconds - 1)));
  });
  const [offset, setOffset] = useState(vod.correctionSeconds);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const [offsetText, setOffsetText] = useState(signed(vod.correctionSeconds));
  const [error, setError] = useState('');
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: number } | null>(null);
  const correct = useRef(onCorrect);
  correct.current = onCorrect;
  function flush() {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    const { value } = pending.current;
    pending.current = null;
    correct.current(value);
  }
  useEffect(() => {
    jump.current?.focus({ preventScroll: true });
    jump.current?.select();
    // A header too narrow for everything scrolls; start at the jump field.
    if (root.current) root.current.scrollLeft = root.current.scrollWidth;
    // Closing timing applies a nudge that hasn't settled yet.
    return () => flush();
  }, []);
  function apply(next: number, now = false) {
    if (!Number.isFinite(next) || Math.abs(next) > LIMIT) {
      setError('Enter an offset within 24 hours.');
      return;
    }
    const value = Math.round(next * 10) / 10;
    setError('');
    offsetRef.current = value;
    setOffset(value);
    setOffsetText(signed(value));
    if (pending.current) clearTimeout(pending.current.timer);
    if (value === vod.correctionSeconds && !pending.current) return;
    pending.current = { value, timer: setTimeout(flush, now ? 0 : 700) };
  }
  const step = (direction: 1 | -1, large: boolean) =>
    apply(offsetRef.current + direction * (large ? 1 : 0.1));
  const driftText = error
    ? error
    : source
      ? 'Source clock'
      : drift === null
        ? 'Waiting for a verified clock'
        : `${formatDelta(drift)} vs ${sourceName}`;
  return (
    <div
      ref={root}
      className="timing"
      role="group"
      aria-label={`${vod.channel} timing`}
      onKeyDown={(event) => {
        if (event.key === '[' || event.key === ']') {
          event.preventDefault();
          step(event.key === ']' ? 1 : -1, event.shiftKey);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <div className="timing-adjust">
        {/* Narrow headers drop the source name, then the readout unless it holds an error. */}
        <span
          className={`timing-drift ${error ? 'has-error' : drift !== null && Math.abs(drift) > DRIFT_LIMIT ? 'drifted' : drift !== null ? 'aligned' : ''}`}
          title={driftText}
        >
          {error ? (
            <span className="signal" role="alert">
              {error}
            </span>
          ) : source ? (
            'Source clock'
          ) : drift === null ? (
            'Not verified'
          ) : (
            <>
              <span className="mono">{formatDelta(drift)}</span>
              <span className="timing-vs"> vs {sourceName}</span>
            </>
          )}
        </span>
        <div className="timing-group" role="group" aria-labelledby={`offset-${vod.id}`}>
          <span
            id={`offset-${vod.id}`}
            className="timing-label"
            title="Positive starts this recording later. Shift steps 1 s; [ and ] nudge."
          >
            Offset
          </span>
          <button
            className="step-btn"
            aria-label="Offset minus 0.1 seconds"
            title="−0.1 s (Shift: −1 s)"
            onClick={(event) => step(-1, event.shiftKey)}
          >
            <Minus size={13} />
          </button>
          <input
            className="field mono center offset-field"
            aria-label="Offset in seconds"
            value={offsetText}
            inputMode="decimal"
            onChange={(event) => setOffsetText(event.target.value)}
            onBlur={() => apply(parseOffset(offsetText), true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply(parseOffset(offsetText), true);
              }
            }}
          />
          <button
            className="step-btn"
            aria-label="Offset plus 0.1 seconds"
            title="+0.1 s (Shift: +1 s)"
            onClick={(event) => step(1, event.shiftKey)}
          >
            <Plus size={13} />
          </button>
          <button
            className="icon-btn timing-reset"
            aria-label="Reset offset to 0"
            title="Reset to 0"
            disabled={offset === 0}
            onClick={() => apply(0, true)}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      {toggle}
      <form
        className="timing-group timing-jump"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const seconds = parseTime(time);
            if (seconds >= vod.durationSeconds)
              throw new Error(`${vod.channel}’s VOD is ${formatTime(vod.durationSeconds)} long.`);
            // The flushed offset reaches state after this handler; seek with it directly.
            const corrected = pending.current?.value;
            flush();
            onSeek(seconds, corrected);
            onDone();
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : 'Check the timestamp.');
          }
        }}
      >
        <label className="sr-only" htmlFor={`jump-${vod.id}`}>
          Jump to
        </label>
        <input
          ref={jump}
          id={`jump-${vod.id}`}
          className="field mono"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          placeholder="1:02:10"
          title="Jump everyone to this time in the VOD"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="icon-btn accent"
          type="submit"
          aria-label="Seek everyone to this timestamp"
          title="Seek everyone"
        >
          <ArrowRight size={15} />
        </button>
      </form>
    </div>
  );
}
