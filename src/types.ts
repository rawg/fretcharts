/**
 * Shared contracts between the layout engine, renderers, and the chart API.
 * Frozen before parallel implementation work begins.
 */

/**
 * Per-string labels, keyed by GUITAR STRING NUMBER (6 = low E .. 1 = high E),
 * matching the CLI's JSON-object convention -- NOT the chord array index.
 * Only meaningful for fretted (non-muted, non-open) strings; a label given
 * for a muted/open string is silently ignored by computeLayout.
 */
export type StringLabels = Partial<Record<1 | 2 | 3 | 4 | 5 | 6, string>>;

/**
 * Per-string finger numbers (1-5), keyed by GUITAR STRING NUMBER, same
 * convention as {@link StringLabels}. Only meaningful for fretted strings;
 * an entry for a muted/open string is silently ignored by computeLayout --
 * open and muted strings never get a finger position label.
 */
export type FingerPositions = Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number>>;

/**
 * Per-string custom CSS class names, same convention as {@link StringLabels}
 * -- e.g. `{"3":"root"}` to tag whichever note lands on string 3 (useful for
 * styling "the root note" consistently across many charts where the root's
 * string position varies, such as inversions). Applied to whatever is
 * actually sounding on that string -- a fretted dot or an open-string
 * circle -- but never a muted string, which isn't playing a note.
 */
export type NoteClasses = Partial<Record<1 | 2 | 3 | 4 | 5 | 6, string>>;

/**
 * A fretted note dot's rendered shape. "circle" is the default when unset
 * -- every dot-producing field/type below treats `shape` as optional for
 * exactly that reason. Never applies to a glyph (open "0"/muted "x")
 * -- those aren't dots, and keep their own fixed shapes regardless.
 */
export type NoteShape = "circle" | "square" | "triangle" | "diamond";

/**
 * Per-string note shapes, same convention as {@link NoteClasses} -- e.g.
 * `{"3":"square"}` to draw whichever note lands on string 3 as a square.
 * Same "fretted strings only" scope as NoteClasses.
 */
export type NoteShapes = Partial<Record<1 | 2 | 3 | 4 | 5 | 6, NoteShape>>;

/**
 * One playable note: a specific string+fret, independently labeled/classed/
 * shaped/fingered. The canonical model behind scale-chart ("multiple
 * markers per string") mode -- unlike {@link StringLabels}/
 * {@link FingerPositions}/{@link NoteClasses}/{@link NoteShapes}, which
 * hold at most one value per string, a chord's worth of these can target
 * the same string at different frets.
 *
 * `fret === 0` renders as an open-string glyph, never a dot -- same
 * convention chord-notation mode already uses for a `0` in its notation.
 * `finger`/`shape` are only ever honored when `fret > 0`, same "never on
 * open/muted" rule {@link ChordChartOptions.fingerPositions} already
 * documents.
 */
export interface NoteMarker {
  string: 1 | 2 | 3 | 4 | 5 | 6;
  fret: number;
  label?: string;
  className?: string;
  shape?: NoteShape;
  finger?: number;
}

export interface ChordChartOptions {
  /** Text label for the whole chart, rendered above the grid. */
  label?: string;
  /** Per-string labels rendered over the dots of fretted strings. */
  stringLabels?: StringLabels;
  /** Per-string finger numbers, rendered below the bottom-most fret. */
  fingerPositions?: FingerPositions;
  /** Per-string custom CSS classes added to that string's sounding note. */
  noteClasses?: NoteClasses;
  /** Per-string dot shapes for that string's sounding note. Defaults to "circle". */
  noteShapes?: NoteShapes;
  /**
   * One open-pitch label per string, index-aligned with the chord array
   * (same order as tuning notation: low/leftmost string first). Unlike
   * every other per-string field here, this describes the tuning itself,
   * not what's currently sounding -- every string gets a label, including
   * muted ones.
   */
  tuningLabels?: readonly string[];
}

