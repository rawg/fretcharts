/**
 * A single, self-contained YAML (or JSON, which parses as a YAML subset)
 * file describing one chart: a chord, a scale chart, a neck diagram, or a
 * series of chords (bulk/CSV mode) -- everything that chord notation, the
 * scale-chart marker model, and the CLI's styling flags can already
 * express, in one human-editable file instead of a shell command. `type:`
 * discriminates which of the four it is; every other key reuses the same
 * internal camelCase field names `RenderChartOptions`/`NeckDiagramOptions`/
 * `RawChartFields` already use.
 *
 * `parseDocument` is pure (no file I/O) and validates BOTH structure
 * (unknown/missing type, unrecognized fields, wrong field types,
 * stylesheet+stylesheetFile conflicts) AND field *values* -- it eagerly
 * calls the same `chartFieldResolver.ts`/notes-parsing functions the CLI
 * already relies on, purely to surface a malformed `stringLabels`/`notes`/
 * etc. as an error at parse time rather than only once the document is
 * built. `buildDocument` does the actual work: resolving `stylesheetFile`/
 * `csvFile` relative to the document's own directory (never the process's
 * CWD) and dispatching to `buildChart`/`buildNeckDiagram`/`buildBulkSvg` --
 * a pure translation layer, no rendering logic duplicated here, mirroring
 * how `bulk.ts` is itself already a thin layer over `buildChart`.
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseYamlText } from "yaml";
import { parse as parseCsvText } from "csv-parse/sync";
import { buildChart, buildNeckDiagram } from "./chart";
import { buildBulkGrid, BulkGrid, transposeCsvNotes, COLUMN_TO_FIELD } from "./bulk";
import {
  RawChartFields,
  resolveChartFields,
  bracketsFromArray,
  noteMarkersFromArray,
  parseBrackets,
  parseNoteMarkers,
  stringifyBracketsCompact,
  stringifyNoteMarkersCompact,
} from "./chartFieldResolver";
import { FretBracket, NoteMarker } from "./types";
import { writeSvgOutput, isDocumentOutputPath, writeDocumentOutput } from "./outputWriter";
import { transposeBrackets, transposeNotation, transposeMarkers, transposeFretRange } from "./transpose";
import { parseTuning, DEFAULT_TUNING } from "./tuning";
import { VERSION, compareVersions, isVersion } from "./version";

/** Raised for malformed document structure -- unknown/missing `type`, unrecognized fields, conflicting fields, or a `stylesheetFile`/`csvFile` that can't be read. */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface DocumentCommonFields {
  /** The FretCharts version that wrote this file -- the minimum needed to render it. See parseDocumentWithWarnings. */
  version?: string;
  label?: string;
  tuning?: string;
  labelTuning?: boolean;
  /** Inline CSS text, embedded as-is -- same meaning as the HTTP routes' `stylesheet` field, not the CLI's `--stylesheet <path>`. */
  stylesheet?: string;
  /** Path to a CSS file, resolved relative to this document's own directory (never the process's CWD). Mutually exclusive with `stylesheet`. */
  stylesheetFile?: string;
  /** Raw SVG markup text, embedded as-is into a `<defs>` element -- same meaning as the HTTP routes' `defs` field, not the CLI's `--svg-defs-file <path>`. See SvgRenderOptions.defs (render/svg.ts) for what it's for. */
  defs?: string;
  /** Path to a file holding raw SVG markup for `<defs>`, resolved relative to this document's own directory (never the process's CWD). Mutually exclusive with `defs`. */
  defsFile?: string;
  /** Shifts every note by this many frets/half-steps (positive = up, negative = down) at render time -- applied to the `notation`/`notes` above, which stay untransposed as written. See RenderChartOptions.transpose/NeckDiagramOptions.transpose (chart.ts). */
  transpose?: number;
  /** Optional default output path; a CLI `--output` flag, if given, overrides this. */
  output?: string;
}

export interface ChordDocument extends DocumentCommonFields {
  type: "chord";
  notation: string;
  stringLabels?: string;
  fingerPositions?: string;
  noteClasses?: string;
  noteShapes?: string;
  root?: string;
  labelPitches?: boolean;
}

