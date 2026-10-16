/**
 * Turns a parsed {@link Chord} into a renderer-agnostic {@link ChartLayout}:
 * which fret range is visible, where the dots and mute/open glyphs go, and
 * what per-string labels (including tuning labels, which apply to every
 * string unconditionally) apply. Also always computes fret-number labels
 * for the grid's 1st, 3rd, and (when shown) 5th rows, regardless of
 * whether the chart starts at the nut. See src/types.ts for the frozen
 * contracts this module implements.
 */

import type { Chord, Fret } from "./chordparse";
import {
  ChartLayout,
  ChordChartOptions,
  DotPosition,
  FingerLabelPosition,
  FingerPositions,
  FretMarkerPosition,
  FretRowLabel,
  GlyphPosition,
  LayoutError,
  FretBracket,
  FretBracketPosition,
  NeckDotPosition,
  NeckFingerLabelPosition,
  NeckFretMarkerPosition,
  NeckFretNumberLabel,
  NeckGlyphPosition,
  NeckLayout,
  NeckTuningLabelPosition,
  NoteClasses,
  NoteMarker,
  NoteShapes,
  StringLabels,
  TuningLabelPosition,
} from "./types";

/** Row positions (1-based, within the visible grid) that always get a fret-number label. */
const LABELED_ROW_POSITIONS = [1, 3, 5];

