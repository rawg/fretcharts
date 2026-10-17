/**
 * Bulk mode: renders every row of a CSV file to its own chart, then
 * composites them into one grid SVG. Each column maps to a chart parameter
 * by heading name (see COLUMN_TO_FIELD below); the chord notation itself
 * has no named CLI flag, so its column must be called "notes". Any value
 * supplied on the command line becomes the default for a row that leaves
 * that column blank or omits it entirely; the CSV always wins when a row
 * gives a non-empty value. An optional collection-wide label titles the
 * whole composite image, centered above the grid.
 *
 * Unlike chart.ts, this module does its own file I/O (reading per-row
 * stylesheet paths) rather than staying strictly I/O-free -- bulk mode is
 * inherently file-driven (the CSV itself is a file), so that discipline
 * buys less here than it does for the single-chart API.
 *
 * `buildBulkSvg`'s optional `inlineStylesheet` parameter is a second,
 * file-free way to supply a default stylesheet -- raw CSS text used for any
 * row that doesn't have its own `stylesheetPath`. This exists for non-CLI
 * callers (e.g. an HTTP handler) that have no legitimate server-side file
 * to read: such a caller should never populate `stylesheetPath` (from
 * either `defaults` or a CSV "stylesheet" column) in the first place, since
 * a remote request fully controls that value and passing it straight to
 * `fs.readFileSync` would be an arbitrary local file read.
 */

import * as fs from "fs";
import { parse } from "csv-parse/sync";
import { buildChart } from "./chart";
import { ChartInputError, RawChartFields, resolveChartFields } from "./chartFieldResolver";
import { writeSvgOutput, isDocumentOutputPath, writeDocumentOutput } from "./outputWriter";
import { transposeNotation } from "./transpose";
import { parseTuning, DEFAULT_TUNING } from "./tuning";
// Type-only: erased at compile time, so this doesn't create a runtime
// circular dependency even though document.ts imports buildBulkSvg/
// COLUMN_TO_FIELD from this module -- same reasoning as outputWriter.ts's
// identical ChartDocument import.
import type { ChordsDocument } from "./document";

const REQUIRED_NOTATION_COLUMN = "notes";

/**
 * Optional column that starts a new section of the grid: a row with a
 * non-empty `header` cell begins a fresh grid row under that heading. The
 * row may also carry its own chart (the section's first), or leave
 * `notes` blank to be a heading-only row.
 */
const HEADER_COLUMN = "header";

/**
 * CSV column heading -> RawChartFields key. "notes" (notation) is handled
 * separately. Exported so document.ts can validate a `type: chords`
 * document's `defaults` object against the exact same set of
 * bulk-recognized field names, rather than maintaining a second,
 * potentially-drifting list.
 */
export const COLUMN_TO_FIELD: Record<string, keyof RawChartFields> = {
  label: "label",
  "string-labels": "stringLabels",
  "finger-positions": "fingerPositions",
  "note-classes": "noteClasses",
  "note-shapes": "noteShapes",
  root: "root",
  tuning: "tuning",
  "label-pitches": "labelPitches",
  "label-tuning": "labelTuning",
  stylesheet: "stylesheetPath",
  // Per-string overrides, one column per guitar string -- same
  // "wins over the aggregate column for that string" precedence as the
  // matching --string-label-N/--finger-position-N CLI flags. See
  // RawChartFields's doc comment in chartFieldResolver.ts.
  "string-label-1": "stringLabel1",
  "string-label-2": "stringLabel2",
  "string-label-3": "stringLabel3",
  "string-label-4": "stringLabel4",
  "string-label-5": "stringLabel5",
  "string-label-6": "stringLabel6",
  "finger-position-1": "fingerPosition1",
  "finger-position-2": "fingerPosition2",
  "finger-position-3": "fingerPosition3",
  "finger-position-4": "fingerPosition4",
  "finger-position-5": "fingerPosition5",
  "finger-position-6": "fingerPosition6",
};

const BOOLEAN_FIELDS = new Set<keyof RawChartFields>(["labelPitches", "labelTuning"]);

/** px gap between adjacent charts in the grid, both across and down. */
const GUTTER = 20;

/** px band reserved above the grid for the collection label, when given. */
const COLLECTION_LABEL_BAND_HEIGHT = 50;
const COLLECTION_LABEL_FONT_SIZE = 28;

/** px band reserved above each section that has a header (see HEADER_COLUMN). */
const SECTION_LABEL_BAND_HEIGHT = 40;
const SECTION_LABEL_FONT_SIZE = 22;

