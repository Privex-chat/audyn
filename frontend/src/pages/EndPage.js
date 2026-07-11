import { useState, useEffect, useRef, useCallback } from 'react';
import { RotateCcw, ListMusic, Link2, MessageSquare, Swords, Trophy, UserPlus, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { DIFFICULTY_MODES, DEFAULT_DIFFICULTY, GAME_MODES } from '@/lib/difficulty';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { drawResultCard } from '@/lib/resultCard';

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
    const canvas = cardRef.current;
    if (!canvas || savingCard) return;
    setSavingCard(true);
    try {
      const safePlaylist = (playlistName || 'audyn').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      // Save the exact canvas that's on screen — preview and download are one
      // and the same image.
      await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `audyn-${safePlaylist}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          resolve();
        }, 'image/png');
      });
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

// Canvas-rendered result card: the on-screen preview and the saved PNG are the
// SAME canvas, so they can't diverge (the old DOM + html2canvas path dropped
// text-shadows, clipped the bg image, mis-rendered emoji, and failed offline).
export function ResultCard({
  cardRef,
  score, maxScore, correctGuesses, totalTracks, percentage,
  playlistName, playlistImage, difficulty, difficultyKey,
  gameMode = 'classic', guessMode = 'song', isDaily,
  emojiGrid, username, displayName, trackResults,
}) {
  const internalRef = useRef(null);
  const ref = cardRef || internalRef;

  const greenCount  = (trackResults || []).filter((r) => classifyResult(r) === 'green').length;
  const yellowCount = (trackResults || []).filter((r) => classifyResult(r) === 'yellow').length;
  const redCount    = (trackResults || []).filter((r) => classifyResult(r) === 'red').length;
  const diffColor   = difficulty?.color || '#00ff88';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    drawResultCard(canvas, {
      score, maxScore, correctGuesses, totalTracks, percentage,
      playlistName, playlistImage,
      diffColor, difficultyLabel: difficulty?.label || difficultyKey,
      gameMode, guessMode, isDaily,
      emojiGrid, greenCount, yellowCount, redCount,
      username, displayName, date,
    }).catch(() => {});
  }, [ref, score, maxScore, correctGuesses, totalTracks, percentage, playlistName,
      playlistImage, diffColor, difficulty, difficultyKey, gameMode, guessMode, isDaily,
      emojiGrid, greenCount, yellowCount, redCount, username, displayName]);

  return (
    <canvas
      ref={ref}
      aria-label={`Audyn score: ${score} out of ${maxScore}`}
      style={{ width: '100%', maxWidth: 440, height: 'auto', display: 'block', margin: '0 auto', borderRadius: 16 }}
    />
  );
}