/** Guitar frets that get a single neck-inlay marker, centered between strings 3 and 4. */
const SINGLE_FRET_MARKERS = [3, 5, 7, 9, 15, 17, 19, 21];
/** Guitar frets that get a double marker, between strings 4-5 and strings 2-3. */
const DOUBLE_FRET_MARKERS = [12];

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Computes neck-inlay-style position markers for whichever of
 * SINGLE_FRET_MARKERS/DOUBLE_FRET_MARKERS fall within the visible grid.
 * String numbers beyond stringCount are silently skipped (e.g. "between
 * strings 4 and 5" doesn't apply to a 4-string instrument).
 */
function computeFretMarkers(
  startFret: number,
  visibleFrets: number,
  stringCount: number,
): FretMarkerPosition[] {
  const markers: FretMarkerPosition[] = [];

  const addMarker = (fret: number, stringNumberA: number, stringNumberB: number, kind: "single" | "double") => {
    if (stringNumberA > stringCount || stringNumberB > stringCount) return;
    const row = fret - startFret - 1;
    if (row < 0 || row >= visibleFrets) return;
    const betweenIndex = stringCount - (stringNumberA + stringNumberB) / 2;
    markers.push({ row, betweenIndex, kind });
  };

  for (const fret of SINGLE_FRET_MARKERS) addMarker(fret, 3, 4, "single");
  for (const fret of DOUBLE_FRET_MARKERS) {
    addMarker(fret, 4, 5, "double");
    addMarker(fret, 2, 3, "double");
  }

  return markers;
}

/**
 * Computes the visible fret window from a flat list of fretted (> 0)
 * values -- shared by both computeLayout (chord mode, fed from a Chord's
 * non-null/non-zero entries) and computeMarkerLayout (scale-chart mode,
 * fed from its markers' frets). `subject` names the caller's data kind
 * ("chord"/"notes") for the LayoutError message only.
 *
 * @throws {LayoutError} if the fretted span can't fit the 5-fret display cap.
 */
function computeFretRange(
  frettedValues: readonly number[],
  subject: string,
): { startFret: number; visibleFrets: number } {
  let highestFret = 0;
  let lowestFret: number | null = null;
  for (const f of frettedValues) {
    if (f > highestFret) highestFret = f;
    if (lowestFret === null || f < lowestFret) lowestFret = f;
  }

  const startFret = highestFret <= 5 ? 0 : (lowestFret as number) - 1;

  if (highestFret - startFret > 5) {
    throw new LayoutError(
      `${subject} spans frets ${lowestFret ?? 0}-${highestFret}, which does not fit ` +
        `within the 5-fret display cap (startFret=${startFret})`,
    );
  }

  return { startFret, visibleFrets: clamp(highestFret - startFret, 4, 5) };
}

/** Fret-number labels for the grid's 1st, 3rd, and (when shown) 5th rows -- shared by both layout paths. */
function computeFretRowLabels(startFret: number, visibleFrets: number): FretRowLabel[] {
  return LABELED_ROW_POSITIONS.filter((position) => position <= visibleFrets).map((position) => ({
    row: position - 1,
    label: String(startFret + position),
  }));
}

export function computeLayout(chord: Chord, options?: ChordChartOptions): ChartLayout {
  const stringCount = chord.length;

  const frettedValues: number[] = [];
  for (const f of chord) {
    if (f === null || f === 0) continue;
    frettedValues.push(f);
  }
  const { startFret, visibleFrets } = computeFretRange(frettedValues, "chord");

  const dots: DotPosition[] = [];
  const glyphs: GlyphPosition[] = [];

  chord.forEach((f: Fret, stringIndex: number) => {
    if (f === null) {
      glyphs.push({ stringIndex, glyph: "x" });
    } else if (f === 0) {
      glyphs.push({ stringIndex, glyph: "0" });
    } else {
      const row = f - startFret - 1;
      dots.push({ stringIndex, row });
    }
  });

  const dotByIndex = new Map<number, DotPosition>();
  for (const dot of dots) dotByIndex.set(dot.stringIndex, dot);
  const glyphByIndex = new Map<number, GlyphPosition>();
  for (const glyph of glyphs) glyphByIndex.set(glyph.stringIndex, glyph);

  if (options?.stringLabels) {
    const entries = Object.entries(options.stringLabels) as Array<
      [string, string | undefined]
    >;
    for (const [key, label] of entries) {
      if (label === undefined) continue;
      const stringNumber = Number(key) as keyof StringLabels;
      const arrayIndex = stringCount - stringNumber;
      const dot = dotByIndex.get(arrayIndex);
      if (dot) {
        dot.label = label;
      }
      // A label for a muted/open string is silently ignored.
    }
  }

  const fingerLabels: FingerLabelPosition[] = [];
  if (options?.fingerPositions) {
    const entries = Object.entries(options.fingerPositions) as Array<
      [string, number | undefined]
    >;
    for (const [key, finger] of entries) {
      if (finger === undefined) continue;
      const stringNumber = Number(key) as keyof FingerPositions;
      const arrayIndex = stringCount - stringNumber;
      // Open and muted strings never get a finger position label -- only
      // fretted strings (i.e. ones that got a dot) qualify.
      if (dotByIndex.has(arrayIndex)) {
        fingerLabels.push({ stringIndex: arrayIndex, finger });
      }
    }
  }

  if (options?.noteClasses) {
    const entries = Object.entries(options.noteClasses) as Array<
      [string, string | undefined]
    >;
    for (const [key, className] of entries) {
      if (className === undefined) continue;
      const stringNumber = Number(key) as keyof NoteClasses;
      const arrayIndex = stringCount - stringNumber;
      const dot = dotByIndex.get(arrayIndex);
      if (dot) {
        dot.className = className;
        continue;
      }
      const glyph = glyphByIndex.get(arrayIndex);
      if (glyph && glyph.glyph === "0") {
        glyph.className = className;
      }
      // A muted string isn't sounding a note, so it never gets a class.
    }
  }

  if (options?.noteShapes) {
    const entries = Object.entries(options.noteShapes) as Array<
      [string, DotPosition["shape"] | undefined]
    >;
    for (const [key, shape] of entries) {
      if (shape === undefined) continue;
      const stringNumber = Number(key) as keyof NoteShapes;
      const arrayIndex = stringCount - stringNumber;
      const dot = dotByIndex.get(arrayIndex);
      if (dot) {
        dot.shape = shape;
      }
      // A shape for a muted/open string is silently ignored, same as
      // stringLabels -- there's no dot there to shape.
    }
  }

  const tuningLabels: TuningLabelPosition[] = (options?.tuningLabels ?? []).map(
    (label, stringIndex) => ({ stringIndex, label }),
  );

  const fretRowLabels = computeFretRowLabels(startFret, visibleFrets);

  const fretMarkers = computeFretMarkers(startFret, visibleFrets, stringCount);

  const layout: ChartLayout = {
    stringCount,
    startFret,
    visibleFrets,
    dots,
    glyphs,
    fingerLabels,
    tuningLabels,
    fretRowLabels,
    fretMarkers,
    chartLabel: options?.label,
  };

  return layout;
}

export interface MarkerLayoutInput {
  stringCount: number;
  markers: NoteMarker[];
  /** Out-of-range string numbers are silently dropped, same scope limit as everywhere else. */
  mutedStrings?: ReadonlyArray<1 | 2 | 3 | 4 | 5 | 6>;
  label?: string;
  tuningLabels?: readonly string[];
  /** Whether to compute fretRowLabels at all. Defaults to `true` -- pass `false` to omit them entirely. */
  labelFrets?: boolean;
  /** Labeled fret-range brackets drawn left of the grid. Their frets take part in fitting the visible window, same as the notes'. */
  brackets?: readonly FretBracket[];
}

/**
 * The scale-chart counterpart to {@link computeLayout}: builds a
 * ChartLayout directly from a list of independently labeled/classed/
 * shaped/fingered {@link NoteMarker}s, rather than a single Chord +
 * per-string lookup maps. Unlike computeLayout, this needs no
 * dotByIndex-style Map -- each marker already carries its own
 * label/className/shape/finger, so this is a filter-map-dedup, not a
 * two-pass lookup.
 *
 * Precedence when a string appears in both `markers` and `mutedStrings`:
 * muted wins and the marker is silently dropped -- consistent with "a
 * muted string isn't sounding a note, so it never gets a class" (already
 * true for chord mode, see computeLayout above). A duplicate {string,
 * fret} pair across multiple markers: the later one in `markers` wins.
 *
 * `brackets`' frets are fitted into the visible window alongside the
 * fretted markers' -- a bracket is never silently clipped -- and stacked
 * by {@link stackBrackets}. A bracket starting at fret 0 (the open-string
 * row above the grid) needs the window to start at the nut.
 *
 * @throws {LayoutError} if the fretted markers' and brackets' combined
 *   span can't fit the 5-fret display cap, a bracket's fret range is
 *   invalid, or a fret-0 bracket can't be shown because the window
 *   doesn't start at the nut.
 */
export function computeMarkerLayout(input: MarkerLayoutInput): ChartLayout {
  const { stringCount } = input;
  const toArrayIndex = (stringNumber: number) => stringCount - stringNumber;
  const inRange = (arrayIndex: number) => arrayIndex >= 0 && arrayIndex < stringCount;

  const mutedIndices = new Set((input.mutedStrings ?? []).map(toArrayIndex).filter(inRange));

  const candidates = input.markers
    .map((m) => ({ ...m, stringIndex: toArrayIndex(m.string) }))
    .filter((m) => inRange(m.stringIndex) && !mutedIndices.has(m.stringIndex));

  // Dedup same {stringIndex, fret}: the later entry in `markers` wins,
  // since a later Map.set() with the same key overwrites the earlier one.
  const byKey = new Map<string, (typeof candidates)[number]>();
  for (const m of candidates) byKey.set(`${m.stringIndex}:${m.fret}`, m);
  const deduped = [...byKey.values()];

  const fretted = deduped.filter((m) => m.fret > 0);
  const open = deduped.filter((m) => m.fret === 0);

  const brackets = input.brackets ?? [];
  assertValidBrackets(brackets);

  const { startFret, visibleFrets } = computeFretRange(
    [...fretted.map((m) => m.fret), ...brackets.flatMap((b) => [b.startFret, b.endFret]).filter((f) => f > 0)],
    brackets.length > 0 ? "notes and brackets" : "notes",
  );
  const openBracket = brackets.find((b) => b.startFret === 0);
  if (openBracket && startFret > 0) {
    throw new LayoutError(
      `bracket ${JSON.stringify(openBracket.label)} starts at fret 0, but the chart's frets start at ${startFret + 1} ` +
        `-- a scale chart only shows the open-string row when it starts at the nut`,
    );
  }

  const dots: DotPosition[] = fretted
    .map((m) => ({
      stringIndex: m.stringIndex,
      row: m.fret - startFret - 1,
      label: m.label,
      className: m.className,
      shape: m.shape,
    }))
    .sort((a, b) => a.stringIndex - b.stringIndex || a.row - b.row);

  const glyphs: GlyphPosition[] = [
    ...open.map((m) => ({
      stringIndex: m.stringIndex,
      glyph: "0" as const,
      label: m.label,
      className: m.className,
    })),
    ...[...mutedIndices].sort((a, b) => a - b).map((stringIndex) => ({ stringIndex, glyph: "x" as const })),
  ].sort((a, b) => a.stringIndex - b.stringIndex);

  const fingerLabels: FingerLabelPosition[] = fretted
    .filter((m) => m.finger !== undefined)
    .map((m) => ({ stringIndex: m.stringIndex, finger: m.finger as number }));

  const tuningLabels: TuningLabelPosition[] = (input.tuningLabels ?? []).map((label, stringIndex) => ({
    stringIndex,
    label,
  }));

  return {
    stringCount,
    startFret,
    visibleFrets,
    dots,
    glyphs,
    fingerLabels,
    tuningLabels,
    fretRowLabels: input.labelFrets === false ? [] : computeFretRowLabels(startFret, visibleFrets),
    fretMarkers: computeFretMarkers(startFret, visibleFrets, stringCount),
    brackets: stackBrackets(brackets),
    chartLabel: input.label,
  };
}
export interface NeckLayoutInput {
  stringCount: number;
  markers: NoteMarker[];
  /** Always rendered regardless of firstFret/lastFret -- muting isn't a fret-range concept. */
  mutedStrings?: ReadonlyArray<1 | 2 | 3 | 4 | 5 | 6>;
  /** First fret shown. 0 = the nut/open position (the default). */
  firstFret?: number;
  /** Last fret shown. Defaults to firstFret + 12. */
  lastFret?: number;
  label?: string;
  tuningLabels?: readonly string[];
  /** Whether to compute fretNumberLabels at all. Defaults to `true` -- pass `false` to omit them entirely. */
  labelFrets?: boolean;
  /** Labeled fret-range brackets drawn below the neck. Like notes, a bracket outside [firstFret, lastFret] grows the window to fit it. */
  brackets?: readonly FretBracket[];
}

/**
 * The wide-neck-diagram counterpart to {@link computeMarkerLayout}: builds
 * a {@link NeckLayout} over an explicit [firstFret, lastFret] window
 * instead of an auto-fit compact grid. Same marker-resolution rules as
 * computeMarkerLayout (muted wins over a same-string marker, duplicate
 * {string, fret} -- later wins). Unlike a *dropped* marker (muted, or an
 * out-of-range string number -- still silently dropped, same precedent as
 * ever), a marker whose fret falls outside [firstFret, lastFret] -- caller-
 * specified or defaulted, including an explicit fret:0 (open) marker when
 * firstFret > 0 -- grows the window to include it instead: `firstFret`/
 * `lastFret` are a convenience default/hint, not a crop a caller can use
 * to silently exclude a note they also asked to be drawn. The returned
 * `warnings` array says so when this happens, empty otherwise.
 *
 * A marker at fret === firstFret (when firstFret > 0) still needs a drawn
 * cell to its left to be positioned against -- see leftBoundaryFret in
 * render/neckSvg.ts, the fix for exactly this.
 *
 * `brackets` follow the same grow-the-window rule as markers, and are
 * assigned stacking levels by {@link stackBrackets}.
 *
 * @throws {LayoutError} if the *requested* firstFret (before any
 *   expansion) is negative/non-integer, or the requested lastFret isn't a
 *   greater integer -- a malformed range is still rejected outright, not
 *   silently "fixed" by expansion. Also if a bracket's startFret/endFret
 *   aren't non-negative integers with startFret <= endFret.
 */
export function computeNeckLayout(input: NeckLayoutInput): NeckLayout {
  const { stringCount } = input;
  const requestedFirstFret = input.firstFret ?? 0;
  const requestedLastFret = input.lastFret ?? requestedFirstFret + 12;

  if (!Number.isInteger(requestedFirstFret) || requestedFirstFret < 0) {
    throw new LayoutError(`firstFret must be a non-negative integer, got ${requestedFirstFret}`);
  }
  if (!Number.isInteger(requestedLastFret) || requestedLastFret <= requestedFirstFret) {
    throw new LayoutError(
      `lastFret (${requestedLastFret}) must be an integer greater than firstFret (${requestedFirstFret})`,
    );
  }

  const toArrayIndex = (stringNumber: number) => stringCount - stringNumber;
  const inRange = (arrayIndex: number) => arrayIndex >= 0 && arrayIndex < stringCount;

  const mutedIndices = new Set((input.mutedStrings ?? []).map(toArrayIndex).filter(inRange));

  const candidates = input.markers
    .map((m) => ({ ...m, stringIndex: toArrayIndex(m.string) }))
    .filter((m) => inRange(m.stringIndex) && !mutedIndices.has(m.stringIndex));

  // Dedup same {stringIndex, fret}: the later entry in `markers` wins,
  // same precedent as computeMarkerLayout.
  const byKey = new Map<string, (typeof candidates)[number]>();
  for (const m of candidates) byKey.set(`${m.stringIndex}:${m.fret}`, m);
  const deduped = [...byKey.values()];

  const brackets = input.brackets ?? [];
  assertValidBrackets(brackets);

  // A note (fretted or open) or bracket that falls outside [requestedFirstFret,
  // requestedLastFret] grows the window to include it, rather than being
  // silently dropped -- the window is a convenience default/hint, not a
  // crop a caller can use to deliberately exclude a note they also asked
  // to be drawn. `warnings` surfaces this so a caller knows their
  // firstFret/lastFret (explicit or defaulted) didn't actually cover
  // everything.
  const neededFrets = [...deduped.map((m) => m.fret), ...brackets.flatMap((b) => [b.startFret, b.endFret])];
  const firstFret = neededFrets.length > 0 ? Math.min(requestedFirstFret, ...neededFrets) : requestedFirstFret;
  const lastFret = neededFrets.length > 0 ? Math.max(requestedLastFret, ...neededFrets) : requestedLastFret;

  const warnings: string[] = [];
  if (firstFret !== requestedFirstFret || lastFret !== requestedLastFret) {
    warnings.push(
      `notes/brackets fall outside frets [${requestedFirstFret}, ${requestedLastFret}] -- expanded to ` +
        `[${firstFret}, ${lastFret}] to fit them all`,
    );
  }

  const inWindow = deduped.filter((m) => m.fret >= firstFret && m.fret <= lastFret);
  const fretted = inWindow.filter((m) => m.fret > 0);
  const open = inWindow.filter((m) => m.fret === 0);

  const dots: NeckDotPosition[] = fretted
    .map((m) => ({
      stringIndex: m.stringIndex,
      fret: m.fret,
      label: m.label,
      className: m.className,
      shape: m.shape,
    }))
    .sort((a, b) => a.stringIndex - b.stringIndex || a.fret - b.fret);

  const glyphs: NeckGlyphPosition[] = [
    ...open.map((m) => ({
      stringIndex: m.stringIndex,
      glyph: "0" as const,
      label: m.label,
      className: m.className,
    })),
    ...[...mutedIndices].sort((a, b) => a - b).map((stringIndex) => ({ stringIndex, glyph: "x" as const })),
  ].sort((a, b) => a.stringIndex - b.stringIndex);

  const fingerLabels: NeckFingerLabelPosition[] = fretted
    .filter((m) => m.finger !== undefined)
    .map((m) => ({ stringIndex: m.stringIndex, fret: m.fret, finger: m.finger as number }));

  const tuningLabels: NeckTuningLabelPosition[] = (input.tuningLabels ?? []).map((label, stringIndex) => ({
    stringIndex,
    label,
  }));

  // Neck-inlay position markers: same SINGLE_FRET_MARKERS/DOUBLE_FRET_MARKERS
  // source as computeFretMarkers, but keyed by absolute fret (not a row
  // relative to some window start) and filtered to [firstFret, lastFret]
  // instead of a visibleFrets row count -- different enough in shape from
  // computeFretMarkers' relative-row math that it's its own small closure
  // here rather than a shared/parameterized function.
  const fretMarkers: NeckFretMarkerPosition[] = [];
  const addFretMarker = (
    fret: number,
    stringNumberA: number,
    stringNumberB: number,
    kind: "single" | "double",
  ): void => {
    if (stringNumberA > stringCount || stringNumberB > stringCount) return;
    if (fret < firstFret || fret > lastFret) return;
    const betweenIndex = stringCount - (stringNumberA + stringNumberB) / 2;
    fretMarkers.push({ fret, betweenIndex, kind });
  };
  for (const fret of SINGLE_FRET_MARKERS) addFretMarker(fret, 3, 4, "single");
  for (const fret of DOUBLE_FRET_MARKERS) {
    addFretMarker(fret, 4, 5, "double");
    addFretMarker(fret, 2, 3, "double");
  }

  // Standard inlay frets within [firstFret, lastFret], above string 1/
  // high-E -- labeling every single fret reads as too busy on a wide
  // diagram, so this sticks to the same reference points a real fretboard
  // marks. Built from a Set, so fret 12's doubled inlay marker naturally
  // produces exactly one label with no explicit dedup step. Always
  // includes firstFret itself, even when it isn't a standard inlay fret --
  // the single most useful reference point on an offset diagram. Unlike
  // the old below-the-neck band, this is shown regardless of whether the
  // diagram starts at the nut (gated only by `labelFrets`, default on) --
  // above string 1 is far enough from the fretboard that it never clutters
  // a plain nut-start view the way a redundant "0" near the nut would.
  const fretNumberLabels: NeckFretNumberLabel[] = [];
  if (input.labelFrets !== false) {
    const frets = new Set<number>([firstFret]);
    for (const fret of SINGLE_FRET_MARKERS) {
      if (fret >= firstFret && fret <= lastFret) frets.add(fret);
    }
    for (const fret of DOUBLE_FRET_MARKERS) {
      if (fret >= firstFret && fret <= lastFret) frets.add(fret);
    }
    fretNumberLabels.push(...[...frets].sort((a, b) => a - b).map((fret) => ({ fret })));
  }

  return {
    stringCount,
    firstFret,
    lastFret,
    dots,
    glyphs,
    fingerLabels,
    tuningLabels,
    fretMarkers,
    fretNumberLabels,
    brackets: stackBrackets(brackets),
    chartLabel: input.label,
    warnings,
  };
}

/** @throws {LayoutError} unless every bracket's startFret/endFret are non-negative integers with startFret <= endFret. */
function assertValidBrackets(brackets: readonly FretBracket[]): void {
  for (const b of brackets) {
    if (!Number.isInteger(b.startFret) || b.startFret < 0 || !Number.isInteger(b.endFret) || b.endFret < b.startFret) {
      throw new LayoutError(
        `bracket ${JSON.stringify(b.label)}: startFret (${b.startFret}) and endFret (${b.endFret}) must be ` +
          `non-negative integers with startFret <= endFret`,
      );
    }
  }
}

/**
 * Assigns each bracket the lowest stacking level (0 = nearest the neck)
 * not already occupied by an overlapping bracket -- two brackets overlap
 * when their inclusive fret ranges share at least one fret, so CAGED
 * shapes that share a boundary fret (e.g. 2-5 and 5-8) stack, while
 * merely adjacent ones (2-5 and 6-8) share a row. Placed in order of
 * startFret, then longest first, so a wide bracket sits nearer the neck
 * than the narrower ones nested inside it. Returned in input order.
 */
export function stackBrackets(brackets: readonly FretBracket[]): FretBracketPosition[] {
  const order = brackets
    .map((b, index) => ({ b, index }))
    .sort((x, y) => x.b.startFret - y.b.startFret || y.b.endFret - x.b.endFret || x.index - y.index);
  // Highest endFret placed so far on each level -- since brackets are
  // placed in startFret order, that alone decides whether a level is free.
  const levelEnds: number[] = [];
  const levels: number[] = new Array(brackets.length);
  for (const { b, index } of order) {
    let level = levelEnds.findIndex((end) => end < b.startFret);
    if (level === -1) level = levelEnds.length;
    levelEnds[level] = b.endFret;
    levels[index] = level;
  }
  return brackets.map((b, i) => ({ ...b, level: levels[i] }));
}
