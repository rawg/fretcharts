/**
 * /neck -- a neck diagram: a wide, horizontal (nut-left, bridge-right)
 * view over an explicit fret range.
 *
 * Unlike /chart, there's no notation-string alternative here -- `notes` is
 * always required, mirroring how `buildNeckDiagram` takes `notes` as a
 * required positional parameter rather than one arm of an XOR.
 */

import { buildNeckDiagram, NeckDiagramOptions } from "../chart";
import { resolveChartFields, RawChartFields } from "../chartFieldResolver";
import { ok, invalid, ApiResult } from "./result";

interface NeckRequestBody {
  /** Required: JSON array or compact "string:fret[:label[:className[:finger[:shape]]]];..." notation. */
  notes?: unknown;
  /** Raw comma-separated string numbers to render muted, e.g. "4,2". Same format as /chart's mutedStrings. */
  mutedStrings?: unknown;
  label?: unknown;
  tuning?: unknown;
  labelPitches?: unknown;
  labelTuning?: unknown;
  /** Whether to show a fret-number label above the neck (over string 1/high-E), at the standard inlay frets within [firstFret, lastFret] plus firstFret itself. Defaults to `true`. */
  labelFrets?: unknown;
  /** First fret shown. Defaults to 0 (the nut/open position). */
  firstFret?: unknown;
  /** Last fret shown. Defaults to firstFret + 12. */
  lastFret?: unknown;
  /** Labeled fret-range brackets below the neck: JSON array of {startFret, endFret, label, className?} or compact "startFret-endFret:label[:className];..." notation. */
  brackets?: unknown;
  /** Raw CSS text -- never a file path; the browser has no local file to read. */
  stylesheet?: unknown;
  /** Raw SVG markup text, embedded as-is into a `<defs>` element -- never a file path, same reasoning as `stylesheet`. */
  defs?: unknown;
  /** Shifts every marker's fret by this many frets/half-steps (positive = up, negative = down) before rendering -- an explicit firstFret/lastFret shifts along with it. See NeckDiagramOptions.transpose (chart.ts). */
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

export function handleNeck(body: unknown): ApiResult {
  if (typeof body !== "object" || body === null) {
    return invalid("request body must be a JSON object");
  }
  const req = body as NeckRequestBody;

  if (!isNonEmptyString(req.notes)) {
    return invalid("notes is required");
  }
  // Explicit type checks rather than silently falling back to undefined --
  // a wrong-typed firstFret/lastFret should be a clean 400, not silently
  // dropped in favor of the default range.
  if (req.firstFret !== undefined && !isNumber(req.firstFret)) {
    return invalid("firstFret must be a number");
  }
  if (req.lastFret !== undefined && !isNumber(req.lastFret)) {
    return invalid("lastFret must be a number");
  }
  if (req.brackets !== undefined && !isString(req.brackets)) {
    return invalid("brackets must be a string");
  }
  if (req.transpose !== undefined && !isNumber(req.transpose)) {
    return invalid("transpose must be a number");
  }

  // Reuses the same chord-field parsing /chart's scale-chart mode uses for
  // notes/mutedStrings/label/tuning/labelPitches/labelTuning/labelFrets --
  // firstFret/lastFret are neck-diagram-specific and passed straight
  // through instead, same as src/cli.ts keeps them outside
  // chartFieldResolver.
  const raw: RawChartFields = {
    label: isString(req.label) ? req.label : undefined,
    tuning: isString(req.tuning) ? req.tuning : undefined,
    labelPitches: isBoolean(req.labelPitches) ? req.labelPitches : undefined,
    labelTuning: isBoolean(req.labelTuning) ? req.labelTuning : undefined,
    labelFrets: isBoolean(req.labelFrets) ? req.labelFrets : undefined,
    markersJson: req.notes,
    mutedStrings: isString(req.mutedStrings) ? req.mutedStrings : undefined,
    // An empty string (e.g. a blank web form field) means "no brackets," not a parse error.
    bracketsText: isNonEmptyString(req.brackets) && req.brackets.trim() !== "" ? req.brackets : undefined,
  };
  const resolved = resolveChartFields(raw);

  // The isNonEmptyString(req.notes) guard above already guarantees
  // resolved.markers is populated; re-checked instead of asserted so this
  // stays type-safe without a non-null assertion.
  const markers = resolved.markers ?? [];

  const options: NeckDiagramOptions = {
    label: resolved.label,
    tuning: resolved.tuning,
    labelPitches: resolved.labelPitches,
    labelTuning: resolved.labelTuning,
    labelFrets: resolved.labelFrets,
    mutedStrings: resolved.mutedStrings,
    firstFret: isNumber(req.firstFret) ? req.firstFret : undefined,
    lastFret: isNumber(req.lastFret) ? req.lastFret : undefined,
    brackets: resolved.brackets,
    transpose: isNumber(req.transpose) ? req.transpose : undefined,
    svgOptions:
      isString(req.stylesheet) || isString(req.defs)
        ? { stylesheet: isString(req.stylesheet) ? req.stylesheet : undefined, defs: isString(req.defs) ? req.defs : undefined }
        : undefined,
  };

  const { svg, layout } = buildNeckDiagram(markers, options);
  const warnings = layout.warnings.length > 0 ? layout.warnings : undefined;

  return ok({ svg, warnings });
}
