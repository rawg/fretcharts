/**
 * Parser for compact guitar chord shorthand.
 *
 * Input is a string of 'x' (muted) and digits, one token per string, ordered
 * from the lowest-pitched string to the highest:
 *
 *     "320003"    -> G       -> [3, 2, 0, 0, 0, 3]
 *     "x02220"    -> A       -> [null, 0, 2, 2, 2, 0]
 *     "xxx121010" -> D/A-ish -> [null, null, null, 12, 10, 10]
 *
 * Index 0 is the 6th (low E) string, index 5 the 1st (high E). Muted strings
 * are null, open strings are 0.
 *
 * Two-digit frets are written inline with no separator, which is ambiguous in
 * general. It becomes unambiguous once three things are fixed: the number of
 * strings is known, two-digit tokens are range-checked to [10, maxFret], and
 * the fretted notes must fall within a span of `maxSpan` frets. A conflicting
 * parse would have to contain both a bare 1-or-2 and a fret >= 10, i.e. a span
 * of at least 8 -- so any maxSpan <= 8 forces uniqueness.
 *
 * Rather than rely on that proof at runtime, the parser enumerates every legal
 * tokenization and asserts that exactly one survives. Zero survivors means the
 * input is malformed; more than one means the constraints were loosened past
 * the point of uniqueness. Both are reported rather than guessed at.
 */

/** A single string's state: null = muted, 0 = open, n = fretted at n. */
export type Fret = number | null;

/** A voicing, low string first. */
export type Chord = Fret[];

export interface ParseOptions {
  /** Number of strings expected. Must be known in advance. Default 6. */
  stringCount?: number;
  /** Highest playable fret. Two-digit tokens above this are rejected. Default 24. */
  maxFret?: number;
  /**
   * Inclusive fret window the fretted notes must fit inside. Open and muted
   * strings are excluded. Pass null to disable, accepting that ambiguity
   * becomes possible. Default 5.
   */
  maxSpan?: number | null;
}

export const DEFAULT_STRING_COUNT = 6;
export const DEFAULT_MAX_FRET = 24;
export const DEFAULT_MAX_SPAN = 5; // inclusive width, so max - min <= 4

/** The input admits no valid reading. */
export class ChordParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChordParseError";
    // Required for `instanceof` to survive compilation down to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The input admits more than one valid reading. */
