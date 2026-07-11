import { normalizeText, normalizeLoose, matchesQuery, splitArtists, splitArtistsRaw, matchesArtist } from './search';

describe('normalizeLoose (surfacing) elides quotes/apostrophes', () => {
  test("contractions match without the apostrophe", () => {
    expect(normalizeLoose("Don't Stop Me Now")).toBe('dont stop me now');
    expect(matchesQuery(normalizeLoose("Don't Stop Me Now"), normalizeLoose('dont stop'))).toBe(true);
  });
  test('curly quotes and possessives', () => {
    expect(normalizeLoose('It’s My Life')).toBe('its my life');
    expect(normalizeLoose('“Heroes”')).toBe('heroes');
  });
  test("Rock 'n' Roll", () => {
    expect(normalizeLoose("Rock 'n' Roll")).toBe('rock n roll');
  });
  test('still forgiving on symbols/accents like normalizeText', () => {
    expect(normalizeLoose('>one - greater than one')).toBe('one greater than one');
    expect(normalizeLoose('Señorita')).toBe('senorita');
  });
});

describe('splitArtistsRaw keeps display casing, deduped', () => {
  test('comma + feat', () => {
    expect(splitArtistsRaw('Drake, 21 Savage')).toEqual(['Drake', '21 Savage']);
    expect(splitArtistsRaw('Calvin Harris feat. Dua Lipa')).toEqual(['Calvin Harris', 'Dua Lipa']);
  });
  test('dedupes case-insensitively', () => {
    expect(splitArtistsRaw('Drake, drake')).toEqual(['Drake']);
  });
});

describe('normalizeText', () => {
  test('strips symbols/punctuation (the >one case)', () => {
    expect(normalizeText('>one - greater than one')).toBe('one greater than one');
  });
  test('folds Latin accents', () => {
    expect(normalizeText('Café Tacvba')).toBe('cafe tacvba');
    expect(normalizeText('Rosalía')).toBe('rosalia');
  });
  test('preserves non-latin scripts intact', () => {
    expect(normalizeText('パラダイス')).toBe('パラダイス');   // Japanese + dakuten survive
    expect(normalizeText('ダンス')).toBe('ダンス');
    expect(normalizeText('사랑')).toBe('사랑');               // Korean
    expect(normalizeText('होने')).toBe('होने');               // Devanagari matras survive
  });
});

describe('matchesQuery (surfacing)', () => {
  const h = normalizeText('>one - greater than one');
  test('substring after normalization', () => {
    expect(matchesQuery(h, normalizeText('one greater than one'))).toBe(true);
  });
  test('all tokens present, any order', () => {
    expect(matchesQuery(h, normalizeText('greater one'))).toBe(true);
  });
  test('accents ignored', () => {
    expect(matchesQuery(normalizeText('Señorita'), normalizeText('senorita'))).toBe(true);
  });
  test('non-matches rejected', () => {
    expect(matchesQuery(normalizeText('hello world'), normalizeText('zzz'))).toBe(false);
  });
});

describe('splitArtists', () => {
  test('comma-separated', () => {
    expect(splitArtists('Drake, 21 Savage')).toEqual(['drake', '21 savage']);
  });
  test('feat / ft / & separators', () => {
    expect(splitArtists('Calvin Harris feat. Dua Lipa')).toEqual(['calvin harris', 'dua lipa']);
    expect(splitArtists('Jack Ü & Justin Bieber')).toEqual(['jack u', 'justin bieber']);
  });
  test('alphabetic separator tokens do not match mid-name', () => {
    expect(splitArtists('Daft Punk')).toEqual(['daft punk']);
    expect(splitArtists('Bill Withers')).toEqual(['bill withers']);
    expect(splitArtists('Xscape')).toEqual(['xscape']);
  });
  test('word boundary is Unicode-aware around non-ASCII letters (matches Python \\b)', () => {
    // "é" is a word char in Python's Unicode \b, so no boundary before "feat" -> no split.
    expect(splitArtists('Beyoncéfeat. Jay-Z')).toEqual(['beyoncefeat jay z']);
    expect(splitArtists('Beyoncé feat. Jay-Z')).toEqual(['beyonce', 'jay z']);
  });
});

describe('matchesArtist (correctness — any credited artist, accent-forgiving, not lenient)', () => {
  test('any collaborator counts', () => {
    expect(matchesArtist('21 savage', 'Drake, 21 Savage')).toBe(true);
    expect(matchesArtist('Drake', 'Drake, 21 Savage')).toBe(true);
  });
  test('accent-folded', () => {
    expect(matchesArtist('Beyonce', 'Beyoncé')).toBe(true);
  });
  test('whole-field match for single act', () => {
    expect(matchesArtist('Tyler, The Creator', 'Tyler, The Creator')).toBe(true);
  });
  test('wrong artist rejected', () => {
    expect(matchesArtist('drake', 'Kendrick Lamar')).toBe(false);
  });
  test('partial is NOT accepted (not too lenient)', () => {
    expect(matchesArtist('dra', 'Drake')).toBe(false);
    expect(matchesArtist('', 'Drake')).toBe(false);
  });
});
