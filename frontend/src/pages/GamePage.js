import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api, { API_BASE } from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { useAudio } from '@/hooks/useAudio';
import { DIFFICULTY_MODES, DEFAULT_DIFFICULTY } from '@/lib/difficulty';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

const BACKEND_URL = API_BASE;

function getStreakMultiplier(count) {
  if (count >= 7) return 2.0;
  if (count >= 5) return 1.5;
  if (count >= 3) return 1.2;
  return 1.0;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function GamePage({
  tracks,
  playlistName,
  playlistId = '',
  songCount,
  difficulty: difficultyKey,
  gameMode = 'classic',
  guessMode = 'song',
  isDaily = false,
  onEnd,
  onBack,

  roomCode = null,
  onRoomScoreUpdate = null,
  onTrackComplete = null,   // (completedCount: number) => void — fires after each track
}) {
  const difficulty = DIFFICULTY_MODES[difficultyKey] || DIFFICULTY_MODES[DEFAULT_DIFFICULTY];
  const CLIP_DURATIONS = difficulty.clipDurations;
  const CLIP_POINTS = difficulty.clipPoints;

  const { ensureGuestSession } = useAuth();
  const { t } = useLanguage();

  // Rounds are server-authoritative: the server picks (and keeps secret) the
  // track order; the client only learns each track at reveal time.
  const [totalRounds, setTotalRounds] = useState(0);
  const [sessionReady, setSessionReady] = useState(false);
  const [albumArtMap, setAlbumArtMap] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [clipStage, setClipStage] = useState(0);
  const [score, setScore] = useState(0);
  const [correctGuesses, setCorrectGuesses] = useState(0);
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState('loading');
  const [startPos, setStartPos] = useState(0);
  const [guessQuery, setGuessQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [stageHistory, setStageHistory] = useState([]);
  const [shaking, setShaking] = useState(false);
  const [revealResult, setRevealResult] = useState(null);
  const [revealInfo, setRevealInfo] = useState(null); // server reveal: {id, name, artist, album_image}
  const [scoreBump, setScoreBump] = useState(false);
  const [screenFlash, setScreenFlash] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const isTouchDevice = useRef('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(isTouchDevice.current);
  const [hasGuessed, setHasGuessed] = useState(false);

  const [streakCount, setStreakCount] = useState(0);

  const { loadAudio, playClip, togglePlay, stop, isPlaying, isLoaded, loadError } = useAudio();
  const inputRef = useRef(null);
  const needsPlayRef = useRef(false);
  const startPosRef = useRef(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef(null);
  const isHoverDevice = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)')?.matches
  );

  const shuffledAllTracksRef = useRef(null);
  const searchIndexRef = useRef(null);
  const debounceRef = useRef(null);
  const sessionIdRef = useRef(null);
  const sessionStartedRef = useRef(false); // guard: start exactly once
  const guessBusyRef = useRef(false);      // guard: one in-flight guess at a time

  useEffect(() => {
    const map = {};
    tracks.forEach((t) => {
      if (t.album_image) map[t.id || t.track_id] = t.album_image;
    });
    setAlbumArtMap(map);
  }, [tracks]);

  useEffect(() => {
    // Autocomplete pool: shuffled once so dropdown order gives nothing away.
    if (!shuffledAllTracksRef.current) {
      shuffledAllTracksRef.current = shuffleArray(tracks);
      searchIndexRef.current = shuffledAllTracksRef.current.map(t => ({
        nameLower: t.name.toLowerCase(),
        artistLower: t.artist.toLowerCase(),
      }));
    }

    // Start the server session exactly once. The ref guard (not effect deps)
    // ensures creating a guest session mid-flight can't restart the game.
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;

    (async () => {
      try {
        await ensureGuestSession();
        const startPayload = {
          playlist_id: playlistId || '',
          song_count: songCount,
          difficulty: difficultyKey || 'normal',
          game_mode: gameMode,
          guess_mode: guessMode,
          is_daily: isDaily,
        };
        if (roomCode) startPayload.room_code = roomCode;

        const res = await api.post('/sessions/start', startPayload);
        sessionIdRef.current = res.data.session_id;
        setTotalRounds(res.data.total_rounds);
        setSessionReady(true);
      } catch (err) {
        console.error('Session start failed:', err);
        toast.error(getApiError(err, t('game.audioError')));
        onBack();
      }
    })();

  }, []); // eslint-disable-line

  const clipUrl = useCallback((roundNo) => (
    `${BACKEND_URL}/api/sessions/${sessionIdRef.current}/clip/${roundNo}`
  ), []);

  const initRound = useCallback((roundNo) => {
    setPhase('loading');
    setClipStage(0);
    setStageHistory([]);
    setGuessQuery('');
    setShowDropdown(false);
    if (inputRef.current) inputRef.current.value = '';
    clearTimeout(debounceRef.current);
    setRevealResult(null);
    setRevealInfo(null);
    setElapsed(0);
    elapsedRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);

    const maxClip = CLIP_DURATIONS[CLIP_DURATIONS.length - 1];
    const maxStart = Math.max(0, 28 - maxClip);
    const randomStart = Math.random() * maxStart + 1;
    setStartPos(randomStart);
    startPosRef.current = randomStart;
    needsPlayRef.current = true;
    loadAudio(clipUrl(roundNo));
  }, [loadAudio, CLIP_DURATIONS, clipUrl]);

  useEffect(() => {
    if (sessionReady && phase === 'loading' && results.length === 0 && !needsAudioUnlock) {
      initRound(0);
    }

  }, [sessionReady, needsAudioUnlock]); // eslint-disable-line

  useEffect(() => {
    if (isLoaded && needsPlayRef.current) {
      needsPlayRef.current = false;
      setPhase('playing');
      playClip(startPosRef.current, CLIP_DURATIONS[0]);
      startTimer();
    }
  }, [isLoaded, playClip, CLIP_DURATIONS]);

  useEffect(() => {
    if (loadError && phase === 'loading') {
      toast.error(t('game.audioError'));
      resolveRoundAsFailed([{ type: 'skip', text: 'AUDIO ERROR' }]);
    }

  }, [loadError]); // eslint-disable-line

  useKeyboardShortcuts({
    onPlay: () => handlePlayToggle(),
    onSubmit: () => {

      if (guessQuery.length > 0 && filteredItems.length > 0) {
        handleGuessItem(filteredItems[0]);
      }
    },
    onClear: () => {
      setGuessQuery('');
      setShowDropdown(false);
      if (inputRef.current) inputRef.current.value = '';
      clearTimeout(debounceRef.current);
    },
    onSkip: () => handleSkip(),
    enabled: phase === 'playing',
  });

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
    };
  }, []);

  const handleAudioUnlock = useCallback(() => {

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {  }

    setNeedsAudioUnlock(false);

  }, []);

  const startTimer = () => {
    const start = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const e = (Date.now() - start) / 1000;
      elapsedRef.current = e;
      setElapsed(e);
    }, 100);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePlayToggle = () => {
    if (phase !== 'playing') return;
    togglePlay();
  };

  const triggerFlash = (type) => {
    setScreenFlash(type);
    setTimeout(() => setScreenFlash(null), type === 'red' ? 150 : 300);
  };

  const postGuess = async (payload) => {
    return api.post(`/sessions/${sessionIdRef.current}/guess`, {
      round: currentIndex,
      ...payload,
    });
  };

  const showBadges = (data) => {
    if (data?.new_badges?.length) {
      data.new_badges.forEach((b) => {
        toast.success(`${b.emoji} Badge unlocked: ${b.label}`);
      });
    }
  };

  // Audio failed to load: the round can't be played, so resolve it
  // server-side (skips through remaining stages) to get the reveal + 0 score.
  const resolveRoundAsFailed = async (history) => {
    stop();
    let reveal = null;
    try {
      for (let i = 0; i < CLIP_DURATIONS.length; i++) {
        const res = await postGuess({ skip: true });
        if (res.data.done) { reveal = res.data.reveal; break; }
      }
    } catch (err) {
      console.error('Round fail-resolve error:', err);
    }
    revealTrack(false, 0, history, null, reveal);
  };

  const handleSkip = async () => {
    if (phase !== 'playing' || guessBusyRef.current) return;
    guessBusyRef.current = true;
    stop();
    setStreakCount(0);
    const newHistory = [...stageHistory, { type: 'skip', text: 'SKIPPED' }];
    setStageHistory(newHistory);

    try {
      const res = await postGuess({ skip: true });
      if (res.data.done) {
        showBadges(res.data);
        revealTrack(false, 0, newHistory, null, res.data.reveal);
      } else {
        setClipStage(res.data.stage);
        playClip(startPosRef.current, CLIP_DURATIONS[res.data.stage]);
      }
    } catch (err) {
      if (err?.response?.status !== 409) {
        console.error('Skip failed:', err);
        toast.error(t('game.audioError'));
        setStageHistory(stageHistory); // roll back the slot entry
      }
    } finally {
      guessBusyRef.current = false;
    }
  };

  const handleGuessItem = async (item) => {
    if (phase !== 'playing' || guessBusyRef.current) return;
    guessBusyRef.current = true;
    stop();

    setHasGuessed(true);
    const displayText = guessMode === 'artist' ? item.artistName || item.artist : item.name;
    const guessStage = clipStage;

    try {
      const res = await postGuess(
        guessMode === 'artist'
          ? { artist: item.artistName || item.artist || '' }
          : { track_id: item.id || item.track_id }
      );
      const data = res.data;

      if (data.correct) {
        const isFirstClip = guessStage === 0;
        const newStreakCount = isFirstClip ? streakCount + 1 : streakCount;
        setStreakCount(newStreakCount);

        const newHistory = [...stageHistory, { type: 'correct', text: displayText }];
        setStageHistory(newHistory);
        triggerFlash('green');
        showBadges(data);

        revealTrack(true, data.score.final_score, newHistory, {
          basePoints: data.score.base_score,
          timePenalty: data.score.time_penalty,
          guessElapsed: data.elapsed_seconds,
          multiplier: data.multiplier || 1.0,
        }, data.reveal);
      } else {
        triggerFlash('red');
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
        setStreakCount(0);

        const newHistory = [...stageHistory, { type: 'wrong', text: displayText }];
        setStageHistory(newHistory);

        if (data.done) {
          showBadges(data);
          revealTrack(false, 0, newHistory, null, data.reveal);
        } else {
          setClipStage(data.stage);
          setTimeout(() => {
            playClip(startPosRef.current, CLIP_DURATIONS[data.stage]);
          }, 500);
        }
      }
    } catch (err) {
      if (err?.response?.status !== 409) {
        console.error('Guess failed:', err);
        toast.error(t('game.audioError'));
      }
    } finally {
      guessBusyRef.current = false;
    }

    setGuessQuery('');
    setShowDropdown(false);
    if (inputRef.current) inputRef.current.value = '';
    clearTimeout(debounceRef.current);
  };

  const handleGuess = (track) => handleGuessItem(track);

  const revealTrack = (correct, points, finalHistory, scoreDetail, reveal) => {
    stop();
    stopTimer();

    const track = reveal
      ? {
          id: reveal.id,
          track_id: reveal.id,
          name: reveal.name,
          artist: reveal.artist,
          album_image: reveal.album_image || albumArtMap[reveal.id] || '',
        }
      : { id: '', name: '—', artist: '', album_image: '' };

    setResults((prev) => [
      ...prev,
      {
        track,
        correct,
        points,
        clipStage,
        stageHistory: finalHistory || stageHistory,
        timePenalty: scoreDetail?.timePenalty || 0,
        basePoints: scoreDetail?.basePoints || 0,
        elapsed_seconds: scoreDetail?.guessElapsed || 0,
        multiplier: scoreDetail?.multiplier || 1.0,
      },
    ]);

    if (correct) {
      setScore((prev) => prev + points);
      setCorrectGuesses((prev) => prev + 1);
      setScoreBump(true);
      setTimeout(() => setScoreBump(false), 300);

      if (roomCode && onRoomScoreUpdate) {
        onRoomScoreUpdate(score + points);
      }
    }

    setRevealInfo(track);
    setRevealResult({ correct, finalScore: points, ...scoreDetail });
    setPhase('revealed');
  };

  const handleNext = async () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= totalRounds) {
      try {
        const sessionResults = results.map((r) => ({
          correct: r.correct,
          clip_stage: r.clipStage,
          points: r.points,
          elapsed_seconds: r.elapsed_seconds || 0,
        }));
        const scRes = await api.post('/scores/session-complete', {
          session_results: sessionResults,
          difficulty: difficultyKey || 'normal',
          game_mode: gameMode,
          guess_mode: guessMode,

          playlist_id: playlistId || '',

          session_id: sessionIdRef.current || null,

          client_hour: new Date().getHours(),
        });
        showBadges(scRes.data);
      } catch (err) {
        console.warn('Session complete failed:', err);
      }

      onEnd({
        score,
        correctGuesses,
        totalTracks: totalRounds,
        results,
        playlistName,
        playlistId,
        playlistImage: '',
        maxScore: totalRounds * CLIP_POINTS[0],
        difficulty: difficultyKey,
        gameMode,
        guessMode,
        isDaily,
      });
    } else {

      if (onTrackComplete) onTrackComplete(currentIndex + 1);
      setCurrentIndex(nextIndex);
      initRound(nextIndex);
    }
  };

  const searchPool = shuffledAllTracksRef.current || tracks;

  const filteredItems = useMemo(() => {
    const q = guessQuery.trim().toLowerCase();
    if (q.length === 0) return [];

    if (guessMode === 'artist') {

      const seen = new Set();
      const items = [];
      for (let i = 0; i < searchPool.length; i++) {
        const t = searchPool[i];
        const idx = searchIndexRef.current?.[i];
        const key = idx ? idx.artistLower.trim() : t.artist.toLowerCase().trim();
        if (!seen.has(key) && key.includes(q)) {
          seen.add(key);
          items.push({ artistName: t.artist, artist: t.artist, id: `artist:${key}` });
          if (items.length >= 7) break;
        }
      }
      return items;
    }

    return searchPool
      .filter((t, i) => {
        const idx = searchIndexRef.current?.[i];
        if (!idx) return false;
        return idx.nameLower.includes(q) || idx.artistLower.includes(q);
      })
      .slice(0, 7);
  }, [guessQuery, guessMode, searchPool]);

  const currentMultiplier = gameMode === 'ticking_away' ? getStreakMultiplier(streakCount) : 1.0;

  if (!sessionReady && !needsAudioUnlock) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--color-neon)' }} />
      </div>
    );
  }

  const maxCountdown = 30;
  const countdownProgress = Math.min(elapsed / maxCountdown, 1);

  if (needsAudioUnlock) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4 cursor-pointer"
        style={{ backgroundColor: 'var(--color-bg)' }}
        onClick={handleAudioUnlock}
        onTouchStart={handleAudioUnlock}
      >
        <h1
          className="font-heading text-4xl font-extrabold tracking-tight neon-glow mb-4"
          style={{ color: 'var(--color-neon)' }}
        >
          {t('game.tapToBegin')}
        </h1>
        <p className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('game.tapToUnlock')}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-4 py-4">
      {}
      {screenFlash === 'green' && <div className="screen-flash-green" />}
      {screenFlash === 'red' && <div className="screen-flash-red" />}

      <div className="w-full max-w-md mx-auto flex flex-col flex-1">
        {}
        <div className="flex items-center justify-between mb-6">
          <button onClick={onBack} className="p-1 btn-tactile" style={{ color: 'var(--color-text-muted)' }}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="font-mono text-sm flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{t('common.score')}</span>
            <span
              className={`text-lg font-bold ${scoreBump ? 'animate-score-pop' : ''}`}
              style={{ color: 'var(--color-neon)' }}
            >
              {score}
            </span>
          </div>
          <div className="font-mono text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            <span style={{ color: 'var(--color-text)' }}>{currentIndex + 1}</span>/{totalRounds}
          </div>
        </div>

        {}
        <div className="flex justify-center mb-4 gap-2 flex-wrap">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.25em] px-3 py-1 rounded-full"
            style={{ color: difficulty.color, border: `1px solid ${difficulty.color}40` }}
          >
            {difficulty.label}
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.25em] px-3 py-1 rounded-full"
            style={{
              color: gameMode === 'ticking_away' ? '#F59E0B' : 'var(--color-text-muted)',
              border: `1px solid ${gameMode === 'ticking_away' ? 'rgba(245,158,11,0.4)' : 'var(--color-border)'}`,
            }}
          >
            {gameMode === 'ticking_away' ? '⏱️ ' + t('home.tickingAway') : '🎵 ' + t('home.classic')}
          </span>
          {guessMode === 'artist' && (
            <span
              className="font-mono text-[10px] uppercase tracking-[0.25em] px-3 py-1 rounded-full"
              style={{ color: '#A855F7', border: '1px solid rgba(168,85,247,0.4)' }}
            >
              🎤 Artist
            </span>
          )}
          {isDaily && (
            <span
              className="font-mono text-[10px] uppercase tracking-[0.25em] px-3 py-1 rounded-full"
              style={{ color: '#EAB308', border: '1px solid rgba(234,179,8,0.4)' }}
            >
              Daily
            </span>
          )}
        </div>

        {}
        {streakCount >= 3 && gameMode === 'ticking_away' && (
          <div className="flex justify-center mb-3 animate-card-enter">
            <span
              className="font-mono text-xs font-bold px-4 py-1.5 rounded-full"
              style={{
                color: currentMultiplier >= 2.0 ? '#EF4444' : currentMultiplier >= 1.5 ? '#F97316' : '#F59E0B',
                border: `1px solid ${currentMultiplier >= 2.0 ? 'rgba(239,68,68,0.4)' : currentMultiplier >= 1.5 ? 'rgba(249,115,22,0.4)' : 'rgba(245,158,11,0.4)'}`,
                backgroundColor: currentMultiplier >= 2.0 ? 'rgba(239,68,68,0.08)' : currentMultiplier >= 1.5 ? 'rgba(249,115,22,0.08)' : 'rgba(245,158,11,0.08)',
                animation: currentMultiplier >= 2.0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }}
            >
              🔥 ×{currentMultiplier} STREAK ({streakCount})
            </span>
          </div>
        )}

        {}
        <div className="space-y-1.5 mb-6">
          {CLIP_DURATIONS.map((duration, idx) => {
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
              active: { border: `1px solid var(--color-neon)40`, backgroundColor: 'var(--color-neon-subtle)' },
              loading: { border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' },
              idle: { border: '1px solid var(--color-border-subtle)', backgroundColor: 'transparent' },
              skip: { border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' },
              wrong: { border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'rgba(127,29,29,0.1)' },
              correct: { border: '1px solid var(--color-neon)30', backgroundColor: 'var(--color-neon-subtle)' },
            };

            return (
              <div
                key={idx}
                className={`flex items-center gap-3 px-4 py-2.5 font-mono text-sm transition-colors duration-200
                  ${shaking && idx === clipStage ? 'animate-shake' : ''}
                `}
                style={{ ...slotStyles[status], animationDelay: `${idx * 60}ms` }}
              >
                <span className="w-10 text-xs tabular-nums" style={{
                  color: status === 'active' || status === 'correct' ? 'var(--color-neon)'
                    : status === 'wrong' ? 'var(--color-error)'
                    : 'var(--color-text-dim)',
                }}>
                  {duration >= 1 ? `${duration}s` : `${(duration * 1000).toFixed(0)}ms`}
                </span>
                <span className="flex-1 truncate text-xs" style={{
                  color: status === 'active' ? 'var(--color-text-muted)'
                    : status === 'correct' ? 'var(--color-neon)'
                    : status === 'wrong' ? 'var(--color-error)'
                    : 'var(--color-text-dim)',
                }}>
                  {text || (status === 'active' ? (isPlaying ? t('game.listening') : t('game.ready')) : '')}
                  {status === 'loading' && t('game.loadingAudio')}
                </span>
                {status === 'active' && isPlaying && (
                  <span className="flex gap-[2px] items-end h-4">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="w-[2px] rounded-full"
                        style={{
                          backgroundColor: 'var(--color-neon)',
                          animation: 'sound-bar 0.4s ease-in-out infinite alternate',
                          animationDelay: `${i * 0.1}s`,
                          height: '3px',
                        }}
                      />
                    ))}
                  </span>
                )}
                {status === 'correct' && (
                  <span className="text-xs" style={{ color: 'var(--color-neon)' }}>+{CLIP_POINTS[idx]}</span>
                )}
              </div>
            );
          })}
        </div>

        {}
        {phase === 'revealed' && revealInfo && (
          <div className="mb-6 animate-card-enter">
            <div
              className="p-6 text-center space-y-4 rounded-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              {revealInfo.album_image && (
                <img
                  src={revealInfo.album_image}
                  alt={revealInfo.name}
                  className="w-28 h-28 mx-auto object-cover rounded-sm"
                  style={{ border: '1px solid var(--color-border-subtle)' }}
                />
              )}
              <div>
                <p className="font-heading text-lg font-bold" style={{ color: 'var(--color-text)' }}>
                  {revealInfo.name}
                </p>
                <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {revealInfo.artist}
                </p>
              </div>
              {revealResult?.correct ? (
                <div>
                  <p className="font-mono font-bold text-xl neon-glow" style={{ color: 'var(--color-neon)' }}>
                    +{revealResult.finalScore}
                  </p>
                  {}
                  {guessMode === 'artist' && (
                    <p className="font-mono text-[10px] mt-1" style={{ color: 'var(--color-neon)' }}>
                      {t('game.correctArtist')}
                    </p>
                  )}
                  {revealResult.timePenalty > 0 && (
                    <p className="font-mono text-[10px] mt-1" style={{ color: 'var(--color-text-dim)' }}>
                      {revealResult.basePoints} base - {revealResult.timePenalty} time penalty
                      {revealResult.multiplier > 1.0 && ` × ${revealResult.multiplier} streak`}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  {guessMode === 'artist' ? (
                    <p className="font-mono text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                      {t('game.theArtistWas', { artist: revealInfo.artist })}
                    </p>
                  ) : (
                    <p className="font-mono text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                      {t('game.betterLuck')}
                    </p>
                  )}

                  {}
                  {revealInfo.id && (
                    <a
                      href={`https://open.spotify.com/track/${revealInfo.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-full font-mono text-xs font-bold uppercase tracking-wider btn-tactile transition-all animate-slide-in-up"
                      style={{
                        backgroundColor: '#1DB954',
                        color: '#FFFFFF',
                        animationDelay: '300ms',
                        animationFillMode: 'backwards',
                      }}
                    >
                      ▶ {t('game.openInSpotify')}
                    </a>
                  )}
                </div>
              )}
              <button
                onClick={handleNext}
                className="w-full h-12 mt-2 font-bold uppercase tracking-wider rounded-sm btn-tactile transition-all flex items-center justify-center gap-1"
                style={{
                  backgroundColor: 'var(--color-neon)',
                  color: 'var(--color-bg)',
                }}
              >
                {currentIndex + 1 >= totalRounds ? t('game.seeResults') : t('game.nextSong')}
              </button>
            </div>
          </div>
        )}

        {}
        {(phase === 'playing' || phase === 'loading') && (
          <div className="flex flex-col items-center gap-5 mt-2">
            {}
            {gameMode === 'ticking_away' && (
              <div className="w-full">
                <div className="flex justify-between mb-1">
                  <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
                    {t('game.timePressure')}
                  </span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    -{Math.floor(elapsed * difficulty.timeDecayRate)}pts
                  </span>
                </div>
                <div className="w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface)' }}>
                  <div
                    className="h-full transition-all duration-100"
                    style={{
                      width: `${countdownProgress * 100}%`,
                      backgroundColor: countdownProgress > 0.7 ? 'var(--color-error)' : countdownProgress > 0.4 ? '#EAB308' : 'var(--color-neon)',
                    }}
                  />
                </div>
              </div>
            )}

            {}
            <div className="relative">
              {gameMode === 'ticking_away' && (
                <svg className="absolute -inset-2" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--color-border)" strokeWidth="2" />
                  <circle
                    cx="50" cy="50" r="45" fill="none"
                    stroke={countdownProgress > 0.7 ? 'var(--color-error)' : 'var(--color-neon)'}
                    strokeWidth="2"
                    strokeDasharray="283"
                    strokeDashoffset={283 - (283 * countdownProgress)}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.1s linear' }}
                  />
                </svg>
              )}
              <button
                onClick={handlePlayToggle}
                className="relative w-16 h-16 rounded-full flex items-center justify-center btn-tactile transition-all"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '2px solid var(--color-border)',
                  opacity: phase === 'loading' ? 0.3 : 1,
                }}
              >
                {phase === 'loading' || !isLoaded ? (
                  <Loader2 className="h-7 w-7 animate-spin" style={{ color: 'var(--color-neon)' }} />
                ) : isPlaying ? (
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="var(--color-neon)">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg className="h-7 w-7 ml-0.5" viewBox="0 0 24 24" fill="var(--color-neon)">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </div>

            {}
            <div className="w-full relative">
              <input
                ref={inputRef}
                type="text"
                defaultValue={guessQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => {
                    setGuessQuery(val);
                    setShowDropdown(val.length > 0);
                  }, 120);
                }}
                onFocus={() => guessQuery.length > 0 && setShowDropdown(true)}
                placeholder={guessMode === 'artist' ? t('game.typeArtist') : t('game.typeGuess')}
                disabled={phase !== 'playing'}
                className="w-full px-4 py-3 text-sm font-body rounded-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />

              {}
              {showDropdown && filteredItems.length > 0 && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 z-50 max-h-56 overflow-y-auto rounded-sm"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {guessMode === 'artist' ? (

                    filteredItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleGuessItem(item)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors btn-tactile"
                        style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hl)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div
                          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
                          style={{ backgroundColor: 'var(--color-surface-hl)' }}
                        >
                          <span className="text-sm">🎤</span>
                        </div>
                        <p className="text-sm font-body truncate" style={{ color: 'var(--color-text)' }}>
                          {item.artistName}
                        </p>
                      </button>
                    ))
                  ) : (

                    filteredItems.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleGuess(t)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors btn-tactile"
                        style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hl)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        {(albumArtMap[t.id] || t.album_image) ? (
                          <img
                            src={albumArtMap[t.id] || t.album_image}
                            alt=""
                            className="w-8 h-8 rounded-sm object-cover flex-shrink-0"
                            style={{ border: '1px solid var(--color-border-subtle)' }}
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center"
                            style={{ backgroundColor: 'var(--color-surface-hl)' }}
                          >
                            <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>♪</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-body truncate" style={{ color: 'var(--color-text)' }}>
                            {t.name}
                          </p>
                          <p className="text-xs font-mono truncate" style={{ color: 'var(--color-text-dim)' }}>
                            {t.artist}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {}
            {isHoverDevice.current && !hasGuessed && (
              <div className="font-mono text-[9px] flex gap-3" style={{ color: 'var(--color-text-dim)' }}>
                <span>{t('game.kbPlay')}</span>
                <span>{t('game.kbGuess')}</span>
                <span>{t('game.kbClear')}</span>
              </div>
            )}

            {}
            <button
              onClick={handleSkip}
              disabled={phase !== 'playing'}
              className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 btn-tactile transition-colors"
              style={{ color: 'var(--color-text-dim)' }}
            >
              {t('game.skip')} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
