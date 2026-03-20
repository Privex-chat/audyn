import { ArrowLeft } from 'lucide-react';

export const GameHeader = ({ score, currentIndex, totalTracks, scoreBump, onBack }) => (
  <div className="flex items-center justify-between mb-8">
    <button
      data-testid="back-btn"
      onClick={onBack}
      className="transition-colors p-1 btn-tactile"
      style={{ color: 'var(--color-text-muted)' }}
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
    <div className="font-mono text-sm flex items-center gap-2">
      <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Score</span>
      <span
        data-testid="game-score"
        className={`text-lg font-bold ${scoreBump ? 'score-bump' : ''}`}
        style={{ color: 'var(--color-neon)' }}
      >
        {score}
      </span>
    </div>
    <div
      data-testid="game-progress"
      className="font-mono text-xs uppercase tracking-wider"
      style={{ color: 'var(--color-text-muted)' }}
    >
      <span style={{ color: 'var(--color-text)' }}>{currentIndex + 1}</span>/{totalTracks}
    </div>
  </div>
);