export interface ScaleDocument extends DocumentCommonFields {
  type: "scale";
  /** Compact "string:fret[:label[:className[:finger[:shape]]]];..." text, OR a native YAML/JSON list of marker objects. */
  notes: string | unknown[];
  mutedStrings?: string;
  labelPitches?: boolean;
  /** Defaults to `true` when omitted -- unlike every other boolean field here. See RenderChartOptions.labelFrets (chart.ts). */
  labelFrets?: boolean;
  /** Same format as NeckDocument.brackets, drawn left of the grid. */
  brackets?: string | unknown[];
}

export interface NeckDocument extends DocumentCommonFields {
  type: "neck";
  notes: string | unknown[];
  mutedStrings?: string;
  labelPitches?: boolean;
  /** Defaults to `true` when omitted -- unlike every other boolean field here. See NeckDiagramOptions.labelFrets. */
  labelFrets?: boolean;
  firstFret?: number;
  lastFret?: number;
  /** Compact "startFret-endFret:label[:className];..." text, OR a native YAML/JSON list of `{startFret, endFret, label, className?}` objects. See parseBrackets (chartFieldResolver.ts). */
  brackets?: string | unknown[];
}

export interface ChordsDocument {
  type: "chords";
  /** See DocumentCommonFields.version. */
  version?: string;
  /** Raw CSV text, typically a YAML block scalar (`csv: |`). Mutually exclusive with `csvFile` -- exactly one is required. */
  csv?: string;
  /** Path to a CSV file, resolved relative to this document's own directory. */
  csvFile?: string;
  columns?: number;
  collectionLabel?: string;
  /**
   * Same shape as the CLI's own `--bulk`-mode defaults: applies to any CSV
   * row that leaves its own column blank. Cannot include "stylesheet"/
   * "stylesheetPath" -- a `chords` document has exactly one place to set
   * styling (the top-level `stylesheet`/`stylesheetFile` field below,
   * applied to the whole grid), never per-row -- see this module's CSV
   * "stylesheet" column rejection below for why.
   */
  defaults?: RawChartFields;
  stylesheet?: string;
  stylesheetFile?: string;
  defs?: string;
  defsFile?: string;
  /** Shifts every row's chord notation by this many frets/half-steps at render time. See DocumentCommonFields.transpose. */
  transpose?: number;
  output?: string;
}

export type ChartDocument = ChordDocument | ScaleDocument | NeckDocument | ChordsDocument;

type FieldType = "string" | "boolean" | "number" | "stringOrArray" | "object";

interface FieldSpec {
  key: string;
  type: FieldType;
  required?: boolean;
}

const COMMON_FIELDS: FieldSpec[] = [
  { key: "version", type: "string" },
  { key: "label", type: "string" },
  { key: "tuning", type: "string" },
  { key: "labelTuning", type: "boolean" },
  { key: "stylesheet", type: "string" },
  { key: "stylesheetFile", type: "string" },
  { key: "defs", type: "string" },
  { key: "defsFile", type: "string" },
  { key: "transpose", type: "number" },
  { key: "output", type: "string" },
];

const CHORD_FIELDS: FieldSpec[] = [
  { key: "notation", type: "string", required: true },
  { key: "stringLabels", type: "string" },
  { key: "fingerPositions", type: "string" },
  { key: "noteClasses", type: "string" },
  { key: "noteShapes", type: "string" },
  { key: "root", type: "string" },
  { key: "labelPitches", type: "boolean" },
  ...COMMON_FIELDS,
];

const SCALE_FIELDS: FieldSpec[] = [
  { key: "notes", type: "stringOrArray", required: true },
  { key: "mutedStrings", type: "string" },
  { key: "labelPitches", type: "boolean" },
  { key: "labelFrets", type: "boolean" },
  { key: "brackets", type: "stringOrArray" },
  ...COMMON_FIELDS,
];

const NECK_FIELDS: FieldSpec[] = [
  { key: "notes", type: "stringOrArray", required: true },
  { key: "mutedStrings", type: "string" },
  { key: "labelPitches", type: "boolean" },
  { key: "labelFrets", type: "boolean" },
  { key: "firstFret", type: "number" },
  { key: "lastFret", type: "number" },
  { key: "brackets", type: "stringOrArray" },
  ...COMMON_FIELDS,
];

const CHORDS_FIELDS: FieldSpec[] = [
  { key: "version", type: "string" },
  { key: "csv", type: "string" },
  { key: "csvFile", type: "string" },
  { key: "columns", type: "number" },
  { key: "collectionLabel", type: "string" },
  { key: "defaults", type: "object" },
  { key: "stylesheet", type: "string" },
  { key: "stylesheetFile", type: "string" },
  { key: "defs", type: "string" },
  { key: "defsFile", type: "string" },
  { key: "transpose", type: "number" },
  { key: "output", type: "string" },
];

