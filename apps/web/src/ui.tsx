import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Volume2, VolumeX } from 'lucide-react';
import type { Platform } from '@vodsync/core';

// How long a speaker button must be held to flip everyone else's sound.
export const HOLD_MS = 500;

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="19" height="15" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M11 23v1a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V15a3 3 0 0 0-3-3h-1"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m11 10 5 3-5 3v-6Z" fill="currentColor" />
    </svg>
  );
}

// Simplified monochrome platform marks; they identify, not decorate.
export function PlatformMark({ platform }: { platform: Platform }) {
  return platform === 'kick' ? (
    <svg className="platform-mark" viewBox="0 0 24 24" role="img" aria-label="Kick">
      <path fill="currentColor" d="M3 3h6v5h2V6h2V3h8v6h-3v2h-2v2h2v2h3v6h-8v-3h-2v-2H9v5H3z" />
    </svg>
  ) : (
    <svg className="platform-mark" viewBox="0 0 24 24" role="img" aria-label="Twitch">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5 2 3 6v14h5v3h3l3-3h4l4-4V2H5Zm15 13-3 3h-4l-3 3v-3H6V4h14v11ZM11 7h2v5h-2V7Zm4.5 0h2v5h-2V7Z"
      />
    </svg>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Global shortcuts must not steal keys that the focused control already uses.
export function claimsKey(target: EventTarget | null, key: string) {
  const node = target instanceof Element ? target : null;
  if (!node || node === document.body) return false;
  if (node.closest('input:not([type="range"]), textarea, select, [contenteditable="true"]'))
    return true;
  if ((key === ' ' || key === 'Enter') && node.closest('button, a[href], summary, input'))
    return true;
  // A focused native player (Kick) uses Space and arrows for its own controls.
  if ((key === ' ' || /^Arrow/.test(key)) && node.closest('video, audio')) return true;
  if (/^(Arrow|Home|End)/.test(key) && node.closest('input, .reorder-handle, .segmented'))
    return true;
  return false;
}

// Focused grips move a player: arrows step, Home/End jump. Other keys return null.
export function gripPosition(key: string, index: number, count: number): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return index - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return index + 1;
  return null;
}

// A player's speaker: press toggles its sound; holding it (pointer, Space or Enter) flips
// everyone: a muted player becomes the only one with sound, an audible one the only one without.
export function SoundButton({
  name,
  muted,
  disabled,
  onToggle,
  onHold,
}: {
  name: string;
  muted: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onHold: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Set when a hold fired, so the release that follows doesn't also toggle. The next
  // press clears it, since some browsers send no click after a long touch.
  const held = useRef(false);
  // A key released here must have been pressed here, not on a control that moved focus.
  const keyed = useRef(false);
  const hold = useRef(onHold);
  hold.current = onHold;
  const [pressing, setPressing] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) release();
  }, [disabled]);
  function press() {
    clearTimeout(timer.current);
    held.current = false;
    setPressing(true);
    timer.current = setTimeout(() => {
      held.current = true;
      setPressing(false);
      hold.current();
    }, HOLD_MS);
  }
  function release() {
    clearTimeout(timer.current);
    setPressing(false);
  }
  const activation = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Enter';
  return (
    <button
      className={`icon-btn sound-btn ${muted ? 'subtle' : 'on'} ${pressing ? 'is-holding' : ''}`}
      disabled={disabled}
      aria-label={`${muted ? 'Unmute' : 'Mute'} ${name}`}
      title={
        muted
          ? `Unmute · hold to hear only ${name}`
          : `Mute · hold to mute ${name} and unmute the rest`
      }
      onPointerDown={(event) => {
        if (event.button === 0) press();
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onBlur={() => {
        keyed.current = false;
        release();
      }}
      // A long touch would otherwise open the browser's menu.
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (held.current) held.current = false;
        else onToggle();
      }}
      // Keys are handled here so a held Enter doesn't repeat clicks.
      onKeyDown={(event) => {
        if (!activation(event)) return;
        event.preventDefault();
        if (event.repeat) return;
        keyed.current = true;
        press();
      }}
      onKeyUp={(event) => {
        if (!activation(event) || !keyed.current) return;
        event.preventDefault();
        keyed.current = false;
        if (held.current) held.current = false;
        else {
          release();
          onToggle();
        }
      }}
    >
      {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
    </button>
  );
}

// The Move row inside a player's header drawer: a keyboard and touch alternative to dragging.
export function MoveControls({
  name,
  index,
  count,
  disabled,
  onMove,
}: {
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (index: number) => void;
}) {
  return (
    <div className="drawer-move">
      <label>
        Position
        <select
          className="field"
          value={index}
          disabled={disabled}
          onChange={(event) => onMove(Number(event.target.value))}
        >
          {Array.from({ length: count }, (_, position) => (
            <option key={position} value={position}>
              {position + 1} of {count}
            </option>
          ))}
        </select>
      </label>
      <button
        className="icon-btn"
        aria-label={`Move ${name} earlier`}
        title="Move earlier"
        disabled={disabled || index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ArrowLeft size={15} />
      </button>
      <button
        className="icon-btn"
        aria-label={`Move ${name} later`}
        title="Move later"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
