/**
 * /chart -- a single chord chart (via notation) or a single scale chart
 * (via notes).
 */

import { buildChart, RenderChartOptions } from "../chart";
import { resolveChartFields, RawChartFields } from "../chartFieldResolver";
import { ok, invalid, ApiResult } from "./result";

interface ChartRequestBody {
  notation?: unknown;
  /** Scale-chart mode: raw notes text -- JSON array or the compact
   *  "string:fret[:label[:className[:finger[:shape]]]];..." notation.
   *  Mutually exclusive with `notation`; exactly one of the two is
   *  required. */
  notes?: unknown;
  /** Scale-chart mode only: raw comma-separated string numbers to render
   *  muted, e.g. "4,2". Same format as `root`. */
  mutedStrings?: unknown;
  label?: unknown;
  stringLabels?: unknown;
  fingerPositions?: unknown;
  noteClasses?: unknown;
  noteShapes?: unknown;
  root?: unknown;
  tuning?: unknown;
  labelPitches?: unknown;
  labelTuning?: unknown;
  /** Scale-chart mode only (chord-notation mode ignores this): whether to show fret-number reference labels. Defaults to `true`. */
  labelFrets?: unknown;
  /** Scale-chart mode only: labeled fret-range brackets left of the grid -- JSON array of {startFret, endFret, label, className?} or compact "startFret-endFret:label[:className];..." notation. Blank means none. */
  brackets?: unknown;
  /** Raw CSS text -- never a file path; the browser has no local file to read. */
  stylesheet?: unknown;
  /** Raw SVG markup text, embedded as-is into a `<defs>` element -- never a file path, same reasoning as `stylesheet`. */
  defs?: unknown;
  /** Shifts every note by this many frets/half-steps (positive = up, negative = down) before rendering. See RenderChartOptions.transpose (chart.ts). */
  transpose?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function handleChart(body: unknown): ApiResult {
  if (typeof body !== "object" || body === null) {
    return invalid("request body must be a JSON object");
  }
  const req = body as ChartRequestBody;

  // Exactly one of notation/notes is required -- mirrors src/cli.ts's own
  // notation-vs-`--notes` gating, with the UI's own field names rather than
  // leaking buildChart's internal "options.notes" phrasing (buildChart
  // would also reject an invalid combination, but its error text names
  // its own parameters, not this route's field names).
  if (isNonEmptyString(req.notation) && isNonEmptyString(req.notes)) {
    return invalid("cannot combine notation with notes -- provide exactly one");
  }
  if (!isNonEmptyString(req.notation) && !isNonEmptyString(req.notes)) {
    return invalid("either notation or notes is required");
  }
  if (req.transpose !== undefined && !isNumber(req.transpose)) {
    return invalid("transpose must be a number");
  }
  if (req.brackets !== undefined && !isString(req.brackets)) {
    return invalid("brackets must be a string");
  }
  // A blank string (e.g. an empty web form field) means "no brackets."
  const hasBrackets = isString(req.brackets) && req.brackets.trim() !== "";
  if (hasBrackets && isNonEmptyString(req.notation)) {
    return invalid("brackets are only supported with notes (scale-chart mode), not notation");
  }

  const notation = isNonEmptyString(req.notation) ? req.notation : undefined;

  // Deliberately never populates stylesheetPath -- there's no local file
  // to read in the browser; stylesheet text goes straight into
  // svgOptions.stylesheet below instead, which chart.ts embeds as raw CSS
  // with zero file I/O involved.
  const raw: RawChartFields = {
    label: isString(req.label) ? req.label : undefined,
    stringLabels: isString(req.stringLabels) ? req.stringLabels : undefined,
    fingerPositions: isString(req.fingerPositions) ? req.fingerPositions : undefined,
    noteClasses: isString(req.noteClasses) ? req.noteClasses : undefined,
    noteShapes: isString(req.noteShapes) ? req.noteShapes : undefined,
    root: isString(req.root) ? req.root : undefined,
    tuning: isString(req.tuning) ? req.tuning : undefined,
    labelPitches: isBoolean(req.labelPitches) ? req.labelPitches : undefined,
    labelTuning: isBoolean(req.labelTuning) ? req.labelTuning : undefined,
    labelFrets: isBoolean(req.labelFrets) ? req.labelFrets : undefined,
    markersJson: isNonEmptyString(req.notes) ? req.notes : undefined,
    mutedStrings: isString(req.mutedStrings) ? req.mutedStrings : undefined,
    bracketsText: hasBrackets ? (req.brackets as string) : undefined,
  };
  const resolved = resolveChartFields(raw);

  const options: RenderChartOptions = {
    label: resolved.label,
    stringLabels: resolved.stringLabels,
    fingerPositions: resolved.fingerPositions,
    noteClasses: resolved.noteClasses,
    noteShapes: resolved.noteShapes,
    tuning: resolved.tuning,
    labelPitches: resolved.labelPitches,
    labelTuning: resolved.labelTuning,
    labelFrets: resolved.labelFrets,
    notes: resolved.markers,
    mutedStrings: resolved.mutedStrings,
    brackets: resolved.brackets,
    transpose: isNumber(req.transpose) ? req.transpose : undefined,
    svgOptions:
      isString(req.stylesheet) || isString(req.defs)
        ? { stylesheet: isString(req.stylesheet) ? req.stylesheet : undefined, defs: isString(req.defs) ? req.defs : undefined }
        : undefined,
  };

  const { svg } = buildChart(notation, options);
  return ok({ svg });
}
