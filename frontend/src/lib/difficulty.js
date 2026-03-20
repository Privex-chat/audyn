export const DIFFICULTY_MODES = {
  easy: {
    key: 'easy',
    label: 'Easy',
    description: 'Longer clips, more time to think',
    color: '#22C55E',
    clipDurations: [2, 5, 10, 15, 20],
    clipPoints: [60, 45, 30, 20, 10],
    timeDecayRate: 1.0,      // points lost per second of thinking
    minScorePercent: 0.6,    // score can't drop below 50% of base from time alone
  },
  normal: {
    key: 'normal',
    label: 'Normal',
    description: 'The classic experience',
    color: '#EAB308',
    clipDurations: [0.5, 1.2, 2, 9, 15],
    clipPoints: [100, 80, 60, 30, 15],
    timeDecayRate: 2.0,
    minScorePercent: 0.4,    // score can't drop below 40% of base
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    description: 'Blink and you miss it',
    color: '#EF4444',
    clipDurations: [0.3, 0.6, 1, 1.5, 3],
    clipPoints: [170, 130, 100, 60, 25],
    timeDecayRate: 3.5,
    minScorePercent: 0.25,    // score can't drop below 30% of base
  },
};

export const DEFAULT_DIFFICULTY = 'normal';

export const GUESS_MODES = {
  song: {
    key: 'song',
    label: 'Song Title',
    description: 'Name the track',
    icon: '🎵',
  },
  artist: {
    key: 'artist',
    label: 'Artist',
    description: 'Name the artist',
    icon: '🎤',
  },
};

export const DEFAULT_GUESS_MODE = 'song';

export const GAME_MODES = {
  classic: {
    key: 'classic',
    label: 'Classic',
    description: 'Score by clip stage only. No time pressure.',
    icon: '🎵',
  },
  ticking_away: {
    key: 'ticking_away',
    label: 'Ticking Away',
    description: 'Score decays the longer you take. Every second counts.',
    icon: '⏱️',
  },
};
export const DEFAULT_GAME_MODE = 'classic';

export function calculateTimePressureScore(basePoints, elapsedSeconds, difficulty) {
  if (basePoints <= 0) return { finalScore: 0, basePoints: 0, timePenalty: 0 };

  const minScore = Math.floor(basePoints * difficulty.minScorePercent);
  const maxPenalty = basePoints - minScore;
  const rawPenalty = Math.floor(elapsedSeconds * difficulty.timeDecayRate);
  const timePenalty = Math.min(rawPenalty, maxPenalty);
  const finalScore = basePoints - timePenalty;

  return { finalScore, basePoints, timePenalty };
}
