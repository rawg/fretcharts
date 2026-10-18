/**
 * Triad search: given a chord progression, picks one three-string triad
 * voicing per chord, all on the same group of three adjacent strings.
 *
 * Candidates. For each chord, string group, and inversion (which chord tone
 * is in the bass) there is exactly one arrangement: the close voicing, each
 * higher voice being the next chord tone above the one below it. That shape
 * repeats every 12 frets, so a candidate is (string group, inversion,
 * octave). Candidates are dropped if they exceed `maxFret`, if their fretted
 * notes span more than `maxSpan` frets (inclusive, open strings excluded --
 * the same convention as chordparse.ts), or if they fall below the floor.
 *
 * Selection. One chord is the anchor: the first chord whose root matches
 * `keyRoot`, or the first chord if no key is given. Every anchor candidate
 * is tried. With a direction, every other chord must sit strictly above
 * (or below) the anchor on the neck; repeats of the anchor's own chord may
 * share its position. The rest of the progression is then chosen to
 * minimize fretting-hand travel, i.e. how far the hand slides along the neck
 * between chords. Ties are broken by total per-string finger movement, then
 * by more compact shapes, then by lower positions. The progression is not
 * treated as a loop: there is no transition from the last chord back to the
 * first.
 */

import { Chord, lowestFret } from "./chordparse";
import { ChordSymbol } from "./chordSymbol";
import { DEFAULT_TUNING, noteToSemitone, parseTuning } from "./tuning";
import { stringifyPerStringCompact } from "./chartFieldResolver";

export class TriadSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriadSearchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const DEFAULT_MAX_SPAN = 3;
export const DEFAULT_MAX_FRET = 15;

/**
 * "fret": every note must be at or above this fret (inclusive, so a fret
 * floor of 1 or more rules out open strings). "pitch": no note may sound
 * lower than the pitch at `fret` on guitar string `string`.
 */
export type Floor = { kind: "fret"; fret: number } | { kind: "pitch"; string: number; fret: number };

export type Direction = "above" | "below";

export interface TriadSearchOptions {
  /** One note per string, low string first (as parseTuning returns). */
  tuning: readonly string[];
  /** Guitar string numbers (1 = highest) the triads may use. Default: all. */
  strings?: readonly number[];
  floor?: Floor;
  /** Inclusive fret width of the fretted notes. Default {@link DEFAULT_MAX_SPAN}. */
  maxSpan?: number;
  /** Highest fret a triad may use. Default {@link DEFAULT_MAX_FRET}. */
  maxFret?: number;
  /** Omit to simply minimize movement. */
  direction?: Direction;
  /** Pitch class (0-11) of the key root, which picks the anchor chord. Default: the first chord. */
  keyRoot?: number;
}

export interface TriadVoicing {
  chord: ChordSymbol;
  /** Full-width chord, low string first, with unused strings muted. */
  frets: Chord;
  /** Guitar string number (1 = highest) -> interval label ("R", "b3", ...). */
  intervals: Record<number, string>;
  /** Guitar string number carrying the chord root. */
  rootString: number;
  /** Fretting-hand position: the lowest fretted note, or 0 if all three strings are open. */
  position: number;
}

export interface TriadProgression {
  /** Guitar string numbers of the group used, lowest-pitched first, e.g. [3, 2, 1]. */
  strings: [number, number, number];
  anchorIndex: number;
  voicings: TriadVoicing[];
}

/**
 * Open-string pitches in semitones, low string first, relative to the
 * lowest string's pitch class. Tuning notation carries no octaves, so each
 * string is assumed to be the nearest pitch *above* the string below it,
 * which holds for standard, drop, open, and baritone tunings alike.
 */
export function openPitches(tuning: readonly string[]): number[] {
  const pitches: number[] = [];
  for (const note of tuning) {
    const pc = noteToSemitone(note);
    if (pitches.length === 0) {
      pitches.push(pc);
      continue;
    }
    const prev = pitches[pitches.length - 1];
    let pitch = prev - (((prev % 12) + 12) % 12) + pc;
    while (pitch <= prev) pitch += 12;
    pitches.push(pitch);
  }
  return pitches;
}

/** "1-4", "1,2,3,4", or a mix like "1-3,5" -> [1, 2, 3, 5]. */
export function parseStrings(value: string): number[] {
  const result = new Set<number>();
  for (const part of value.split(",").map((p) => p.trim())) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const [lo, hi] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
      for (let s = lo; s <= hi; s++) result.add(s);
    } else if (/^\d+$/.test(part)) {
      result.add(Number(part));
    } else {
      throw new TriadSearchError(`invalid strings ${JSON.stringify(value)} (expected e.g. "1-4" or "1,2,3,4")`);
    }
  }
  return [...result].sort((a, b) => a - b);
}

