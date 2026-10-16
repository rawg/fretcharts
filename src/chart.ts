/**
 * Programmatic entry point for building and rendering a chord chart end to
 * end: notation string -> parsed chord -> layout -> SVG (and optionally
 * PNG). This is the surface a caller like an AWS Lambda handler is expected
 * to import directly, so it must stay free of any I/O -- no reading
 * `process.argv`, no writing to stdout/stderr, no `process.exit`. All of
 * that lives in `./cli` instead.
 */

import {
  Chord,
  ChordParseError,
  ParseOptions,
  parseChord,
} from "./chordparse";
import { computeLayout, computeMarkerLayout, computeNeckLayout } from "./layout";
import { ChartLayout, ChordChartOptions, LayoutError, FretBracket, NeckLayout, NoteMarker } from "./types";
import { renderSvg, SvgRenderOptions } from "./render/svg";
import { renderNeckSvg, NeckSvgRenderOptions } from "./render/neckSvg";
import { renderPng } from "./render/png";
import { DEFAULT_TUNING, TuningError, parseTuning, pitchLabelsForChord, pitchLabelsForMarkers } from "./tuning";
import { ChartInputError } from "./chartFieldResolver";
import { transposeBrackets, transposeChord, transposeMarkers, transposeFretRange } from "./transpose";

export interface RenderChartOptions extends ChordChartOptions {
  /** Options forwarded to parseChord (maxFret, maxSpan). stringCount is
   *  always derived from `tuning`'s length, overriding any stringCount set
   *  here. */
  parseOptions?: ParseOptions;
  /** Options forwarded to renderSvg (cellSize, dotRadius, colors, etc.). */
  svgOptions?: SvgRenderOptions;
  /**
   * Shifts every sounding note by this many frets/half-steps (positive =
   * up, negative = down) before layout -- e.g. `transpose: 2` turns an
   * A-major chord shape (`x02220`) into the same shape two frets up (a B
   * major barre). Applied to `notation`'s parsed chord or to `notes`,
   * whichever is in play; a shift that would put any note below the nut
   * (fret 0) throws {@link ChartInputError}. See transpose.ts.
   */
  transpose?: number;
  /**
   * Tuning notation (e.g. "DADGBE"), low string first -- same order as
   * chord notation. Its length determines the chord's string count.
   * Defaults to standard EADGBE.
   */
  tuning?: string;
  /**
   * Auto-label each fretted note with its computed pitch (e.g. "F#"),
   * using `tuning`. Never applied to open or muted strings. In chord-
   * notation mode, an explicit `stringLabels` entry for a string takes
   * precedence over its computed pitch label; in scale-chart mode
   * (`options.notes`), a marker's own explicit `label` wins the same way.
   */
  labelPitches?: boolean;
  /**
   * Label every string with its open pitch from `tuning`, above the
   * mute/open glyphs and below the chart label. Unlike `labelPitches`,
   * every string gets one regardless of fret/mute/open state -- this
   * describes the tuning itself, not what's currently sounding.
   */
  labelTuning?: boolean;
  /**
   * Scale-chart mode: multiple independently labeled/classed/shaped/
   * fingered markers, rather than a single chord notation string. Mutually
   * exclusive with the `notation` argument -- exactly one of the two must
   * be given. stringLabels/fingerPositions/noteClasses/noteShapes are
   * chord-notation-specific and silently unused in this mode, since each
   * marker already carries its own label/className/shape/finger directly.
   * `labelPitches` IS honored in this mode -- see its own doc comment.
   */
  notes?: NoteMarker[];
  /**
   * Scale-chart mode only. A string listed here renders "x" and silently
   * drops any marker in `notes` targeting the same string.
   */
  mutedStrings?: (1 | 2 | 3 | 4 | 5 | 6)[];
  /**
   * Scale-chart mode only (chord-notation mode ignores this): whether to
   * show a fret-number label to the right of the grid's 1st, 3rd, and
   * (when shown) 5th rows. Defaults to `true` -- pass `false` to omit
   * them.
   */
  labelFrets?: boolean;
  /**
   * Scale-chart mode only: labeled fret ranges drawn as brackets left of
   * the grid (e.g. CAGED shapes or scale positions), same model as
   * {@link NeckDiagramOptions.brackets}. Their frets take part in fitting
   * the visible window, and `transpose` shifts them along with the notes.
   * Combining this with a chord notation string throws ChartInputError.
   */
  brackets?: FretBracket[];
}

export interface Chart {
  /** Only populated for notation-based (chord) calls; undefined for notes-based (scale-chart) calls. */
  chord?: Chord;
  layout: ChartLayout;
  svg: string;
}

