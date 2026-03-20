import { useRef, useCallback, useState, useEffect } from 'react';
import { Howl } from 'howler';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://api.audyn.com';

function proxyAudioUrl(originalUrl) {
  if (!originalUrl) return originalUrl;

  if (originalUrl.includes('scdn.co') || originalUrl.includes('spotifycdn.com')) {
    return `${BACKEND_URL}/api/audio-proxy?url=${encodeURIComponent(originalUrl)}`;
  }
  return originalUrl;
}

export function useAudio() {
  const soundRef = useRef(null);
  const timeoutRef = useRef(null);
  const startPosRef = useRef(0);
  const clipDurRef = useRef(0);
  const retryRef = useRef(false);
  const originalUrlRef = useRef('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const unmountedRef = useRef(false);

  const _createHowl = useCallback((url, useHtml5) => {
    const sound = new Howl({
      src: [url],

      html5: useHtml5,
      format: ['mp3'],  // Explicit format — proxied/CDN URLs don't always have .mp3 extension
      preload: true,
      onload: () => {
        if (unmountedRef.current) { sound.unload(); return; }
        setIsLoaded(true);
        setLoadError(false);
      },
      onloaderror: (id, err) => {
        console.error(`Audio load error (html5=${useHtml5}):`, err);
        if (unmountedRef.current) { sound.unload(); return; }

        if (!useHtml5 && !retryRef.current) {
          console.log('Retrying with html5 mode...');
          retryRef.current = true;
          sound.unload();
          const fallback = _createHowl(url, true);
          soundRef.current = fallback;
          return;
        }
        setLoadError(true);
      },
      onplayerror: (id, err) => {
        console.error('Audio play error:', err);
        sound.once('unlock', () => {
          sound.play();
        });
      },
    });
    return sound;
  }, []);

  const loadAudio = useCallback((url) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (soundRef.current) soundRef.current.unload();

    setIsLoaded(false);
    setIsPlaying(false);
    setLoadError(false);
    retryRef.current = false;
    originalUrlRef.current = url;

    const proxiedUrl = proxyAudioUrl(url);

    const sound = _createHowl(proxiedUrl, false);
    soundRef.current = sound;
  }, [_createHowl]);

  const playClip = useCallback((startPos, duration) => {
    const sound = soundRef.current;
    if (!sound) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    startPosRef.current = startPos;
    clipDurRef.current = duration;

    sound.stop();
    sound.seek(startPos);
    sound.play();
    setIsPlaying(true);

    timeoutRef.current = setTimeout(() => {
      if (soundRef.current) {
        soundRef.current.pause();
        setIsPlaying(false);
      }
    }, duration * 1000 + 80);
  }, []);

  const togglePlay = useCallback(() => {
    const sound = soundRef.current;
    if (!sound) return;

    if (sound.playing()) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      sound.pause();
      setIsPlaying(false);
    } else {
      playClip(startPosRef.current, clipDurRef.current);
    }
  }, [playClip]);

  const stop = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (soundRef.current) {
      soundRef.current.stop();
      setIsPlaying(false);
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (soundRef.current) soundRef.current.unload();
    };
  }, []);

  return { loadAudio, playClip, togglePlay, stop, isPlaying, isLoaded, loadError };
}
