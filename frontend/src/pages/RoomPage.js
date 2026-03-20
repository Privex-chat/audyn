import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Copy, Loader2, Share2, Download } from 'lucide-react';

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import GamePage from '@/pages/GamePage';

function getApiError(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (Array.isArray(e.loc) ? `${e.loc.slice(-1)[0]}: ${e.msg}` : e.msg)).join(', ');
  return fallback;
}

function resolvePlaylistId(playlistData) {
  if (!playlistData) return null;
  return playlistData.playlist_id || playlistData.id || playlistData.playlistId || null;
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);   // graceful fallback to initials

    img.src = url.includes('?') ? url : `${url}?_cb=1`;
  });
}

function drawAvatar(ctx, { cx, cy, r, img, name, winner, neon }) {
  ctx.save();

  if (winner) {
    const glow = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r + 10);
    glow.addColorStop(0, `${neon}55`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (img) {

    const side = r * 2;
    ctx.drawImage(img, cx - r, cy - r, side, side);

    const vig = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
    vig.addColorStop(0, 'transparent');
    vig.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vig;
    ctx.fillRect(cx - r, cy - r, side, side);
  } else {

    ctx.fillStyle = winner ? 'rgba(204,255,0,0.15)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    ctx.restore();
    ctx.save();
    ctx.fillStyle = winner ? neon : 'rgba(255,255,255,0.75)';
    ctx.font      = `bold ${Math.round(r * 0.9)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name || '?')[0].toUpperCase(), cx, cy + 1);
    ctx.restore();
    return;
  }

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = winner ? neon : 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = winner ? 2.5 : 1.5;
  ctx.stroke();
}

function rrPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

async function drawRoomScoreCard(canvas, opts) {
  const {
    myName, myScore, myCorrect, myAvatarUrl,
    oppName, oppScore, oppCorrect, oppAvatarUrl,
    playlistImageUrl,
    songCount, playlistName, difficulty, gameMode, date,
  } = opts;

  const [myImg, oppImg, playlistImg] = await Promise.all([
    loadImage(myAvatarUrl),
    loadImage(oppAvatarUrl),
    loadImage(playlistImageUrl),
  ]);

  const W = 420, H = 680;
  const DPR = 2;
  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  const neon   = '#CCFF00';
  const red    = '#FF4455';
  const myWon  = myScore > oppScore;
  const oppWon = oppScore > myScore;
  const tied   = myScore === oppScore;
  const winnerColor = myWon ? neon : oppWon ? red : 'rgba(255,255,255,0.6)';

  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, W, H);

  if (playlistImg) {
    ctx.save();
    ctx.globalAlpha = 0.12;

    const scale = Math.max(W / playlistImg.width, H / playlistImg.height);
    const pw = playlistImg.width * scale;
    const ph = playlistImg.height * scale;
    ctx.drawImage(playlistImg, (W - pw) / 2, (H - ph) / 2, pw, ph);
    ctx.restore();
  }

  const bgOverlay = ctx.createRadialGradient(W / 2, H * 0.45, 60, W / 2, H * 0.45, W * 0.9);
  bgOverlay.addColorStop(0, 'rgba(8,8,15,0.55)');
  bgOverlay.addColorStop(1, 'rgba(8,8,15,0.92)');
  ctx.fillStyle = bgOverlay;
  ctx.fillRect(0, 0, W, H);

  const sweep = ctx.createLinearGradient(0, 0, W * 0.7, H * 0.5);
  sweep.addColorStop(0, 'rgba(204,255,0,0.04)');
  sweep.addColorStop(0.5, 'rgba(204,255,0,0.01)');
  sweep.addColorStop(1, 'transparent');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, W, H);

  const stripe = ctx.createLinearGradient(0, 0, W, 0);
  stripe.addColorStop(0,   neon);
  stripe.addColorStop(0.5, `${neon}88`);
  stripe.addColorStop(1,   'transparent');
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, W, 3);

  ctx.fillStyle = neon;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('AUDYN  ×  1v1', 24, 38);

  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(date, W - 24, 38);
  ctx.textAlign = 'left';

  const pills = [difficulty.toUpperCase(), gameMode === 'ticking_away' ? '⏱ TICKING' : '🎵 CLASSIC'];
  let px = 24;
  ctx.font = '9.5px monospace';
  pills.forEach((pill) => {
    const tw = ctx.measureText(pill).width;
    const ph = 18, py = 48, pr = 4;
    rrPath(ctx, px, py, tw + 16, ph, pr);
    ctx.fillStyle = 'rgba(204,255,0,0.09)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(204,255,0,0.28)';
    ctx.lineWidth = 0.75;
    ctx.stroke();
    ctx.fillStyle = 'rgba(204,255,0,0.75)';
    ctx.fillText(pill, px + 8, py + 12.5);
    px += tw + 24;
  });

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(24, 78, W - 48, 1);

  const playerZoneY = 90;
  const avatarR     = 44;           // avatar radius
  const halfW       = W / 2;

  const myX  = halfW / 2;
  const oppX = halfW + halfW / 2;
  const avY  = playerZoneY + avatarR + 12;

  if (myWon) {
    const halo = ctx.createRadialGradient(myX, avY, 0, myX, avY, avatarR * 2.8);
    halo.addColorStop(0, 'rgba(204,255,0,0.18)');
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(myX, avY, avatarR * 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  if (oppWon) {
    const halo = ctx.createRadialGradient(oppX, avY, 0, oppX, avY, avatarR * 2.8);
    halo.addColorStop(0, 'rgba(255,68,85,0.18)');
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(oppX, avY, avatarR * 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  drawAvatar(ctx, { cx: myX,  cy: avY, r: avatarR, img: myImg,  name: myName,  winner: myWon,  neon });
  drawAvatar(ctx, { cx: oppX, cy: avY, r: avatarR, img: oppImg, name: oppName, winner: oppWon, neon: red });

  ctx.font = '22px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (myWon)  ctx.fillText('🏆', myX,  avY - avatarR - 6);
  if (oppWon) ctx.fillText('🏆', oppX, avY - avatarR - 6);

  const nameY = avY + avatarR + 20;
  ctx.font      = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = myWon  ? neon : 'rgba(255,255,255,0.82)';
  ctx.fillText(myName.length  > 13 ? myName.slice(0,13)  + '…' : myName,  myX,  nameY);
  ctx.fillStyle = oppWon ? red  : 'rgba(255,255,255,0.82)';
  ctx.fillText(oppName.length > 13 ? oppName.slice(0,13) + '…' : oppName, oppX, nameY);

  const scoreY = nameY + 56;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font      = `bold ${myWon ? 64 : 48}px sans-serif`;
  ctx.fillStyle = myWon ? neon : 'rgba(255,255,255,0.72)';
  ctx.fillText(myScore.toLocaleString(), myX, scoreY);

  ctx.font      = `bold ${oppWon ? 64 : 48}px sans-serif`;
  ctx.fillStyle = oppWon ? red : 'rgba(255,255,255,0.72)';
  ctx.fillText(oppScore.toLocaleString(), oppX, scoreY);

  const ptsY = scoreY + 16;
  ctx.font      = '10px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('pts', myX,  ptsY);
  ctx.fillText('pts', oppX, ptsY);

  const corrY = ptsY + 18;
  ctx.font      = '11px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  if (myCorrect != null)  ctx.fillText(`${myCorrect}/${songCount}  ✓`, myX,  corrY);
  if (oppCorrect != null) ctx.fillText(`${oppCorrect}/${songCount}  ✓`, oppX, corrY);

  const vsBadgeY = avY;
  ctx.fillStyle = '#0d0d18';
  ctx.beginPath();
  ctx.arc(halfW, vsBadgeY, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', halfW, vsBadgeY);
  ctx.textBaseline = 'alphabetic';

  const bannerY = corrY + 28;
  const bannerH = 52;
  const bannerBg = tied
    ? 'rgba(255,255,255,0.05)'
    : myWon ? 'rgba(204,255,0,0.08)' : 'rgba(255,68,85,0.08)';
  const bannerBorder = tied ? 'rgba(255,255,255,0.1)' : myWon ? 'rgba(204,255,0,0.35)' : 'rgba(255,68,85,0.35)';
  const bannerColor  = tied ? 'rgba(255,255,255,0.55)' : myWon ? neon : red;

  rrPath(ctx, 24, bannerY, W - 48, bannerH, 8);
  ctx.fillStyle = bannerBg;
  ctx.fill();
  ctx.strokeStyle = bannerBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = bannerColor;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const scoreDiff = Math.abs(myScore - oppScore);
  const bannerText = tied
    ? "It's a tie! 🤝"
    : myWon
    ? `${myName.length > 10 ? myName.slice(0,10)+'…' : myName} wins by ${scoreDiff} pts 🏆`
    : `${oppName.length > 10 ? oppName.slice(0,10)+'…' : oppName} wins by ${scoreDiff} pts 🏆`;
  ctx.fillText(bannerText, halfW, bannerY + bannerH / 2);
  ctx.textBaseline = 'alphabetic';

  const barY = bannerY + bannerH + 20;
  const barH = 10;
  const barX = 24, barW = W - 48;
  const total  = (myScore + oppScore) || 1;
  const myFrac = myScore / total;

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  rrPath(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();

  if (myFrac > 0.01) {
    const myBarW = barW * myFrac;
    const myGrad = ctx.createLinearGradient(barX, 0, barX + myBarW, 0);
    myGrad.addColorStop(0, neon);
    myGrad.addColorStop(1, `${neon}99`);
    ctx.fillStyle = myGrad;

    ctx.beginPath();
    ctx.moveTo(barX + barH / 2, barY);
    ctx.lineTo(barX + myBarW, barY);
    ctx.lineTo(barX + myBarW, barY + barH);
    ctx.lineTo(barX + barH / 2, barY + barH);
    ctx.quadraticCurveTo(barX, barY + barH, barX, barY + barH / 2);
    ctx.quadraticCurveTo(barX, barY, barX + barH / 2, barY);
    ctx.closePath();
    ctx.fill();
  }

  if (myFrac < 0.99) {
    const oppBarX = barX + barW * myFrac;
    const oppBarW = barW * (1 - myFrac);
    ctx.fillStyle = `${red}88`;
    ctx.beginPath();
    const rx = barX + barW;
    ctx.moveTo(oppBarX, barY);
    ctx.lineTo(rx - barH / 2, barY);
    ctx.quadraticCurveTo(rx, barY, rx, barY + barH / 2);
    ctx.quadraticCurveTo(rx, barY + barH, rx - barH / 2, barY + barH);
    ctx.lineTo(oppBarX, barY + barH);
    ctx.closePath();
    ctx.fill();
  }

  const barLabelY = barY + barH + 15;
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = `${neon}cc`;
  ctx.fillText(myScore.toLocaleString(), barX, barLabelY);
  ctx.fillStyle = `${red}cc`;
  ctx.textAlign = 'right';
  ctx.fillText(oppScore.toLocaleString(), barX + barW, barLabelY);
  ctx.textAlign = 'left';

  const footerY = barLabelY + 28;

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(24, footerY, W - 48, 1);

  const footerContentY = footerY + 22;

  if (playlistImg) {
    ctx.save();
    ctx.beginPath();
    rrPath(ctx, 24, footerContentY - 14, 32, 32, 5);
    ctx.clip();
    ctx.drawImage(playlistImg, 24, footerContentY - 14, 32, 32);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    rrPath(ctx, 24, footerContentY - 14, 32, 32, 5);
    ctx.stroke();
  }

  const textOffsetX = playlistImg ? 64 : 24;

  ctx.font      = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  const pnTrunc = playlistName.length > 28 ? playlistName.slice(0, 28) + '…' : playlistName;
  ctx.fillText(pnTrunc, textOffsetX, footerContentY);

  ctx.font      = '10px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText(`${songCount} songs  ·  H2H Challenge`, textOffsetX, footerContentY + 16);

  ctx.font      = 'bold 11px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = `${neon}88`;
  ctx.fillText('AUDYN.XYZ', W - 24, footerContentY + 4);

  ctx.textAlign = 'left';
  return canvas;
}

function roundRect(ctx, x, y, w, h, r) { rrPath(ctx, x, y, w, h, r); ctx.fill(); }
function roundRectStroke(ctx, x, y, w, h, r) { rrPath(ctx, x, y, w, h, r); ctx.stroke(); }
function roundRectLeft(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath(); ctx.fill();
}
function roundRectRight(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
}

export default function RoomPage({ roomData, onNavigate, onBack }) {
  const { user, ensureGuestSession } = useAuth();
  const { t } = useLanguage();

  const [subState, setSubState] = useState('init'); // init|lobby|playing|waiting|results

  const [roomCode, setRoomCode]   = useState(null);
  const [roomInfo, setRoomInfo]   = useState(null);
  const [isHost, setIsHost]       = useState(false);

  const [tracks, setTracks]     = useState([]);
  const [settings, setSettings] = useState({});

  const [myScore,    setMyScore]    = useState(0);
  const [myCorrect,  setMyCorrect]  = useState(0);
  const [myProgress, setMyProgress] = useState(0); // tracks completed
  const [gameResults, setGameResults] = useState(null);

  const [oppInfo,     setOppInfo]     = useState(null);
  const [oppScore,    setOppScore]    = useState(null); // null = hidden until both done
  const [oppCorrect,  setOppCorrect]  = useState(null);
  const [oppProgress, setOppProgress] = useState(0);

  const [gameKey,         setGameKey]         = useState(0);
  const [waitingElapsed,  setWaitingElapsed]  = useState(0); // seconds waiting
  const [savingImage,     setSavingImage]     = useState(false);

  const pollRef          = useRef(null);
  const waitingTimerRef  = useRef(null);
  const finishedRef      = useRef(false);
  const initCalledRef    = useRef(false);

  useEffect(() => {
    if (!roomData) return;
    if (initCalledRef.current) return;
    initCalledRef.current = true;

    (async () => {
      try {
        await ensureGuestSession();

        if (roomData.mode === 'create') {
          const playlistId = resolvePlaylistId(roomData.playlistData);
          if (!playlistId) { toast.error(t('room.noPlaylist')); onBack(); return; }

          const songCount = Number(roomData.settings?.songCount) || 10;
          const payload = {
            playlist_id: playlistId,
            song_count:  songCount,
            difficulty:  roomData.settings?.difficulty || 'normal',
            game_mode:   roomData.settings?.gameMode   || 'classic',
            guess_mode:  roomData.settings?.guessMode  || 'song',
          };

          const res = await api.post('/rooms/create', payload);
          setRoomCode(res.data.room_code);
          setTracks(shuffleArray(res.data.tracks || []));
          setSettings(roomData.settings || {});
          setIsHost(true);
          setSubState('lobby');
          window.history.pushState({}, '', `/room/${res.data.room_code}`);

        } else if (roomData.mode === 'join' && roomData.code) {
          const res = await api.post(`/rooms/join/${roomData.code}`);
          setRoomCode(res.data.room_code);
          setTracks(shuffleArray(res.data.tracks || []));
          setSettings({
            songCount:  res.data.song_count,
            difficulty: res.data.difficulty,
            gameMode:   res.data.game_mode,
            guessMode:  res.data.guess_mode,
          });
          setIsHost(false);
          setSubState('playing');
          setGameKey((k) => k + 1);
        }
      } catch (err) {
        toast.error(getApiError(err, 'Failed to set up room'));
        onBack();
      }
    })();
  }, [roomData]); // eslint-disable-line

  useEffect(() => {
    if (!roomCode || subState === 'init') return;

    const poll = async () => {
      try {
        const res = await api.get(`/rooms/${roomCode}`);
        const data = res.data;
        setRoomInfo(data);

        const amHost = isHost;
        const hostData  = data.host;
        const guestData = data.guest;
        const me  = amHost ? hostData  : guestData;
        const opp = amHost ? guestData : hostData;

        if (opp) {
          setOppInfo({ username: opp.username, avatar_url: opp.avatar_url });
          setOppProgress(opp.progress ?? 0);

          if (opp.score != null) setOppScore(opp.score);
          if (opp.correct != null) setOppCorrect(opp.correct);
        }
        if (me && me.score != null) {

          if (me.correct != null) setMyCorrect(me.correct);
        }

        if (subState === 'lobby' && guestData) {
          setSubState('playing');
          setGameKey((k) => k + 1);
        }

        if (data.status === 'finished' && finishedRef.current) {
          setSubState('results');
        }

        if (data.status === 'finished' && subState === 'waiting') {
          setSubState('results');
        }
      } catch {

      }
    };

    pollRef.current = setInterval(poll, 2000);
    poll();
    return () => clearInterval(pollRef.current);
  }, [roomCode, subState, isHost]); // eslint-disable-line

  useEffect(() => {
    if (subState !== 'waiting') {
      clearInterval(waitingTimerRef.current);
      setWaitingElapsed(0);
      return;
    }
    waitingTimerRef.current = setInterval(
      () => setWaitingElapsed((n) => n + 1),
      1000,
    );
    return () => clearInterval(waitingTimerRef.current);
  }, [subState]);

  const handleTrackComplete = useCallback((completedCount) => {
    setMyProgress(completedCount);
    if (roomCode) {
      api.post(`/rooms/${roomCode}/score`, { tracks_completed: completedCount })
        .catch(() => {});
    }
  }, [roomCode]);

  const handleRoomScoreUpdate = useCallback((newScore) => {
    setMyScore(newScore);
  }, []);

  const handleGameEnd = useCallback(async (results) => {
    setGameResults(results);
    setMyScore(results.score);
    setMyCorrect(results.correctGuesses);
    setMyProgress(results.totalTracks);
    finishedRef.current = true;

    if (roomCode) {
      try {

        await api.post(`/rooms/${roomCode}/score`, {
          tracks_completed: results.totalTracks,
        });
        await api.post(`/rooms/${roomCode}/finish`);
      } catch {  }
    }

    setSubState('waiting');

    setTimeout(() => {
      setSubState((s) => (s === 'waiting' ? 'results' : s));
    }, 180_000);
  }, [roomCode]);

  const handleSaveImage = useCallback(async () => {
    setSavingImage(true);
    try {
      const canvas     = document.createElement('canvas');
      const songCount  = settings.songCount || roomInfo?.song_count || 10;
      const myName     = user?.username || 'You';
      const oppName    = oppInfo?.username || 'Opponent';
      const myFinal    = gameResults?.score  ?? myScore;
      const oppFinal   = oppScore ?? 0;
      const myCorr     = gameResults?.correctGuesses ?? myCorrect;
      const oppCorr    = oppCorrect;
      const playlist   = gameResults?.playlistName || roomInfo?.playlist_name || roomInfo?.playlist_id || 'Playlist';
      const diff       = settings.difficulty || roomInfo?.difficulty || 'normal';
      const gm         = settings.gameMode   || roomInfo?.game_mode  || 'classic';
      const date       = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      const myAvatarUrl  = user?.avatar_url   || null;
      const oppAvatarUrl = oppInfo?.avatar_url || null;

      const playlistImageUrl = roomInfo?.playlist_image || gameResults?.playlistImage || null;

      await drawRoomScoreCard(canvas, {
        myName,  myScore: myFinal,  myCorrect: myCorr,  myAvatarUrl,
        oppName, oppScore: oppFinal, oppCorrect: oppCorr, oppAvatarUrl,
        playlistImageUrl,
        songCount, playlistName: playlist, difficulty: diff, gameMode: gm, date,
      });

      await new Promise((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          try {
            const file = new File([blob], 'audyn-1v1.png', { type: 'image/png' });
            if (navigator.share && navigator.canShare?.({ files: [file] })) {
              await navigator.share({ files: [file], title: 'Audyn 1v1 Result' });
            } else {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'audyn-1v1.png';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            }
            resolve();
          } catch (e) { reject(e); }
        }, 'image/png');
      });

      toast.success('Score card saved!');
    } catch (err) {
      console.error(err);
      toast.error('Could not save image');
    } finally {
      setSavingImage(false);
    }
  }, [user, oppInfo, oppScore, oppCorrect, myScore, myCorrect, gameResults, settings, roomInfo]);

  const handleCopyCode = () => {
    const url = `${window.location.origin}/room/${roomCode}`;
    navigator.clipboard?.writeText(url)
      .then(() => toast.success(t('room.roomLinkCopied')))
      .catch(() => toast.error('Could not copy'));
  };

  const handlePlayAgain = () => {
    if (!roomData?.playlistData) { onBack(); return; }
    initCalledRef.current = false;
    onNavigate('room', { ...roomData, mode: 'create' });
  };

  const songCount   = settings.songCount || roomInfo?.song_count || 10;
  const myFinalScore  = gameResults?.score ?? myScore;
  const oppFinalScore = oppScore ?? 0;
  const diff        = myFinalScore - oppFinalScore;
  const won         = diff > 0;
  const tied        = diff === 0;
  const oppName     = oppInfo?.username || t('room.opponent');
  const myName      = user?.username || t('common.you');

  if (subState === 'lobby') {
    return (
      <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center px-4 py-6">
        <div className="w-full max-w-sm space-y-8 text-center">
          <button onClick={onBack} className="absolute top-4 left-4 p-2 btn-tactile"
            style={{ color: 'var(--color-text-muted)' }}>
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em]"
              style={{ color: 'var(--color-text-dim)' }}>{t('room.roomCode')}</p>
            <div className="flex items-center justify-center gap-3">
              <h1 className="font-heading text-5xl font-extrabold tracking-[0.15em] neon-glow"
                style={{ color: 'var(--color-neon)' }}>{roomCode}</h1>
              <button onClick={handleCopyCode} className="p-2 btn-tactile"
                style={{ color: 'var(--color-text-muted)' }}>
                <Copy className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-surface)', border: '2px solid var(--color-border)' }}>
              <span className="font-heading text-lg font-bold" style={{ color: 'var(--color-text-muted)' }}>
                {user?.username?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: 'var(--color-neon)' }} />
              <p className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('room.waitingForOpponent')}
              </p>
            </div>
          </div>

          <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
            {t('room.shareCodeHint')}
          </p>

          <button onClick={onBack} className="font-mono text-[11px] uppercase tracking-wider py-2 btn-tactile"
            style={{ color: 'var(--color-text-muted)' }}>
            {t('room.cancelRoom')}
          </button>
        </div>
      </div>
    );
  }

  if (subState === 'playing' && tracks.length > 0) {
    return (
      <div className="min-h-screen flex flex-col">
        {}
        <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-2 backdrop-blur-md"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-bg) 90%, transparent)',
            borderBottom: '1px solid var(--color-border)',
          }}>
          {}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-surface)' }}>
              <span className="text-[9px] font-mono" style={{ color: 'var(--color-neon)' }}>
                {user?.username?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
            <span className="font-mono text-sm font-bold" style={{ color: 'var(--color-neon)' }}>
              {myScore}
            </span>
          </div>

          <span className="font-mono text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--color-text-dim)' }}>VS</span>

          {}
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
                {oppName}
              </p>
              <p className="font-mono text-xs font-bold" style={{ color: 'var(--color-error)' }}>
                {oppProgress}/{songCount}
              </p>
            </div>
            <div className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-surface)' }}>
              <span className="text-[9px] font-mono" style={{ color: 'var(--color-text-dim)' }}>
                {oppName[0]?.toUpperCase() || '?'}
              </span>
            </div>
          </div>
        </div>

        <GamePage
          key={gameKey}
          tracks={tracks}
          playlistName={t('room.h2hChallenge')}
          playlistId={roomInfo?.playlist_id || settings.playlistId || ''}
          songCount={settings.songCount || 10}
          difficulty={settings.difficulty || 'normal'}
          gameMode={settings.gameMode || 'classic'}
          guessMode={settings.guessMode || 'song'}
          isDaily={false}
          roomCode={roomCode}
          onRoomScoreUpdate={handleRoomScoreUpdate}
          onTrackComplete={handleTrackComplete}
          onEnd={handleGameEnd}
          onBack={onBack}
        />
      </div>
    );
  }

  if (subState === 'waiting') {
    const oppPct = songCount > 0 ? Math.round((oppProgress / songCount) * 100) : 0;
    const canSkip = waitingElapsed >= 60;

    return (
      <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm space-y-8 text-center animate-slide-in-up">

          {}
          <div className="p-4 rounded-sm"
            style={{ backgroundColor: 'var(--color-neon-subtle)', border: '1px solid var(--color-neon-dim)' }}>
            <p className="font-mono text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--color-text-dim)' }}>Your score</p>
            <p className="font-heading text-4xl font-extrabold neon-glow mt-1"
              style={{ color: 'var(--color-neon)' }}>{myFinalScore.toLocaleString()}</p>
            <p className="font-mono text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {gameResults?.correctGuesses ?? myCorrect}/{songCount} correct
            </p>
          </div>

          {}
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--color-text-muted)' }} />
              <p className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Waiting for {oppName}…
              </p>
            </div>

            {}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
                  {oppName}
                </span>
                <span className="font-mono text-[10px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                  {oppProgress} / {songCount} tracks
                </span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--color-surface)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${oppPct}%`,
                    backgroundColor: 'var(--color-error)',
                    opacity: 0.7,
                  }} />
              </div>
              {}
              <div className="flex gap-1 justify-center flex-wrap mt-1">
                {Array.from({ length: songCount }).map((_, i) => (
                  <span key={i} className="w-2 h-2 rounded-full transition-colors duration-300"
                    style={{
                      backgroundColor: i < oppProgress
                        ? 'var(--color-error)'
                        : 'var(--color-border)',
                    }} />
                ))}
              </div>
            </div>

            {}
            {waitingElapsed > 10 && (
              <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
                Waiting {Math.floor(waitingElapsed / 60) > 0
                  ? `${Math.floor(waitingElapsed / 60)}m ${waitingElapsed % 60}s`
                  : `${waitingElapsed}s`}
              </p>
            )}
          </div>

          {}
          {canSkip && (
            <button
              onClick={() => setSubState('results')}
              className="font-mono text-[11px] uppercase tracking-wider py-2 px-4 rounded-sm btn-tactile"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              Show results anyway
            </button>
          )}
        </div>
      </div>
    );
  }

  if (subState === 'results') {
    const myCorr  = gameResults?.correctGuesses ?? myCorrect;
    const oppCorr = oppCorrect;

    return (
      <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-md space-y-5">

          {}
          <div className="text-center py-4 rounded-sm animate-card-enter"
            style={{
              backgroundColor: won
                ? 'var(--color-neon-subtle)'
                : tied ? 'var(--color-surface)' : 'rgba(239,68,68,0.05)',
              border: `1px solid ${won ? 'var(--color-neon)' : tied ? 'var(--color-border)' : 'rgba(239,68,68,0.3)'}`,
            }}>
            <p className="font-heading text-xl font-extrabold"
              style={{ color: won ? 'var(--color-neon)' : tied ? 'var(--color-text)' : 'var(--color-error)' }}>
              {won
                ? t('room.wonBy', { diff: Math.abs(diff) })
                : tied ? t('room.tie')
                : t('room.lostBy', { diff: Math.abs(diff) })}
            </p>
          </div>

          {}
          <div className="grid grid-cols-2 gap-3">
            {}
            <div className="p-4 rounded-sm text-center space-y-1"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: won ? '2px solid var(--color-neon)' : '1px solid var(--color-border)',
              }}>
              <p className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--color-text-dim)' }}>{t('common.you')}</p>
              <p className="font-heading text-3xl font-extrabold"
                style={{ color: 'var(--color-neon)' }}>{myFinalScore.toLocaleString()}</p>
              <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                {myCorr}/{songCount} correct
              </p>
              <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
                {myName}
              </p>
            </div>

            {}
            <div className="p-4 rounded-sm text-center space-y-1"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: !won && !tied ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
              }}>
              <p className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--color-text-dim)' }}>{t('room.opponent')}</p>
              <p className="font-heading text-3xl font-extrabold"
                style={{ color: 'var(--color-error)' }}>{oppFinalScore.toLocaleString()}</p>
              {oppCorr != null && (
                <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {oppCorr}/{songCount} correct
                </p>
              )}
              <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
                {oppName}
              </p>
            </div>
          </div>

          {}
          {myFinalScore + oppFinalScore > 0 && (
            <div className="space-y-1">
              <div className="w-full h-2 rounded-full overflow-hidden flex"
                style={{ backgroundColor: 'var(--color-surface)' }}>
                <div className="h-full transition-all"
                  style={{
                    width: `${(myFinalScore / (myFinalScore + oppFinalScore)) * 100}%`,
                    backgroundColor: 'var(--color-neon)',
                    opacity: 0.8,
                  }} />
                <div className="h-full flex-1" style={{ backgroundColor: 'var(--color-error)', opacity: 0.5 }} />
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[9px]" style={{ color: 'var(--color-neon)' }}>{myName}</span>
                <span className="font-mono text-[9px]" style={{ color: 'var(--color-error)' }}>{oppName}</span>
              </div>
            </div>
          )}

          {}
          <div className="space-y-2 pt-2">
            {}
            <button
              onClick={handleSaveImage}
              disabled={savingImage}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile transition-all"
              style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)', opacity: savingImage ? 0.7 : 1 }}>
              {savingImage
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : navigator.share ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              {navigator.share ? 'Share score card' : 'Save score card'}
            </button>

            <button
              onClick={handlePlayAgain}
              className="w-full py-4 rounded-sm font-heading text-sm font-bold uppercase tracking-wider btn-tactile transition-all flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}>
              {t('room.playAgain')}
            </button>

            <button
              onClick={onBack}
              className="w-full py-3 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              {t('common.goHome')}
            </button>
          </div>

          {}
          <p className="text-center font-mono text-[9px]" style={{ color: 'var(--color-text-dim)' }}>
            Score card shows display names only — no profile links for guest players.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--color-neon)' }} />
    </div>
  );
}
