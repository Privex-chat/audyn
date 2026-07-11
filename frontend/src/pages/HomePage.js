import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Music, Play, Zap, Users, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { DIFFICULTY_MODES, DEFAULT_DIFFICULTY, GAME_MODES, DEFAULT_GAME_MODE, GUESS_MODES, DEFAULT_GUESS_MODE } from '@/lib/difficulty';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getFeaturedPlaylists } from '@/lib/featuredPlaylists';

const DEMO_PLAYLIST = '37i9dQZF1DXcBWIGoYBM5M';
const RECENT_KEY = 'audyn_recent_playlists';

export default function HomePage({
  onStart,
  onNavigate,
  challengeData,
  onClearChallenge,
  pendingPlaylistId,
  onClearPendingPlaylist,
}) {
  const { user, isAuthenticated, isGuest } = useAuth();
  const { t, language } = useLanguage();

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [playlistInfo, setPlaylistInfo] = useState(null);
  const [songCount, setSongCount] = useState('10');
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY);
  const [gameMode, setGameMode] = useState(DEFAULT_GAME_MODE);
  const [guessMode, setGuessMode] = useState(DEFAULT_GUESS_MODE);
  const [playlistLoaded, setPlaylistLoaded] = useState(false);
  const [recentPlaylists, setRecentPlaylists] = useState([]);
  const [playersToday, setPlayersToday] = useState(null);
  const [challengeBanner, setChallengeBanner] = useState(null);
  const [featuredData, setFeaturedData] = useState([]);
  const [fillStatus, setFillStatus] = useState(null); // { playable, total, pending } while previews load
  const [showAnnouncement, setShowAnnouncement] = useState(() => !localStorage.getItem('audyn_announcement_dismissed'));

  useEffect(() => {
    const fetchPlayers = () =>
      api.get('/stats/activity')
        .then((res) => setPlayersToday(res.data.players_today))
        .catch(() => {});
    fetchPlayers();
    const interval = setInterval(fetchPlayers, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isAuthenticated && !isGuest) {
      api.get('/stats/recent-playlists')
        .then((res) => setRecentPlaylists(res.data || []))
        .catch(() => {});
    } else {
      try {
        const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        if (stored.length > 0) {
          const ids = stored.map((p) => p.playlist_id).join(',');
          api.get(`/stats/recent-playlists?ids=${ids}`)
            .then((res) => {
              if (res.data?.length > 0) setRecentPlaylists(res.data);
              else setRecentPlaylists(stored);
            })
            .catch(() => setRecentPlaylists(stored));
        }
      } catch {}
    }
  }, [isAuthenticated, isGuest]);

  useEffect(() => {
    const featured = getFeaturedPlaylists(language);
    const ids = featured.map((p) => p.id).join(',');
    api.get(`/stats/recent-playlists?ids=${ids}`)
      .then((res) => {

        const apiMap = {};
        (res.data || []).forEach((p) => { apiMap[p.playlist_id] = p; });
        const merged = featured.map((f) => ({
          playlist_id: f.id,
          name: apiMap[f.id]?.name || f.fallbackName,
          image_url: apiMap[f.id]?.image_url || f.fallbackImage || '',
          total_tracks: apiMap[f.id]?.total_tracks || 0,
        }));
        setFeaturedData(merged);
      })
      .catch(() => {

        setFeaturedData(featured.map((f) => ({
          playlist_id: f.id,
          name: f.fallbackName,
          image_url: f.fallbackImage || '',
          total_tracks: 0,
        })));
      });
  }, [language]);

  useEffect(() => {
    if (challengeData?.shareId) {
      api.get(`/share/${challengeData.shareId}`)
        .then((res) => {
          const d = res.data;
          setChallengeBanner({
            username: d.username,
            score: d.score,
            playlistId: d.playlist_id,
            playlistName: d.playlist_name,
          });
          if (d.playlist_id) {
            setUrl(`https://open.spotify.com/playlist/${d.playlist_id}`);
            if (d.difficulty) setDifficulty(d.difficulty);
          }
        })
        .catch(() => {})
        .finally(() => onClearChallenge?.());
    }
  }, [challengeData, onClearChallenge]);

  useEffect(() => {
    if (pendingPlaylistId) {
      const playlistUrl = `https://open.spotify.com/playlist/${pendingPlaylistId}`;
      setUrl(playlistUrl);
      handleLoad(playlistUrl);
      if (onClearPendingPlaylist) onClearPendingPlaylist();
    }

  }, [pendingPlaylistId]);

  const saveToRecent = (info) => {
    try {
      const entry = {
        playlist_id: info.playlist_id,
        name: info.name,
        image_url: info.image || '',
        total_tracks: info.total_tracks,
      };
      const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      const filtered = stored.filter((p) => p.playlist_id !== entry.playlist_id);
      const updated = [entry, ...filtered].slice(0, 5);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    } catch {}
  };

  const handleLoad = async (playlistUrl) => {
    const target = playlistUrl || url.trim();
    if (!target) {
      toast.error(t('home.loadPlaylist'));
      return;
    }
    setLoading(true);
    setPlaylistLoaded(false);
    setFillStatus(null);
    try {
      const resp = await api.get(`/playlist/${encodeURIComponent(target)}`);
      setPlaylistInfo(resp.data);
      saveToRecent(resp.data);
      setTimeout(() => setPlaylistLoaded(true), 100);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to load playlist';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // While a big playlist's previews scrape in the background, poll the
  // lightweight status endpoint so the playable count climbs live, then
  // re-fetch the full track list once it settles. Keyed on playlist_id so it
  // runs once per loaded playlist.
  useEffect(() => {
    const pid = playlistInfo?.playlist_id;
    const total = playlistInfo?.total_in_playlist || 0;
    const playable = playlistInfo?.total_tracks || 0;
    if (!pid || total === 0 || playlistInfo?.fetch_complete === true || playable >= total) {
      setFillStatus(null);
      return;
    }

    let cancelled = false;
    let timer = null;
    let lastPlayable = playable;
    let stable = 0;

    const refreshFull = async () => {
      try {
        const res = await api.get(`/playlist/${pid}`);
        if (!cancelled) setPlaylistInfo((prev) => (prev && prev.playlist_id === pid ? res.data : prev));
      } catch { /* keep what we have */ }
      if (!cancelled) setFillStatus(null);
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/playlist-status/${pid}`);
        const d = res.data;
        if (d.exists && !cancelled) {
          setFillStatus({ playable: d.playable, total: d.total, pending: d.pending });
          setPlaylistInfo((prev) => (prev && prev.playlist_id === pid ? { ...prev, total_tracks: d.playable } : prev));
          if (d.playable > lastPlayable) { lastPlayable = d.playable; stable = 0; }
          else { stable += 1; }
          // done: nothing left, or growth stalled for ~12s (the last few tracks
          // may have no preview on Spotify and never resolve)
          if (d.pending === 0 || stable >= 5) { await refreshFull(); return; }
        }
      } catch { /* transient; keep polling */ }
      if (!cancelled) timer = setTimeout(tick, 2500);
    };

    timer = setTimeout(tick, 2500);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [playlistInfo?.playlist_id]); // eslint-disable-line

  const handleDemo = () => {
    setUrl(`https://open.spotify.com/playlist/${DEMO_PLAYLIST}`);
    handleLoad(`https://open.spotify.com/playlist/${DEMO_PLAYLIST}`);
  };

  const handleRecentClick = (p) => {
    const playlistUrl = `https://open.spotify.com/playlist/${p.playlist_id}`;
    setUrl(playlistUrl);
    handleLoad(playlistUrl);
  };

  // If previews are still filling, grab the freshest full track list before
  // starting so the game uses everything available right now, not the initial
  // ~96. Returns the info to start with.
  const freshestPlaylist = async () => {
    if (!fillStatus || !playlistInfo?.playlist_id) return playlistInfo;
    try {
      const res = await api.get(`/playlist/${playlistInfo.playlist_id}`);
      setPlaylistInfo(res.data);
      return res.data;
    } catch {
      return playlistInfo;
    }
  };

  const handleStart = async () => {
    if (!playlistInfo) return;
    const info = await freshestPlaylist();
    const count = songCount === 'all' ? info.total_tracks : parseInt(songCount);
    onStart(info, { songCount: count, difficulty, gameMode, guessMode });
  };

  const handleChallengeRoom = async () => {
    if (!playlistInfo) return;
    const info = await freshestPlaylist();
    const count = songCount === 'all' ? info.total_tracks : parseInt(songCount);
    onNavigate('room', {
      playlistData: info,
      settings: { songCount: count, difficulty, gameMode, guessMode, playlistId: info.playlist_id },
      mode: 'create',
    });
  };

  const diffModes = [
    { key: 'easy', label: t('home.easy'), desc: t('home.easyDesc'), color: '#22C55E' },
    { key: 'normal', label: t('home.normal'), desc: t('home.normalDesc'), color: '#EAB308' },
    { key: 'hard', label: t('home.hard'), desc: t('home.hardDesc'), color: '#EF4444' },
  ];
  const gameModes = [
    { key: 'classic', label: t('home.classic'), desc: t('home.classicDesc'), icon: '🎵' },
    { key: 'ticking_away', label: t('home.tickingAway'), desc: t('home.tickingAwayDesc'), icon: '⏱️' },
  ];
  const guessModes = [
    { key: 'song', label: t('home.songTitle'), desc: t('home.songTitleDesc'), icon: '🎵' },
    { key: 'artist', label: t('home.artist'), desc: t('home.artistDesc'), icon: '🎤' },
  ];

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md space-y-6">

        {}
        {!playlistInfo && (
          <div className="text-center pt-6 pb-2 space-y-3 animate-slide-in-down">
            <h2
              className="font-heading text-3xl font-extrabold tracking-tight neon-glow"
              style={{ color: 'var(--color-neon)' }}
            >
              {t('home.title')}
            </h2>
            <p className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('home.subtitle')}
            </p>
            {playersToday > 0 && (
              <div className="flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-success)' }} />
                <span className="font-mono text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('home.playersToday', { count: playersToday, s: playersToday !== 1 ? 's' : '' })}
                </span>
              </div>
            )}
          </div>
        )}

        {}
        {challengeBanner && (
          <div
            className="p-3 rounded-sm text-center animate-slide-in-down"
            style={{
              backgroundColor: 'var(--color-neon-subtle)',
              border: '1px solid var(--color-neon-dim)',
            }}
          >
            <p className="font-mono text-xs font-bold" style={{ color: 'var(--color-neon)' }}>
              {t('home.beatScore', { username: challengeBanner.username, score: challengeBanner.score })}
            </p>
            <p className="font-body text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {challengeBanner.playlistName}
            </p>
          </div>
        )}

        {showAnnouncement && (
          <div
            className="px-3 py-2 rounded-sm animate-slide-in-down flex items-center justify-between gap-2"
            style={{
              backgroundColor: 'var(--color-surface-hl)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <div className="flex items-center gap-2 text-left flex-1">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('home.announcement.title').replace('🎉 ', '')}
              </span>
              <p className="font-body text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('home.announcement.message')}
              </p>
            </div>
            <button
              onClick={() => {
                setShowAnnouncement(false);
                localStorage.setItem('audyn_announcement_dismissed', 'true');
              }}
              className="flex-shrink-0 p-0.5 rounded transition-colors btn-tactile"
              style={{
                color: 'var(--color-text-dim)',
                backgroundColor: 'transparent',
                border: 'none',
              }}
              aria-label="Dismiss announcement"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {}
        {!playlistInfo && (
          <div className="space-y-3 animate-slide-in-up">
            <div className="relative">
              <input
                data-testid="playlist-url-input"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
                placeholder={t('home.playlistInput')}
                className="w-full px-4 py-3.5 text-sm font-mono rounded-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
              <Music className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-dim)' }} />
            </div>

            <Button
              data-testid="load-btn"
              onClick={() => handleLoad()}
              disabled={loading}
              className="w-full h-12 font-bold text-sm uppercase tracking-wider rounded-sm btn-tactile transition-all"
              style={{
                backgroundColor: 'var(--color-neon)',
                color: 'var(--color-bg)',
              }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('home.loadPlaylist')}
            </Button>

            {}
            <button
              onClick={handleDemo}
              disabled={loading}
              className="w-full py-2.5 text-xs font-mono uppercase tracking-wider transition-all btn-tactile rounded-sm"
              style={{
                border: '1px dashed var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              <Zap className="h-3 w-3 inline mr-1.5" style={{ color: 'var(--color-neon)' }} />
              {t('home.tryDemo')}
            </button>

            {}
            {featuredData.length > 0 && (
              <div className="space-y-2 pt-3">
                <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                  {t('home.featuredPlaylists')}
                </p>
                <div className="space-y-1.5">
                  {featuredData.map((p) => (
                    <button
                      key={p.playlist_id}
                      onClick={() => handleRecentClick(p)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-left transition-all btn-tactile"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        border: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      <div
                        className="w-10 h-10 rounded-sm overflow-hidden flex-shrink-0"
                        style={{ border: '1px solid var(--color-border-subtle)' }}
                      >
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface-hl)' }}>
                            <Music className="h-4 w-4" style={{ color: 'var(--color-text-dim)' }} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-body truncate" style={{ color: 'var(--color-text)' }}>
                          {p.name}
                        </p>
                        {p.total_tracks > 0 && (
                          <p className="text-[10px] font-mono" style={{ color: 'var(--color-text-dim)' }}>
                            {p.total_tracks} {t('common.tracks')}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--color-text-dim)' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {}
            {recentPlaylists.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                  {t('home.recentlyPlayed')}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {recentPlaylists.map((p) => (
                    <button
                      key={p.playlist_id}
                      onClick={() => handleRecentClick(p)}
                      className="flex-shrink-0 w-16 text-center group btn-tactile"
                    >
                      <div
                        className="w-16 h-16 rounded-sm overflow-hidden mb-1 transition-all group-hover:shadow-neon"
                        style={{ border: '1px solid var(--color-border-subtle)' }}
                      >
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface)' }}>
                            <Music className="h-5 w-5" style={{ color: 'var(--color-text-dim)' }} />
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] font-mono truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {p.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {}
        {playlistInfo && (
          <div className={`space-y-5 ${playlistLoaded ? 'animate-card-enter' : 'opacity-0'}`}>
            {}
            <div
              className="p-4 rounded-sm transition-shadow"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: playlistLoaded ? `0 0 30px var(--color-neon-glow)` : 'none',
              }}
            >
              <div className="flex items-center gap-4">
                {playlistInfo.image && (
                  <img
                    src={playlistInfo.image}
                    alt=""
                    className="w-16 h-16 rounded-sm object-cover"
                    style={{ border: '1px solid var(--color-border-subtle)' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-heading text-base font-bold truncate" style={{ color: 'var(--color-text)' }}>
                    {playlistInfo.name}
                  </p>
                  {fillStatus && fillStatus.pending > 0 ? (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-neon)' }}>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t('home.loadingPreviews')}
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {fillStatus.playable} / {fillStatus.total}
                        </span>
                      </div>
                      <div className="w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface-hl)' }}>
                        <div
                          className="h-full transition-all duration-700"
                          style={{
                            width: `${Math.round((fillStatus.playable / Math.max(fillStatus.total, 1)) * 100)}%`,
                            backgroundColor: 'var(--color-neon)',
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="font-mono text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {t('home.playableTracks', { count: playlistInfo.total_tracks })}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {}
            <div className="space-y-2">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('home.songs')}
              </label>
              <Select value={songCount} onValueChange={setSongCount}>
                <SelectTrigger
                  className="rounded-sm h-10"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                  }}
                >
                  {[5, 10, 25, 50, 'all'].map((n) => (
                    <SelectItem key={n} value={String(n)} style={{ color: 'var(--color-text)' }}>
                      {n === 'all' ? `All (${playlistInfo.total_tracks})` : `${n} ${t('home.songs').toLowerCase()}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {}
            <div className="space-y-2">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('home.difficulty')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {diffModes.map((mode) => (
                  <button
                    key={mode.key}
                    onClick={() => setDifficulty(mode.key)}
                    className="p-3 rounded-sm text-center transition-all btn-tactile"
                    style={{
                      border: `1px solid ${difficulty === mode.key ? mode.color + '60' : 'var(--color-border)'}`,
                      backgroundColor: difficulty === mode.key ? mode.color + '08' : 'transparent',
                    }}
                  >
                    <p
                      className="font-mono text-xs font-bold uppercase tracking-wider"
                      style={{ color: difficulty === mode.key ? mode.color : 'var(--color-text-muted)' }}
                    >
                      {mode.label}
                    </p>
                    <p className="text-[9px] font-mono mt-1" style={{ color: 'var(--color-text-dim)' }}>
                      {mode.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {}
            <div className="space-y-2">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('home.gameMode')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {gameModes.map((mode) => (
                  <button
                    key={mode.key}
                    onClick={() => setGameMode(mode.key)}
                    className="p-3 rounded-sm text-center transition-all btn-tactile"
                    style={{
                      border: `1px solid ${gameMode === mode.key ? 'var(--color-neon)60' : 'var(--color-border)'}`,
                      backgroundColor: gameMode === mode.key ? 'var(--color-neon-subtle)' : 'transparent',
                    }}
                  >
                    <span className="text-lg">{mode.icon}</span>
                    <p
                      className="font-mono text-xs font-bold uppercase tracking-wider mt-1"
                      style={{ color: gameMode === mode.key ? 'var(--color-neon)' : 'var(--color-text-muted)' }}
                    >
                      {mode.label}
                    </p>
                    <p className="text-[9px] font-mono mt-1" style={{ color: 'var(--color-text-dim)' }}>
                      {mode.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {}
            <div className="space-y-2">
              <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
                {t('home.guessMode')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {guessModes.map((mode) => (
                  <button
                    key={mode.key}
                    onClick={() => setGuessMode(mode.key)}
                    className="p-3 rounded-sm text-center transition-all btn-tactile"
                    style={{
                      border: `1px solid ${guessMode === mode.key ? 'var(--color-neon)60' : 'var(--color-border)'}`,
                      backgroundColor: guessMode === mode.key ? 'var(--color-neon-subtle)' : 'transparent',
                    }}
                  >
                    <span className="text-lg">{mode.icon}</span>
                    <p
                      className="font-mono text-xs font-bold uppercase tracking-wider mt-1"
                      style={{ color: guessMode === mode.key ? 'var(--color-neon)' : 'var(--color-text-muted)' }}
                    >
                      {mode.label}
                    </p>
                    <p className="text-[9px] font-mono mt-1" style={{ color: 'var(--color-text-dim)' }}>
                      {mode.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {}
            <div className="flex items-center gap-2 px-1">
              <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--color-text-dim)' }}>{t('home.clips')}:</span>
              <div className="flex gap-1 flex-wrap">
                {DIFFICULTY_MODES[difficulty].clipDurations.map((d, i) => (
                  <span
                    key={i}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      color: DIFFICULTY_MODES[difficulty].color,
                    }}
                  >
                    {d >= 1 ? `${d}s` : `${(d * 1000).toFixed(0)}ms`}
                  </span>
                ))}
              </div>
            </div>

            {}
            <div className="space-y-2">
              <Button
                data-testid="start-game-btn"
                onClick={handleStart}
                className="w-full h-14 font-bold text-base uppercase tracking-wider rounded-sm btn-tactile transition-all"
                style={{
                  backgroundColor: 'var(--color-neon)',
                  color: 'var(--color-bg)',
                }}
              >
                <Play className="h-5 w-5 mr-2" />
                {t('home.startGame')}
              </Button>
              {playlistInfo && (
                <button
                  onClick={handleChallengeRoom}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile transition-all"
                  style={{
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {t('home.challengeFriend')}
                </button>
              )}
              <button
                onClick={() => { setPlaylistInfo(null); setPlaylistLoaded(false); setUrl(''); }}
                className="w-full py-2 text-xs font-mono uppercase tracking-wider btn-tactile"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('home.changePlaylist')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
