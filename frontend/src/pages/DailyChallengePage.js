import { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function DailyChallengePage({ onBack, onStartDaily }) {
  const { user, isAuthenticated, isGuest } = useAuth();
  const { t } = useLanguage();
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userStreak, setUserStreak] = useState(0);

  useEffect(() => {
    api.get('/daily/today')
      .then((res) => { setChallenge(res.data); setUserStreak(res.data.user_streak || 0); })
      .catch((err) => { setError(err.response?.data?.detail || t('daily.couldNotLoad')); })
      .finally(() => setLoading(false));
  }, [t]);

  const handlePlay = () => {
    if (challenge?.already_played && isAuthenticated && !isGuest) {
      toast.error(t('daily.alreadyPlayedToast'));
      return;
    }
    if (challenge?.tracks?.length > 0) onStartDaily(challenge);
  };

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 btn-tactile" style={{ color: 'var(--color-text-muted)' }}><ArrowLeft className="h-4 w-4" /></button>
          <h1 className="font-heading text-xl font-extrabold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Calendar className="h-5 w-5" style={{ color: 'var(--color-neon)' }} />
            {t('daily.title')}
          </h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-neon)' }} /></div>
        ) : error ? (
          <div className="p-8 text-center space-y-4 rounded-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="text-4xl">🎵</div>
            <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>{error}</p>
            <p className="font-mono text-xs" style={{ color: 'var(--color-text-dim)' }}>{t('daily.needsCache')}</p>
          </div>
        ) : challenge ? (
          <div className="space-y-6 animate-slide-in-up">
            <div className="p-6 text-center rounded-sm space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--color-text-dim)' }}>{t('daily.todaysChallenge')}</p>
              <p className="font-heading text-lg font-bold" style={{ color: 'var(--color-text)' }}>{today}</p>
              <div className="flex justify-center gap-4 pt-2">
                <div className="text-center">
                  <p className="font-heading text-2xl font-bold" style={{ color: 'var(--color-neon)' }}>{challenge.track_count}</p>
                  <p className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('common.songs')}</p>
                </div>
                <div className="text-center">
                  <p className="font-heading text-2xl font-bold" style={{ color: 'var(--color-neon)' }}>{t('home.normal')}</p>
                  <p className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('home.difficulty')}</p>
                </div>
              </div>
              <p className="font-mono text-[10px] pt-2" style={{ color: 'var(--color-text-muted)' }}>{t('daily.classicMode')}</p>
            </div>

            {userStreak > 0 && (
              <div className="py-3 text-center rounded-sm" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <p className="font-mono text-sm font-bold" style={{ color: '#F59E0B' }}>
                  <span className={userStreak >= 7 ? 'inline-block' : ''} style={userStreak >= 7 ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}}>🔥</span>
                  {' '}{userStreak === 1 ? t('daily.firstDay') : t('daily.dayStreak', { count: userStreak })}
                </p>
              </div>
            )}

            {challenge.already_played && isAuthenticated && !isGuest ? (
              <div className="p-4 text-center rounded-sm" style={{ backgroundColor: 'var(--color-neon-subtle)', border: '1px solid var(--color-neon-dim)' }}>
                <p className="font-mono text-xs" style={{ color: 'var(--color-neon)' }}>{t('daily.alreadyPlayed')}</p>
              </div>
            ) : (
              <button onClick={handlePlay} className="w-full h-14 rounded-sm font-bold text-base uppercase tracking-wider btn-tactile transition-all flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}>
                <Play className="h-5 w-5" />
                {t('daily.playToday')}
              </button>
            )}

            {!isAuthenticated && (
              <p className="text-center font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{t('daily.signInToSave')}</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
