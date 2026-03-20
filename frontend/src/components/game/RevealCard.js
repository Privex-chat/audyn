import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const RevealCard = ({ track, revealResult, isLastTrack, onNext }) => (
  <div className="mb-8 animate-fade-in">
    <div
      className="p-6 text-center space-y-4 rounded-sm"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
    >
      {track.album_image && (
        <img
          data-testid="album-art"
          src={track.album_image}
          alt={track.album_name || track.name}
          className="w-28 h-28 mx-auto animate-flip-in object-cover rounded-sm"
          style={{ border: '1px solid var(--color-border-subtle)' }}
        />
      )}
      <div>
        <p
          data-testid="revealed-track-name"
          className="font-heading text-lg font-bold"
          style={{ color: 'var(--color-text)' }}
        >
          {track.name}
        </p>
        <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {track.artist}
        </p>
      </div>
      {revealResult?.correct ? (
        <div>
          <p
            data-testid="points-earned"
            className="font-mono font-bold text-xl neon-glow"
            style={{ color: 'var(--color-neon)' }}
          >
            +{revealResult.finalScore}
          </p>
          {revealResult.timePenalty > 0 && (
            <p className="font-mono text-[10px] mt-1" style={{ color: 'var(--color-text-dim)' }}>
              {revealResult.basePoints} base - {revealResult.timePenalty} time penalty
            </p>
          )}
        </div>
      ) : (
        <p
          data-testid="points-earned"
          className="font-mono text-xs uppercase tracking-wider"
          style={{ color: 'var(--color-text-dim)' }}
        >
          Better luck next time
        </p>
      )}
      <button
        data-testid="next-song-btn"
        onClick={onNext}
        className="w-full h-12 mt-2 font-bold uppercase tracking-wider rounded-sm btn-tactile transition-all flex items-center justify-center gap-1"
        style={{
          backgroundColor: 'var(--color-neon)',
          color: 'var(--color-bg)',
        }}
      >
        {isLastTrack ? 'SEE RESULTS' : 'NEXT SONG'}
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  </div>
);
