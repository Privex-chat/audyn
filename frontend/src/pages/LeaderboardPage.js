import { useState, useEffect } from 'react';
import { ArrowLeft, Trophy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

const MEDAL_COLORS = {
  1: { bg: 'rgba(255,215,0,0.08)', border: 'rgba(255,215,0,0.3)', text: '#FFD700', icon: '🥇' },
  2: { bg: 'rgba(192,192,192,0.06)', border: 'rgba(192,192,192,0.2)', text: '#C0C0C0', icon: '🥈' },
  3: { bg: 'rgba(205,127,50,0.06)', border: 'rgba(205,127,50,0.2)', text: '#CD7F32', icon: '🥉' },
};

export default function LeaderboardPage({ onBack, onNavigate }) {
  const { user, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const [tab, setTab] = useState('global');
  const [period, setPeriod] = useState('all');
  const [lbGameMode, setLbGameMode] = useState('classic');
  const [lbGuessMode, setLbGuessMode] = useState('song');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userRank, setUserRank] = useState(null);

  const periods = [
    { key: 'all', label: t('leaderboard.allTime') },
    { key: 'month', label: t('leaderboard.month') },
    { key: 'week', label: t('leaderboard.week') },
  ];

  useEffect(() => {
    setLoading(true);
    const endpoint = tab === 'daily'
      ? `/leaderboard/daily?game_mode=${lbGameMode}&guess_mode=${lbGuessMode}`
      : `/leaderboard/global?period=${period}&game_mode=${lbGameMode}&guess_mode=${lbGuessMode}`;
    api.get(endpoint)
      .then((res) => setEntries(res.data))
      .catch(() => toast.error('Could not load leaderboard'))
      .finally(() => setLoading(false));
  }, [tab, period, lbGameMode, lbGuessMode]);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      api.get(`/leaderboard/user/${user.id}`)
        .then((res) => setUserRank(res.data))
        .catch(() => {});
    }
  }, [isAuthenticated, user]);

  const isMe = (entry) => user && entry.user_id === user.id;

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md space-y-5 pb-20">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 btn-tactile" style={{ color: 'var(--color-text-muted)' }}><ArrowLeft className="h-4 w-4" /></button>
          <h1 className="font-heading text-xl font-extrabold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Trophy className="h-5 w-5" style={{ color: 'var(--color-neon)' }} />
            {t('leaderboard.title')}
          </h1>
        </div>

        <div className="flex gap-2">
          {['global', 'daily'].map((tt) => (
            <button key={tt} onClick={() => setTab(tt)}
              className="flex-1 py-2.5 font-mono text-xs uppercase tracking-[0.15em] btn-tactile transition-all rounded-sm"
              style={{ border: `1px solid ${tab === tt ? 'var(--color-neon)40' : 'var(--color-border)'}`, color: tab === tt ? 'var(--color-neon)' : 'var(--color-text-muted)', backgroundColor: tab === tt ? 'var(--color-neon-subtle)' : 'transparent' }}>
              {tt === 'global' ? t('leaderboard.global') : t('leaderboard.daily')}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {[{ key: 'classic', label: t('leaderboard.classicMode') }, { key: 'ticking_away', label: t('leaderboard.tickingMode') }].map((m) => (
            <button key={m.key} onClick={() => setLbGameMode(m.key)}
              className="flex-1 py-1.5 font-mono text-[10px] uppercase tracking-wider btn-tactile rounded-sm transition-all"
              style={{ backgroundColor: lbGameMode === m.key ? 'var(--color-surface-hl)' : 'transparent', color: lbGameMode === m.key ? 'var(--color-text)' : 'var(--color-text-dim)', border: `1px solid ${lbGameMode === m.key ? 'var(--color-border)' : 'transparent'}` }}>
              {m.label}
            </button>
          ))}
        </div>
        {lbGameMode === 'ticking_away' && (
          <p className="font-mono text-[9px] text-center" style={{ color: 'var(--color-text-dim)' }}>{t('leaderboard.rankedByTimePressure')}</p>
        )}

        <div className="flex gap-1.5">
          {[{ key: 'song', label: t('leaderboard.songMode') }, { key: 'artist', label: t('leaderboard.artistMode') }].map((m) => (
            <button key={m.key} onClick={() => setLbGuessMode(m.key)}
              className="flex-1 py-1.5 font-mono text-[10px] uppercase tracking-wider btn-tactile rounded-sm transition-all"
              style={{ backgroundColor: lbGuessMode === m.key ? 'var(--color-surface-hl)' : 'transparent', color: lbGuessMode === m.key ? 'var(--color-text)' : 'var(--color-text-dim)', border: `1px solid ${lbGuessMode === m.key ? 'var(--color-border)' : 'transparent'}` }}>
              {m.label}
            </button>
          ))}
        </div>

        {tab === 'global' && (
          <div className="flex gap-1.5">
            {periods.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className="flex-1 py-1.5 font-mono text-[10px] uppercase tracking-wider btn-tactile rounded-sm transition-all"
                style={{ backgroundColor: period === p.key ? 'var(--color-surface-hl)' : 'transparent', color: period === p.key ? 'var(--color-text)' : 'var(--color-text-dim)', border: `1px solid ${period === p.key ? 'var(--color-border)' : 'transparent'}` }}>
                {p.label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-neon)' }} /></div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-heading text-base" style={{ color: 'var(--color-text-muted)' }}>{t('leaderboard.noEntries')}</p>
            <p className="font-body text-sm mt-1" style={{ color: 'var(--color-text-dim)' }}>{t('leaderboard.beFirst')}</p>
          </div>
        ) : (
          <div className="space-y-1.5 stagger-children">
            {entries.map((entry) => {
              const medal = MEDAL_COLORS[entry.rank];
              const me = isMe(entry);
              return (
                <div key={entry.user_id}
                  onClick={() => onNavigate && entry.username && onNavigate('profile-public', { username: entry.username })}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-sm transition-all cursor-pointer"
                  style={{ backgroundColor: medal ? medal.bg : me ? 'var(--color-neon-subtle)' : 'transparent', border: `1px solid ${medal ? medal.border : me ? 'var(--color-neon)30' : 'var(--color-border-subtle)'}` }}>
                  <span className="font-mono text-sm w-8 tabular-nums text-center font-bold" style={{ color: medal ? medal.text : 'var(--color-text-dim)' }}>{medal ? medal.icon : entry.rank}</span>
                  {entry.avatar_url ? (
                    <img src={entry.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" style={{ border: `2px solid ${medal ? medal.border : 'var(--color-border)'}` }} />
                  ) : (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface)', border: '2px solid var(--color-border)' }}>
                      <span className="text-xs font-mono" style={{ color: 'var(--color-text-dim)' }}>{entry.username?.[0]?.toUpperCase() || '?'}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm truncate" style={{ color: me ? 'var(--color-neon)' : 'var(--color-text)' }}>
                      {entry.username} {me && <span style={{ color: 'var(--color-text-dim)' }}>({t('common.you')})</span>}
                    </p>
                    <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{entry.tracks_guessed} {t('common.tracks')}</p>
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums" style={{ color: me ? 'var(--color-neon)' : 'var(--color-text)' }}>{entry.total_score?.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isAuthenticated && userRank && (
        <div className="fixed bottom-0 left-0 right-0 backdrop-blur-md py-3 px-4 z-40" style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg) 90%, transparent)', borderTop: '1px solid var(--color-border)' }}>
          <div className="max-w-md mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold" style={{ color: 'var(--color-neon)' }}>#{userRank.global_rank || '—'}</span>
              <span className="font-body text-sm" style={{ color: 'var(--color-text)' }}>{t('leaderboard.yourRank')}</span>
            </div>
            <span className="font-mono text-sm font-bold" style={{ color: 'var(--color-neon)' }}>{userRank.total_score?.toLocaleString() || 0}</span>
          </div>
        </div>
      )}
    </div>
  );
}
