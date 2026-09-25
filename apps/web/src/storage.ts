export function readStorage(key: string, session = false): string | null {
  try {
    return (session ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}
export function writeStorage(key: string, value: string | null, session = false): void {
  try {
    const store = session ? sessionStorage : localStorage;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* In-memory use remains available with storage disabled. */
  }
}
