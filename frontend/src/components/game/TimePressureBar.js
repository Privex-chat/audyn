import { useState, useEffect, useRef } from 'react';

export const TimePressureBar = ({ active, basePoints, difficulty, onElapsedUpdate }) => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (active) {
      startRef.current = Date.now();
      const tick = () => {
        const now = Date.now();
        const sec = (now - startRef.current) / 1000;
        setElapsed(sec);
        if (onElapsedUpdate) onElapsedUpdate(sec);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setElapsed(0);
      startRef.current = null;
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, onElapsedUpdate]);

  if (!active || basePoints <= 0) return null;

  const minScore = Math.floor(basePoints * difficulty.minScorePercent);
  const maxPenalty = basePoints - minScore;
  const currentPenalty = Math.min(Math.floor(elapsed * difficulty.timeDecayRate), maxPenalty);
  const currentScore = basePoints - currentPenalty;
  const decayPercent = maxPenalty > 0 ? (currentPenalty / maxPenalty) * 100 : 0;

  let barColor;
  if (decayPercent < 50) {
    barColor = '#CCFF00';
  } else if (decayPercent < 80) {
    barColor = '#EAB308';
  } else {
    barColor = '#EF4444';
  }

  return (
    <div className="w-full space-y-1">
      <div className="flex justify-between items-center">
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
          Time pressure
        </span>
        <span
          className="font-mono text-xs tabular-nums font-bold"
          style={{ color: barColor }}
        >
          {currentScore}pts
        </span>
      </div>
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface)' }}>
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{
            width: `${Math.min(decayPercent, 100)}%`,
            backgroundColor: barColor,
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
};