/** "5" -> fret floor; "5,3" / "5:3" / "5 3" -> pitch floor at string 5, fret 3. */
export function parseFloor(value: string): Floor {
  const parts = value.trim().split(/[\s,:]+/);
  if (parts.every((p) => /^\d+$/.test(p))) {
    if (parts.length === 1) return { kind: "fret", fret: Number(parts[0]) };
    if (parts.length === 2) return { kind: "pitch", string: Number(parts[0]), fret: Number(parts[1]) };
  }
  throw new TriadSearchError(
    `invalid floor ${JSON.stringify(value)} (expected a fret like "5", or string and fret like "5,3")`,
  );
}

/** Every contiguous three-string group within `allowed`, as low-first string indices. */
export function stringGroups(stringCount: number, allowed?: readonly number[]): [number, number, number][] {
  const ok = (stringNumber: number) => allowed === undefined || allowed.includes(stringNumber);
  const groups: [number, number, number][] = [];
  for (let i = 0; i + 2 < stringCount; i++) {
    const group: [number, number, number] = [i, i + 1, i + 2];
    if (group.every((index) => ok(stringCount - index))) groups.push(group);
  }
  return groups;
}

interface Candidate {
  voicing: TriadVoicing;
  /** The three fretted positions, low string first, for finger-movement costs. */
  triadFrets: [number, number, number];
  span: number;
}

function candidatesFor(
  chord: ChordSymbol,
  group: [number, number, number],
  open: number[],
  minPitch: number,
  options: Required<Pick<TriadSearchOptions, "maxSpan" | "maxFret">> & { minFret: number },
): Candidate[] {
  const stringCount = open.length;
  const pitchClasses = chord.tones.map((t) => (chord.rootPitchClass + t.semitones) % 12);
  const result: Candidate[] = [];

  for (let bass = 0; bass < 3; bass++) {
    const order = [bass, (bass + 1) % 3, (bass + 2) % 3];
    const firstFret = (((pitchClasses[order[0]] - open[group[0]]) % 12) + 12) % 12;

    for (let bassFret = firstFret; bassFret <= options.maxFret; bassFret += 12) {
      const pitches = [open[group[0]] + bassFret];
      for (let v = 1; v < 3; v++) {
        const prev = pitches[v - 1];
        const up = (((pitchClasses[order[v]] - prev) % 12) + 12) % 12;
        pitches.push(prev + (up === 0 ? 12 : up));
      }
      const triadFrets = pitches.map((p, v) => p - open[group[v]]) as [number, number, number];
      if (triadFrets.some((f) => f < options.minFret || f > options.maxFret)) continue;
      if (pitches.some((p) => p < minPitch)) continue;

      const fretted = triadFrets.filter((f) => f > 0);
      const span = fretted.length === 0 ? 0 : Math.max(...fretted) - Math.min(...fretted) + 1;
      if (span > options.maxSpan) continue;

      const frets: Chord = new Array(stringCount).fill(null);
      const intervals: Record<number, string> = {};
      let rootString = 0;
      group.forEach((index, v) => {
        frets[index] = triadFrets[v];
        const stringNumber = stringCount - index;
        intervals[stringNumber] = chord.tones[order[v]].label;
        if (order[v] === 0) rootString = stringNumber;
      });

      result.push({
        voicing: { chord, frets, intervals, rootString, position: lowestFret(frets) ?? 0 },
        triadFrets,
        span,
      });
    }
  }
  return result;
}

// Weights make the cost lexicographic: hand travel dominates, then finger
// movement, then shape compactness. Finger movement across three strings
// never exceeds ~3 * maxFret, and spans are at most maxSpan per chord, so
// these comfortably separate the tiers for any realistic fret range.
const HAND_WEIGHT = 1_000_000;
const FINGER_WEIGHT = 1_000;

function transitionCost(a: Candidate, b: Candidate): number {
  const hand = Math.abs(a.voicing.position - b.voicing.position);
  const fingers = a.triadFrets.reduce((sum, f, i) => sum + Math.abs(f - b.triadFrets[i]), 0);
  return hand * HAND_WEIGHT + fingers * FINGER_WEIGHT;
}

/** Per-chord cost: compact shapes first, then lower on the neck. */
function nodeCost(c: Candidate): number {
  return c.span * 100 + c.voicing.position;
}

const sameTriad = (a: ChordSymbol, b: ChordSymbol) =>
  a.rootPitchClass === b.rootPitchClass && a.tones.every((t, i) => t.semitones === b.tones[i].semitones);

/**
 * Cheapest path through `layers` (one candidate list per chord) starting
 * from a fixed `start` candidate. Returns the chosen candidates in layer
 * order (excluding `start`) and the total cost, or null if some layer is
 * empty.
 */