/** A filled circle (or square/triangle/diamond, per `shape`) over a fretted string. */
export interface DotPosition {
  /** 0-based CHORD ARRAY index (0 = low E / leftmost column). */
  stringIndex: number;
  /** 0-based row within the visible grid. */
  row: number;
  label?: string;
  /** Extra CSS class(es) from {@link NoteClasses}, added to the dot (and its label). */
  className?: string;
  /** Rendered shape, from {@link NoteShapes}/{@link NoteMarker.shape}. Defaults to "circle" when unset. */
  shape?: NoteShape;
}

/** An "x" (muted) or "0" (open) glyph above the grid. */
export interface GlyphPosition {
  /** 0-based chord array index. */
  stringIndex: number;
  glyph: "x" | "0";
  /** Extra CSS class(es) from {@link NoteClasses}; only ever set for "0" (open) glyphs. */
  className?: string;
  /**
   * Text rendered over an open-string glyph's circle -- e.g. a scale
   * degree on an open root. Only ever set for "0" glyphs, never "x"; a
   * muted string isn't sounding a note. Only ever populated by
   * `computeMarkerLayout`'s scale-chart path, straight from a
   * {@link NoteMarker}'s own `label` -- `computeLayout` (chord-notation
   * mode) never sets this, since a `stringLabels` entry for an open
   * string is documented to be silently dropped there.
   */
  label?: string;
}

/** A finger number (1-5) below the bottom-most fret, under a fretted string. */
export interface FingerLabelPosition {
  /** 0-based CHORD ARRAY index (0 = low E / leftmost column). */
  stringIndex: number;
  finger: number;
}

/** An open-pitch label above the mute/open glyphs, under a string. */
export interface TuningLabelPosition {
  /** 0-based CHORD ARRAY index (0 = low E / leftmost column). */
  stringIndex: number;
  label: string;
}

/**
 * A fret-number label to the right of one of the grid's 1st, 3rd, or 5th
 * visible rows (whichever exist -- the 5th only when visibleFrets === 5).
 * Always present for the rows that exist, regardless of whether the chart
 * starts at the nut. Plain fret number text, e.g. "3" or "10" -- no "fr"
 * suffix.
 */
export interface FretRowLabel {
  /** 0-based row within the visible grid (0, 2, or 4). */
  row: number;
  label: string;
}

/**
 * A guitar-neck inlay-style position marker dot, shown whenever its fret is
 * within the visible grid, regardless of what's fretted/played. "single"
 * frets (3/5/7/9/15/17/19/21) get one marker centered between strings 3
 * and 4; fret 12 gets two ("double"), between strings 4-5 and strings 2-3.
 */
export interface FretMarkerPosition {
  /** 0-based row within the visible grid. */
  row: number;
  /** Horizontal position as a (possibly fractional) array index -- e.g. 2.5
   *  sits midway between the string at index 2 and the string at index 3. */
  betweenIndex: number;
  kind: "single" | "double";
}

export interface ChartLayout {
  stringCount: number;
  /** Fret the top grid boundary represents; 0 = at the nut. */
  startFret: number;
  /** Number of horizontal rows shown (4 or 5). */
  visibleFrets: number;
  dots: DotPosition[];
  glyphs: GlyphPosition[];
  fingerLabels: FingerLabelPosition[];
  tuningLabels: TuningLabelPosition[];
  fretRowLabels: FretRowLabel[];
  fretMarkers: FretMarkerPosition[];
  /** Fret-range brackets left of the grid (scale-chart mode only -- see computeMarkerLayout), in input order with stacking levels. Absent/empty when there are none. */
  brackets?: FretBracketPosition[];
  chartLabel?: string;
}

/**
 * Canonical marker/glyph/label positions for a neck diagram: a wide,
 * horizontal (nut-left, bridge-right) view over an explicit fret range,
 * as opposed to ChartLayout's compact auto-fit vertical grid. Produced by
 * computeNeckLayout (layout.ts), consumed by renderNeckSvg
 * (render/neckSvg.ts).
 */

