import { normalizeText, matchesQuery, splitArtists, matchesArtist } from './search';

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
