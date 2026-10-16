# chordparse — agent brief

Parses compact guitar chord shorthand into a fixed-length array of frets.
Two implementations exist in parity: `chordparse.py` and `chordparse.ts`
(+ `chordparse.test.ts`). **Changes to one must be mirrored in the other.**

## What it does

```
"320003"     -> [3, 2, 0, 0, 0, 3]
"x02220"     -> [None, 0, 2, 2, 2, 0]
"xxx121010"  -> [None, None, None, 12, 10, 10]
```

Index 0 is the 6th (low E) string, index 5 the 1st (high E). `None`/`null` is
muted, `0` is open, `n` is fretted at fret n. Output length always equals the
configured string count.

## The core problem

Two-digit frets are written inline with no separator, so `xxx121010` could in
principle read as `x x x 1 21 0 10` or several other things. The module resolves
this without a delimiter.

## Why it is unambiguous — read before touching the constraints

Three conditions together force a unique parse:

1. **String count is fixed and known.** With `n` tokens and `L` characters,
   the number of two-digit tokens is pinned at `L - n` in every candidate parse.
   Parses can only disagree about *placement*, never *count*.
2. **Two-digit tokens are range-checked** to `[10, maxFret]`. This is also what
   rejects leading zeros (`05` < 10) and nonsense pairs (`91` > 24).
3. **Fretted notes fit within `maxSpan`.** If two parses diverged, one would
   have to read a character as a bare `1` or `2` while the other read it as the
   start of a fret >= 10 — meaning the first parse contains both a fret <= 2 and
   a fret >= 10, a span of at least 8.

**Therefore `maxSpan <= 8` guarantees uniqueness.** The default of 5 is well
inside that. Raising it above 8, or setting it to `None`/`null`, reintroduces
genuine ambiguity — the parser will then raise `AmbiguousChordError` rather than
guess. Verify with `parseChord("1212121212", { maxSpan: null })`, which yields
four-plus valid readings.

Open (`0`) and muted strings are excluded from the span calculation. This is
correct and load-bearing; do not "fix" it.

## API

Python:

```python
parse_chord(text, strings=6, max_fret=24, max_span=5) -> list[int | None]
format_chord(chord, separator=" ") -> str      # inverse of parse_chord
lowest_fret(chord) -> int | None               # ignores open/muted
```

TypeScript:

```ts
parseChord(text: string, options?: ParseOptions): Chord          // throws
tryParseChord(text: string, options?: ParseOptions): ParseResult // union
formatChord(chord: readonly Fret[], separator?: string): string
lowestFret(chord: readonly Fret[]): number | null

type Fret = number | null;
type Chord = Fret[];
interface ParseOptions { stringCount?: number; maxFret?: number; maxSpan?: number | null }
type ParseResult = { ok: true; chord: Chord } | { ok: false; error: ChordParseError }
```

`tryParseChord` is the right entry point for rendering pipelines — one bad chord
in a song file should not take down the page. `parseChord` throws, for callers
that want to fail loudly.

Errors: `ChordParseError` (no valid reading), `AmbiguousChordError extends
ChordParseError` (multiple readings).

## Input handling

Whitespace, `-`, or `.` anywhere in the input switches to a separator-based path
that skips inference entirely: `"10-12-12-12-10-10"`, `"x x x 12 10 10"`. This is
the escape hatch for anything the packed form cannot express. Note the separated
path still enforces span and `maxFret`, but reports leading zeros explicitly
rather than silently.

Legal characters in packed input: `0-9`, `x`, `X`. Anything else raises.

## Implementation notes

`tokenizations()` is a backtracking walk that branches at each digit — take one
character, or take two if they form a value in `[10, maxFret]`. `x` returns early
because it can never begin a two-character token. The feasibility guard
(`remainingTokens <= remainingChars <= 2 * remainingTokens`) prunes aggressively,
so the search stays trivially small at 6 strings.

The parser then filters by span and **asserts exactly one candidate survives**.
It does not take the first match.

Do not replace this with greedy longest-match. Greedy returns the same answer
whenever the constraints hold, but it dead-ends on malformed input (requiring
backtracking anyway) and silently returns a wrong chord if anyone loosens
`maxSpan` past 8. The enumerate-and-assert design converts that failure mode from
"plausible wrong diagram" into "explicit error."

## Testing

```bash
python3 chordparse.py     # self-test + exhaustive check
npx tsc --strict --target ES2020 --module commonjs --types node --outDir dist \
  chordparse.ts chordparse.test.ts && node dist/chordparse.test.js
```

Both run an exhaustive check: every legal 6-token chord (1,466,516 of them) is
packed to shorthand and re-parsed. Expected result is **0 ambiguous**. Any change
to the tokenizer or the constraints must keep that at 0.

`__internal` in the TS module exports `tokenizations` and `spanOk` solely so the
test can run without duplicating the tokenizer. Not part of the public surface.

## Extending — what breaks the guarantee

- **Variable-width input** (partial voicings, "just the top four strings") breaks
  condition 1 and reintroduces ambiguity immediately. `stringCount` may vary per
  call — bass, ukulele — but must be known at call time, not inferred.
- **New alphabet symbols** (e.g. `T` for thumb-over, `/` for slash chords)
  require redoing the uniqueness analysis. Start at the character validation in
  `parseChord`.
- **Raising `maxFret`** past ~99 would allow three-digit tokens, invalidating the
  1-or-2-character assumption throughout the tokenizer.

If the packed format becomes a liability, the alternative is single-character
encoding for frets 10+ (`a`=10, `b`=11, `c`=12 → `xxxcaa`). Always one character
per string, parseable by index, no span assumption, survives variable string
counts. Costs human readability of the source text.