/** A filled circle (or square/triangle/diamond, per `shape`) over a fretted string, at a specific absolute fret. */
export interface NeckDotPosition {
  /** 0-based array index (0 = low E / bottom row -- see NeckLayout). */
  stringIndex: number;
  /** Absolute fret number (always > 0 -- fret 0 is a glyph, not a dot). */
  fret: number;
  label?: string;
  className?: string;
  /** Rendered shape, from a {@link NoteMarker}'s own `shape`. Defaults to "circle" when unset. */
  shape?: NoteShape;
}

/** An "x" (muted) or "0" (open) glyph at the neck's left/nut edge. */
export interface NeckGlyphPosition {
  stringIndex: number;
  glyph: "x" | "0";
  className?: string;
  label?: string;
}

/**
 * A finger number (1-5) near a specific fretted dot. Unlike
 * {@link FingerLabelPosition}, this carries its own `fret` -- so two
 * fretted notes on the same string at different frets (routine on a wide
 * neck diagram, unlike the compact grid) never collide at the same
 * rendered position.
 */
export interface NeckFingerLabelPosition {
  stringIndex: number;
  fret: number;
  finger: number;
}

/** An open-pitch label at the neck's left edge, one per string unconditionally. */
export interface NeckTuningLabelPosition {
  stringIndex: number;
  label: string;
}

/**
 * A neck-inlay-style position marker, same convention as
 * {@link FretMarkerPosition} but keyed by absolute fret number instead of
 * a row relative to some window start -- always present within
 * [firstFret, lastFret] regardless of whether fret-number labels are shown.
 */
export interface NeckFretMarkerPosition {
  fret: number;
  /** Same convention as FretMarkerPosition.betweenIndex, now along the vertical (string) axis. */
  betweenIndex: number;
  kind: "single" | "double";
}

/**
 * An actual fret-number label above the neck (over string 1/high-E), at
 * the standard inlay frets within [firstFret, lastFret] plus firstFret
 * itself -- populated whenever the layout input's `labelFrets` isn't
 * explicitly `false` (the default), regardless of whether the diagram
 * starts at the nut.
 */
export interface NeckFretNumberLabel {
  fret: number;
}

/**
 * A labeled fret range drawn as a bracket alongside a neck diagram (below
 * the neck) or scale chart (left of the grid) -- e.g. to mark which frets
 * belong to which CAGED shape or scale/arpeggio pattern.
 * Both ends are inclusive absolute fret numbers: `{startFret: 2,
 * endFret: 5}` spans the 2nd through 5th fret columns, drawn just inside
 * the fret lines bounding that range.
 */
export interface FretBracket {
  startFret: number;
  endFret: number;
  label: string;
  className?: string;
}

/**
 * A placed {@link FretBracket}. `level` is its stacking row: 0 sits
 * closest to the fretboard, and each overlapping bracket (sharing
 * at least one fret with one already placed) moves one row further away.
 */
export interface FretBracketPosition extends FretBracket {
  level: number;
}

export interface NeckLayout {
  stringCount: number;
  /** First fret shown. 0 = the nut/open position. */
  firstFret: number;
  /** Last fret shown. */
  lastFret: number;
  dots: NeckDotPosition[];
  glyphs: NeckGlyphPosition[];
  fingerLabels: NeckFingerLabelPosition[];
  tuningLabels: NeckTuningLabelPosition[];
  fretMarkers: NeckFretMarkerPosition[];
  fretNumberLabels: NeckFretNumberLabel[];
  /** Fret-range brackets below the neck, in input order, each with its stacking `level`. */
  brackets: FretBracketPosition[];
  chartLabel?: string;
  /** Non-fatal notices -- currently just "the fret range was auto-expanded to fit a note or bracket outside [firstFret, lastFret]" (see computeNeckLayout in layout.ts). Empty when nothing needed flagging. */
  warnings: string[];
}

/**
 * Thrown when a chord's fretted span can't fit the 5-fret display cap
 * (only reachable via non-default parseChord options -- the default
 * maxSpan=5 in chordparse.ts otherwise guarantees this can't happen), or
 * when a neck diagram's firstFret/lastFret range is invalid (firstFret
 * negative or non-integer, or lastFret not a greater integer).
 */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