/** Fields a `type: chords` document's `defaults` may set -- exactly the CLI's own bulk-mode-recognized fields, minus "stylesheetPath" (rejected, see ChordsDocument.defaults's doc comment). */
const ALLOWED_BULK_DEFAULT_FIELDS = new Set<keyof RawChartFields>(Object.values(COLUMN_TO_FIELD));
ALLOWED_BULK_DEFAULT_FIELDS.delete("stylesheetPath");

function matchesType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "stringOrArray":
      return typeof value === "string" || Array.isArray(value);
  }
}

const TYPE_DESCRIPTIONS: Record<FieldType, string> = {
  string: "a string",
  boolean: "a boolean",
  number: "a number",
  object: "an object",
  stringOrArray: "a string or a list",
};

/**
 * Set when a file comes from a newer FretCharts than this one: an
 * unrecognized field is then dropped with a warning rather than rejected,
 * since it's most likely a feature this version doesn't have yet.
 */
type Leniency = { warnings: string[] } | undefined;

/** Throws `message` for an unrecognized field -- or, for a newer file (see Leniency), deletes it from `obj` and warns. */
function rejectUnrecognized(obj: Record<string, unknown>, key: string, name: string, message: string, lenient: Leniency): void {
  if (!lenient) throw new DocumentError(message);
  delete obj[key];
  lenient.warnings.push(`ignored unrecognized field "${name}"`);
}

/** Validates `obj`'s keys/types against `specs` for a document of type `docType`. Unrecognized keys and wrong-typed/missing-required fields are both hard errors -- see DocumentError's doc comment -- except for the Leniency case above. */
function validateFields(obj: Record<string, unknown>, specs: FieldSpec[], docType: string, lenient: Leniency): void {
  const allowed = new Set(["type", ...specs.map((s) => s.key)]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      rejectUnrecognized(obj, key, key, `unrecognized field "${key}" for type: ${docType}`, lenient);
    }
  }
  for (const spec of specs) {
    const value = obj[spec.key];
    if (value === undefined) {
      if (spec.required) {
        throw new DocumentError(`type: ${docType} requires a "${spec.key}" field`);
      }
      continue;
    }
    if (!matchesType(value, spec.type)) {
      throw new DocumentError(`"${spec.key}" must be ${TYPE_DESCRIPTIONS[spec.type]} for type: ${docType}`);
    }
  }
}

function assertNoStylesheetConflict(obj: Record<string, unknown>): void {
  if (obj.stylesheet !== undefined && obj.stylesheetFile !== undefined) {
    throw new DocumentError('cannot combine "stylesheet" and "stylesheetFile" -- give exactly one');
  }
  if (obj.defs !== undefined && obj.defsFile !== undefined) {
    throw new DocumentError('cannot combine "defs" and "defsFile" -- give exactly one');
  }
}

/** Builds a RawChartFields from whichever of its keys are present on `obj` -- safe because validateFields has already confirmed each present key's type. */
function rawFieldsFrom(obj: Record<string, unknown>): RawChartFields {
  return {
    label: obj.label as string | undefined,
    tuning: obj.tuning as string | undefined,
    labelTuning: obj.labelTuning as boolean | undefined,
    stringLabels: obj.stringLabels as string | undefined,
    fingerPositions: obj.fingerPositions as string | undefined,
    noteClasses: obj.noteClasses as string | undefined,
    noteShapes: obj.noteShapes as string | undefined,
    root: obj.root as string | undefined,
    labelPitches: obj.labelPitches as boolean | undefined,
    mutedStrings: obj.mutedStrings as string | undefined,
    labelFrets: obj.labelFrets as boolean | undefined,
  };
}

/** Validates (and, for its side effect, resolves-and-discards) a scale/neck document's `notes` field -- throws ChartInputError/FingerPositionError for malformed content, same as the CLI's --notes. */
function validateNotes(notes: string | unknown[]): void {
  if (typeof notes === "string") {
    parseNoteMarkers(notes);
  } else {
    noteMarkersFromArray(notes);
  }
}

function resolveNotesValue(notes: string | unknown[]): NoteMarker[] {
  return typeof notes === "string" ? parseNoteMarkers(notes) : noteMarkersFromArray(notes);
}

