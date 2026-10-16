/**
 * /bulk -- many chords composited into one grid image.
 *
 * Security note: this route must NEVER populate RawChartFields.stylesheetPath
 * or RawChartFields.defsPath from request data. Those fields mean "read this
 * path from disk" (see bulk.ts) -- there's no local filesystem to read
 * from in the browser. Any CSS the caller supplies goes through
 * buildBulkSvg's file-free `inlineStylesheet` parameter instead; any SVG defs markup goes through
 * `defaults.defsText` (raw text, never a path -- see bulk.ts's per-row
 * `defs` resolution), and a CSV "stylesheet" column (bulk.ts's per-row
 * equivalent of the same footgun) is rejected outright below.
 */

import { parse } from "csv-parse/sync";
import { buildBulkGrid } from "../bulk";
import { RawChartFields } from "../chartFieldResolver";
import { ok, invalid, gridParts, ApiResult } from "./result";

const DEFAULT_COLUMNS = 4;

/**
 * Hard cap on CSV data rows. Not a correctness requirement -- just a
 * defensive bound so one very large paste can't lock up the browser tab
 * with an extremely slow render (or an oversized PNG canvas).
 */
const MAX_ROWS = 200;

interface BulkDefaultsBody {
  label?: unknown;
  stringLabels?: unknown;
  fingerPositions?: unknown;
  noteClasses?: unknown;
  noteShapes?: unknown;
  root?: unknown;
  tuning?: unknown;
  labelPitches?: unknown;
  labelTuning?: unknown;
}

interface BulkRequestBody {
  csv?: unknown;
  defaults?: unknown;
  columns?: unknown;
  collectionLabel?: unknown;
  /** Raw CSS text, applied to the whole grid -- never a file path. */
  stylesheet?: unknown;
  /** Raw SVG markup text, applied to the whole grid as a `<defs>` element -- never a file path, same reasoning as `stylesheet`. */
  defs?: unknown;
  /** Shifts every row's chord notation by this many frets/half-steps (positive = up, negative = down). See buildBulkSvg's own doc comment (bulk.ts). */
  transpose?: unknown;
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

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** First (header) row only, or [] if the CSV can't even be parsed that far. */
function csvHeaderColumns(csvText: string): string[] {
  try {
    const rows = parse(csvText, { to: 1, trim: true }) as string[][];
    return rows[0] ?? [];
  } catch {
    return [];
  }
}

/** Data-row count, or 0 if unparseable -- buildBulkSvg's own parse below
 *  surfaces the real, well-formatted error for genuinely malformed CSV. */
function csvDataRowCount(csvText: string): number {
  try {
    const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as unknown[];
    return rows.length;
  } catch {
    return 0;
  }
}

export function handleBulk(body: unknown): ApiResult {
  if (typeof body !== "object" || body === null) {
    return invalid("request body must be a JSON object");
  }
  const req = body as BulkRequestBody;

  if (!isNonEmptyString(req.csv)) {
    return invalid("csv is required and must be a non-empty string");
  }
  if (req.transpose !== undefined && !isNumber(req.transpose)) {
    return invalid("transpose must be a number");
  }

  if (csvHeaderColumns(req.csv).includes("stylesheet")) {
    return invalid('"stylesheet" is not a supported CSV column -- use the request\'s top-level "stylesheet" field to style the whole grid instead');
  }

  const rowCount = csvDataRowCount(req.csv);
  if (rowCount > MAX_ROWS) {
    return invalid(`too many rows (${rowCount}); the maximum is ${MAX_ROWS}`);
  }

  const columns = typeof req.columns === "number" ? req.columns : DEFAULT_COLUMNS;

  const defaultsBody: BulkDefaultsBody =
    typeof req.defaults === "object" && req.defaults !== null ? (req.defaults as BulkDefaultsBody) : {};
  // Explicitly enumerated, never a `...req.defaults` spread -- see the
  // module doc comment on why stylesheetPath must never appear here.
  const defaults: RawChartFields = {
    label: isString(defaultsBody.label) ? defaultsBody.label : undefined,
    stringLabels: isString(defaultsBody.stringLabels) ? defaultsBody.stringLabels : undefined,
    fingerPositions: isString(defaultsBody.fingerPositions) ? defaultsBody.fingerPositions : undefined,
    noteClasses: isString(defaultsBody.noteClasses) ? defaultsBody.noteClasses : undefined,
    noteShapes: isString(defaultsBody.noteShapes) ? defaultsBody.noteShapes : undefined,
    root: isString(defaultsBody.root) ? defaultsBody.root : undefined,
    tuning: isString(defaultsBody.tuning) ? defaultsBody.tuning : undefined,
    labelPitches: isBoolean(defaultsBody.labelPitches) ? defaultsBody.labelPitches : undefined,
    labelTuning: isBoolean(defaultsBody.labelTuning) ? defaultsBody.labelTuning : undefined,
    defsText: isString(req.defs) ? req.defs : undefined,
  };

  const grid = buildBulkGrid(
    req.csv,
    defaults,
    columns,
    isString(req.collectionLabel) ? req.collectionLabel : undefined,
    isString(req.stylesheet) ? req.stylesheet : undefined,
    isNumber(req.transpose) ? req.transpose : undefined,
  );

  return ok({ svg: grid.svg, grid: gridParts(grid) });
}
