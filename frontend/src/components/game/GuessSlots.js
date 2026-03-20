export const GuessSlots = ({ clipDurations, clipPoints, stageHistory, clipStage, phase, isPlaying, shaking }) => (
  <div className="space-y-1.5 mb-8">
    {clipDurations.map((duration, idx) => {
      let status = 'idle';
      let text = '';

      if (idx < stageHistory.length) {
        status = stageHistory[idx].type;
        text = stageHistory[idx].text;
      } else if (idx === clipStage && phase === 'playing') {
        status = 'active';
      } else if (idx === clipStage && phase === 'loading') {
        status = 'loading';
      }

      const slotStyles = {
        active: { border: '1px solid var(--color-neon)40', backgroundColor: 'var(--color-neon-subtle)' },
        loading: { border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' },
        idle: { border: '1px solid var(--color-border-subtle)', backgroundColor: 'transparent' },
        skip: { border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' },
        wrong: { border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'rgba(127,29,29,0.1)' },
        correct: { border: '1px solid var(--color-neon)30', backgroundColor: 'var(--color-neon-subtle)' },
      };

      const durationColor = {
        active: 'var(--color-neon)',
        correct: 'var(--color-neon)',
        wrong: 'var(--color-error)',
      };

      const textColor = {
        active: 'var(--color-text-muted)',
        correct: 'var(--color-neon)',
        wrong: 'var(--color-error)',
        skip: 'var(--color-text-dim)',
      };

      return (
        <div
          key={idx}
          data-testid={`guess-slot-${idx}`}
          className={`
            slot-enter flex items-center gap-3 px-4 py-2.5 font-mono text-sm
            transition-colors duration-200
            ${shaking && idx === clipStage ? 'animate-shake' : ''}
          `}
          style={{ ...slotStyles[status], animationDelay: `${idx * 60}ms` }}
        >
          <span
            className="w-10 text-xs tabular-nums"
            style={{ color: durationColor[status] || 'var(--color-text-dim)' }}
          >
            {duration >= 1 ? `${duration}s` : `${(duration * 1000).toFixed(0)}ms`}
          </span>
          <span
            className="flex-1 truncate text-xs"
            style={{ color: textColor[status] || 'var(--color-text-dim)' }}
          >
            {text || (status === 'active' ? (isPlaying ? 'LISTENING...' : 'READY') : '')}
            {status === 'loading' && 'LOADING...'}
          </span>
          {status === 'active' && isPlaying && (
            <span className="flex gap-[2px] items-end h-3">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="w-[2px] rounded-full"
                  style={{
                    backgroundColor: 'var(--color-neon)',
                    animation: `sound-bar 0.5s ease-in-out infinite alternate`,
                    animationDelay: `${i * 0.15}s`,
                    height: '4px',
                  }}
                />
              ))}
            </span>
          )}
          {status === 'correct' && (
            <span className="text-xs" style={{ color: 'var(--color-neon)' }}>+{clipPoints[idx]}</span>
          )}
        </div>
      );
    })}
  </div>
);
