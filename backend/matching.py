"""Server-side guess matching — the authoritative judge for scoring.

Mirrors frontend/src/lib/search.js so a guess is judged identically whether
the client is a guest (frontend decides) or logged-in (this decides). Keep the
two in lock-step if either changes.

Policy (chosen by the product owner):
- accent- and punctuation-forgiving, but words must otherwise match exactly
  (no typo/edit-distance leniency)
- artist mode: naming ANY credited artist on the track is correct
"""
import re
import unicodedata


def normalize_text(s: str) -> str:
    """lowercase · fold Latin accents · drop punctuation/symbols · collapse ws.

    Decompose → strip ONLY the Latin combining-accent range → recompose, so
    non-latin scripts that use combining marks (Japanese dakuten, Devanagari
    matras, …) survive intact. Keeps letters, numbers, and combining marks of
    any script; everything else becomes a space.
    """
    if not s:
        return ""
    d = unicodedata.normalize("NFD", s)
    d = "".join(c for c in d if not (0x300 <= ord(c) <= 0x36F))
    s = unicodedata.normalize("NFC", d).lower()
    out = []
    for c in s:
        if c.isspace():
            out.append(" ")
        elif unicodedata.category(c)[0] in ("L", "N", "M"):
            out.append(c)
        else:
            out.append(" ")
    return re.sub(r"\s+", " ", "".join(out)).strip()


# Separators between collaborating artists. Symbols split anywhere; the
# alphabetic words only at word boundaries so "Maxwell"/"within"/"Sixx" aren't
# torn apart.
_ARTIST_SEP = re.compile(
    r"\s*(?:,|&|/|\+|×|\b(?:feat|ft|featuring|with|x)\b\.?)\s*",
    re.IGNORECASE,
)


def split_artists(raw_artist: str) -> list[str]:
    """"Drake, 21 Savage" → ["drake", "21 savage"]; "A feat. B" → ["a", "b"]."""
    if not raw_artist:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for part in _ARTIST_SEP.split(raw_artist):
        n = normalize_text(part)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def matches_artist(guess: str, track_artist: str) -> bool:
    """The guess names ANY credited artist on the track (accent-forgiving),
    or equals the whole artist field (covers a single act typed in full, and
    the legacy client that submits the entire comma-joined string)."""
    g = normalize_text(guess)
    if not g:
        return False
    return g in split_artists(track_artist) or normalize_text(track_artist) == g


if __name__ == "__main__":
    # Self-check: python matching.py
    assert normalize_text(">one - greater than one") == "one greater than one"
    assert normalize_text("Café Tacvba") == "cafe tacvba"
    assert normalize_text("パラダイス") == "パラダイス"          # Japanese preserved
    assert normalize_text("तेरा होने") == "तेरा होने"             # Devanagari matras preserved
    assert split_artists("Drake, 21 Savage") == ["drake", "21 savage"]
    assert split_artists("Calvin Harris feat. Dua Lipa") == ["calvin harris", "dua lipa"]
    assert split_artists("Maxwell") == ["maxwell"]              # not torn on the 'x'
    assert matches_artist("21 savage", "Drake, 21 Savage")      # any collaborator
    assert matches_artist("Drake, 21 Savage", "Drake, 21 Savage")  # legacy full-string
    assert matches_artist("Beyonce", "Beyoncé")                 # accent-fold
    assert not matches_artist("drake", "Kendrick Lamar")        # wrong artist
    assert not matches_artist("dra", "Drake")                   # partial ≠ correct
    assert not matches_artist("", "Drake")
    print("matching.py self-check passed")