function resolveBracketsValue(brackets: string | unknown[] | undefined): FretBracket[] | undefined {
  if (brackets === undefined) return undefined;
  return typeof brackets === "string" ? parseBrackets(brackets) : bracketsFromArray(brackets);
}

function validateBulkDefaults(defaults: unknown, lenient: Leniency): void {
  // validateFields already confirmed this is a plain object via the
  // "object" FieldType check before this is ever called.
  const obj = defaults as Record<string, unknown>;
  if (obj.stylesheet !== undefined || obj.stylesheetPath !== undefined) {
    throw new DocumentError(
      '"defaults" cannot include "stylesheet"/"stylesheetPath" -- a type: chords document has exactly ' +
        'one place to set styling (the top-level "stylesheet"/"stylesheetFile" field), applied to the whole grid',
    );
  }
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_BULK_DEFAULT_FIELDS.has(key as keyof RawChartFields)) {
      rejectUnrecognized(obj, key, `defaults.${key}`, `"defaults.${key}" is not a recognized field`, lenient);
    }
  }
}

/**
 * Parses YAML (or JSON) text into a validated ChartDocument. Does no file
 * I/O -- `stylesheetFile`/`csvFile` are checked for type/presence here,
 * read later by `buildDocument`.
 *
 * @throws {DocumentError} for malformed YAML, or any structural problem:
 *   unknown/missing `type`, an unrecognized or wrong-typed field, both (or
 *   neither, for `chords`' csv/csvFile) of a mutually-exclusive pair.
 * @throws {ChartInputError|FingerPositionError} propagated unchanged from
 *   `resolveChartFields`/`noteMarkersFromArray`/`parseNoteMarkers` for a
 *   malformed field *value* (e.g. bad `stringLabels` JSON, an out-of-range
 *   `notes` string number).
 */
export function parseDocument(yamlText: string): ChartDocument {
  return parseDocumentWithWarnings(yamlText).doc;
}

/**
 * Same as {@link parseDocument}, plus non-fatal warnings. A file's
 * optional `version` names the FretCharts release that wrote it -- the
 * minimum needed to render it. When that's newer than this release
 * ({@link VERSION}), parsing becomes best-effort: the mismatch is warned
 * about, and unrecognized fields (top-level or in `defaults`) are dropped
 * with a warning each instead of rejected. Everything else -- an unknown
 * `type`, a wrong-typed or malformed value -- still throws, since there's
 * nothing sensible to render.
 *
 * @throws same as parseDocument, plus {@link DocumentError} for a
 *   `version` that isn't an `X.Y.Z` version string.
 */
