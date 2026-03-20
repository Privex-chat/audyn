import { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, ExternalLink, Award, Play, Copy } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

const WEBAPP_URL = process.env.REACT_APP_WEBAPP_URL || window.location.origin;
const DISPLAY_HOST = new URL(WEBAPP_URL).host;

export default function PublicProfilePage({ username, onBack, onNavigate }) {
  const { t } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!username) return;

    setLoading(true);

    api.get(`/auth/profile/${username}`)
      .then((res) => {
        const p = res.data;
        setProfile(p);

        const displayName = p.display_name || p.username;

        document.title = `${displayName} on Audyn`;

        setMetaTag('og:title', `${displayName} on Audyn`);
        setMetaTag(
          'og:description',
          `Rank #${p.global_rank || '—'} • ${p.total_score} pts`
        );
      })
      .catch((err) => {
        setError(err.response?.data?.detail || 'User not found');
      })
      .finally(() => setLoading(false));
  }, [username]);

  const setMetaTag = (property, content) => {
    let tag =
      document.querySelector(`meta[property="${property}"]`) ||
      document.querySelector(`meta[name="${property}"]`);

    if (!tag) {
      tag = document.createElement('meta');

      if (property.startsWith('og:')) {
        tag.setAttribute('property', property);
      } else {
        tag.setAttribute('name', property);
      }

      document.head.appendChild(tag);
    }

    tag.setAttribute('content', content);
  };

  const copyProfile = () => {
    const url = `${WEBAPP_URL}/${profile.username}`;

    navigator.clipboard.writeText(url)
      .then(() => toast.success(t('profile.profileLinkCopied')))
      .catch(() => toast.error(t('common.error')));
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-48px)] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-neon)' }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center px-4">
        <div
          className="w-full max-w-sm p-8 text-center rounded-sm space-y-4"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p className="font-heading text-lg font-bold" style={{ color: 'var(--color-text)' }}>
            {t('publicProfile.userNotFound')}
          </p>

          <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {error || t('publicProfile.userNotExist')}
          </p>

          <button
            onClick={onBack}
            className="px-6 py-2.5 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile"
            style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}
          >
            {t('common.playAudyn')}
          </button>
        </div>
      </div>
    );
  }

  const displayName = profile.display_name || profile.username;

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md space-y-6">

        {}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 btn-tactile"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <h1 className="font-heading text-xl font-extrabold" style={{ color: 'var(--color-text)' }}>
            {t('profile.title')}
          </h1>
        </div>

        {}
        <div className="flex flex-col items-center text-center space-y-3">

          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-24 h-24 rounded-full object-cover"
              style={{ border: '3px solid var(--color-neon)' }}
            />
          ) : (
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '3px solid var(--color-border)',
              }}
            >
              <span
                className="font-heading text-3xl font-bold"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {profile.username?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
          )}

          <div className="space-y-1">
            <h2 className="font-heading text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
              {displayName}
            </h2>

            <p className="font-mono text-xs" style={{ color: 'var(--color-text-dim)' }}>
              @{profile.username}
            </p>
          </div>

          {}
          {profile.bio && (
            <p
              className="font-body text-base leading-relaxed max-w-xs"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {profile.bio}
            </p>
          )}

          {}
          <div className="flex items-center gap-2 mt-1">

            <a
              href={`${WEBAPP_URL}/${profile.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs underline-offset-2 hover:underline"
              style={{ color: 'var(--color-neon)' }}
            >
              {DISPLAY_HOST}/{profile.username}
            </a>

            <button
              onClick={copyProfile}
              className="p-1 btn-tactile"
              title="Copy link"
            >
              <Copy className="h-3 w-3" />
            </button>

          </div>

        </div>

        {}
        <div className="grid grid-cols-3 gap-2">

          {[
            { label: 'Rank', value: profile.global_rank ? `#${profile.global_rank}` : '—' },
            { label: 'Score', value: profile.total_score?.toLocaleString() || '0' },
            { label: 'Tracks', value: profile.tracks_guessed || '0' },
          ].map((s) => (
            <div
              key={s.label}
              className="p-3 text-center rounded-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <p
                className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--color-text-dim)' }}
              >
                {s.label}
              </p>

              <p
                className="font-heading text-lg font-bold mt-1"
                style={{ color: 'var(--color-neon)' }}
              >
                {s.value}
              </p>
            </div>
          ))}

        </div>

        {}
        {[profile.link_spotify, profile.link_instagram, profile.link_pinterest].some(Boolean) && (
          <div className="flex justify-center gap-3 flex-wrap">

            {profile.link_spotify && (
              <a
                href={profile.link_spotify}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] flex items-center gap-1 btn-tactile"
                style={{ color: 'var(--color-neon)' }}
              >
                <ExternalLink className="h-3 w-3" />
                Spotify
              </a>
            )}

            {profile.link_instagram && (
              <a
                href={profile.link_instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] flex items-center gap-1 btn-tactile"
                style={{ color: 'var(--color-magenta)' }}
              >
                <ExternalLink className="h-3 w-3" />
                Instagram
              </a>
            )}

            {profile.link_pinterest && (
              <a
                href={profile.link_pinterest}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] flex items-center gap-1 btn-tactile"
                style={{ color: 'var(--color-error)' }}
              >
                <ExternalLink className="h-3 w-3" />
                Pinterest
              </a>
            )}

          </div>
        )}

        {}
        {profile.badges && profile.badges.length > 0 && (
          <div className="space-y-3">

            <div className="flex items-center gap-2">
              <Award className="h-4 w-4" style={{ color: 'var(--color-neon)' }} />
              <h3 className="font-heading text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                {t('profile.achievements')}
                </h3>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {profile.badges.map((badge) => (
                <div
                  key={badge.key}
                  className="p-3 rounded-sm text-center"
                  style={{
                    backgroundColor: 'var(--color-neon-subtle)',
                    border: '1px solid var(--color-neon)30',
                  }}
                  title={badge.label}
                >
                  <span className="text-2xl">{badge.emoji}</span>

                  <p
                    className="font-mono text-[8px] uppercase tracking-wider mt-1 truncate"
                    style={{ color: 'var(--color-neon)' }}
                  >
                    {badge.label}
                  </p>
                </div>
              ))}
            </div>

          </div>
        )}

        {}
        <button
          onClick={() => {
            window.history.pushState({}, '', '/');
            onNavigate('home');
          }}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-sm font-heading text-sm font-bold uppercase tracking-wider btn-tactile"
          style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)' }}
        >
          <Play className="h-4 w-4" />
          {t('common.playAudyn')}
        </button>

      </div>
    </div>
  );
}