/** A run of charts under one optional heading. Only a grid's first section can lack a header. */
export interface BulkSection {
  header?: string;
  charts: string[];
}

/** Escapes the basic XML special characters in the collection label's text content. */
function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cellOrDefault(cell: string | undefined, fallback: string | undefined): string | undefined {
  return cell !== undefined && cell !== "" ? cell : fallback;
}

function parseBoolCell(cell: string, context: string): boolean {
  const v = cell.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  throw new ChartInputError(`invalid boolean value ${JSON.stringify(cell)} in ${context}: use true/false`);
}

/** Builds one row's RawChartFields, CSV cell values winning over CLI defaults. */
function rowRawFields(row: Record<string, string>, defaults: RawChartFields, rowNumber: number): RawChartFields {
  const raw: RawChartFields = { ...defaults };
  for (const [column, field] of Object.entries(COLUMN_TO_FIELD)) {
    const cell = row[column];
    if (BOOLEAN_FIELDS.has(field)) {
      if (cell !== undefined && cell !== "") {
        (raw[field] as boolean | undefined) = parseBoolCell(cell, `row ${rowNumber} column "${column}"`);
      }
      continue;
    }
    (raw[field] as string | undefined) = cellOrDefault(cell, raw[field] as string | undefined);
  }
  return raw;
}

/** Inserts x/y attributes into an SVG string's root <svg> tag, positioning it as a nested viewport. */
function positionSvg(svg: string, x: number, y: number): string {
  return svg.replace(/^<svg /, `<svg x="${x}" y="${y}" `);
}

function svgDimensions(svg: string): { width: number; height: number } {
  const width = Number(/\swidth="([\d.]+)"/.exec(svg)?.[1]);
  const height = Number(/\sheight="([\d.]+)"/.exec(svg)?.[1]);
  return { width, height };
}

function textElement(className: string, x: number, y: number, fontSize: number, text: string): string {
  return `<text class="${className}" x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
    text,
  )}</text>`;
}

/**
 * Arranges chart SVGs into a grid, `columns` per row, each cell top-left
 * aligned. Each section starts on a fresh row, under its header (if any)
 * centered in its own band. `collectionLabel`, if given, is centered in a
 * band above everything, and every chart is shifted down to make room.
 */
function composeGrid(sections: BulkSection[], columns: number, collectionLabel?: string): string {
  const allCharts = sections.flatMap((s) => s.charts);
  const dims = allCharts.map(svgDimensions);
  const cellWidth = Math.max(...dims.map((d) => d.width));
  const cellHeight = Math.max(...dims.map((d) => d.height));

  const cols = Math.min(columns, Math.max(...sections.map((s) => s.charts.length)));
  const totalWidth = cols * cellWidth + (cols - 1) * GUTTER;

  const labelBandHeight = collectionLabel ? COLLECTION_LABEL_BAND_HEIGHT : 0;
  const elements: string[] = [];
  let y = labelBandHeight;
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) y += GUTTER;
    if (section.header !== undefined) {
      elements.push(
        textElement("chord-collection-section-label", totalWidth / 2, y + SECTION_LABEL_BAND_HEIGHT / 2, SECTION_LABEL_FONT_SIZE, section.header),
      );
      y += SECTION_LABEL_BAND_HEIGHT;
    }
    section.charts.forEach((svg, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      elements.push(positionSvg(svg, col * (cellWidth + GUTTER), y + row * (cellHeight + GUTTER)));
    });
    const rows = Math.ceil(section.charts.length / columns);
    if (rows > 0) y += rows * cellHeight + (rows - 1) * GUTTER;
  });
  const totalHeight = y;

  const labelElement = collectionLabel
    ? textElement("chord-collection-label", totalWidth / 2, labelBandHeight / 2, COLLECTION_LABEL_FONT_SIZE, collectionLabel)
    : "";

  // Covers the full canvas, including the gutters between charts -- each
  // chart's own background (see render/svg.ts's chord-chart-background)
  // only covers its own cell. Transparent by default, classed for
  // stylesheet overrides.
  const backgroundElement = `<rect class="chord-collection-background" x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="none" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">${backgroundElement}${labelElement}${elements.join(
    "",
  )}</svg>`;
}

