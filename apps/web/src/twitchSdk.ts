// The official Twitch embed SDK, shared by recording and live players.
export type TwitchEmbed = {
  play(): void;
  pause(): void;
  seek(time: number): void;
  setMuted(muted: boolean): void;
  getCurrentTime(): number;
  isPaused(): boolean;
  getDuration(): number;
  getVideo(): string;
  getChannel(): string;
  getEnded(): boolean;
  getPlaybackStats(): { bufferSize?: number; hlsLatencyBroadcaster?: number } | null;
  addEventListener(event: string, callback: (event?: unknown) => void): void;
  removeEventListener(event: string, callback: (event?: unknown) => void): void;
};
export type TwitchConstructor = {
  new (element: HTMLElement, options: object): TwitchEmbed;
  READY: string;
  PLAYBACK_BLOCKED: string;
  PLAYING: string;
  PLAY: string;
  PAUSE: string;
  SEEK: string;
  ENDED: string;
  ONLINE: string;
  OFFLINE: string;
};
declare global {
  interface Window {
    Twitch?: { Player: TwitchConstructor };
  }
}
let sdk: Promise<TwitchConstructor> | undefined;
export function loadTwitchSdk() {
  if (window.Twitch) return Promise.resolve(window.Twitch.Player);
  if (!sdk)
    sdk = new Promise<TwitchConstructor>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://player.twitch.tv/js/embed/v1.js';
      const timeout = window.setTimeout(() => {
        script.remove();
        sdk = undefined;
        reject(new Error('Twitch player timed out. Retry or open it on Twitch.'));
      }, 15000);
      script.onload = () => {
        clearTimeout(timeout);
        if (window.Twitch) resolve(window.Twitch.Player);
        else {
          sdk = undefined;
          reject(new Error('Twitch player is unavailable.'));
        }
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        sdk = undefined;
        reject(
          new Error('Twitch player was blocked. Check browser settings or open it on Twitch.'),
        );
      };
      document.head.appendChild(script);
    });
  return sdk;
}
