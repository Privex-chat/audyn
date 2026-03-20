import { useEffect } from 'react';

export function useKeyboardShortcuts({ onPlay, onSubmit, onClear, onSkip, enabled }) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea';

      if (e.key === ' ' && !isInput) {

        e.preventDefault();
        onPlay?.();
      } else if (e.key === 'Escape') {

        e.preventDefault();
        if (isInput) e.target.blur();
        onClear?.();
      } else if (e.key === 'Enter' && isInput) {

        e.preventDefault();
        onSubmit?.();
      } else if (e.key === 's' && !isInput) {

        e.preventDefault();
        onSkip?.();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onPlay, onSubmit, onClear, onSkip]);
}
