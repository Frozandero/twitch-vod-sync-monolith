import type { ReactNode } from 'react';
import type { Platform } from '@vodsync/core';

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
