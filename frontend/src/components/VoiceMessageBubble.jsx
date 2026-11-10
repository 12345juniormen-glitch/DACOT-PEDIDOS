import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const BAR_HEIGHTS = [8, 14, 20, 11, 23, 16, 9, 19, 26, 14, 22, 11, 18, 25, 13, 20, 10, 17, 24, 15, 9, 21, 16, 8];

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VoiceMessageBubble({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playError, setPlayError] = useState(false);
  const progress = duration > 0 ? position / duration : 0;

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setPlayError(false);
    try {
      await audio.play();
    } catch (_) {
      setPlaying(false);
      setPlayError(true);
    }
  };

  const seek = (event) => {
    const next = Number(event.target.value);
    if (!audioRef.current || !Number.isFinite(next)) return;
    audioRef.current.currentTime = next;
    setPosition(next);
  };

  return <div className="w-full min-w-[210px] max-w-[360px]">
    <audio
      ref={audioRef}
      src={src}
      preload="metadata"
      className="hidden"
      onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      onDurationChange={(event) => setDuration(event.currentTarget.duration)}
      onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={(event) => { event.currentTarget.currentTime = 0; setPlaying(false); setPosition(0); }}
      onError={() => { setPlaying(false); setPlayError(true); }}
    />
    <div className="flex items-center gap-3 py-1">
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="relative flex h-10 min-w-0 flex-1 items-center focus-within:ring-2 focus-within:ring-primary">
        <div className="pointer-events-none flex w-full items-center justify-between gap-[2px]" aria-hidden="true">
          {BAR_HEIGHTS.map((height, index) => <span
            key={index}
            className={`w-[2px] min-w-[2px] ${index / BAR_HEIGHTS.length < progress ? "bg-primary" : "bg-muted-foreground/60"}`}
            style={{ height }}
          />)}
        </div>
        <input
          type="range"
          min="0"
          max={duration > 0 && Number.isFinite(duration) ? duration : 0}
          step="0.1"
          value={position}
          onChange={seek}
          disabled={!duration || !Number.isFinite(duration)}
          aria-label="Posição do áudio"
          aria-valuetext={`${formatTime(position)} de ${formatTime(duration)}`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {formatTime(position)} / {formatTime(duration)}
      </span>
    </div>
    {playError && <p className="text-xs text-destructive">Não foi possível reproduzir este áudio.</p>}
  </div>;
}