/**
 * Renders every row of `csvText` and composites the results into one grid
 * SVG, `columns` charts per row, wrapping to additional rows as needed. A
 * row with a `header` cell starts a new section on a fresh row, titled by
 * that text (see HEADER_COLUMN).
 * `collectionLabel`, if given, titles the whole composite image, centered
 * above the grid. `inlineStylesheet`, if given, is raw CSS text used as the
 * default stylesheet for any row that doesn't resolve its own
 * `stylesheetPath` (see the module doc comment above) -- a `stylesheetPath`
 * always wins when present, since it's an explicit, more specific choice.
 * `transpose`, if given, shifts every row's chord notation by that many
 * frets/half-steps (same meaning as RenderChartOptions.transpose in
 * chart.ts) -- applied uniformly to every row, unlike every other option
 * here there's no per-row CSV column for it.
 *
 * @throws {ChartInputError} for malformed CSV syntax (e.g. an unescaped
 *   quote in a field), CSV structure problems (missing "notes" column, no
 *   data rows), a malformed field value, or any buildChart failure (bad
 *   notation, bad tuning, a transpose that would put a row's note below
 *   the nut, etc.) -- syntax errors included, always prefixed with the
 *   offending row number where one applies, so it's easy to find in the
 *   source file.
 */
export function buildBulkSvg(
  csvText: string,
  defaults: RawChartFields,
  columns: number,
  collectionLabel?: string,
  inlineStylesheet?: string,
  transpose?: number,
): string {
  return buildBulkGrid(csvText, defaults, columns, collectionLabel, inlineStylesheet, transpose).svg;
}

/**
 * A bulk render's composite grid plus the pieces it was built from, for
 * callers that lay the charts out themselves -- the web UI's print view
 * puts each chart in its own cell so a long grid can break across pages.
 */
export interface BulkGrid {
  /** The composite grid, exactly what buildBulkSvg returns. */
  svg: string;
  /** Each row's own chart SVG, in CSV order, across every section. */
  charts: string[];
  /** The same charts grouped by `header` row; a single headerless section when the CSV has none. */
  sections: BulkSection[];
  columns: number;
  collectionLabel?: string;
}

/** Same as {@link buildBulkSvg}, but also returns each chart on its own. */
export function buildBulkGrid(
  csvText: string,
  defaults: RawChartFields,
  columns: number,
  collectionLabel?: string,
  inlineStylesheet?: string,
  transpose?: number,
): BulkGrid {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new ChartInputError(`columns must be a positive integer, got ${columns}`);
  }

  let rows: Record<string, string>[];
  try {
    rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    // Most commonly hit via a field containing an unescaped quote -- e.g.
    // typing raw JSON like {"6":"R"} into a string-labels/finger-positions/
    // note-classes cell. csv-parse's own error names the field but not the
    // fix, so spell it out: standard CSV quoting (same as Excel/Sheets)
    // wraps the whole field in quotes and doubles any quote inside it.
    const message = err instanceof Error ? err.message : String(err);
    throw new ChartInputError(
      `CSV parse error: ${message}. If a field's value contains a double quote (e.g. JSON like {"6":"R"}), wrap the whole field in quotes and double each internal quote: "{""6"":""R""}".`,
    );
  }

  if (rows.length === 0) {
    throw new ChartInputError("CSV file has no data rows");
  }
  if (!(REQUIRED_NOTATION_COLUMN in rows[0])) {
    throw new ChartInputError('CSV file must have a "notes" column for chord notation');
  }

  const sections: BulkSection[] = [{ charts: [] }];
  rows.forEach((row, i) => {
    const rowNumber = i + 2; // 1-based, plus the header row
    const header = row[HEADER_COLUMN];
    if (header) sections.push({ header, charts: [] });
    const notation = row[REQUIRED_NOTATION_COLUMN];
    if (!notation) {
      if (header) return;
      throw new ChartInputError(`row ${rowNumber}: missing chord notation in the "notes" column`);
    }

    let resolved;
    try {
      resolved = resolveChartFields(rowRawFields(row, defaults, rowNumber));
    } catch (err) {
      if (err instanceof Error) {
        throw new ChartInputError(`row ${rowNumber}: ${err.message}`);
      }
      throw err;
    }

    const stylesheet =
      resolved.stylesheetPath !== undefined
        ? fs.readFileSync(resolved.stylesheetPath, "utf8")
        : inlineStylesheet;
    const defs =
      resolved.defsPath !== undefined ? fs.readFileSync(resolved.defsPath, "utf8") : resolved.defsText;

    try {
      const chart = buildChart(notation, {
        label: resolved.label,
        stringLabels: resolved.stringLabels,
        fingerPositions: resolved.fingerPositions,
        noteClasses: resolved.noteClasses,
        noteShapes: resolved.noteShapes,
        tuning: resolved.tuning,
        labelPitches: resolved.labelPitches,
        labelTuning: resolved.labelTuning,
        transpose,
        svgOptions: stylesheet !== undefined || defs !== undefined ? { stylesheet, defs } : undefined,
      });
      sections[sections.length - 1].charts.push(chart.svg);
    } catch (err) {
      if (err instanceof Error) {
        throw new ChartInputError(`row ${rowNumber} (${JSON.stringify(notation)}): ${err.message}`);
      }
      throw err;
    }
  });

  // Drop the implicit leading section when the CSV opens with a header row.
  if (sections[0].charts.length === 0) sections.shift();
  const charts = sections.flatMap((s) => s.charts);
  if (charts.length === 0) {
    throw new ChartInputError("CSV file has no chord rows, only headers");
  }

  return { svg: composeGrid(sections, columns, collectionLabel), charts, sections, columns, collectionLabel };
}

