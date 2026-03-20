const FEATURED_PLAYLISTS = {
  en: [
    {
      id: '37i9dQZF1DXcBWIGoYBM5M',   // ✅ Verified — 34.4M saves
      fallbackName: "Today's Top Hits",
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DX0XUsuxWHRQd',   // ✅ Verified — 15.8M saves
      fallbackName: 'RapCaviar',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DWXRqgorJj26U',   // ✅ Verified — 12M+ saves
      fallbackName: 'Rock Classics',
      fallbackImage: '',
    },
  ],

  hi: [
    {
      id: '37i9dQZF1DX0XUfTFmNBRM',   // ✅ Verified — 3.1M saves
      fallbackName: 'Hot Hits Hindi',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DWXtlo6ENS92N',   // ✅ Verified — 1.6M saves
      fallbackName: 'Bollywood Central',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DX8xfQRRX1PDm',   // ✅ Verified — 1.2M saves
      fallbackName: 'Bollywood Dance Music',
      fallbackImage: '',
    },
  ],

  es: [
    {
      id: '37i9dQZF1DX10zKzsJ2jva',   // ✅ Verified — 15.5M saves
      fallbackName: 'Viva Latino',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DXaxEKcoCdWHD',   // ✅ Verified — 3.1M saves
      fallbackName: 'Éxitos España',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DX8SfyqmSFDwe',   // ✅ Verified — 3.3M saves
      fallbackName: 'Old School Reggaeton',
      fallbackImage: '',
    },
  ],

  ja: [
    {
      id: '37i9dQZF1DXafb0IuPwJyF',   // ✅ Verified — 1M saves
      fallbackName: 'Tokyo Super Hits!',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DXdbRLJPSmnyq',   // ✅ Verified — 422.5K saves
      fallbackName: 'J-Pop Hits',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DWT8aqnwgRt92',   // ✅ Verified — 1.5M saves
      fallbackName: 'Anime Now',
      fallbackImage: '',
    },
  ],

  ko: [
    {
      id: '37i9dQZF1DX9tPFwDMOoak',   // K-Pop Daebak — Spotify's flagship K-Pop editorial
      fallbackName: 'K-Pop Daebak',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DWU4xkXueiKGa',   // K-Pop Hits
      fallbackName: 'K-Pop Hits',
      fallbackImage: '',
    },
    {
      id: '37i9dQZF1DX4FcAKI5Nhzq',   // Hot Hits Korea
      fallbackName: 'Hot Hits Korea',
      fallbackImage: '',
    },
  ],
};

export function getFeaturedPlaylists(language) {
  return FEATURED_PLAYLISTS[language] || FEATURED_PLAYLISTS.en;
}

export default FEATURED_PLAYLISTS;
