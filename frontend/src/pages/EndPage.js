import { useState, useEffect, useRef, useCallback } from 'react';
import { RotateCcw, ListMusic, Link2, MessageSquare, Swords, Trophy, UserPlus, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { DIFFICULTY_MODES, DEFAULT_DIFFICULTY, GAME_MODES } from '@/lib/difficulty';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

const WEBAPP_URL = process.env.REACT_APP_WEBAPP_URL || window.location.origin;

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  return new Promise((resolve, reject) => {
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) resolve(); else reject(new Error('execCommand copy failed'));
  });
}

export function classifyResult(r) {
  const stage = r.clipStage ?? r.clip_stage ?? 0;
  if (r.correct && stage === 0) return 'green';
  if (r.correct) return 'yellow';
  return 'red';
}

export function buildEmojiGrid(trackResults) {
  return trackResults.map((r) => {
    const c = classifyResult(r);
    if (c === 'green') return '🟩';
    if (c === 'yellow') return '🟨';
    return '🟥';
  }).join('');
}

function MissedTracksSection({ trackResults }) {
  const [open, setOpen] = useState(false);

  const missed = trackResults.filter((r) => classifyResult(r) !== 'green');
  if (missed.length === 0) return null;

  const yellowCount = missed.filter((r) => classifyResult(r) === 'yellow').length;
  const redCount    = missed.filter((r) => classifyResult(r) === 'red').length;

  return (
    <div className="w-full rounded-sm overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      {}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors btn-tactile"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          {open
            ? <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
            : <ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
          }
          <span className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-secondary)' }}>
            Missed Tracks
          </span>
        </div>
        <div className="flex items-center gap-2">
          {yellowCount > 0 && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: '#EAB308' }}>
              🟨 {yellowCount}
            </span>
          )}
          {redCount > 0 && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
              🟥 {redCount}
            </span>
          )}
        </div>
      </button>

      {}
      {open && (
        <div className="divide-y" style={{ borderTop: '1px solid var(--color-border)', borderColor: 'var(--color-border)' }}>
          {missed.map((r, i) => {
            const tier = classifyResult(r);
            const tid  = r.track?.id || r.track?.track_id;
            const accentColor = tier === 'yellow' ? '#EAB308' : '#EF4444';
            const bgColor     = tier === 'yellow' ? 'rgba(234,179,8,0.06)' : 'rgba(239,68,68,0.06)';
            const stage       = r.clipStage ?? r.clip_stage ?? 0;

            return (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3"
                style={{ backgroundColor: bgColor }}
              >
                {}
                <div className="shrink-0 w-1.5 h-8 rounded-full" style={{ backgroundColor: accentColor, opacity: 0.7 }} />

                {}
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[12px] truncate" style={{ color: 'var(--color-text)' }}>
                    {r.track?.name || '—'}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="font-mono text-[10px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {r.track?.artist || ''}
                    </p>
                    {tier === 'yellow' && (
                      <span className="font-mono text-[9px] px-1 py-px rounded-sm shrink-0" style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: '#EAB308' }}>
                        clip {stage + 1}
                      </span>
                    )}
                  </div>
                </div>

                {}
                {tid && (
                  <a
                    href={`https://open.spotify.com/track/${tid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full transition-all btn-tactile"
                    style={{ backgroundColor: 'rgba(29,185,84,0.12)', border: '1px solid rgba(29,185,84,0.2)' }}
                    title="Open in Spotify"
                  >
                    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="#1DB954">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    <span className="font-mono text-[9px]" style={{ color: '#1DB954' }}>Play</span>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function loadHtml2Canvas() {
  if (window.html2canvas) return window.html2canvas;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('html2canvas load failed'));
    document.head.appendChild(s);
  });
}

export default function EndPage({ results, playlistData, onReplay, onNewPlaylist, onSignup, onNavigate }) {
  const { user, isAuthenticated, isGuest } = useAuth();
  const { t } = useLanguage();
  const [shareId, setShareId]               = useState(null);
  const [shareCreating, setShareCreating]   = useState(false);
  const [isPersonalBest, setIsPersonalBest] = useState(false);
  const [copiedLink, setCopiedLink]         = useState(false);
  const [copiedText, setCopiedText]         = useState(false);
  const [fallbackUrl, setFallbackUrl]       = useState(null);
  const [savingCard, setSavingCard]         = useState(false);
  const shareCreatedRef = useRef(false);
  const cardRef = useRef(null);

  const {
    score, correctGuesses, totalTracks, playlistName, playlistId, playlistImage,
    maxScore, difficulty: difficultyKey, gameMode = 'classic', guessMode = 'song', isDaily,
  } = results;

  const difficulty  = DIFFICULTY_MODES[difficultyKey] || DIFFICULTY_MODES[DEFAULT_DIFFICULTY];
  const percentage  = Math.round((correctGuesses / totalTracks) * 100);
  const trackResults = results.results || [];
  const emojiGrid   = buildEmojiGrid(trackResults);

  useEffect(() => {
    if (shareCreatedRef.current) return;
    shareCreatedRef.current = true;
    createShare();
    checkPersonalBest();

  }, []);

  useEffect(() => {
    if (!fallbackUrl) return;
    const dismiss = () => setFallbackUrl(null);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [fallbackUrl]);

  const createShare = async () => {
    setShareCreating(true);
    try {
      const shareResults = trackResults.map((r) => ({
        correct: r.correct,
        clip_stage: r.clipStage,
        points: r.points,
        track: r.track ? { id: r.track.id || r.track.track_id, name: r.track.name, artist: r.track.artist } : null,
      }));
      const res = await api.post('/share', {
        username: user?.username || 'Guest',
        score, max_score: maxScore, correct_guesses: correctGuesses,
        total_tracks: totalTracks, playlist_id: playlistId || '',
        playlist_name: playlistName,
        playlist_image: playlistData?.image || playlistImage || '',
        difficulty: difficultyKey || 'normal',
        game_mode: gameMode, guess_mode: guessMode, is_daily: isDaily || false,
        results: shareResults, timestamp: new Date().toISOString(),
      });
      setShareId(res.data.share_id);
    } catch (err) { console.warn('Share creation failed:', err); }
    finally { setShareCreating(false); }
  };

  const checkPersonalBest = async () => {
    if (!isAuthenticated || isGuest || !playlistId) return;
    try {
      const res = await api.get('/scores/my-scores?limit=500');
      const sessions = {};
      res.data
        .filter((s) => s.playlist_id === playlistId)
        .forEach((s) => {
          const day = s.guessed_at ? s.guessed_at.split('T')[0] : 'unknown';
          const key = `${s.playlist_id}_${day}`;
          sessions[key] = (sessions[key] || 0) + s.final_score;
        });
      const pastSessionTotals = Object.values(sessions);
      if (pastSessionTotals.length > 0 && score > Math.max(...pastSessionTotals)) {
        setIsPersonalBest(true);
      }
    } catch {}
  };

  const shareLink     = shareId ? `${WEBAPP_URL}/s/${shareId}` : null;
  const challengeLink = shareId ? `${WEBAPP_URL}/challenge/${shareId}` : null;

  const handleCopyLink = () => {
    if (!shareLink) return;
    copyToClipboard(shareLink).then(() => {
      setCopiedLink(true); toast.success(t('common.copied')); setTimeout(() => setCopiedLink(false), 2000);
    }).catch(() => { setFallbackUrl(shareLink); setTimeout(() => setFallbackUrl(null), 10000); });
  };

  const generateShareText = () =>
    t('end.shareText', { score, max: maxScore, playlist: playlistName, difficulty: difficulty.label, tracks: totalTracks, link: shareLink || '' });

  const handleCopyText = () => {
    copyToClipboard(generateShareText()).then(() => {
      setCopiedText(true); toast.success(t('common.copied')); setTimeout(() => setCopiedText(false), 2000);
    }).catch(() => { setFallbackUrl(generateShareText()); setTimeout(() => setFallbackUrl(null), 10000); });
  };

  const handleChallenge = () => {
    if (!challengeLink) return;
    copyToClipboard(challengeLink).then(() => {
      toast.success(t('room.challengeLinkCopied'));
    }).catch(() => { setFallbackUrl(challengeLink); setTimeout(() => setFallbackUrl(null), 10000); });
  };

  const handleSaveCard = useCallback(async () => {
    if (!cardRef.current || savingCard) return;
    setSavingCard(true);
    try {
      const h2c = await loadHtml2Canvas();
      const canvas = await h2c(cardRef.current, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        scale: 2,           // retina-quality
        logging: false,
      });
      const link = document.createElement('a');
      const safePlaylist = (playlistName || 'audyn').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      link.download = `audyn-${safePlaylist}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('Card saved!');
    } catch (err) {
      console.error('Save card failed:', err);
      toast.error('Could not save image — try a screenshot instead');
    } finally {
      setSavingCard(false);
    }
  }, [savingCard, playlistName]);

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">

        {}
        {isPersonalBest && (
          <div className="text-center py-3 rounded-sm animate-neon-flash"
            style={{ backgroundColor: 'var(--color-neon-subtle)', border: '1px solid var(--color-neon)' }}>
            <p className="font-heading text-sm font-bold" style={{ color: 'var(--color-neon)' }}>{t('end.newPersonalBest')}</p>
          </div>
        )}

        {}
        <div className="animate-card-enter">
          <ResultCard
            cardRef={cardRef}
            score={score} maxScore={maxScore} correctGuesses={correctGuesses}
            totalTracks={totalTracks} percentage={percentage} playlistName={playlistName}
            playlistImage={playlistData?.image || playlistImage}
            difficulty={difficulty} difficultyKey={difficultyKey}
            gameMode={gameMode} guessMode={guessMode}
            isDaily={isDaily} emojiGrid={emojiGrid}
            username={user?.username || 'Guest'} displayName={user?.display_name || ''}
            trackResults={trackResults}
          />
        </div>

        {}
        <MissedTracksSection trackResults={trackResults} />

        {}
        <div className="space-y-2 stagger-children">
          {}
          <button
            onClick={handleSaveCard}
            disabled={savingCard}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile transition-all"
            style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)', opacity: savingCard ? 0.6 : 1 }}
          >
            <Download className="h-4 w-4" />
            {savingCard ? 'Saving…' : 'Save to Device'}
          </button>

          <button onClick={handleCopyLink} disabled={!shareId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', opacity: shareId ? 1 : 0.5 }}>
            <Link2 className="h-4 w-4" />
            {copiedLink ? t('common.copied') : t('end.copyLink')}
          </button>

          <button onClick={handleCopyText} disabled={!shareId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', opacity: shareId ? 1 : 0.5 }}>
            <MessageSquare className="h-4 w-4" />
            {copiedText ? t('common.copied') : t('end.copyShareText')}
          </button>

          <button onClick={handleChallenge} disabled={!shareId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', opacity: shareId ? 1 : 0.5 }}>
            <Swords className="h-4 w-4" />
            {t('end.challengeFriend')}
          </button>
        </div>

        {}
        {fallbackUrl && (
          <div className="relative p-3 rounded-sm animate-slide-in-up"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}>
            <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('end.copyManually')}</p>
            <input type="text" readOnly value={fallbackUrl} autoFocus onFocus={(e) => e.target.select()}
              className="w-full px-3 py-2 text-xs font-mono rounded-sm outline-none"
              style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <button onClick={() => setFallbackUrl(null)} className="absolute top-2 right-2 text-xs btn-tactile" style={{ color: 'var(--color-text-muted)' }}>✕</button>
          </div>
        )}

        {}
        <div className="space-y-2 stagger-children">
          <button onClick={onReplay}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-sm font-heading text-sm font-bold uppercase tracking-wider btn-tactile transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <RotateCcw className="h-4 w-4" />
            {isDaily ? t('common.daily') : t('end.playAgain')}
          </button>
          <button onClick={onNewPlaylist}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-sm font-heading text-sm font-bold uppercase tracking-wider btn-tactile transition-all"
            style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}>
            <ListMusic className="h-4 w-4" />
            {t('end.newPlaylist')}
          </button>
        </div>

        <button onClick={() => onNavigate('leaderboard')}
          className="w-full py-2 font-mono text-[11px] uppercase tracking-wider btn-tactile text-center"
          style={{ color: 'var(--color-text-muted)' }}>
          <Trophy className="h-3 w-3 inline mr-1" />
          {t('end.viewLeaderboard')}
        </button>

        {isGuest && (
          <div className="p-4 rounded-sm text-center space-y-2"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('end.createAccount')}</p>
            <button onClick={onSignup}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-mono text-xs uppercase tracking-wider rounded-sm btn-tactile"
              style={{ border: '1px solid var(--color-neon-dim)', color: 'var(--color-neon)' }}>
              <UserPlus className="h-3 w-3" />
              {t('end.signUp')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultCard({
  cardRef,
  score, maxScore, correctGuesses, totalTracks, percentage,
  playlistName, playlistImage, difficulty, difficultyKey,
  gameMode = 'classic', guessMode = 'song', isDaily,
  emojiGrid, username, displayName, trackResults,
}) {
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const greenCount  = (trackResults || []).filter((r) => classifyResult(r) === 'green').length;
  const yellowCount = (trackResults || []).filter((r) => classifyResult(r) === 'yellow').length;
  const redCount    = (trackResults || []).filter((r) => classifyResult(r) === 'red').length;

  const diffColor = difficulty?.color || '#00ff88';

  const cardBg = '#111118';

  return (
    <div
      ref={cardRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.08)',
        backgroundColor: cardBg,

      }}
    >
      {}
      {playlistImage && (
        <>
          {}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: '-10%',          // overshoot so scaled img fills card
              zIndex: 0,
            }}
          >
            <img
              src={playlistImage}
              alt=""
              crossOrigin="anonymous"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: 0.22,
                display: 'block',

                transform: 'scale(1.1)',
              }}
            />
          </div>
          {}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              background: 'linear-gradient(160deg, rgba(10,10,20,0.72) 0%, rgba(10,10,20,0.88) 100%)',
            }}
          />
        </>
      )}

      {}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          zIndex: 2,

          background: `linear-gradient(90deg, ${diffColor}, ${diffColor}60, transparent)`,
        }}
      />

      {}
      <div style={{ position: 'relative', zIndex: 3, padding: '28px 24px 24px' }}>

        {}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Badge color={diffColor}>{difficulty?.label || difficultyKey}</Badge>
            <Badge color={gameMode === 'ticking_away' ? '#F59E0B' : 'rgba(255,255,255,0.45)'}>
              {gameMode === 'ticking_away' ? '⏱ Ticking' : '🎵 Classic'}
            </Badge>
            {guessMode === 'artist' && <Badge color="#A855F7">🎤 Artist</Badge>}
            {isDaily && <Badge color="#EAB308">📅 Daily</Badge>}
          </div>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)', flexShrink: 0, marginTop: 2 }}>
            {date}
          </span>
        </div>

        {}
        <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
          <p
            className="font-heading neon-glow"
            style={{
              fontSize: 80,           // fixed px — html2canvas handles px reliably
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: '-0.02em',
              color: diffColor,
              margin: 0,
            }}
          >
            {score}
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
            out of {maxScore} points
          </p>
        </div>

        {}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '10px 0' }}>
          <StatPill label="Correct"  value={`${correctGuesses}/${totalTracks}`} highlight={false} neonColor={diffColor} />
          <StatPill label="Accuracy" value={`${percentage}%`}                   highlight={percentage === 100} neonColor={diffColor} />
        </div>

        {}
        {emojiGrid && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <p style={{ textAlign: 'center', fontSize: 18, lineHeight: 1.6, letterSpacing: 2, margin: 0 }}>
              {emojiGrid}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 4 }}>
              {greenCount  > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>🟩 1st Try</span>}
              {yellowCount > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>🟨 Nice Try</span>}
              {redCount    > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>🟥 Try Again</span>}
            </div>
          </div>
        )}

        {}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 16, marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {}
          {playlistImage ? (
            <img
              src={playlistImage}
              alt=""
              crossOrigin="anonymous"
              style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}
            />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
              🎵
            </div>
          )}

          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontFamily: 'sans-serif', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.75)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {playlistName}
            </p>
            {username && username !== 'Guest' && (
              
              <span style={{ display: 'block', fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                {displayName || `@${username}`}
                {displayName && <span style={{ color: 'rgba(255,255,255,0.2)' }}> · @{username}</span>}
              </span>
            )}
          </div>

          {}
          <span
            className="font-heading"
            style={{ flexShrink: 0, fontWeight: 800, letterSpacing: '0.35em', textTransform: 'uppercase', fontSize: 10, color: diffColor, opacity: 0.6 }}
          >
            AUDYN
          </span>
        </div>
      </div>
    </div>
  );
}

function Badge({ color, children }) {
  return (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.18em',
        padding: '2px 8px',
        borderRadius: 4,
        color,

        border: `1px solid ${color}55`,
        backgroundColor: `${color}18`,
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}

function StatPill({ label, value, highlight, neonColor }) {

  const bgColor     = highlight ? 'rgba(0,255,136,0.12)'  : 'rgba(255,255,255,0.05)';
  const borderColor = highlight ? 'rgba(0,255,136,0.28)'  : 'rgba(255,255,255,0.08)';
  const textColor   = highlight ? (neonColor || '#00ff88') : 'rgba(255,255,255,0.85)';

  return (
    <div
      style={{
        textAlign: 'center',
        padding: '8px 16px',
        borderRadius: 10,
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        minWidth: 76,
      }}
    >
      <p style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: textColor, lineHeight: 1.2, margin: 0 }}>
        {value}
      </p>
      <p style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', marginTop: 3, marginBottom: 0 }}>
        {label}
      </p>
    </div>
  );
}
