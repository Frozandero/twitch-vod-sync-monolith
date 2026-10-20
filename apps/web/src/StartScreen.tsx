import type { FormEvent, RefObject } from 'react';
import { LoaderCircle, Plus, Undo2, X } from 'lucide-react';
import {
  formatTime,
  parseChannelTarget,
  parseMedia,
  type LiveSession,
  type Platform,
  type Session,
} from '@vodsync/core';
import type { LiveInputResult } from './liveInputs';
import type { InputResult } from './recordingInputs';
import type { RecentSession } from './recentSessions';
import { dayLabel, shortClock } from './timeFormat';
import { Kbd, PlatformMark } from './ui';

export const splitInputs = (text: string) => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

type Preview = {
  input: string;
  platform?: Platform;
  name: string;
  kind: string;
  hint: string;
  tone?: string;
};

// Recognise pasted lines locally; nothing is fetched until the user adds them.
export function previewInputs(inputs: string[]): Preview[] {
  const hasMedia = inputs.some((input) => !parseChannelTarget(input) && isMedia(input));
  let momentSet = false;
  return inputs.map((input) => {
    const target = parseChannelTarget(input);
    if (target)
      return {
        input,
        platform: target.platform,
        name: target.channel,
        kind: hasMedia ? 'streamer' : 'live',
        hint: hasMedia ? 'Finds the VOD covering that moment' : 'Opens the live stream',
      };
    try {
      const ref = parseMedia(input);
      const sets = !momentSet;
      momentSet = true;
      if (ref.kind === 'clip')
        return {
          input,
          platform: ref.platform,
          name: ref.id,
          kind: 'clip',
          hint: sets ? 'Sets the moment to the clip start' : 'Opens its parent VOD at the clip',
        };
      return {
        input,
        platform: ref.platform,
        name: ref.platform === 'twitch' ? `video ${ref.id}` : 'video',
        kind: 'VOD',
        hint: `${ref.offsetSeconds ? `At ${formatTime(ref.offsetSeconds)}` : 'From the start'}${sets ? ' · sets the moment' : ''}`,
      };
    } catch (error) {
      return {
        input,
        name: input,
        kind: '',
        hint: error instanceof Error ? error.message : 'Not a Twitch or Kick link',
        tone: 'signal',
      };
    }
  });
}
function isMedia(input: string) {
  try {
    parseMedia(input);
    return true;
  } catch {
    return false;
  }
}

const label = (session: Session | LiveSession) => {
  const names =
    'kind' in session
      ? session.channels.map((channel) => channel.name)
      : session.vods.map((vod) => vod.channel);
  return names.length > 4
    ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
    : names.join(', ');
};

export function StartScreen({
  field,
  input,
  onInput,
  onSubmit,
  busy,
  pending,
  results,
  notice,
  recent,
  onOpen,
  onForget,
  closed,
  onUndo,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  input: string;
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  busy: boolean;
  pending: string[];
  results: (InputResult | LiveInputResult)[];
  notice: string;
  recent: RecentSession[];
  onOpen: (session: Session | LiveSession) => void;
  onForget: (savedAt: number) => void;
  // The channel of a recording that was just closed, so it can be restored.
  closed?: string;
  onUndo: () => void;
}) {
  const lines = busy ? pending : splitInputs(input);
  const failed = new Map(
    results.flatMap((r) => (r.status === 'failed' ? [[r.input, r.error] as const] : [])),
  );
  const preview = previewInputs(lines).slice(0, 12);
  return (
    <div className="start">
      {closed && (
        <div className="start-undo" role="status">
          <span>Closed {closed}</span>
          <button type="button" className="ghost-btn" onClick={onUndo} disabled={busy}>
            <Undo2 size={15} aria-hidden="true" />
            Undo
            <Kbd>⌘Z</Kbd>
          </button>
        </div>
      )}
      <h1>Watch streams side by side</h1>
      <p className="start-lede">
        Paste Twitch or Kick VODs, clips and timestamped links to play them on one clock. Paste{' '}
        <code>twitch/name</code> or <code>kick/name</code> on its own to watch live channels; next
        to a VOD or clip it finds that streamer’s VOD at the same moment.
      </p>
      <form className="start-form" onSubmit={onSubmit} aria-label="Add recordings or channels">
        <label htmlFor="start-input" className="sr-only">
          Recordings or channels to add
        </label>
        <textarea
          ref={field}
          id="start-input"
          className="mono"
          rows={3}
          spellCheck={false}
          value={input}
          disabled={busy}
          placeholder={'https://www.twitch.tv/videos/…\nhttps://clips.twitch.tv/…\nkick/name'}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          autoFocus
        />
        <div className="start-form-foot">
          <span>
            <Kbd>Shift</Kbd>
            <Kbd>⏎</Kbd> new line
          </span>
          <button className="primary-btn" type="submit" disabled={busy || !lines.length}>
            {busy ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            {busy ? `Adding ${lines.length}` : lines.length > 1 ? `Add ${lines.length}` : 'Add'}
          </button>
        </div>
      </form>
      {notice && (
        <p className="start-notice" role="alert">
          {notice}
        </p>
      )}
      {!!preview.length && (
        <ul className="start-preview" aria-label="Recognised links">
          {preview.map((item) => {
            const error = failed.get(item.input);
            return (
              <li key={item.input}>
                <span className="preview-name">
                  {item.platform ? <PlatformMark platform={item.platform} /> : <i />}
                  <span className="mono">{item.name}</span>
                  {item.kind && <span className="preview-kind">{item.kind}</span>}
                </span>
                <span className={`preview-hint ${error ? 'signal' : (item.tone ?? '')}`}>
                  {busy && <LoaderCircle className="spin" size={12} aria-hidden="true" />}
                  {error ?? item.hint}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!!recent.length && (
        <section className="start-recent" aria-labelledby="recent-heading">
          <h2 id="recent-heading">Recent</h2>
          <ul>
            {recent.map(({ session, savedAt }) => (
              <li key={savedAt}>
                <button
                  type="button"
                  className="recent-open"
                  disabled={busy}
                  onClick={() => onOpen(session)}
                >
                  <span className="recent-name">{label(session)}</span>
                  {'kind' in session ? (
                    <span className="recent-time">Live</span>
                  ) : (
                    <>
                      <span className="mono recent-time">
                        {shortClock(session.momentMs, false)} UTC
                      </span>
                      <span className="recent-date">
                        {dayLabel(session.momentMs, false).slice(4, -5)}
                      </span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="icon-btn small subtle"
                  aria-label={`Forget ${label(session)}`}
                  title="Remove from recent"
                  disabled={busy}
                  onClick={() => onForget(savedAt)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