export class AmbiguousChordError extends ChordParseError {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousChordError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ParseResult =
  | { ok: true; chord: Chord }
  | { ok: false; error: ChordParseError };

const SEPARATORS = new Set([" ", "\t", "-", "."]);
const LEGAL_CHARS = new Set("0123456789xX".split(""));

/**
 * Parse chord shorthand into a fixed-length array of frets, low string first.
 *
 * Whitespace, '-' and '.' are treated as token separators; if any are present
 * the input is split on them instead of being tokenized, which sidesteps
 * ambiguity entirely.
 *
 * @throws {ChordParseError} if there is no valid reading.
 * @throws {AmbiguousChordError} if there are several.
 */
export function parseChord(text: string, options: ParseOptions = {}): Chord {
  const stringCount = options.stringCount ?? DEFAULT_STRING_COUNT;
  const maxFret = options.maxFret ?? DEFAULT_MAX_FRET;
  const maxSpan = options.maxSpan === undefined ? DEFAULT_MAX_SPAN : options.maxSpan;

  if (!Number.isInteger(stringCount) || stringCount < 1) {
    throw new RangeError("stringCount must be a positive integer");
  }

  const raw = text.trim();
  if (raw.length === 0) {
    throw new ChordParseError("empty input");
  }

  // Explicitly separated input needs no inference.
  if ([...raw].some((ch) => SEPARATORS.has(ch))) {
    return parseSeparated(raw, stringCount, maxFret, maxSpan);
  }

  const bad = [...new Set([...raw])].filter((ch) => !LEGAL_CHARS.has(ch));
  if (bad.length > 0) {
    throw new ChordParseError(
      `unexpected character(s) ${JSON.stringify(bad)} in ${JSON.stringify(text)}`,
    );
  }

  // A chord of n tokens occupies between n and 2n characters.
  if (raw.length < stringCount || raw.length > 2 * stringCount) {
    throw new ChordParseError(
      `${JSON.stringify(text)} has ${raw.length} characters, ` +
        `which cannot form ${stringCount} tokens`,
    );
  }

  const candidates = tokenizations(raw, stringCount, maxFret).filter((c) =>
    spanOk(c, maxSpan),
  );

  if (candidates.length === 0) {
    throw new ChordParseError(`no valid reading of ${JSON.stringify(text)}`);
  }
  if (candidates.length > 1) {
    const readings = candidates.slice(0, 4).map((c) => formatChord(c)).join(", ");
    throw new AmbiguousChordError(
      `${JSON.stringify(text)} is ambiguous: ${readings}`,
    );
  }

  return candidates[0];
}

/**
 * Non-throwing variant, for rendering pipelines that should degrade rather
 * than crash on a malformed chart.
 */
export function tryParseChord(
  text: string,
  options: ParseOptions = {},
): ParseResult {
  try {
    return { ok: true, chord: parseChord(text, options) };
  } catch (err) {
    if (err instanceof ChordParseError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}

/** Handle input that already has token boundaries marked. */
function parseSeparated(
  raw: string,
  stringCount: number,
  maxFret: number,
  maxSpan: number | null,
): Chord {
  const tokens = raw.split(/[\s\-.]+/).filter((t) => t.length > 0);

  if (tokens.length !== stringCount) {
    throw new ChordParseError(
      `expected ${stringCount} tokens, found ${tokens.length}`,
    );
  }

  const chord: Chord = tokens.map((tok) => {
    if (tok === "x" || tok === "X") return null;
    if (!/^\d+$/.test(tok)) {
      throw new ChordParseError(`invalid token ${JSON.stringify(tok)}`);
    }
    if (tok.length > 1 && tok[0] === "0") {
      throw new ChordParseError(`leading zero in token ${JSON.stringify(tok)}`);
    }
    const fret = Number(tok);
    if (fret > maxFret) {
      throw new ChordParseError(`fret ${fret} exceeds maxFret ${maxFret}`);
    }
    return fret;
  });

  if (!spanOk(chord, maxSpan)) {
    throw new ChordParseError(
      `fretted notes exceed a ${maxSpan}-fret span: ${formatChord(chord)}`,
    );
  }
  return chord;
}

/** Enumerate every reading of `raw` as exactly `stringCount` tokens. */
function tokenizations(
  raw: string,
  stringCount: number,
  maxFret: number,
): Chord[] {
  const found: Chord[] = [];
  const acc: Chord = [];

  const walk = (i: number): void => {
    if (acc.length === stringCount) {
      if (i === raw.length) found.push([...acc]);
      return;
    }

    const remainingTokens = stringCount - acc.length;
    const remainingChars = raw.length - i;
    // Each remaining token eats 1 or 2 characters.
    if (
      remainingChars < remainingTokens ||
      remainingChars > 2 * remainingTokens
    ) {
      return;
    }

    const ch = raw[i];

    if (ch === "x" || ch === "X") {
      acc.push(null);
      walk(i + 1);
      acc.pop();
      return; // 'x' can never begin a two-character token
    }

    acc.push(ch.charCodeAt(0) - 48);
    walk(i + 1);
    acc.pop();

    if (i + 1 < raw.length && raw[i + 1] >= "0" && raw[i + 1] <= "9") {
      const pair = Number(raw.slice(i, i + 2));
      // The lower bound rejects leading zeros as a side effect.
      if (pair >= 10 && pair <= maxFret) {
        acc.push(pair);
        walk(i + 2);
        acc.pop();
      }
    }
  };

  walk(0);
  return found;
}

/** True if the fretted notes fit inside the allowed window. */
function spanOk(chord: readonly Fret[], maxSpan: number | null): boolean {
  if (maxSpan === null) return true;
  let lo = Infinity;
  let hi = -Infinity;
  let count = 0;
  for (const f of chord) {
    if (f === null || f === 0) continue;
    count += 1;
    if (f < lo) lo = f;
    if (f > hi) hi = f;
  }
  if (count < 2) return true;
  return hi - lo <= maxSpan - 1;
}

/** Render a parsed chord back to shorthand. Inverse of parseChord. */
export function formatChord(chord: readonly Fret[], separator = " "): string {
  return chord.map((f) => (f === null ? "x" : String(f))).join(separator);
}

/** Lowest fretted note, ignoring open and muted strings. null if all open. */
export function lowestFret(chord: readonly Fret[]): number | null {
  let lo: number | null = null;
  for (const f of chord) {
    if (f === null || f === 0) continue;
    if (lo === null || f < lo) lo = f;
  }
  return lo;
}

/** Exposed for testing the uniqueness claim. */
export const __internal = { tokenizations, spanOk };
