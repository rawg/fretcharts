/**
 * Tuning notation and pitch computation.
 *
 * Tuning notation is a sequence of notes, one per string, LOW STRING FIRST
 * -- the same left-to-right order as chord notation and the underlying
 * `Chord` array (index 0 = lowest/leftmost string). Each note is a capital
 * letter A-G optionally followed by a single accidental: "b" for flat or
 * "#" for sharp. Unlike chord notation's fret digits, this is never
 * ambiguous -- a bare "b"/"#" can never start a note on its own, so the
 * tokenizer is a simple greedy left-to-right walk, no backtracking needed.
 *
 *     "DADGBE"   -> ["D","A","D","G","B","E"]   (drop D)
 *     "BEADF#B"  -> ["B","E","A","D","F#","B"]  (baritone B)
 */

import type { Chord } from "./chordparse";
import type { StringLabels } from "./types";

/** The input is not valid tuning notation. */
export class TuningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuningError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Standard guitar tuning, low string (6) to high string (1). */
export const DEFAULT_TUNING: readonly string[] = ["E", "A", "D", "G", "B", "E"];

const NATURAL_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export type Accidental = "sharp" | "flat";

/** Parses tuning notation into one note per string, low string first. */
export function parseTuning(text: string): string[] {
  const chars = [...text.trim()];
  if (chars.length === 0) {
    throw new TuningError("empty tuning notation");
  }

  const notes: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const letter = chars[i];
    if (!/^[A-G]$/.test(letter)) {
      throw new TuningError(
        `invalid note letter ${JSON.stringify(letter)} in ${JSON.stringify(
          text,
        )} (expected a capital A-G)`,
      );
    }
    i++;
    let accidental = "";
    if (chars[i] === "b" || chars[i] === "#") {
      accidental = chars[i];
      i++;
    }
    notes.push(letter + accidental);
  }
  return notes;
}

/** Semitone 0-11 (C=0) for a note like "F", "F#", or "Gb". */
export function noteToSemitone(note: string): number {
  const letter = note[0];
  const accidental = note.slice(1);
  const base = NATURAL_SEMITONES[letter];
  if (base === undefined) {
    throw new TuningError(`invalid note letter ${JSON.stringify(letter)} in ${JSON.stringify(note)}`);
  }
  let semitone = base;
  if (accidental === "#") semitone += 1;
  else if (accidental === "b") semitone -= 1;
  else if (accidental !== "") {
    throw new TuningError(`invalid accidental ${JSON.stringify(accidental)} in ${JSON.stringify(note)}`);
  }
  return ((semitone % 12) + 12) % 12;
}

function semitoneToNoteName(semitone: number, accidental: Accidental): string {
  const table = accidental === "flat" ? FLAT_NAMES : SHARP_NAMES;
  return table[((semitone % 12) + 12) % 12];
}

/** The pitch sounding at `fret` frets above `openNote`. */
export function pitchAt(openNote: string, fret: number, accidental: Accidental = "sharp"): string {
  return semitoneToNoteName(noteToSemitone(openNote) + fret, accidental);
}

/**
 * Computes a {@link StringLabels}-shaped map of pitch names for every
 * fretted string in `chord`, given `tuning` (same index order as `chord`:
 * low/leftmost string first). Open and muted strings are skipped entirely
 * -- open strings do sound a defined pitch, but auto-labeling only applies
 * to fretted note markers, matching the "over the dot" label slot they
 * already occupy.
 *
 * String numbers beyond 6 (a >6-string tuning) are silently dropped, same
 * pre-existing scope limit as {@link StringLabels} itself.
 */
export function pitchLabelsForChord(
  chord: Chord,
  tuning: readonly string[],
  accidental: Accidental = "sharp",
): StringLabels {
  const stringCount = chord.length;
  const result: StringLabels = {};
  chord.forEach((fret, index) => {
    if (fret === null || fret === 0) return;
    const openNote = tuning[index];
    const stringNumber = stringCount - index;
    if (stringNumber < 1 || stringNumber > 6) return;
    result[stringNumber as 1 | 2 | 3 | 4 | 5 | 6] = pitchAt(openNote, fret, accidental);
  });
  return result;
}

/**
 * The scale-chart/neck-diagram counterpart to {@link pitchLabelsForChord}:
 * returns a new marker array where every FRETTED marker (`fret > 0`) that
 * doesn't already carry its own explicit `label` gets one computed from
 * its fret against `tuning` (same index order as tuning notation: low/
 * leftmost string first, `marker.string` a 1-6 guitar string number). Open
 * markers (`fret === 0`, rendered as an open-string glyph) are left
 * untouched -- same "never applied to open strings" rule as
 * pitchLabelsForChord -- and an explicit `label` always wins over its
 * computed pitch, exactly like an explicit `stringLabels` entry does
 * there.
 *
 * A marker whose `string` falls outside `tuning`'s range is left
 * untouched rather than throwing -- computeMarkerLayout/computeNeckLayout
 * already silently drop out-of-range markers themselves, so this just
 * avoids doing extra (unused) work for one that's about to be dropped
 * anyway.
 */
export function pitchLabelsForMarkers<M extends { string: number; fret: number; label?: string }>(
  markers: readonly M[],
  tuning: readonly string[],
  accidental: Accidental = "sharp",
): M[] {
  const stringCount = tuning.length;
  return markers.map((m) => {
    if (m.fret <= 0 || m.label !== undefined) return m;
    const openNote = tuning[stringCount - m.string];
    if (openNote === undefined) return m;
    return { ...m, label: pitchAt(openNote, m.fret, accidental) };
  });
}