/** Minimal RFC4180-style field escaping: quotes a field only if it contains a comma, quote, or newline, doubling any internal quote -- the same rule buildBulkSvg's own CSV-quoting error message already describes to users. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/**
 * Rewrites `csvText`'s "notes" column, transposing each row's chord
 * notation by `halfSteps` -- the CSV counterpart to `transposeNotation`/
 * `transposeMarkers` (transpose.ts), for "baking" a `--transpose` shift
 * directly into a bulk CSV instead of leaving a separate `transpose:`
 * field on the `type: chords` document that embeds it (see
 * document.ts's `bakeTransposeIntoDoc` and cli.ts's `--bake-transpose`).
 * Every other column is left exactly as parsed, just re-escaped with
 * `csvField` above -- the transposed notation itself is always plain
 * digits/spaces/"x" (`transposeNotation` always reformats via
 * `formatChord`'s space-separated form), so it never actually needs
 * quoting, but any *other* column could.
 *
 * Same per-row tuning resolution as `buildBulkSvg` (a row or `defaults`
 * can set its own `tuning`, which determines how many strings a
 * two-digit-fret token in tight notation disambiguates against).
 *
 * @throws {ChartInputError} same cases `buildBulkSvg`'s own CSV parsing
 *   does (malformed CSV, missing "notes" column, no data rows, a missing
 *   notation cell, a malformed per-row field), plus a shift that would put
 *   any row's note below the nut -- all row-numbered.
 */
export function transposeCsvNotes(csvText: string, defaults: RawChartFields, halfSteps: number): string {
  let header: string[];
  let rows: Record<string, string>[];
  try {
    header = (parse(csvText, { to: 1, trim: true }) as string[][])[0] ?? [];
    rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ChartInputError(
      `CSV parse error: ${message}. If a field's value contains a double quote (e.g. JSON like {"6":"R"}), wrap the whole field in quotes and double each internal quote: "{""6"":""R""}".`,
    );
  }

  if (rows.length === 0) {
    throw new ChartInputError("CSV file has no data rows");
  }
  if (!(REQUIRED_NOTATION_COLUMN in rows[0])) {
    throw new ChartInputError('CSV file must have a "notes" column for chord notation');
  }

  const outLines = rows.map((row, i) => {
    const rowNumber = i + 2; // 1-based, plus the header row
    const notation = row[REQUIRED_NOTATION_COLUMN];
    if (!notation) {
      if (row[HEADER_COLUMN]) return header.map((column) => csvField(row[column] ?? "")).join(",");
      throw new ChartInputError(`row ${rowNumber}: missing chord notation in the "notes" column`);
    }

    try {
      const resolved = resolveChartFields(rowRawFields(row, defaults, rowNumber));
      const tuning = resolved.tuning !== undefined ? parseTuning(resolved.tuning) : DEFAULT_TUNING;
      const transposed = transposeNotation(notation, halfSteps, { stringCount: tuning.length });
      const updated: Record<string, string> = { ...row, [REQUIRED_NOTATION_COLUMN]: transposed };
      return header.map((column) => csvField(updated[column] ?? "")).join(",");
    } catch (err) {
      if (err instanceof Error) {
        throw new ChartInputError(`row ${rowNumber} (${JSON.stringify(notation)}): ${err.message}`);
      }
      throw err;
    }
  });

  return [header.map(csvField).join(","), ...outLines].join("\n") + "\n";
}

