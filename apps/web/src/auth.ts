import type { TwitchAuth } from '@vodsync/providers';
import { readStorage, writeStorage } from './storage';
const AUTH_KEY = 'vodsync.twitch.auth';
const STATE_KEY = 'vodsync.twitch.state';
export const configuredClientId = import.meta.env.VITE_TWITCH_CLIENT_ID || '';
export const redirectUri = () => `${location.origin}${location.pathname}`;
export function beginLogin(clientId: string) {
  if (!/^[a-zA-Z0-9]{10,100}$/.test(clientId))
    throw new Error('Enter a valid public Twitch application Client ID.');
  const state = crypto.randomUUID();
  writeStorage(STATE_KEY, JSON.stringify({ state, clientId, created: Date.now() }), true);
  if (!readStorage(STATE_KEY, true)) throw new Error('Enable session storage to connect Twitch.');
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: '',
    state,
  }).toString();
  location.assign(url.toString());
}
export function disconnect() {
  writeStorage(AUTH_KEY, null, true);
}
export async function validateAuth(auth: TwitchAuth): Promise<TwitchAuth> {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${auth.token}` },
    signal: AbortSignal.timeout(10000),
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('Twitch connection expired. Please connect again.');
  const data = await response.json();
  if (data.client_id !== auth.clientId || !(data.expires_in > 0))
    throw new Error('Twitch connection is invalid. Please connect again.');
  return auth;
}
export async function restoreAuth(): Promise<TwitchAuth | undefined> {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const token = fragment.get('access_token');
  if (token || fragment.has('error') || query.has('error')) {
    history.replaceState(null, '', location.pathname);
    const saved = readStorage(STATE_KEY, true);
    writeStorage(STATE_KEY, null, true);
    if (!token)
      throw new Error('Twitch connection was cancelled. Public lookup is still available.');
    const pending = saved ? JSON.parse(saved) : null;
    if (
      !pending ||
      pending.state !== fragment.get('state') ||
      Date.now() - pending.created > 600000
    )
      throw new Error('Twitch sign-in could not be verified. Please connect again.');
    const auth = await validateAuth({ clientId: pending.clientId, token });
    writeStorage(AUTH_KEY, JSON.stringify(auth), true);
    return auth;
  }
  const saved = readStorage(AUTH_KEY, true);
  if (!saved) return undefined;
  try {
    return await validateAuth(JSON.parse(saved));
  } catch (error) {
    disconnect();
    throw error;
  }
}