function cheapestChain(start: Candidate, layers: Candidate[][]): { path: Candidate[]; cost: number } | null {
  let best: { cost: number; path: Candidate[] }[] = [{ cost: 0, path: [] }];
  let prev: Candidate[] = [start];
  for (const layer of layers) {
    if (layer.length === 0) return null;
    const next = layer.map((c) => {
      let winner = { cost: Infinity, path: [] as Candidate[] };
      prev.forEach((p, i) => {
        const cost = best[i].cost + transitionCost(p, c) + nodeCost(c);
        if (cost < winner.cost) winner = { cost, path: best[i].path };
      });
      return { cost: winner.cost, path: [...winner.path, c] };
    });
    best = next;
    prev = layer;
  }
  return best.reduce((a, b) => (b.cost < a.cost ? b : a));
}

/** Finds the easiest-to-play triad progression for `chords` under `options`. */
export function findTriads(chords: readonly ChordSymbol[], options: TriadSearchOptions): TriadProgression {
  if (chords.length === 0) throw new TriadSearchError("no chords given");
  const { tuning } = options;
  const stringCount = tuning.length;
  if (stringCount < 3) throw new TriadSearchError("the tuning needs at least 3 strings");
  const maxSpan = options.maxSpan ?? DEFAULT_MAX_SPAN;
  const maxFret = options.maxFret ?? DEFAULT_MAX_FRET;

  for (const s of options.strings ?? []) {
    if (!Number.isInteger(s) || s < 1 || s > stringCount) {
      throw new TriadSearchError(`string ${s} is out of range for a ${stringCount}-string tuning`);
    }
  }
  const groups = stringGroups(stringCount, options.strings);
  if (groups.length === 0) {
    throw new TriadSearchError("the allowed strings don't include three adjacent strings");
  }

  const open = openPitches(tuning);
  let minFret = 0;
  let minPitch = -Infinity;
  if (options.floor?.kind === "fret") {
    minFret = options.floor.fret;
  } else if (options.floor?.kind === "pitch") {
    const { string, fret } = options.floor;
    if (!Number.isInteger(string) || string < 1 || string > stringCount) {
      throw new TriadSearchError(`floor string ${string} is out of range for a ${stringCount}-string tuning`);
    }
    minPitch = open[stringCount - string] + fret;
  }

  let anchorIndex = 0;
  if (options.keyRoot !== undefined) {
    anchorIndex = chords.findIndex((c) => c.rootPitchClass === options.keyRoot);
    if (anchorIndex === -1) {
      throw new TriadSearchError("no chord in the progression has the key's root");
    }
  }
  const anchorChord = chords[anchorIndex];

  let best: { cost: number; progression: TriadProgression } | null = null;

  for (const group of groups) {
    const layers = chords.map((c) => candidatesFor(c, group, open, minPitch, { maxSpan, maxFret, minFret }));

    for (const anchor of layers[anchorIndex]) {
      const allowed = (c: Candidate, chord: ChordSymbol): boolean => {
        if (options.direction === undefined) return true;
        const a = anchor.voicing.position;
        const p = c.voicing.position;
        if (sameTriad(chord, anchorChord)) return options.direction === "above" ? p >= a : p <= a;
        return options.direction === "above" ? p > a : p < a;
      };
      const filtered = layers.map((layer, i) => layer.filter((c) => allowed(c, chords[i])));

      const after = cheapestChain(anchor, filtered.slice(anchorIndex + 1));
      const before = cheapestChain(anchor, filtered.slice(0, anchorIndex).reverse());
      if (after === null || before === null) continue;

      const cost = after.cost + before.cost + nodeCost(anchor);
      if (best === null || cost < best.cost) {
        const path = [...before.path.reverse(), anchor, ...after.path];
        best = {
          cost,
          progression: {
            strings: group.map((index) => stringCount - index) as [number, number, number],
            anchorIndex,
            voicings: path.map((c) => c.voicing),
          },
        };
      }
    }
  }

  if (best === null) {
    throw new TriadSearchError(
      "no triad progression satisfies these constraints -- try more strings, a lower floor, " +
        "a larger --max-span or --max-fret, or no --direction",
    );
  }
  return best.progression;
}

/** Chord notation for a voicing: compact when every fret is a single digit, dash-separated otherwise. */
export function formatVoicing(frets: Chord): string {
  const tokens = frets.map((f) => (f === null ? "x" : String(f)));
  return tokens.some((t) => t.length > 1) ? tokens.join("-") : tokens.join("");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A FretCharts bulk-mode CSV: notes, label, root, string-labels, plus a
 * tuning column when `tuning` is given (omit it for standard tuning).
 */
export function progressionToCsv(progression: TriadProgression, tuning?: string): string {
  const header = ["notes", "label", "root", "string-labels"];
  if (tuning !== undefined) header.push("tuning");
  const stringCount = (tuning !== undefined ? parseTuning(tuning) : DEFAULT_TUNING).length;
  const rows = progression.voicings.map((v) => {
    const labels = stringifyPerStringCompact(v.intervals, stringCount) ?? "";
    const row = [formatVoicing(v.frets), v.chord.symbol, String(v.rootString), labels];
    if (tuning !== undefined) row.push(tuning);
    return row.map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}
