import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import {
  formatTime,
  matchDescription,
  matchMoment,
  startMs,
  timelineBounds,
  vodKey,
  type Vod,
} from '@vodsync/core';

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);
export function Timeline({
  vods,
  moment,
  playing,
  onSeek,
  onPlayback,
}: {
  vods: Vod[];
  moment: number;
  playing: boolean;
  onSeek: (moment: number) => void;
  onPlayback: () => void;
}) {
  const { min, max } = timelineBounds(vods);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? moment;
  const duration = (max - min) / 1000;
  function commit() {
    if (draft !== null) {
      onSeek(draft);
      setDraft(null);
    }
  }
  return (
    <section className="timeline" aria-label="Shared broadcast timeline">
      <div className="timeline-toolbar">
        <button
          className="icon-button"
          aria-label={playing ? 'Pause all players' : 'Play matching players'}
          title={playing ? 'Pause all players' : 'Play matching players'}
          onClick={onPlayback}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <time>
          {new Date(shown).toISOString().slice(0, 10)} <strong>{clock(shown)}</strong> UTC
        </time>
        <span>Drag to seek all recordings</span>
      </div>
      <div className="timeline-ruler">
        <span>{clock(min)}</span>
        <span>{clock((min + max) / 2)}</span>
        <span>{clock(max)}</span>
      </div>
      <div className="timeline-lanes">
        {vods.map((vod) => {
          const match = matchMoment(vod, shown);
          return (
            <div className="timeline-row" key={vodKey(vod)}>
              <span title={vod.channel}>{vod.channel}</span>
              <div className="timeline-track">
                <div
                  className={`timeline-range ${match.state === 'playing' ? 'active' : ''}`}
                  title={`${vod.channel}: ${clock(startMs(vod))}–${clock(startMs(vod) + vod.durationSeconds * 1000)}`}
                  style={{
                    left: `${((startMs(vod) - min) / (max - min)) * 100}%`,
                    width: `${(vod.durationSeconds / duration) * 100}%`,
                  }}
                />
                <i style={{ left: `${((shown - min) / (max - min)) * 100}%` }} />
              </div>
              <time title={matchDescription(match)}>{formatTime(match.offsetSeconds)}</time>
            </div>
          );
        })}
        <input
          className="timeline-seeker"
          type="range"
          aria-label="Seek all recordings"
          min={0}
          max={duration}
          step="1"
          value={(shown - min) / 1000}
          aria-valuetext={`${clock(shown)} UTC`}
          onChange={(e) => setDraft(min + Number(e.target.value) * 1000)}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </section>
  );
}
