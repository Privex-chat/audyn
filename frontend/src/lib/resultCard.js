// Canvas renderer for the end-of-game result card.
//
// Single source of truth: the on-screen preview and the saved PNG are drawn
// from the SAME canvas, so they can't diverge. Replaces the DOM + CDN
// html2canvas path, which dropped neon text-shadows, clipped the overshot
// background image, rendered emoji inconsistently, produced transparent
// corners, and failed entirely offline / under ad-blockers.
//
// Uses generic font families (like the 1v1 room card) to avoid web-font load
// races — what you see is what downloads.

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // graceful: card still renders w/o art
    img.src = url.includes('?') ? url : `${url}?_cb=1`;
  });
}

function rrPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const W = 440;
const PAD = 24;
const DPR = 2;

// Draw the card into `canvas`, sizing it to fit the content. Resolves when the
// (optional) playlist image has loaded and everything is painted.
export async function drawResultCard(canvas, opts, isCancelled) {
  const {
    score = 0, maxScore = 0, correctGuesses = 0, totalTracks = 0, percentage = 0,
    playlistName = '', playlistImage = '',
    diffColor = '#CCFF00', difficultyLabel = '',
    gameMode = 'classic', guessMode = 'song', isDaily = false,
    emojiGrid = '', greenCount = 0, yellowCount = 0, redCount = 0,
    username = 'Guest', displayName = '', date = '',
  } = opts;

  const playlistImg = await loadImage(playlistImage);
  if (isCancelled && isCancelled()) return null; // deps changed / unmounted while the image loaded
  const usable = W - PAD * 2;
  const emojis = emojiGrid ? [...emojiGrid] : [];

  // ── pass 1: measure emoji-grid wrapping to compute card height ──
  const ctx = canvas.getContext('2d');
  canvas.width = W * DPR;
  canvas.height = 1200 * DPR; // temp
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.font = '18px sans-serif';
  const EMOJI_SP = 2;
  const lines = emojis.length ? [[]] : [];
  if (emojis.length) {
    let lineW = 0;
    for (const e of emojis) {
      const ew = ctx.measureText(e).width + EMOJI_SP;
      if (lineW + ew > usable && lineW > 0) { lines.push([e]); lineW = ew; }
      else { lines[lines.length - 1].push(e); lineW += ew; }
    }
  }

  // ── layout heights ──
  const yStart = 28;
  const headerH = 24;
  const scoreH = 118;         // 80px number + "out of" + gaps
  const pillsH = 56;
  const emojiH = emojis.length ? lines.length * 26 + 20 : 0;
  const footerH = 74;
  const H = yStart + headerH + scoreH + pillsH + emojiH + footerH + PAD;

  // ── final sizing + draw ──
  canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // card background
  rrPath(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = '#111118';
  ctx.fill();
  ctx.save();
  rrPath(ctx, 0, 0, W, H, 16);
  ctx.clip();

  // dimmed playlist-image background (overshoot so it fills the card)
  if (playlistImg) {
    const scale = Math.max(W / playlistImg.width, H / playlistImg.height) * 1.1;
    const pw = playlistImg.width * scale;
    const ph = playlistImg.height * scale;
    ctx.globalAlpha = 0.22;
    ctx.drawImage(playlistImg, (W - pw) / 2, (H - ph) / 2, pw, ph);
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, 'rgba(10,10,20,0.72)');
    g.addColorStop(1, 'rgba(10,10,20,0.88)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // top accent stripe
  const stripe = ctx.createLinearGradient(0, 0, W, 0);
  stripe.addColorStop(0, diffColor);
  stripe.addColorStop(0.5, diffColor + '60');
  stripe.addColorStop(1, 'transparent');
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, W, 3);

  let y = yStart;

  // ── header: badges (left) + date (right) ──
  const badges = [
    difficultyLabel || 'Normal',
    gameMode === 'ticking_away' ? '⏱ Ticking' : '🎵 Classic',
  ];
  if (guessMode === 'artist') badges.push('🎤 Artist');
  if (isDaily) badges.push('📅 Daily');

  ctx.textBaseline = 'middle';
  let bx = PAD;
  const by = y + 9;
  ctx.font = '10px monospace';
  for (const b of badges) {
    const label = b.toUpperCase();
    const tw = ctx.measureText(label).width;
    const bw = tw + 16;
    if (bx + bw > W - PAD - 70) break; // keep clear of the date
    rrPath(ctx, bx, by - 9, bw, 18, 4);
    ctx.fillStyle = diffColor + '20';
    ctx.fill();
    ctx.strokeStyle = diffColor + '55';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = diffColor;
    ctx.textAlign = 'left';
    ctx.fillText(label, bx + 8, by + 1);
    bx += bw + 6;
  }
  if (date) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    ctx.fillText(date, W - PAD, by + 1);
  }
  y += headerH;

  // ── score ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // neon glow via shadow (html2canvas dropped this — canvas keeps it)
  ctx.save();
  ctx.shadowColor = diffColor;
  ctx.shadowBlur = 24;
  ctx.fillStyle = diffColor;
  ctx.font = '800 80px sans-serif';
  ctx.fillText(String(score), W / 2, y + 74);
  ctx.restore();
  ctx.font = '12px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(`out of ${maxScore} points`, W / 2, y + 98);
  y += scoreH;

  // ── stat pills ──
  const pills = [
    { label: 'Correct', value: `${correctGuesses}/${totalTracks}`, hi: false },
    { label: 'Accuracy', value: `${percentage}%`, hi: percentage === 100 },
  ];
  const pillW = 96, pillH = 44, gap = 12;
  let px = W / 2 - (pillW * pills.length + gap * (pills.length - 1)) / 2;
  for (const p of pills) {
    rrPath(ctx, px, y, pillW, pillH, 10);
    ctx.fillStyle = p.hi ? 'rgba(0,255,136,0.12)' : 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = p.hi ? 'rgba(0,255,136,0.28)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = p.hi ? diffColor : 'rgba(255,255,255,0.85)';
    ctx.font = '700 16px monospace';
    ctx.fillText(p.value, px + pillW / 2, y + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px monospace';
    ctx.fillText(p.label.toUpperCase(), px + pillW / 2, y + 34);
    px += pillW + gap;
  }
  y += pillsH;

  // ── emoji grid + legend ──
  if (emojis.length) {
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'left';
    let ey = y + 18;
    for (const line of lines) {
      const w = line.reduce((a, e) => a + ctx.measureText(e).width + EMOJI_SP, 0) - EMOJI_SP;
      let ex = (W - w) / 2;
      for (const e of line) {
        ctx.fillText(e, ex, ey);
        ex += ctx.measureText(e).width + EMOJI_SP;
      }
      ey += 26;
    }
    // legend
    const legend = [];
    if (greenCount > 0) legend.push('🟩 1st Try');
    if (yellowCount > 0) legend.push('🟨 Nice Try');
    if (redCount > 0) legend.push('🟥 Try Again');
    if (legend.length) {
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'center';
      ctx.fillText(legend.join('    '), W / 2, ey + 2);
    }
    y += emojiH;
  }

  // ── footer ──
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  const fy = y + 30;
  let textX = PAD;
  if (playlistImg) {
    ctx.save();
    rrPath(ctx, PAD, fy - 20, 40, 40, 8);
    ctx.clip();
    ctx.drawImage(playlistImg, PAD, fy - 20, 40, 40);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    rrPath(ctx, PAD, fy - 20, 40, 40, 8);
    ctx.stroke();
    textX = PAD + 52;
  } else {
    rrPath(ctx, PAD, fy - 20, 40, 40, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🎵', PAD + 20, fy + 6);
    textX = PAD + 52;
  }
  ctx.textAlign = 'left';
  ctx.font = '500 12px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const maxNameW = W - PAD - textX - 70;
  let name = playlistName || '';
  while (name && ctx.measureText(name).width > maxNameW) name = name.slice(0, -1);
  if (name !== (playlistName || '')) name = name.slice(0, -1) + '…';
  ctx.fillText(name, textX, fy - 4);
  if (username && username !== 'Guest') {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(displayName || `@${username}`, textX, fy + 12);
  }
  // AUDYN wordmark
  ctx.textAlign = 'right';
  ctx.font = '800 10px sans-serif';
  ctx.fillStyle = diffColor;
  ctx.globalAlpha = 0.6;
  ctx.fillText('A U D Y N', W - PAD, fy - 2);
  ctx.globalAlpha = 1;

  ctx.restore(); // undo card clip
  return { width: W, height: H };
}
