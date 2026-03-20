import { Play, Pause, Loader2 } from 'lucide-react';

export const AudioPlayer = ({ phase, isLoaded, isPlaying, onTogglePlay }) => (
  <button
    data-testid="play-pause-btn"
    onClick={onTogglePlay}
    disabled={phase === 'loading'}
    className="play-ring w-20 h-20 rounded-full flex items-center justify-center
      active:scale-95 transition-colors duration-200
      disabled:opacity-30 disabled:cursor-not-allowed"
    style={{
      border: '2px solid var(--color-border)',
      backgroundColor: 'var(--color-surface)',
    }}
  >
    {phase === 'loading' || !isLoaded ? (
      <Loader2 className="h-7 w-7 animate-spin" style={{ color: 'var(--color-neon)' }} />
    ) : isPlaying ? (
      <Pause className="h-7 w-7" style={{ color: 'var(--color-neon)' }} />
    ) : (
      <Play className="h-7 w-7 ml-0.5" style={{ color: 'var(--color-neon)' }} />
    )}
  </button>
);
