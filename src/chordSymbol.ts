/**
 * Parser for common chord symbols ("D", "Bm", "Gsus4", "Cadd9", "A7",
 * "Fmaj7", ...), reducing each to the three tones a triad voicing plays.
 *
 * A triad has room for exactly three notes, so four-note chords drop one:
 * the 5th, since it's the least characteristic tone -- A7 -> A, C#, G and
 * Cadd9 -> C, E, D. Where the 5th itself is altered (m7b5, dim7) it *is*
 * the characteristic tone, so the 3rd is dropped instead: Bm7b5 -> B, F, A.
 * Three-note chords (major, minor, dim, aug, sus2, sus4) are unchanged.
 *
 * Slash chords aren't supported -- every inversion is already a candidate,
 * so the bass note is chosen by the triad search, not the symbol.
 */

import { noteToSemitone } from "./tuning";

/** The symbol is not a recognized chord. */
export class ChordSymbolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChordSymbolError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** One chord tone: its semitone offset above the root and its interval label. */
export interface ChordTone {
  semitones: number;
  label: string;
}

export interface ChordSymbol {
  /** The symbol as given, e.g. "F#m7". */
  symbol: string;
  /** The root's pitch class, 0-11 (C=0). */
  rootPitchClass: number;
  /** Exactly three tones, root first, in ascending close-voicing order. */
  tones: [ChordTone, ChordTone, ChordTone];
}

const R: ChordTone = { semitones: 0, label: "R" };
const tone = (semitones: number, label: string): ChordTone => ({ semitones, label });

type Triad = [ChordTone, ChordTone, ChordTone];

const MAJOR: Triad = [R, tone(4, "3"), tone(7, "5")];
const MINOR: Triad = [R, tone(3, "b3"), tone(7, "5")];
const DIM: Triad = [R, tone(3, "b3"), tone(6, "b5")];
const AUG: Triad = [R, tone(4, "3"), tone(8, "#5")];
const SUS2: Triad = [R, tone(2, "2"), tone(7, "5")];
const SUS4: Triad = [R, tone(5, "4"), tone(7, "5")];
const SIX: Triad = [R, tone(4, "3"), tone(9, "6")];
const MINOR_SIX: Triad = [R, tone(3, "b3"), tone(9, "6")];
const DOM7: Triad = [R, tone(4, "3"), tone(10, "b7")];
const MAJ7: Triad = [R, tone(4, "3"), tone(11, "7")];
const MIN7: Triad = [R, tone(3, "b3"), tone(10, "b7")];
const HALF_DIM7: Triad = [R, tone(6, "b5"), tone(10, "b7")];
const DIM7: Triad = [R, tone(6, "b5"), tone(9, "bb7")];
// The 9th sounds as a 2nd in a close voicing, so it sorts below the 3rd.
const ADD9: Triad = [R, tone(2, "9"), tone(4, "3")];

/** Quality suffix -> triad tones. Aliases share an entry. */
const QUALITIES: Record<string, Triad> = {
  "": MAJOR,
  maj: MAJOR,
  M: MAJOR,
  m: MINOR,
  min: MINOR,
  "-": MINOR,
  dim: DIM,
  "°": DIM,
  o: DIM,
  aug: AUG,
  "+": AUG,
  sus2: SUS2,
  sus4: SUS4,
  sus: SUS4,
  "6": SIX,
  m6: MINOR_SIX,
  min6: MINOR_SIX,
  "7": DOM7,
  maj7: MAJ7,
  M7: MAJ7,
  "Δ": MAJ7,
  "Δ7": MAJ7,
  m7: MIN7,
  min7: MIN7,
  "-7": MIN7,
  m7b5: HALF_DIM7,
  min7b5: HALF_DIM7,
  "ø": HALF_DIM7,
  "ø7": HALF_DIM7,
  dim7: DIM7,
  "°7": DIM7,
  o7: DIM7,
  add9: ADD9,
};

/** Parses a chord symbol like "Bm", "F#7", or "Ebmaj7". */
export function parseChordSymbol(text: string): ChordSymbol {
  const symbol = text.trim();
  const match = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  if (match === null) {
    throw new ChordSymbolError(
      `invalid chord ${JSON.stringify(text)} (expected a root A-G, e.g. "D", "Bm", "F#7")`,
    );
  }
  const [, letter, accidental, suffix] = match;
  if (suffix.includes("/")) {
    throw new ChordSymbolError(
      `slash chords aren't supported (${JSON.stringify(text)}) -- every inversion is already considered`,
    );
  }
  const tones = QUALITIES[suffix];
  if (tones === undefined) {
    throw new ChordSymbolError(
      `unsupported chord quality ${JSON.stringify(suffix)} in ${JSON.stringify(text)} ` +
        "(supported: maj, m, dim, aug, sus2, sus4, 6, m6, 7, maj7, m7, m7b5, dim7, add9)",
    );
  }
  return { symbol, rootPitchClass: noteToSemitone(letter + accidental), tones };
}

/** Parses a bare note name ("G", "F#", "Bb") or a chord symbol's root, for --key. */
export function parseKeyRoot(text: string): number {
  const match = /^([A-G])([#b]?)/.exec(text.trim());
  if (match === null) {
    throw new ChordSymbolError(`invalid key ${JSON.stringify(text)} (expected a note A-G, e.g. "G", "F#")`);
  }
  return noteToSemitone(match[1] + match[2]);
}
