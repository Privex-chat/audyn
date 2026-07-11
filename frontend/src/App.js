import { useState, useEffect, useCallback } from 'react';
import '@/App.css';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemeProvider, useThemeMode } from '@/context/ThemeContext';
import { LanguageProvider } from '@/context/LanguageContext';
import api from '@/lib/api';

import NavBar from '@/components/NavBar';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ErrorBoundary from '@/components/ErrorBoundary';
import HomePage from '@/pages/HomePage';
import GamePage from '@/pages/GamePage';
import EndPage from '@/pages/EndPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import LeaderboardPage from '@/pages/LeaderboardPage';
import DailyChallengePage from '@/pages/DailyChallengePage';
import ProfilePage from '@/pages/ProfilePage';
import SharePage from '@/pages/SharePage';
import PublicProfilePage from '@/pages/PublicProfilePage';
import RoomPage from '@/pages/RoomPage';

function AppContent() {
  const { user, isAuthenticated, isGuest, loading: authLoading } = useAuth();
  const { theme } = useThemeMode();

  const [phase, setPhase] = useState('home');
  const [playlistData, setPlaylistData] = useState(null);
  const [gameSettings, setGameSettings] = useState({ songCount: 10, difficulty: 'normal', gameMode: 'classic', guessMode: 'song' });
  const [gameResults, setGameResults] = useState(null);
  const [gameKey, setGameKey] = useState(0);
  const [isDailyGame, setIsDailyGame] = useState(false);
  const [dailyPlaylistId, setDailyPlaylistId] = useState(null);
  const [guestConvert, setGuestConvert] = useState(false);
  const [dailyUnplayed, setDailyUnplayed] = useState(false);
  const [shareId, setShareId] = useState(null);
  const [challengeData, setChallengeData] = useState(null);
  const [phaseTransition, setPhaseTransition] = useState(false);
  const [pendingPlaylistId, setPendingPlaylistId] = useState(null);
  const [profileUsername, setProfileUsername] = useState(null);
  const [roomData, setRoomData] = useState(null);

  const resolvePathToPhase = useCallback((path) => {
    const shareMatch = path.match(/^\/s\/([a-z0-9_-]+)$/i);
    const challengeMatch = path.match(/^\/challenge\/([a-z0-9_-]+)$/i);
    const roomMatch = path.match(/^\/room\/([A-Z0-9]{6})$/i);
    const usernameMatch = path.match(/^\/([a-zA-Z0-9_]{3,30})$/);
    if (shareMatch) {
      setShareId(shareMatch[1]);
      return 'share';
    } else if (challengeMatch) {
      setChallengeData({ shareId: challengeMatch[1] });
      return 'home';
    } else if (roomMatch) {
      setRoomData({ code: roomMatch[1].toUpperCase(), mode: 'join' });
      return 'room';
    } else if (usernameMatch) {
      setProfileUsername(usernameMatch[1]);
      return 'profile-public';
    }
    return 'home';
  }, []);

  useEffect(() => {
    const resolved = resolvePathToPhase(window.location.pathname);
    if (resolved !== 'home') setPhase(resolved);
  }, [resolvePathToPhase]);

  useEffect(() => {
    const handlePopState = () => {
      const resolved = resolvePathToPhase(window.location.pathname);
      setPhase(resolved);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [resolvePathToPhase]);

  useEffect(() => {
    if (!isAuthenticated || isGuest) return;
    api.get('/daily/today')
      .then((res) => {
        setDailyUnplayed(!res.data.already_played);
      })
      .catch(() => {});
  }, [isAuthenticated, isGuest]);

  const navigateTo = useCallback((newPhase) => {
    setPhaseTransition(true);
    setTimeout(() => {
      setPhase(newPhase);
      setPhaseTransition(false);
    }, 150);
  }, []);

  const handleStart = (data, settings) => {
    setPlaylistData(data);
    setGameSettings(settings);
    setIsDailyGame(false);
    setDailyPlaylistId(data.playlist_id || null);
    setGameKey((prev) => prev + 1);
    navigateTo('game');
  };

  const handleStartFromRoom = (roomPlaylistData, roomSettings) => {
    setPlaylistData(roomPlaylistData);
    setGameSettings(roomSettings);
    setIsDailyGame(false);
    setDailyPlaylistId(roomPlaylistData.playlist_id || null);
    setGameKey((prev) => prev + 1);
  };

  const handleStartDaily = (challenge) => {
    setPlaylistData({
      name: `Daily Challenge — ${challenge.date}`,
      tracks: challenge.tracks,
      playlist_id: challenge.playlist_id,
    });
    setGameSettings({ songCount: challenge.track_count, difficulty: 'normal', gameMode: 'classic', guessMode: 'song' });
    setIsDailyGame(true);
    setDailyPlaylistId(challenge.playlist_id);
    setGameKey((prev) => prev + 1);
    navigateTo('game');
  };

  const handleEnd = (results) => {
    setGameResults({ ...results, isDaily: isDailyGame, dailyPlaylistId });
    navigateTo('end');
  };

  const handleReplay = () => {
    if (isDailyGame) {
      navigateTo('daily');
      return;
    }
    setGameResults(null);
    setGameKey((prev) => prev + 1);
    navigateTo('game');
  };

  const handleNewPlaylist = () => {
    setPlaylistData(null);
    setGameResults(null);
    setIsDailyGame(false);
    setDailyPlaylistId(null);
    navigateTo('home');
  };

  const goHome = () => {
    window.history.pushState({}, '', '/');
    navigateTo('home');
  };

  const handleSignupFromEnd = () => {
    setGuestConvert(true);
    navigateTo('register');
  };

  const handleNavigate = useCallback((target, payload) => {
    if (target === 'home') {
      window.history.pushState({}, '', '/');
      navigateTo('home');
      if (payload?.playlistId) {
        setPendingPlaylistId(payload.playlistId);
      }
    } else if (target === 'room') {
      setRoomData(payload || null);
      navigateTo('room');
    } else if (target === 'profile-public' && payload?.username) {
      window.history.pushState({}, '', `/${payload.username}`);
      setProfileUsername(payload.username);
      navigateTo('profile-public');
    } else {
      navigateTo(target);
    }

  }, [navigateTo]);

  const showNav = !['game', 'room'].includes(phase);

  if (authLoading) {
    return (
      <div className="noise-bg min-h-screen flex items-center justify-center">
        <div className="font-mono text-xs uppercase tracking-[0.3em] animate-pulse"
          style={{ color: 'var(--color-text-muted)' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`noise-bg min-h-screen ${theme === 'crt' ? 'crt-flicker' : ''}`}>
      {showNav && (
        <NavBar
          onNavigate={handleNavigate}
          currentPhase={phase}
          dailyUnplayed={dailyUnplayed}
        />
      )}

      <div
        className="transition-opacity duration-150"
        style={{ opacity: phaseTransition ? 0 : 1 }}
      >
        {phase === 'home' && (
          <div className="phase-enter">
            <HomePage
              onStart={handleStart}
              onNavigate={handleNavigate}
              challengeData={challengeData}
              onClearChallenge={() => setChallengeData(null)}
              pendingPlaylistId={pendingPlaylistId}
              onClearPendingPlaylist={() => setPendingPlaylistId(null)}
            />
          </div>
        )}

        {phase === 'game' && playlistData && (
          <div className="phase-enter">
            <GamePage
              key={gameKey}
              tracks={playlistData.tracks}
              playlistName={playlistData.name}
              playlistId={dailyPlaylistId || playlistData.playlist_id || ''}
              songCount={gameSettings.songCount}
              difficulty={gameSettings.difficulty}
              gameMode={gameSettings.gameMode || 'classic'}
              guessMode={gameSettings.guessMode || 'song'}
              isDaily={isDailyGame}
              onEnd={handleEnd}
              onBack={handleNewPlaylist}
            />
          </div>
        )}

        {phase === 'end' && gameResults && (
          <div className="phase-enter">
            <EndPage
              results={gameResults}
              playlistData={playlistData}
              onReplay={handleReplay}
              onNewPlaylist={handleNewPlaylist}
              onSignup={handleSignupFromEnd}
              onNavigate={handleNavigate}
            />
          </div>
        )}

        {phase === 'share' && shareId && (
          <div className="phase-enter">
            <SharePage shareId={shareId} onNavigate={handleNavigate} />
          </div>
        )}

        {phase === 'login' && (
          <div className="phase-enter">
            <LoginPage
              onBack={goHome}
              onSwitchToRegister={() => navigateTo('register')}
            />
          </div>
        )}

        {phase === 'register' && (
          <div className="phase-enter">
            <RegisterPage
              onBack={goHome}
              onSwitchToLogin={() => navigateTo('login')}
              guestConvert={guestConvert}
            />
          </div>
        )}

        {phase === 'leaderboard' && (
          <div className="phase-enter">
            <LeaderboardPage onBack={goHome} onNavigate={handleNavigate} />
          </div>
        )}

        {phase === 'daily' && (
          <div className="phase-enter">
            <DailyChallengePage onBack={goHome} onStartDaily={handleStartDaily} />
          </div>
        )}

        {phase === 'profile' && (
          <div className="phase-enter">
            <ProfilePage onBack={goHome} onNavigate={handleNavigate} />
          </div>
        )}

        {phase === 'room' && (
          <div className="phase-enter">
            <RoomPage
              roomData={roomData}
              onNavigate={handleNavigate}
              onBack={goHome}
            />
          </div>
        )}

        {phase === 'profile-public' && profileUsername && (
          <div className="phase-enter">
            <PublicProfilePage
              username={profileUsername}
              onBack={goHome}
              onNavigate={handleNavigate}
            />
          </div>
        )}
      </div>

      {}
      {showNav && <LanguageSwitcher />}

      {}
      {phase === 'home' && (
        <a
          href="https://github.com/Privex-chat/audyn"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source code on GitHub"
          style={{
            position: 'fixed',
            bottom: '1rem',
            left: '1rem',
            zIndex: 50,
            opacity: 0.7,
            transition: 'opacity 0.2s ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'inherit',
            textDecoration: 'none',
            fontSize: '0.75rem',
            fontFamily: "'Inter', sans-serif",
            letterSpacing: '0.02em',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Open Source on GitHub
        </a>
      )}

      <Toaster
        theme={theme === 'light' ? 'light' : 'dark'}
        position="top-center"
        toastOptions={{
          style: {
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontFamily: 'var(--font-body)',
          },
        }}
      />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <ErrorBoundary>
            <AppContent />
          </ErrorBoundary>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