/**
 * Builds and renders a chart to SVG -- either a chord (from `notation`) or
 * a scale chart (from `options.notes`). Exactly one of the two must be
 * given; this is the single entry point for both.
 *
 * @throws {ChartInputError} if both or neither of `notation`/`options.notes` are given,
 *   or `options.brackets` is combined with `notation`.
 * @throws {TuningError} if `tuning` isn't valid tuning notation.
 * @throws {ChordParseError} (or its subclass AmbiguousChordError) if the
 *   notation has no valid reading, or more than one.
 * @throws {LayoutError} if the fretted span (chord or notes mode) can't
 *   fit the 5-fret display cap (only reachable with non-default
 *   parseOptions in chord mode; always reachable in notes mode).
 */
export function buildChart(notation?: string, options?: RenderChartOptions): Chart {
  if (notation !== undefined && options?.notes !== undefined) {
    throw new ChartInputError("cannot combine a chord notation string with options.notes");
  }
  if (notation === undefined && options?.notes === undefined) {
    throw new ChartInputError("buildChart requires either a chord notation string or options.notes");
  }
  if (notation !== undefined && options?.brackets !== undefined) {
    throw new ChartInputError("brackets are only supported in scale-chart mode (options.notes), not with a chord notation string");
  }

  const tuning = options?.tuning !== undefined ? parseTuning(options.tuning) : DEFAULT_TUNING;

  if (notation !== undefined) {
    let chord = parseChord(notation, {
      ...options?.parseOptions,
      stringCount: tuning.length,
    });
    if (options?.transpose !== undefined) {
      chord = transposeChord(chord, options.transpose);
    }

    let stringLabels = options?.stringLabels;
    if (options?.labelPitches) {
      const pitchLabels = pitchLabelsForChord(chord, tuning);
      // An explicit stringLabels entry for a string wins over its computed
      // pitch label.
      stringLabels = { ...pitchLabels, ...stringLabels };
    }

    const layout = computeLayout(chord, {
      label: options?.label,
      stringLabels,
      fingerPositions: options?.fingerPositions,
      noteClasses: options?.noteClasses,
      noteShapes: options?.noteShapes,
      tuningLabels: options?.labelTuning ? tuning : undefined,
    });
    const svg = renderSvg(layout, options?.svgOptions);
    return { chord, layout, svg };
  }

  // Scale-chart mode. The guards above already ensure options.notes is
  // defined whenever we reach here (notation is undefined in this branch,
  // and "neither given" was already rejected) -- re-checked instead of
  // asserted so this stays type-safe without a non-null assertion.
  let markers = options?.notes;
  if (markers === undefined) {
    throw new ChartInputError("buildChart requires either a chord notation string or options.notes");
  }
  if (options?.transpose !== undefined) {
    markers = transposeMarkers(markers, options.transpose);
  }
  if (options?.labelPitches) {
    markers = pitchLabelsForMarkers(markers, tuning);
  }

  const layout = computeMarkerLayout({
    stringCount: tuning.length,
    markers,
    mutedStrings: options?.mutedStrings,
    label: options?.label,
    tuningLabels: options?.labelTuning ? tuning : undefined,
    labelFrets: options?.labelFrets,
    brackets:
      options?.brackets !== undefined && options.transpose !== undefined
        ? transposeBrackets(options.brackets, options.transpose)
        : options?.brackets,
  });
  const svg = renderSvg(layout, options?.svgOptions);
  return { layout, svg };
}

/**
 * Non-throwing variant of {@link buildChart}, for rendering pipelines that
 * should degrade rather than crash on malformed input.
 */
export function tryBuildChart(
  notation?: string,
  options?: RenderChartOptions,
):
  | { ok: true; chart: Chart }
  | { ok: false; error: ChordParseError | LayoutError | TuningError | ChartInputError } {
  try {
    return { ok: true, chart: buildChart(notation, options) };
  } catch (err) {
    if (
      err instanceof ChordParseError ||
      err instanceof LayoutError ||
      err instanceof TuningError ||
      err instanceof ChartInputError
    ) {
      return { ok: false, error: err };
    }
    throw err;
  }
}

/**
 * Builds a chart (chord or scale, same rules as {@link buildChart}) and
 * rasterizes it to a PNG buffer.
 *
 * @throws {ChordParseError|AmbiguousChordError|LayoutError|ChartInputError} same as
 *   {@link buildChart}.
 */
export async function renderChartPng(
  notation?: string,
  options?: RenderChartOptions,
): Promise<Buffer> {
  const { svg } = buildChart(notation, options);
  return renderPng(svg);
}

