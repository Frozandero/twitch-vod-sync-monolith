import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
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

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

// A floating panel anchored to a trigger. It lives in a portal so player tiles
// that clip their corners cannot cut it off, and it never moves media nodes.
export function Popover({
  anchor,
  open,
  onClose,
  children,
  className = '',
  label,
  role = 'dialog',
  align = 'end',
  autoFocus = true,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label: string;
  role?: 'dialog' | 'menu';
  align?: 'start' | 'end';
  autoFocus?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!open) {
      setPosition(undefined);
      return;
    }
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      const node = panel.current;
      if (!trigger || !node) return;
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const gap = 6;
      let left = align === 'end' ? trigger.right - width : trigger.left;
      left = Math.max(8, Math.min(left, innerWidth - width - 8));
      let top = trigger.bottom + gap;
      if (top + height > innerHeight - 8 && trigger.top - gap - height > 8)
        top = trigger.top - gap - height;
      setPosition({ top: Math.max(8, top), left });
    };
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => {
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
    };
  }, [open, anchor, align]);
  useEffect(() => {
    if (!open) return;
    const trigger = anchor.current;
    if (autoFocus) panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close.current();
      trigger?.focus({ preventScroll: true });
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger?.contains(target)) return;
      close.current();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', pointer, true);
      // Closing from inside the panel removes the focused control; return focus to the trigger.
      const active = document.activeElement;
      if (!active || active === document.body) trigger?.focus({ preventScroll: true });
    };
  }, [open, anchor, autoFocus]);
  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      className={`popover ${className}`}
      role={role}
      aria-label={label}
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
      onBlur={(event) => {
        // Tabbing away closes it; clicks inside or on the trigger don't.
        const next = event.relatedTarget as Node | null;
        if (!next || panel.current?.contains(next) || anchor.current?.contains(next)) return;
        close.current();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export type MenuItem = {
  label: string;
  onSelect: () => void;
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  href?: string;
};

export function Menu({
  anchor,
  open,
  onClose,
  label,
  items,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  items: (MenuItem | 'separator')[];
}) {
  function move(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  return (
    <Popover
      anchor={anchor}
      open={open}
      onClose={onClose}
      label={label}
      role="menu"
      className="menu"
    >
      <div onKeyDown={move}>
        {items.map((item, i) =>
          item === 'separator' ? (
            <div className="menu-separator" key={i} role="separator" />
          ) : item.href ? (
            <a
              key={item.label}
              role="menuitem"
              className="menu-item"
              href={item.href}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
            >
              <span>{item.label}</span>
            </a>
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`menu-item ${item.danger ? 'danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                // Focus the trigger first so dialogs opened by the item restore to it.
                anchor.current?.focus();
                onClose();
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.kbd && <Kbd>{item.kbd}</Kbd>}
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}

// Global shortcuts must not steal keys that the focused control already uses.
export function claimsKey(target: EventTarget | null, key: string) {
  const node = target instanceof Element ? target : null;
  if (!node || node === document.body) return false;
  if (
    node.closest(
      'input:not([type="range"]), textarea, select, [contenteditable="true"], .popover, dialog, [aria-modal="true"]',
    )
  )
    return true;
  if ((key === ' ' || key === 'Enter') && node.closest('button, a[href], summary, input'))
    return true;
  // A focused native player (Kick) uses Space and arrows for its own controls.
  if ((key === ' ' || /^Arrow/.test(key)) && node.closest('video, audio')) return true;
  if (/^(Arrow|Home|End)/.test(key) && node.closest('input, .reorder-handle, .segmented'))
    return true;
  return false;
}