export interface RunBulkOptions {
  csvPath: string;
  columns: number;
  defaults: RawChartFields;
  output?: string;
  collectionLabel?: string;
  /** Shifts every row's chord notation by this many frets/half-steps. See buildBulkSvg's own doc comment. */
  transpose?: number;
  /** Only with a non-undefined transpose: writes the shift directly into the written document's CSV `notes` column (via transposeCsvNotes) instead of leaving a `transpose:` field. */
  bakeTranspose?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Builds a ChordsDocument capturing this bulk invocation's current
 * values -- used when `--output` names a `.yaml`/`.yml`/`.json` path.
 * `stylesheetPath` (from `--stylesheet`, applied as every row's default)
 * is read and embedded as the document's top-level inline `stylesheet`,
 * not left as a path -- a path recorded as-is would be relative to this
 * process's CWD, not portable if the generated document later moves or
 * is read from elsewhere, the same reasoning `documentFromSingleOptions`
 * (cli.ts) already applies to `--stylesheet` for chord/scale/neck
 * documents. It's embedded at the top level rather than per-row inside
 * `defaults` regardless, since a `chords` document's `defaults` cannot
 * carry styling at all (see ChordsDocument's own doc comment) --
 * `--stylesheet` setting one shared default for every row is exactly the
 * whole-grid-only model a top-level `stylesheet` already means. Every
 * other field is explicitly enumerated, never a blind spread of
 * `options.defaults` -- same discipline the HTTP /bulk route's own
 * defaults handling already uses, so a field bulk mode doesn't actually
 * support (e.g. `markersJson`, not applicable to chord-notation rows)
 * can never leak into the generated document.
 *
 * `options.bakeTranspose` (only with a non-undefined `options.transpose`)
 * rewrites `csvText`'s "notes" column via `transposeCsvNotes` before
 * embedding it, and omits `transpose:` entirely -- the reverse of the
 * default (embed the CSV as originally read, plus a `transpose:` field
 * `buildDocument` applies at render time).
 */
function documentFromBulkOptions(options: RunBulkOptions, csvText: string): ChordsDocument {
  const raw = options.defaults;
  const bake = options.bakeTranspose && options.transpose !== undefined;
  const bakedCsvText = bake ? transposeCsvNotes(csvText, raw, options.transpose!) : csvText;
  const defaults: RawChartFields = {
    label: raw.label,
    stringLabels: raw.stringLabels,
    fingerPositions: raw.fingerPositions,
    noteClasses: raw.noteClasses,
    noteShapes: raw.noteShapes,
    root: raw.root,
    tuning: raw.tuning,
    labelPitches: raw.labelPitches,
    labelTuning: raw.labelTuning,
    stringLabel1: raw.stringLabel1,
    stringLabel2: raw.stringLabel2,
    stringLabel3: raw.stringLabel3,
    stringLabel4: raw.stringLabel4,
    stringLabel5: raw.stringLabel5,
    stringLabel6: raw.stringLabel6,
    fingerPosition1: raw.fingerPosition1,
    fingerPosition2: raw.fingerPosition2,
    fingerPosition3: raw.fingerPosition3,
    fingerPosition4: raw.fingerPosition4,
    fingerPosition5: raw.fingerPosition5,
    fingerPosition6: raw.fingerPosition6,
  };
  const hasDefaults = Object.values(defaults).some((v) => v !== undefined);
  const stylesheet = raw.stylesheetPath !== undefined ? fs.readFileSync(raw.stylesheetPath, "utf8") : undefined;
  const defs = raw.defsPath !== undefined ? fs.readFileSync(raw.defsPath, "utf8") : raw.defsText;
  return {
    type: "chords",
    csv: bakedCsvText,
    collectionLabel: options.collectionLabel,
    columns: options.columns,
    defaults: hasDefaults ? defaults : undefined,
    stylesheet,
    defs,
    transpose: bake ? undefined : options.transpose,
  };
}

/**
 * Reads the CSV at `csvPath`, builds the grid SVG, and writes it out (same
 * stdout/.svg/.png behavior as the single-chart CLI path) -- or, for a
 * `.yaml`/`.yml`/`.json` `--output` path, writes a `type: chords` document
 * capturing this invocation instead of rendering (see
 * documentFromBulkOptions above). Returns an exit code and never throws --
 * I/O and chart-building failures are reported as a clean single-line
 * stderr message instead.
 */
export async function runBulk(options: RunBulkOptions): Promise<number> {
  try {
    const csvText = fs.readFileSync(options.csvPath, "utf8");
    const svg = buildBulkSvg(
      csvText,
      options.defaults,
      options.columns,
      options.collectionLabel,
      undefined,
      options.transpose,
    );
    if (isDocumentOutputPath(options.output)) {
      return writeDocumentOutput(documentFromBulkOptions(options, csvText), options.output);
    }
    return await writeSvgOutput(svg, options.output);
  } catch (err) {
    // File-read failures (bad path, permissions), ChartInputError (CSV
    // structure/field problems, already row-prefixed), and anything else
    // unexpected all get the same clean single-line message.
    process.stderr.write(`${errorMessage(err)}\n`);
    return 1;
  }
}