export interface NeckDiagramOptions {
  /** Text label for the whole diagram, rendered above the neck. */
  label?: string;
  /**
   * A string listed here renders "x" and silently drops any marker in
   * `notes` targeting the same string. Same convention as
   * {@link RenderChartOptions.mutedStrings}.
   */
  mutedStrings?: (1 | 2 | 3 | 4 | 5 | 6)[];
  /**
   * Tuning notation (e.g. "DADGBE"), low string first. Its length
   * determines the diagram's string count. Defaults to standard EADGBE.
   */
  tuning?: string;
  /**
   * Label every string with its open pitch from `tuning`, at the neck's
   * left edge. Every string gets one regardless of fret/mute/open state --
   * same convention as {@link RenderChartOptions.labelTuning}.
   */
  labelTuning?: boolean;
  /**
   * Auto-label each fretted marker (`fret > 0`) with its computed pitch
   * (e.g. "F#"), using `tuning`. Never applied to open-string markers
   * (`fret === 0`). A marker's own explicit `label` wins over its computed
   * pitch label -- same convention as {@link RenderChartOptions.labelPitches}
   * in scale-chart mode.
   */
  labelPitches?: boolean;
  /** First fret shown. Defaults to 0 (the nut/open position). */
  firstFret?: number;
  /** Last fret shown. Defaults to `firstFret + 12`. */
  lastFret?: number;
  /**
   * Whether to show a fret-number label above the neck (over string 1/
   * high-E), at the standard inlay frets within [firstFret, lastFret] plus
   * firstFret itself -- regardless of whether the diagram starts at the
   * nut. Defaults to `true` -- pass `false` to omit them.
   */
  labelFrets?: boolean;
  /**
   * Labeled fret ranges drawn as brackets below the neck (e.g. CAGED
   * shapes or scale positions). Overlapping brackets stack away from the
   * neck. Like notes, a bracket outside [firstFret, lastFret] grows the
   * window, and `transpose` shifts brackets along with the notes.
   */
  brackets?: FretBracket[];
  /**
   * Shifts every marker's fret by this many frets/half-steps (positive =
   * up, negative = down) before layout, same meaning as
   * {@link RenderChartOptions.transpose} -- an explicit `firstFret`/
   * `lastFret` shifts along with the notes, so the window follows the
   * shape (see transposeFretRange in transpose.ts). A shift that would
   * put any marker below the nut throws {@link ChartInputError}.
   */
  transpose?: number;
  /** Options forwarded to renderNeckSvg (spacing, radii, colors, etc.). */
  svgOptions?: NeckSvgRenderOptions;
}

export interface NeckDiagram {
  layout: NeckLayout;
  svg: string;
}

/**
 * Builds and renders a neck diagram to SVG: a wide, horizontal (nut-left,
 * bridge-right) view of an explicit fret range, reusing the same
 * {@link NoteMarker}-based model as buildChart's scale-chart mode. Unlike
 * {@link buildChart}, `notes` is a required positional parameter -- there's
 * no chord-notation alternative to guard against here.
 *
 * @throws {TuningError} if `tuning` isn't valid tuning notation.
 * @throws {LayoutError} if `firstFret`/`lastFret` describe an invalid range
 *   (firstFret negative or non-integer, or lastFret not a greater integer),
 *   or a bracket's startFret/endFret do.
 */
export function buildNeckDiagram(notes: NoteMarker[], options?: NeckDiagramOptions): NeckDiagram {
  const tuning = options?.tuning !== undefined ? parseTuning(options.tuning) : DEFAULT_TUNING;
  let markers = options?.transpose !== undefined ? transposeMarkers(notes, options.transpose) : notes;
  if (options?.labelPitches) {
    markers = pitchLabelsForMarkers(markers, tuning);
  }
  const { firstFret, lastFret } =
    options?.transpose !== undefined
      ? transposeFretRange(options.firstFret, options.lastFret, options.transpose)
      : { firstFret: options?.firstFret, lastFret: options?.lastFret };

  const layout = computeNeckLayout({
    stringCount: tuning.length,
    markers,
    mutedStrings: options?.mutedStrings,
    firstFret,
    lastFret,
    label: options?.label,
    tuningLabels: options?.labelTuning ? tuning : undefined,
    labelFrets: options?.labelFrets,
    brackets:
      options?.brackets !== undefined && options.transpose !== undefined
        ? transposeBrackets(options.brackets, options.transpose)
        : options?.brackets,
  });
  const svg = renderNeckSvg(layout, options?.svgOptions);
  return { layout, svg };
}

/**
 * Non-throwing variant of {@link buildNeckDiagram}, for rendering pipelines
 * that should degrade rather than crash on malformed input.
 */
export function tryBuildNeckDiagram(
  notes: NoteMarker[],
  options?: NeckDiagramOptions,
): { ok: true; diagram: NeckDiagram } | { ok: false; error: TuningError | LayoutError } {
  try {
    return { ok: true, diagram: buildNeckDiagram(notes, options) };
  } catch (err) {
    if (err instanceof LayoutError || err instanceof TuningError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}

/**
 * Builds a neck diagram (same rules as {@link buildNeckDiagram}) and
 * rasterizes it to a PNG buffer.
 *
 * @throws {TuningError|LayoutError} same as {@link buildNeckDiagram}.
 */
export async function renderNeckDiagramPng(
  notes: NoteMarker[],
  options?: NeckDiagramOptions,
): Promise<Buffer> {
  const { svg } = buildNeckDiagram(notes, options);
  return renderPng(svg);
}
