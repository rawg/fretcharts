/**
 * Shifts every sounding note -- a chord notation string's fretted/open
 * strings, or a scale/neck marker list's `fret` fields -- by a fixed
 * number of frets. "Frets" and "half-steps" mean the same thing here: on
 * a fretted instrument, moving a shape N frets up the neck transposes it
 * up N half-steps, so one signed integer (`halfSteps`, positive = up,
 * negative = down) covers both phrasings. Muted strings are left alone.
 * A shift that would put any note below the nut (fret 0) is rejected
 * outright rather than silently clamped, since that isn't a shape the
 * instrument can actually play.
 */

import { ParseOptions, Fret, parseChord, formatChord } from "./chordparse";
import { ChartInputError } from "./chartFieldResolver";
import { FretBracket, NoteMarker } from "./types";

function shiftFret(fret: number, halfSteps: number, context: string): number {
  const shifted = fret + halfSteps;
  if (shifted < 0) {
    throw new ChartInputError(
      `transposing ${context} (fret ${fret}) by ${halfSteps} would put it below the nut (fret ${shifted}) -- try a smaller shift`,
    );
  }
  return shifted;
}

/**
 * Transposes an already-parsed {@link Chord} (a `Fret[]`, as `parseChord`
 * returns) by `halfSteps` frets -- the primitive `transposeNotation` below
 * and `chart.ts`'s `buildChart` (which already has a parsed `Chord` on
 * hand, and can transpose it directly without a string round-trip) both
 * build on.
 *
 * @throws {ChartInputError} if the shift would put any note below the nut.
 */
export function transposeChord(chord: readonly Fret[], halfSteps: number): Fret[] {
  return chord.map((fret, i) => (fret === null ? null : shiftFret(fret, halfSteps, `string ${chord.length - i}`)));
}

/**
 * Transposes a chord notation string by `halfSteps` frets. `parseOptions`
 * is forwarded to `parseChord` for interpreting the *input* exactly as a
 * normal render would (so a two-digit-fret input is still disambiguated
 * the same way) -- the result is always re-serialized via `formatChord`'s
 * default space-separated form, which is unambiguous regardless of how
 * many digits a shifted fret needs, rather than reproducing whatever
 * separator style (or lack of one) the input used.
 *
 * @throws {ChordParseError} (propagated from `parseChord`) if `notation` has no valid reading.
 * @throws {ChartInputError} if the shift would put any note below the nut.
 */
export function transposeNotation(notation: string, halfSteps: number, parseOptions?: ParseOptions): string {
  const chord = parseChord(notation, parseOptions);
  return formatChord(transposeChord(chord, halfSteps));
}

/**
 * Transposes every marker's `fret` by `halfSteps`; every other field
 * (label/className/finger/shape/string) is untouched.
 *
 * @throws {ChartInputError} if the shift would put any marker below the nut.
 */
export function transposeMarkers(markers: readonly NoteMarker[], halfSteps: number): NoteMarker[] {
  return markers.map((m) => ({ ...m, fret: shiftFret(m.fret, halfSteps, `string ${m.string}`) }));
}

/**
 * Transposes neck-diagram brackets by `halfSteps`, alongside the notes
 * they label -- same below-the-nut rejection as {@link transposeMarkers}.
 *
 * @throws {ChartInputError} if the shift would put any bracket end below the nut.
 */
export function transposeBrackets(brackets: readonly FretBracket[], halfSteps: number): FretBracket[] {
  return brackets.map((b) => ({
    ...b,
    startFret: shiftFret(b.startFret, halfSteps, `bracket ${JSON.stringify(b.label)}`),
    endFret: shiftFret(b.endFret, halfSteps, `bracket ${JSON.stringify(b.label)}`),
  }));
}

/**
 * Transposes an optional explicit `firstFret`/`lastFret` neck-diagram
 * window by the same `halfSteps` as the notes it frames, so the window
 * follows the shape instead of needing computeNeckLayout's auto-expand
 * (see layout.ts) to catch up on every use of a transposition. `firstFret`
 * clamps at a minimum of 0 (it's a display bound, not a note -- nothing to
 * reject); `lastFret` shifts unclamped, so a shift large enough to leave
 * `lastFret <= firstFret` still surfaces layout.ts's own clear
 * LayoutError rather than being silently patched up here. Returns
 * `undefined` unchanged for whichever of the two wasn't given -- an
 * omitted bound has no position to preserve, and computeNeckLayout's own
 * defaulting (relative to `firstFret`) already does the right thing once
 * the notes themselves are transposed.
 */
export function transposeFretRange(
  firstFret: number | undefined,
  lastFret: number | undefined,
  halfSteps: number,
): { firstFret: number | undefined; lastFret: number | undefined } {
  return {
    firstFret: firstFret !== undefined ? Math.max(0, firstFret + halfSteps) : undefined,
    lastFret: lastFret !== undefined ? lastFret + halfSteps : undefined,
  };
}
