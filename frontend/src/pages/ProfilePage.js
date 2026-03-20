import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Camera, Loader2, ExternalLink, LogOut, Award } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

const extractInstagramUsername = (url) => {
  if (!url) return '';
  const m = url.match(/instagram\.com\/([A-Za-z0-9_][A-Za-z0-9_.]{0,28}[A-Za-z0-9_]?)(?:\/.*)?$/);
  return m ? m[1] : '';
};

const extractPinterestUsername = (url) => {
  if (!url) return '';
  const m = url.match(/pinterest\.com\/([A-Za-z0-9_.]+?)(?:\/.*)?$/);
  return m ? m[1] : '';
};

const IG_USERNAME_RE = /^(?!.*\.\.)(?!.*\.$)[A-Za-z0-9_.]{1,30}$/;

const PT_USERNAME_RE = /^[A-Za-z0-9_.]{3,30}$/;

const SPOTIFY_URL_RE = /^https:\/\/open\.spotify\.com\/user\/[A-Za-z0-9]+$/;

const WEBAPP_URL = process.env.REACT_APP_WEBAPP_URL || window.location.origin;
const DISPLAY_HOST = new URL(WEBAPP_URL).host;

export default function ProfilePage({ onBack, onNavigate }) {
  const { user, isAuthenticated, logout, refreshProfile } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [badges, setBadges] = useState([]);
  const [scoreHistory, setScoreHistory] = useState([]);
  const [dailyStreak, setDailyStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [linkSpotify, setLinkSpotify] = useState('');
  const [linkInstagram, setLinkInstagram] = useState('');
  const [linkPinterest, setLinkPinterest] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      api.get('/auth/me'),
      api.get(`/leaderboard/user/${user.id}`).catch(() => ({ data: null })),
      api.get('/achievements/my').catch(() => ({ data: [] })),
      api.get('/scores/my-scores?limit=50').catch(() => ({ data: [] })),
    ])
      .then(([profileRes, statsRes, badgesRes, scoresRes]) => {
        const p = profileRes.data;
        setProfile(p);
        setBio(p.bio || '');
        setDisplayName(p.display_name || '');
        setLinkSpotify(p.link_spotify || '');

        setLinkInstagram(extractInstagramUsername(p.link_instagram));
        setLinkPinterest(extractPinterestUsername(p.link_pinterest));
        if (statsRes.data) setStats(statsRes.data);

        api.get('/daily/today')
          .then((streakRes) => setDailyStreak(streakRes.data?.user_streak || 0))
          .catch(() => {});
        setBadges(badgesRes.data || []);

        const scores = scoresRes.data || [];
        const chartData = scores
          .slice(0, 30)
          .reverse()
          .map((s, i) => ({ idx: i, score: s.final_score }));
        setScoreHistory(chartData);
      })
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false));
  }, [isAuthenticated, user, t]);

  const handleSaveProfile = async () => {

    const spotifyVal = linkSpotify.trim();
    if (spotifyVal && !SPOTIFY_URL_RE.test(spotifyVal)) {
      toast.error('Spotify link must be: https://open.spotify.com/user/your_id');
      return;
    }

    const igUser = linkInstagram.trim();
    if (igUser && !IG_USERNAME_RE.test(igUser)) {
      toast.error('Invalid Instagram username (1–30 chars, letters/digits/._)');
      return;
    }

    const ptUser = linkPinterest.trim();
    if (ptUser && !PT_USERNAME_RE.test(ptUser)) {
      toast.error('Invalid Pinterest username (3–30 chars, letters/digits/._)');
      return;
    }

    setSaving(true);
    try {
      await api.put('/auth/profile', {
        bio,
        display_name: displayName.trim(),
        link_spotify: spotifyVal,
        link_instagram: igUser ? `https://www.instagram.com/${igUser}/` : '',
        link_pinterest: ptUser ? `https://pinterest.com/${ptUser}/` : '',
      });
      await refreshProfile();
      setEditing(false);
      toast.success(t('profile.profileUpdated'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error(t('profile.onlyJpgPngWebp'));
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/auth/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await refreshProfile();
      toast.success(t('profile.avatarUpdated'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = () => {
    logout();
    onBack();
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-[calc(100vh-48px)] flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="font-heading text-lg" style={{ color: 'var(--color-text)' }}>
            {t('profile.signInToView')}
          </p>
          <button
            onClick={onBack}
            className="px-6 py-2 rounded-sm font-mono text-xs uppercase btn-tactile"
            style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-48px)] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-neon)' }} />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md space-y-6">
        {}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1 btn-tactile" style={{ color: 'var(--color-text-muted)' }}>
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="font-heading text-xl font-extrabold" style={{ color: 'var(--color-text)' }}>
              {t('profile.title')}
              </h1>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 btn-tactile"
            style={{ color: 'var(--color-text-muted)' }}
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {}
        <div className="flex flex-col items-center gap-3">
          <div className="relative group">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="w-20 h-20 rounded-full object-cover"
                style={{ border: '3px solid var(--color-neon)' }}
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--color-surface)', border: '3px solid var(--color-border)' }}
              >
                <span className="font-heading text-2xl font-bold" style={{ color: 'var(--color-text-muted)' }}>
                  {profile?.username?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              ) : (
                <Camera className="h-5 w-5 text-white" />
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
          <div className="text-center">
            <h2 className="font-heading text-xl font-bold" style={{ color: 'var(--color-text)' }}>
              {profile?.display_name || profile?.username}
            </h2>
            <p className="font-mono text-xs mt-0.5" style={{ color: 'var(--color-text-dim)' }}>@{profile?.username}</p>
          </div>
          {}
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-[10px] truncate" style={{ color: 'var(--color-text-muted)' }}>
              {DISPLAY_HOST}/{profile?.username}
            </span>
            <button
              onClick={() => {
                const url = `${DISPLAY_HOST}/${profile?.username}`;
                navigator.clipboard?.writeText(url)
                  .then(() => toast.success('Profile link copied!'))
                  .catch(() => toast.error('Could not copy link'));
              }}
              className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm btn-tactile"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-neon)' }}
            >
              Copy
            </button>
          </div>
        </div>

        {}
        {stats && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Rank', value: stats.global_rank ? `#${stats.global_rank}` : '—' },
              { label: 'Score', value: stats.total_score?.toLocaleString() || '0' },
              { label: 'Tracks', value: stats.tracks_guessed || '0' },
              { label: '🔥 Streak', value: dailyStreak || '0' },
            ].map((s) => (
              <div
                key={s.label}
                className="p-3 text-center rounded-sm"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)' }}
              >
                <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                  {s.label}
                </p>
                <p className="font-heading text-lg font-bold mt-1" style={{ color: 'var(--color-neon)' }}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {}
        {scoreHistory.length > 2 && (
          <div
            className="p-3 rounded-sm"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)' }}
          >
            <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-dim)' }}>
              {t('profile.recentScores')}
            </p>
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scoreHistory}>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '2px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text)',
                    }}
                    formatter={(value) => [value, 'Score']}
                    labelFormatter={() => ''}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="var(--color-neon)"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, fill: 'var(--color-neon)' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4" style={{ color: 'var(--color-neon)' }} />
            <h3 className="font-heading text-sm font-bold" style={{ color: 'var(--color-text)' }}>
              {t('profile.achievements')}
            </h3>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {badges.map((badge) => (
              <div
                key={badge.key}
                className="relative p-3 rounded-sm text-center transition-all"
                style={{
                  backgroundColor: badge.earned ? 'var(--color-neon-subtle)' : 'var(--color-surface)',
                  border: `1px solid ${badge.earned ? 'var(--color-neon)' + '30' : 'var(--color-border-subtle)'}`,
                  opacity: badge.earned ? 1 : 0.4,
                }}
                title={`${badge.label}: ${badge.description}`}
              >
                <span className="text-2xl">{badge.emoji}</span>
                <p className="font-mono text-[8px] uppercase tracking-wider mt-1 truncate"
                  style={{ color: badge.earned ? 'var(--color-neon)' : 'var(--color-text-dim)' }}>
                  {badge.label}
                </p>
                {badge.earned && (
                  <div
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                    style={{ backgroundColor: 'var(--color-neon)', boxShadow: '0 0 6px var(--color-neon-glow)' }}
                  />
                )}
              </div>
            ))}
          </div>

          {badges.length === 0 && (
            <p className="text-center py-4 font-body text-sm" style={{ color: 'var(--color-text-dim)' }}>
              {t('profile.playToEarn')}
            </p>
          )}
        </div>

        {}
        {editing ? (
          <div className="space-y-3">
            {}
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('profile.displayName')}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 50))}
                placeholder={t('profile.displayNamePlaceholder')}
                className="w-full px-3 py-2 text-sm rounded-sm outline-none"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
              <p className="font-mono text-[9px]" style={{ color: 'var(--color-text-dim)' }}>
                {displayName.length}/50 — Leave blank to show your username
              </p>
            </div>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Write a short bio..."
              maxLength={160}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-sm outline-none resize-none"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
            {}
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('profile.spotify')}
              </label>
              <input
                type="text"
                value={linkSpotify}
                onChange={(e) => setLinkSpotify(e.target.value)}
                placeholder={t('profile.spotifyPlaceholder')}
                className="w-full px-3 py-2 text-sm rounded-sm outline-none"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: `1px solid ${
                    linkSpotify.trim() && !SPOTIFY_URL_RE.test(linkSpotify.trim())
                      ? 'var(--color-error)'
                      : 'var(--color-border)'
                  }`,
                  color: 'var(--color-text)',
                }}
              />
              {linkSpotify.trim() && !SPOTIFY_URL_RE.test(linkSpotify.trim()) && (
                <p className="font-mono text-[10px]" style={{ color: 'var(--color-error)' }}>
                  Must start with https://open.spotify.com/user/
                </p>
              )}
            </div>

            {}
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('profile.instagram')}
              </label>
              <div
                className="flex items-center rounded-sm overflow-hidden"
                style={{ border: `1px solid ${linkInstagram.trim() && !IG_USERNAME_RE.test(linkInstagram.trim()) ? 'var(--color-error)' : 'var(--color-border)'}` }}
              >
                <span
                  className="px-3 py-2 font-mono text-sm shrink-0 select-none"
                  style={{ backgroundColor: 'var(--color-surface-raised, var(--color-surface))', color: 'var(--color-text-dim)', borderRight: '1px solid var(--color-border-subtle)' }}
                >
                  instagram.com/
                </span>
                <input
                  type="text"
                  value={linkInstagram}
                  onChange={(e) => setLinkInstagram(e.target.value.replace(/[^A-Za-z0-9_.]/g, '').slice(0, 30))}
                  placeholder="username"
                  className="flex-1 px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                />
                <span
                  className="px-2 py-2 font-mono text-sm shrink-0 select-none"
                  style={{ backgroundColor: 'var(--color-surface-raised, var(--color-surface))', color: 'var(--color-text-dim)', borderLeft: '1px solid var(--color-border-subtle)' }}
                >
                  /
                </span>
              </div>
              {linkInstagram.trim() && !IG_USERNAME_RE.test(linkInstagram.trim()) && (
                <p className="font-mono text-[10px]" style={{ color: 'var(--color-error)' }}>
                  Letters, digits, underscores and periods only (1–30 chars)
                </p>
              )}
            </div>

            {}
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('profile.pinterest')}
              </label>
              <div
                className="flex items-center rounded-sm overflow-hidden"
                style={{ border: `1px solid ${linkPinterest.trim() && !PT_USERNAME_RE.test(linkPinterest.trim()) ? 'var(--color-error)' : 'var(--color-border)'}` }}
              >
                <span
                  className="px-3 py-2 font-mono text-sm shrink-0 select-none"
                  style={{ backgroundColor: 'var(--color-surface-raised, var(--color-surface))', color: 'var(--color-text-dim)', borderRight: '1px solid var(--color-border-subtle)' }}
                >
                  pinterest.com/
                </span>
                <input
                  type="text"
                  value={linkPinterest}
                  onChange={(e) => setLinkPinterest(e.target.value.replace(/[^A-Za-z0-9_.]/g, '').slice(0, 30))}
                  placeholder="username"
                  className="flex-1 px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                />
                <span
                  className="px-2 py-2 font-mono text-sm shrink-0 select-none"
                  style={{ backgroundColor: 'var(--color-surface-raised, var(--color-surface))', color: 'var(--color-text-dim)', borderLeft: '1px solid var(--color-border-subtle)' }}
                >
                  /
                </span>
              </div>
              {linkPinterest.trim() && !PT_USERNAME_RE.test(linkPinterest.trim()) && (
                <p className="font-mono text-[10px]" style={{ color: 'var(--color-error)' }}>
                  Letters, digits, underscores and periods only (3–30 chars)
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="flex-1 py-2 rounded-sm font-mono text-xs uppercase btn-tactile"
                style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-2 rounded-sm font-mono text-xs uppercase btn-tactile"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {profile?.bio && (
              <p className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {profile.bio}
              </p>
            )}
            {[profile?.link_spotify, profile?.link_instagram, profile?.link_pinterest].some(Boolean) && (
              <div className="flex gap-3 flex-wrap">
                {profile.link_spotify && (
                  <a href={profile.link_spotify} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[11px] flex items-center gap-1 btn-tactile"
                    style={{ color: 'var(--color-neon)' }}>
                    <ExternalLink className="h-3 w-3" /> Spotify
                  </a>
                )}
                {profile.link_instagram && (
                  <a href={profile.link_instagram} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[11px] flex items-center gap-1 btn-tactile"
                    style={{ color: 'var(--color-magenta)' }}>
                    <ExternalLink className="h-3 w-3" /> Instagram
                  </a>
                )}
                {profile.link_pinterest && (
                  <a href={profile.link_pinterest} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[11px] flex items-center gap-1 btn-tactile"
                    style={{ color: 'var(--color-error)' }}>
                    <ExternalLink className="h-3 w-3" /> Pinterest
                  </a>
                )}
              </div>
            )}
            <button
              onClick={() => setEditing(true)}
              className="font-mono text-[11px] uppercase tracking-wider py-1 btn-tactile"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {t('profile.editProfile')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