export function parseDocumentWithWarnings(yamlText: string): { doc: ChartDocument; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = parseYamlText(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentError(`invalid YAML: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DocumentError('document must be a YAML/JSON object with a "type" field');
  }
  const obj = parsed as Record<string, unknown>;

  const version = obj.version;
  if (version !== undefined && (typeof version !== "string" || !isVersion(version))) {
    throw new DocumentError('"version" must be a version string like "0.2.0" (quote it in YAML)');
  }
  const newer = version !== undefined && compareVersions(version as string, VERSION) > 0;
  const warnings: string[] = [];
  const lenient: Leniency = newer ? { warnings } : undefined;
  if (newer) {
    warnings.push(
      `this file was written by FretCharts ${version}, newer than this one (${VERSION}); rendering it as well as possible, but some features may be missing or look different`,
    );
  }

  const type = obj.type;
  if (typeof type !== "string") {
    throw new DocumentError('document is missing a "type" field (must be one of "chord", "scale", "neck", "chords")');
  }

  switch (type) {
    case "chord": {
      validateFields(obj, CHORD_FIELDS, "chord", lenient);
      assertNoStylesheetConflict(obj);
      resolveChartFields(rawFieldsFrom(obj));
      return { doc: obj as unknown as ChordDocument, warnings };
    }
    case "scale": {
      validateFields(obj, SCALE_FIELDS, "scale", lenient);
      assertNoStylesheetConflict(obj);
      resolveChartFields(rawFieldsFrom(obj));
      validateNotes(obj.notes as string | unknown[]);
      resolveBracketsValue(obj.brackets as string | unknown[] | undefined);
      return { doc: obj as unknown as ScaleDocument, warnings };
    }
    case "neck": {
      validateFields(obj, NECK_FIELDS, "neck", lenient);
      assertNoStylesheetConflict(obj);
      resolveChartFields(rawFieldsFrom(obj));
      validateNotes(obj.notes as string | unknown[]);
      resolveBracketsValue(obj.brackets as string | unknown[] | undefined);
      return { doc: obj as unknown as NeckDocument, warnings };
    }
    case "chords": {
      validateFields(obj, CHORDS_FIELDS, "chords", lenient);
      assertNoStylesheetConflict(obj);
      if ((obj.csv === undefined) === (obj.csvFile === undefined)) {
        throw new DocumentError('type: chords requires exactly one of "csv" or "csvFile"');
      }
      if (obj.defaults !== undefined) {
        validateBulkDefaults(obj.defaults, lenient);
      }
      return { doc: obj as unknown as ChordsDocument, warnings };
    }
    default:
      throw new DocumentError(
        `unrecognized "type": ${JSON.stringify(type)} (must be one of "chord", "scale", "neck", "chords")` +
          (newer ? `; this file was written by FretCharts ${version}, so upgrading from ${VERSION} may help` : ""),
      );
  }
}

function resolveStylesheet(doc: { stylesheet?: string; stylesheetFile?: string }, basePath: string): string | undefined {
  if (doc.stylesheetFile !== undefined) {
    const resolved = path.resolve(basePath, doc.stylesheetFile);
    try {
      return fs.readFileSync(resolved, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DocumentError(`could not read stylesheetFile "${doc.stylesheetFile}": ${message}`);
    }
  }
  return doc.stylesheet;
}

function resolveDefs(doc: { defs?: string; defsFile?: string }, basePath: string): string | undefined {
  if (doc.defsFile !== undefined) {
    const resolved = path.resolve(basePath, doc.defsFile);
    try {
      return fs.readFileSync(resolved, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DocumentError(`could not read defsFile "${doc.defsFile}": ${message}`);
    }
  }
  return doc.defs;
}

/** First (header) row only, or [] if the CSV can't even be parsed that far -- same technique src/api/bulk.ts uses to reject a per-row "stylesheet" column. */
function csvHeaderColumns(csvText: string): string[] {
  try {
    const rows = parseCsvText(csvText, { to: 1, trim: true }) as string[][];
    return rows[0] ?? [];
  } catch {
    return [];
  }
}

function resolveCsv(doc: ChordsDocument, basePath: string): string {
  let csvText: string;
  if (doc.csvFile !== undefined) {
    const resolved = path.resolve(basePath, doc.csvFile);
    try {
      csvText = fs.readFileSync(resolved, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DocumentError(`could not read csvFile "${doc.csvFile}": ${message}`);
    }
  } else if (doc.csv !== undefined) {
    csvText = doc.csv;
  } else {
    // parseDocument already guarantees exactly one of csv/csvFile is
    // present; re-checked instead of asserted so this stays type-safe.
    throw new DocumentError('type: chords requires exactly one of "csv" or "csvFile"');
  }

  // Same reasoning as the HTTP /bulk route's identical check: a per-row
  // "stylesheet" column would embed a second <style> block whose rules
  // aren't scoped to their own chart, cascading across the whole
  // composited grid -- see bulk.ts's module doc comment and the README's
  // Bulk mode "Caveat" paragraph. A chords document already has exactly
  // one place to set styling (the top-level stylesheet/stylesheetFile
  // field); this rejects the one other way a document could smuggle in
  // per-row styling (see also validateBulkDefaults's identical rejection
  // of defaults.stylesheet/stylesheetPath).
  if (csvHeaderColumns(csvText).includes("stylesheet")) {
    throw new DocumentError(
      '"stylesheet" is not a supported CSV column -- use this document\'s top-level "stylesheet"/' +
        '"stylesheetFile" field to style the whole grid instead',
    );
  }
  return csvText;
}

/**
 * Resolves `stylesheetFile`/`csvFile` relative to `basePath` (the
 * document file's own directory -- NOT the process's current working
 * directory) and dispatches to `buildChart`/`buildNeckDiagram`/
 * `buildBulkGrid`. `output`, if the document set one, is surfaced in the
 * result but not itself written -- that's `runDocument`'s job, same
 * separation `buildBulkSvg`/`runBulk` already have. `warnings` carries a
 * `type: neck` document's non-fatal notices (currently just "the fret
 * range was auto-expanded to fit a note" -- see computeNeckLayout in
 * layout.ts); always `[]` for every other document type. `grid` is set for
 * a `chords` document only: its charts one by one, for the web print view.
 *
 * @throws same as `buildChart`/`buildNeckDiagram`/`buildBulkSvg`, plus
 *   {@link DocumentError} if `stylesheetFile`/`csvFile` can't be read, or
 *   a `chords` document's CSV has a "stylesheet" column.
 */
export function buildDocument(
  doc: ChartDocument,
  basePath: string,
): { svg: string; output?: string; warnings: string[]; grid?: BulkGrid } {
  const stylesheet = resolveStylesheet(doc, basePath);
  const defs = resolveDefs(doc, basePath);
  const svgOptions = stylesheet !== undefined || defs !== undefined ? { stylesheet, defs } : undefined;

  switch (doc.type) {
    case "chord": {
      const resolved = resolveChartFields(rawFieldsFrom(doc as unknown as Record<string, unknown>));
      const { svg } = buildChart(doc.notation, {
        label: resolved.label,
        stringLabels: resolved.stringLabels,
        fingerPositions: resolved.fingerPositions,
        noteClasses: resolved.noteClasses,
        noteShapes: resolved.noteShapes,
        tuning: resolved.tuning,
        labelPitches: resolved.labelPitches,
        labelTuning: resolved.labelTuning,
        transpose: doc.transpose,
        svgOptions,
      });
      return { svg, output: doc.output, warnings: [] };
    }
    case "scale": {
      const resolved = resolveChartFields(rawFieldsFrom(doc as unknown as Record<string, unknown>));
      const { svg } = buildChart(undefined, {
        notes: resolveNotesValue(doc.notes),
        mutedStrings: resolved.mutedStrings,
        label: resolved.label,
        tuning: resolved.tuning,
        labelPitches: resolved.labelPitches,
        labelTuning: resolved.labelTuning,
        labelFrets: resolved.labelFrets,
        brackets: resolveBracketsValue(doc.brackets),
        transpose: doc.transpose,
        svgOptions,
      });
      return { svg, output: doc.output, warnings: [] };
    }
    case "neck": {
      const resolved = resolveChartFields(rawFieldsFrom(doc as unknown as Record<string, unknown>));
      const { svg, layout } = buildNeckDiagram(resolveNotesValue(doc.notes), {
        mutedStrings: resolved.mutedStrings,
        label: resolved.label,
        tuning: resolved.tuning,
        labelPitches: resolved.labelPitches,
        labelTuning: resolved.labelTuning,
        labelFrets: resolved.labelFrets,
        firstFret: doc.firstFret,
        lastFret: doc.lastFret,
        brackets: resolveBracketsValue(doc.brackets),
        transpose: doc.transpose,
        svgOptions,
      });
      return { svg, output: doc.output, warnings: layout.warnings };
    }
    case "chords": {
      const csvText = resolveCsv(doc, basePath);
      const defaults: RawChartFields = { ...(doc.defaults ?? {}), defsText: defs };
      const grid = buildBulkGrid(csvText, defaults, doc.columns ?? 4, doc.collectionLabel, stylesheet, doc.transpose);
      return { svg: grid.svg, output: doc.output, warnings: [], grid };
    }
  }
}

export interface RunDocumentOptions {
  documentPath: string;
  /** Overrides the document's own `output:` field, if given. */
  output?: string;
  /** Overrides the document's own `transpose:` field, if given -- same "CLI flag wins" precedent as `output`. */
  transpose?: number;
  /** Only with a non-undefined transpose, and only for a chord/scale/neck document being written back out (not rendered, and not a type: chords document -- see bakeTransposeIntoDoc). Writes the shift directly into notation/notes instead of leaving a transpose: field. */
  bakeTranspose?: boolean;
}

/**
 * Mutates `doc` in place: applies its own `transpose:` shift directly to
 * `notation` (chord), `notes`/`firstFret`/`lastFret`/`brackets` (scale/neck), or an
 * inline `csv`'s "notes" column (`chords`, via `transposeCsvNotes`), then
 * clears `transpose` -- the reverse of how `buildDocument` normally
 * applies it transiently at render time. A no-op if `transpose` isn't
 * set. For a `chords` document referencing an external `csvFile` instead
 * of inline `csv`, also a no-op (leaves `transpose` set) -- rewriting a
 * file the reformat path never otherwise touches would break the
 * "`--file` reformat never reads/writes anything but `documentPath`
 * itself" contract `runDocument` documents; use the CLI's `--file` to
 * actually render the file if you need to inspect it first.
 *
 * `notes`' shape is preserved: a compact string stays a compact string
 * (re-stringified via `stringifyNoteMarkersCompact`), a native list stays
 * a native list -- baking changes *values*, not the format `--compact-notes`
 * already controls.
 *
 * @throws {ChartInputError} if the shift would put any note below the nut.
 */
function bakeTransposeIntoDoc(doc: ChartDocument): void {
  const halfSteps = doc.transpose;
  if (halfSteps === undefined) return;

  if (doc.type === "chord") {
    const stringCount = (doc.tuning !== undefined ? parseTuning(doc.tuning) : DEFAULT_TUNING).length;
    doc.notation = transposeNotation(doc.notation, halfSteps, { stringCount });
  } else if (doc.type === "scale" || doc.type === "neck") {
    const markers = transposeMarkers(resolveNotesValue(doc.notes), halfSteps);
    doc.notes = typeof doc.notes === "string" ? stringifyNoteMarkersCompact(markers) : markers;
    if (doc.type === "neck") {
      const shifted = transposeFretRange(doc.firstFret, doc.lastFret, halfSteps);
      doc.firstFret = shifted.firstFret;
      doc.lastFret = shifted.lastFret;
    }
    const brackets = resolveBracketsValue(doc.brackets);
    if (brackets !== undefined) {
      const shiftedBrackets = transposeBrackets(brackets, halfSteps);
      doc.brackets = typeof doc.brackets === "string" ? stringifyBracketsCompact(shiftedBrackets) : shiftedBrackets;
    }
  } else if (doc.csv !== undefined) {
    doc.csv = transposeCsvNotes(doc.csv, doc.defaults ?? {}, halfSteps);
  } else {
    return; // csvFile-referenced chords document -- see doc comment above.
  }
  doc.transpose = undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads the document at `documentPath`, builds it, and writes the result
 * out (same stdout/.svg/.png behavior as the single-chart/bulk CLI
 * paths) -- mirrors `bulk.ts`'s `runBulk` exactly. For a
 * `.yaml`/`.yml`/`.json` output path, writes the already-parsed `doc`
 * back out as-is instead of rendering -- a straightforward reformat/
 * convert (e.g. hand-written YAML into canonical form, or YAML<->JSON),
 * not a "resolve every field" transformation: `stylesheetFile`/`csvFile`
 * references are left exactly as written, not read and embedded inline.
 * `buildDocument` (which needs those files to actually exist, to render)
 * is skipped entirely in this case -- `parseDocument` alone already
 * validates structure and field values, which is all a reformat needs.
 * `options.transpose`, if given, overrides the document's own `transpose:`
 * field (same "CLI flag wins" precedent as `output`) before either the
 * reformat-write or the render -- so it lands in a written-back document
 * too, not just a direct render. `options.bakeTranspose`, only meaningful
 * alongside a reformat-write (a render already applies `transpose`
 * transiently either way), bakes the shift into `notation`/`notes` (a
 * `type: chords` document's inline CSV included) instead of leaving a
 * `transpose:` field -- see `bakeTransposeIntoDoc`, including its
 * `csvFile` exception.
 * Returns an exit code and never throws.
 */
export async function runDocument(options: RunDocumentOptions): Promise<number> {
  try {
    const yamlText = fs.readFileSync(options.documentPath, "utf8");
    const { doc, warnings: parseWarnings } = parseDocumentWithWarnings(yamlText);
    for (const warning of parseWarnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    if (options.transpose !== undefined) {
      doc.transpose = options.transpose;
    }
    const resolvedOutput = options.output ?? doc.output;

    if (isDocumentOutputPath(resolvedOutput)) {
      if (options.bakeTranspose) {
        bakeTransposeIntoDoc(doc);
      }
      return writeDocumentOutput(doc, resolvedOutput);
    }

    const basePath = path.dirname(path.resolve(options.documentPath));
    const { svg, warnings } = buildDocument(doc, basePath);
    for (const warning of warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    return await writeSvgOutput(svg, resolvedOutput);
  } catch (err) {
    process.stderr.write(`${errorMessage(err)}\n`);
    return 1;
  }
}
