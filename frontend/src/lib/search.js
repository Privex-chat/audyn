// Forgiving text matching for the guess dropdowns.
//
// Goal: surface the right song/artist despite punctuation, symbols, accents,
// and separator differences — WITHOUT giving answers away (correctness for
// songs is still by track id; for artists it's an exact normalized-name match,
// see matchesArtist). Unicode-aware so non-latin scripts (Hindi, etc.) survive.

// lowercase · fold Latin accents · punctuation/symbols → space · collapse.
// e.g. ">one - greater than one" → "one greater than one", "Café" → "cafe".
// Decompose → strip ONLY the Latin combining-accent range → RECOMPOSE, so
// non-latin scripts that use combining marks (Japanese dakuten, etc.) are
// preserved rather than mangled. Non-latin scripts (Hindi, Japanese, …) pass
// through intact since they aren't letters we fold.
export function normalizeText(s) {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')       // Latin accents only
    .normalize('NFC')                      // recompose (protects e.g. パ, ダ)
    .toLowerCase()
    // keep letters, numbers, and combining marks (any script) + space. Marks
    // must stay: Devanagari matras, Arabic/Thai vowels etc. are category M,
    // not L — dropping them would gut those scripts. Latin accents are already
    // removed above, so this only preserves the non-latin ones.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Apostrophes and quote glyphs — elided (removed, not spaced) so contractions
// and possessives match when typed without them.
const QUOTES = /['‘’‛`´ʼ"“”«»]/g;

// Looser normalization for DROPDOWN SURFACING ONLY (never correctness): elides
// quotes/apostrophes so "Dont" finds "Don't", "rocknroll" finds "Rock 'n' Roll".
// Correctness stays on strict normalizeText, which the backend mirrors.
export function normalizeLoose(s) {
  return normalizeText((s || '').replace(QUOTES, ''));
}

// Surfacing test: substring match, or all query tokens present in any order.
export function matchesQuery(normHaystack, normQuery) {
  if (!normQuery) return false;
  if (normHaystack.includes(normQuery)) return true;
  return normQuery.split(' ').every((tok) => tok && normHaystack.includes(tok));
}

// Separators Spotify (and people) use between collaborating artists.
// Word-bounded on the alphabetic tokens so they don't match mid-name, e.g.
// "x" in "Xscape", "ft" in "Daft Punk", "with" in "Bill Withers".
// Mirrors backend/matching.py _ARTIST_SEP exactly (dot consumed after the word
// boundary so "feat." doesn't leak into the next name).
const ARTIST_SEP = /\s*(?:,|&|\/|\+|×|\b(?:feat|ft|featuring|with|x)\b\.?)\s*/gi;

// Split a raw artist field into individual normalized artist names.
// "Drake, 21 Savage" → ["drake", "21 savage"]; "A feat. B" → ["a", "b"].
export function splitArtists(rawArtist) {
  if (!rawArtist) return [];
  const seen = new Set();
  const out = [];
  for (const part of rawArtist.split(ARTIST_SEP)) {
    const n = normalizeText(part);
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

// Same split but keeping each artist's ORIGINAL display text (for the artist
// dropdown), deduped by normalized form.
// "Drake, 21 Savage" → ["Drake", "21 Savage"].
export function splitArtistsRaw(rawArtist) {
  if (!rawArtist) return [];
  const seen = new Set();
  const out = [];
  for (const part of rawArtist.split(ARTIST_SEP)) {
    const trimmed = part.trim();
    const key = normalizeText(trimmed);
    if (key && !seen.has(key)) { seen.add(key); out.push(trimmed); }
  }
  return out;
}

// Artist correctness: the guess names ANY credited artist on the track.
export function matchesArtist(guess, trackArtist) {
  const g = normalizeText(guess);
  if (!g) return false;
  const artists = splitArtists(trackArtist);
  // exact per-artist match, plus the whole normalized field (covers a track
  // credited as a single "A & B" act the player types in full).
  return artists.includes(g) || normalizeText(trackArtist) === g;
}
