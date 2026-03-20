import { useState, useEffect } from 'react';
import { Loader2, Play, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { DIFFICULTY_MODES, DEFAULT_DIFFICULTY } from '@/lib/difficulty';
import { ResultCard, classifyResult, buildEmojiGrid } from '@/pages/EndPage';
import { useLanguage } from '@/context/LanguageContext';

function MissedTracksSection({ trackResults }) {
  const [open, setOpen] = useState(false);

  const missed = trackResults.filter((r) => classifyResult(r) !== 'green');
  if (missed.length === 0) return null;

  const yellowCount = missed.filter((r) => classifyResult(r) === 'yellow').length;
  const redCount    = missed.filter((r) => classifyResult(r) === 'red').length;

  return (
    <div className="w-full rounded-sm overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
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

      {open && (
        <div className="divide-y" style={{ borderTop: '1px solid var(--color-border)', borderColor: 'var(--color-border)' }}>
          {missed.map((r, i) => {
            const tier        = classifyResult(r);
            const tid         = r.track?.id || r.track?.track_id;
            const accentColor = tier === 'yellow' ? '#EAB308' : '#EF4444';
            const bgColor     = tier === 'yellow' ? 'rgba(234,179,8,0.06)' : 'rgba(239,68,68,0.06)';
            const stage       = r.clip_stage ?? r.clipStage ?? 0;

            return (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3"
                style={{ backgroundColor: bgColor }}
              >
                <div className="shrink-0 w-1.5 h-8 rounded-full" style={{ backgroundColor: accentColor, opacity: 0.7 }} />

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

export default function SharePage({ shareId, onNavigate }) {
  const { t } = useLanguage();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!shareId) return;
    api.get(`/share/${shareId}`)
      .then((res) => {
        setData(res.data);
        const d = res.data;
        document.title = `${d.username} scored ${d.score}/${d.max_score} on ${d.playlist_name} — Audyn`;
        setMetaTag('og:title', `${d.username} scored ${d.score}/${d.max_score} on Audyn`);
        setMetaTag('og:description', `${d.correct_guesses}/${d.total_tracks} correct on "${d.playlist_name}" (${d.difficulty})`);
        setMetaTag('og:type', 'website');
        setMetaTag('og:image', d.playlist_image || '');
        setMetaTag('twitter:card', 'summary');
        setMetaTag('twitter:title', `Audyn — ${d.score}/${d.max_score}`);
        setMetaTag('twitter:description', `Can you beat ${d.username}? Try "${d.playlist_name}" on Audyn.`);
      })
      .catch((err) => { setError(err.response?.data?.detail || t('share.shareExpired')); })
      .finally(() => setLoading(false));
  }, [shareId, t]);

  const setMetaTag = (property, content) => {
    let tag = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
    if (!tag) {
      tag = document.createElement('meta');
      if (property.startsWith('og:')) tag.setAttribute('property', property);
      else tag.setAttribute('name', property);
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', content);
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-48px)] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--color-neon)' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm p-8 text-center rounded-sm space-y-4"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="font-heading text-lg font-bold" style={{ color: 'var(--color-text)' }}>{t('share.shareNotFound')}</p>
          <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>{error || t('share.shareExpired')}</p>
          <button
            onClick={() => { window.history.pushState({}, '', '/'); onNavigate('home'); }}
            className="px-6 py-2.5 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile"
            style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}>
            {t('common.playAudyn')}
          </button>
        </div>
      </div>
    );
  }

  const difficulty  = DIFFICULTY_MODES[data.difficulty] || DIFFICULTY_MODES[DEFAULT_DIFFICULTY];
  const percentage  = Math.round((data.correct_guesses / data.total_tracks) * 100);
  const emojiGrid   = buildEmojiGrid(data.results || []);
  const trackResults = data.results || [];

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">

        {}
        <div className="text-center space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--color-text-dim)' }}>{t('end.scoreCard')}</p>
          {data.username && (
            <a
              href={`https://audyn.xyz/${data.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-heading text-sm font-bold hover:underline"
              style={{ color: 'var(--color-neon)' }}
            >
              @{data.username}
            </a>
          )}
        </div>

        {}
        <div className="animate-card-enter">
          <ResultCard
            score={data.score} maxScore={data.max_score}
            correctGuesses={data.correct_guesses} totalTracks={data.total_tracks}
            percentage={percentage} playlistName={data.playlist_name}
            playlistImage={data.playlist_image} difficulty={difficulty}
            difficultyKey={data.difficulty} gameMode={data.game_mode || 'classic'}
            guessMode={data.guess_mode || 'song'} isDaily={data.is_daily}
            emojiGrid={emojiGrid} username={data.username}
            trackResults={trackResults}
          />
        </div>

        {}
        <MissedTracksSection trackResults={trackResults} />

        {}
        <div className="space-y-3">
          {data.playlist_id && (
            <button
              onClick={() => { window.history.pushState({}, '', '/'); onNavigate('home', { playlistId: data.playlist_id }); }}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-sm font-heading text-sm font-bold uppercase tracking-wider btn-tactile transition-all"
              style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}>
              <Play className="h-5 w-5" />
              {t('share.playThisPlaylist')}
            </button>
          )}
          <button
            onClick={() => { window.history.pushState({}, '', '/'); onNavigate('home'); }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <ExternalLink className="h-3 w-3" />
            {t('share.goToAudyn')}
          </button>
        </div>

      </div>
    </div>
  );
}
