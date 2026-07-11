import { drawResultCard } from './resultCard';

// Minimal recording 2D-context mock (jsdom has no canvas).
function mockCanvas() {
  const calls = { fillText: [], setTransform: [] };
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 12 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop === 'fillText') return (...a) => calls.fillText.push(a);
      if (prop === 'setTransform') return (...a) => calls.setTransform.push(a);
      // every other ctx method is a no-op; property sets are swallowed
      return () => {};
    },
    set() { return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { canvas, calls };
}

beforeAll(() => {
  // loadImage resolves via onload; give it dimensions for the cover math.
  global.Image = class {
    set src(_v) { this.width = 300; this.height = 300; setTimeout(() => this.onload && this.onload(), 0); }
  };
});

const base = {
  score: 640, maxScore: 1000, correctGuesses: 8, totalTracks: 10, percentage: 80,
  playlistName: 'Today’s Top Hits', playlistImage: 'https://i.scdn.co/image/x',
  diffColor: '#CCFF00', difficultyLabel: 'Normal', gameMode: 'classic', guessMode: 'song',
  isDaily: false, emojiGrid: '🟩🟨🟥', greenCount: 1, yellowCount: 1, redCount: 1,
  username: 'sonix', displayName: '', date: 'Jul 11, 2026',
};

test('renders without throwing and sizes the canvas', async () => {
  const { canvas, calls } = mockCanvas();
  await drawResultCard(canvas, base);
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);
  // the score is drawn
  expect(calls.fillText.some((a) => String(a[0]) === '640')).toBe(true);
  expect(calls.fillText.some((a) => String(a[0]).includes('out of 1000'))).toBe(true);
});

test('handles no playlist image (fallback tile)', async () => {
  const { canvas } = mockCanvas();
  await drawResultCard(canvas, { ...base, playlistImage: '' });
  expect(canvas.height).toBeGreaterThan(0);
});

test('handles a long emoji grid (wraps) and long playlist name (truncates)', async () => {
  const { canvas } = mockCanvas();
  await drawResultCard(canvas, {
    ...base,
    emojiGrid: '🟩'.repeat(50),
    playlistName: 'A ridiculously long playlist name that must be truncated to fit the footer width',
  });
  expect(canvas.height).toBeGreaterThan(0);
});

test('artist + daily badges path', async () => {
  const { canvas } = mockCanvas();
  await drawResultCard(canvas, { ...base, guessMode: 'artist', isDaily: true, gameMode: 'ticking_away' });
  expect(canvas.height).toBeGreaterThan(0);
});

test('guest (no username line) and empty emoji grid', async () => {
  const { canvas } = mockCanvas();
  await drawResultCard(canvas, { ...base, username: 'Guest', emojiGrid: '' });
  expect(canvas.height).toBeGreaterThan(0);
});
