import { validateSession, vodKey, type Session } from '@vodsync/core';
import { readStorage, writeStorage } from './storage';

const KEY = 'vodsync.recent.v1';
const LIMIT = 6;
export type RecentSession = { savedAt: number; session: Session };

const keys = (session: Session) => new Set(session.vods.map(vodKey));

// Local history is untrusted like any other saved session: revalidate every entry.
export function readRecent(raw = readStorage(KEY)): RecentSession[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const recent: RecentSession[] = [];
    for (const item of value.slice(0, LIMIT)) {
      try {
        const savedAt = Number(item?.savedAt);
        if (!Number.isFinite(savedAt)) continue;
        recent.push({ savedAt, session: validateSession(item.session) });
      } catch {
        /* Drop entries that no longer validate. */
      }
    }
    return recent;
  } catch {
    return [];
  }
}

// Larger or smaller states of the same session replace each other instead of piling up.
export function rememberSession(
  recent: RecentSession[],
  session: Session,
  now = Date.now(),
): RecentSession[] {
  const current = keys(session);
  const rest = recent.filter(({ session: other }) => {
    const previous = keys(other);
    const subset = [...previous].every((key) => current.has(key));
    const superset = [...current].every((key) => previous.has(key));
    return !subset && !superset;
  });
  return [{ savedAt: now, session }, ...rest].slice(0, LIMIT);
}

export function writeRecent(recent: RecentSession[]) {
  writeStorage(KEY, recent.length ? JSON.stringify(recent) : null);
}
