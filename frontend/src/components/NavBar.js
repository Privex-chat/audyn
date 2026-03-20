import { Calendar, Trophy, User, LogIn, Sun, Moon, Monitor } from 'lucide-react';
import { useThemeMode } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import logo from '@/assets/logo_medium_nobg.svg';
const themeIcons = {
  noir: <Moon className="h-3 w-3" />,
  light: <Sun className="h-3 w-3" />,
  crt: <Monitor className="h-3 w-3" />,
};

const themeLabels = { noir: 'Noir', light: 'Light', crt: 'CRT' };

export default function NavBar({ onNavigate, currentPhase, dailyUnplayed = false }) {
  const { theme, setTheme, themes } = useThemeMode();
  const { user, isAuthenticated, isGuest } = useAuth();
  const { t } = useLanguage();

  return (
    <nav
      className="sticky top-0 z-50 w-full border-b backdrop-blur-md transition-colors duration-300"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-bg) 85%, transparent)',
        borderColor: 'var(--color-border-subtle)',
      }}
    >
      <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between">
        {}
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2 font-heading text-lg font-extrabold tracking-wider btn-tactile"
          style={{ color: 'var(--color-neon)' }}
        >
          <img src={logo} alt="" className="h-6 w-auto" />
          AUDYN
        </button>

        <div className="flex items-center gap-0.5">
          {}
          <div
            className="flex items-center rounded-full p-0.5 mr-1"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            {themes.map((t2) => (
              <button
                key={t2}
                onClick={() => setTheme(t2)}
                className="relative p-1.5 rounded-full transition-all duration-200 btn-tactile"
                style={{
                  backgroundColor: theme === t2 ? 'var(--color-neon-subtle)' : 'transparent',
                  color: theme === t2 ? 'var(--color-neon)' : 'var(--color-text-muted)',
                }}
                title={themeLabels[t2]}
              >
                {themeIcons[t2]}
              </button>
            ))}
          </div>

          {}
          <button
            onClick={() => onNavigate('daily')}
            className="relative p-2 transition-colors btn-tactile"
            style={{ color: currentPhase === 'daily' ? 'var(--color-neon)' : 'var(--color-text-muted)' }}
            title={t('nav.dailyChallenge')}
          >
            <Calendar className="h-4 w-4" />
            {dailyUnplayed && (
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full animate-pulse-dot"
                style={{ backgroundColor: '#EAB308' }}
              />
            )}
          </button>

          {}
          <button
            onClick={() => onNavigate('leaderboard')}
            className="p-2 transition-colors btn-tactile"
            style={{ color: currentPhase === 'leaderboard' ? 'var(--color-neon)' : 'var(--color-text-muted)' }}
            title={t('nav.leaderboard')}
          >
            <Trophy className="h-4 w-4" />
          </button>

          {}
          {isAuthenticated ? (
            <button
              onClick={() => onNavigate('profile')}
              className="p-1.5 transition-colors btn-tactile"
              title={t('nav.profile')}
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover"
                  style={{ border: '2px solid var(--color-border)' }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-neon)',
                    border: '2px solid var(--color-border)',
                  }}
                >
                  {user?.username?.[0]?.toUpperCase() || '?'}
                </div>
              )}
            </button>
          ) : (
            <button
              onClick={() => onNavigate('login')}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors btn-tactile rounded-sm"
              style={{
                color: 'var(--color-neon)',
                border: '1px solid var(--color-neon-dim)',
              }}
            >
              <LogIn className="h-3 w-3" />
              {t('nav.logIn')}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
