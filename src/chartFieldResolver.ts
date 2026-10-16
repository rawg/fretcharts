/**
 * Turns raw string/boolean CLI-shaped input (one value per named parameter,
 * e.g. `--string-labels` or a CSV column of the same name) into the parsed
 * options `chart.ts`'s `buildChart` understands. Shared by the single-chord
 * CLI path (`cli.ts`) and the bulk CSV path (`bulk.ts`) so the two don't
 * duplicate JSON parsing, `--root` merging, or error formatting.
 */

import { StringLabels, FingerPositions, FretBracket, NoteClasses, NoteMarker, NoteShape, NoteShapes } from "./types";
import { parseFingerNumber, parseFingerPositions } from "./fingerPositions";

type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;
const STRING_NUMBERS: readonly StringNumber[] = [1, 2, 3, 4, 5, 6];

/** Raised for malformed field values that aren't commander's own parsing errors. */
export class ChartInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartInputError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const NOTE_SHAPES: readonly NoteShape[] = ["circle", "square", "triangle", "diamond"];

/** Validates a shape value (from JSON, compact notation, or a CSV cell) against {@link NoteShape}'s allowed values. `context` names the caller's field for error text. */
function parseNoteShape(value: unknown, context: string): NoteShape {
  if (typeof value !== "string" || !(NOTE_SHAPES as readonly string[]).includes(value)) {
    throw new ChartInputError(
      `${context}: invalid shape ${JSON.stringify(value)}: must be "circle", "square", "triangle", or "diamond"`,
    );
  }
  return value as NoteShape;
}

/** One value per named parameter, exactly as read from argv or a CSV cell. */
export interface RawChartFields {
  label?: string;
  stringLabels?: string;
  fingerPositions?: string;
  noteClasses?: string;
  /** Raw JSON text: per-string dot shapes, e.g. `--note-shapes '{"3":"square"}'`. Same convention as `noteClasses` -- no per-string override flags, since none exist for noteClasses either. */
  noteShapes?: string;
  root?: string;
  tuning?: string;
  labelPitches?: boolean;
  labelTuning?: boolean;
  /** Path to a CSS file, not yet read from disk. */
  stylesheetPath?: string;
  /** Raw SVG markup text (e.g. `--svg-defs '<linearGradient ...>...</linearGradient>'`), embedded as-is into a `<defs>` element. See RenderChartOptions.svgOptions.defs (chart.ts) for what it's for. Mutually exclusive with `defsPath` -- enforced by the caller (e.g. cli.ts), not here. */
  defsText?: string;
  /** Path to a file holding raw SVG markup for `<defs>`, not yet read from disk. */
  defsPath?: string;
  /**
   * Per-string overrides for `stringLabels`, one field per guitar string
   * (`--string-label-1` .. `--string-label-6` / a "string-label-N" CSV
   * column). Each wins over a same-numbered entry from `stringLabels` when
   * both are given -- the more specifically-targeted value takes
   * precedence, same spirit as `root` vs. `noteClasses` below but the
   * other way round, since these single-string flags have nothing broader
   * to defer to.
   */
  stringLabel1?: string;
  stringLabel2?: string;
  stringLabel3?: string;
  stringLabel4?: string;
  stringLabel5?: string;
  stringLabel6?: string;
  /** Per-string overrides for `fingerPositions`, same convention/precedence as `stringLabel1`..`stringLabel6`. */
  fingerPosition1?: string;
  fingerPosition2?: string;
  fingerPosition3?: string;
  fingerPosition4?: string;
  fingerPosition5?: string;
  fingerPosition6?: string;
  /**
   * Raw JSON text for scale-chart mode: an array of NoteMarker-shaped
   * objects, e.g. `--notes`. Named `markersJson` rather than `notes` --
   * bulk.ts's CSV "notes" column already means chord-notation text in a
   * different domain, and this avoids planting a second, differently-typed
   * meaning for the same field name.
   */
  markersJson?: string;
  /** Raw comma-separated string numbers for scale-chart mode's muted strings, e.g. `--muted`. Same shape as `root`. */
  mutedStrings?: string;
  /**
   * Scale-chart/neck-diagram mode only (chord-notation mode ignores this):
   * whether to show fret-number reference labels. Defaults to `true` when
   * omitted -- unlike every other boolean field here, `undefined` means
   * "on," not "off," so this is passed straight through as-is (never
   * defaulted to `false`) all the way down to `computeMarkerLayout`/
   * `computeNeckLayout`, which are what actually apply the `!== false`
   * default-on check.
   */
  labelFrets?: boolean;
  /** Scale-chart/neck-diagram mode only: raw JSON array or compact "start-end:label[:className];..." text for fret-range brackets, e.g. `--brackets`. See parseBrackets. */
  bracketsText?: string;
}

/** `RawChartFields`, parsed and ready to merge into `RenderChartOptions`. */
export interface ResolvedChartFields {
  label?: string;
  stringLabels?: StringLabels;
  fingerPositions?: FingerPositions;
  noteClasses?: NoteClasses;
  noteShapes?: NoteShapes;
  tuning?: string;
  labelPitches?: boolean;
  labelTuning?: boolean;
  stylesheetPath?: string;
  defsText?: string;
  defsPath?: string;
  markers?: NoteMarker[];
  mutedStrings?: (1 | 2 | 3 | 4 | 5 | 6)[];
  labelFrets?: boolean;
  brackets?: FretBracket[];
}

/**
 * @throws {ChartInputError} if `stringLabels`/`noteClasses`/`noteShapes`
 *   isn't valid JSON or isn't a JSON object, if a `noteShapes` value isn't
 *   "circle"/"square"/"triangle"/"diamond", or if `root` isn't a valid
 *   string number/comma-separated list.
 * @throws {FingerPositionError} if `fingerPositions` is malformed, in
 *   either its JSON or notation form.
 */
export function resolveChartFields(raw: RawChartFields): ResolvedChartFields {
  let stringLabels: StringLabels | undefined;
  if (raw.stringLabels !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.stringLabels);
    } catch {
      throw new ChartInputError(`string-labels is not valid JSON: ${raw.stringLabels}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ChartInputError("string-labels must be a JSON object, e.g. '{\"3\":\"b3\"}'");
    }
    stringLabels = parsed as StringLabels;
  }

  const stringLabelOverrides = collectPerStringValues([
    raw.stringLabel1,
    raw.stringLabel2,
    raw.stringLabel3,
    raw.stringLabel4,
    raw.stringLabel5,
    raw.stringLabel6,
  ]);
  if (Object.keys(stringLabelOverrides).length > 0) {
    // Per-string flags/columns win over a same-numbered entry from the
    // aggregate stringLabels blob -- see the RawChartFields doc comment.
    stringLabels = { ...stringLabels, ...stringLabelOverrides };
  }

  let fingerPositions =
    raw.fingerPositions !== undefined ? parseFingerPositions(raw.fingerPositions) : undefined;

  const fingerPositionRaw = [
    raw.fingerPosition1,
    raw.fingerPosition2,
    raw.fingerPosition3,
    raw.fingerPosition4,
    raw.fingerPosition5,
    raw.fingerPosition6,
  ];
  const fingerPositionOverrides: FingerPositions = {};
  STRING_NUMBERS.forEach((stringNumber, i) => {
    const value = fingerPositionRaw[i];
    if (value !== undefined) {
      fingerPositionOverrides[stringNumber] = parseFingerNumber(value, `string ${stringNumber}`);
    }
  });
  if (Object.keys(fingerPositionOverrides).length > 0) {
    fingerPositions = { ...fingerPositions, ...fingerPositionOverrides };
  }

  let noteClasses: NoteClasses | undefined;
  if (raw.noteClasses !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.noteClasses);
    } catch {
      throw new ChartInputError(`note-classes is not valid JSON: ${raw.noteClasses}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ChartInputError("note-classes must be a JSON object, e.g. '{\"3\":\"root\"}'");
    }
    noteClasses = parsed as NoteClasses;
  }

  if (raw.root !== undefined) {
    const rootClasses: NoteClasses = {};
    for (const stringNumber of parseStringNumberList(raw.root, "root")) {
      rootClasses[stringNumber as 1 | 2 | 3 | 4 | 5 | 6] = "root";
    }
    // root wins as a default, but an explicit noteClasses entry for the
    // same string overrides it.
    noteClasses = { ...rootClasses, ...noteClasses };
  }

  let noteShapes: NoteShapes | undefined;
  if (raw.noteShapes !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.noteShapes);
    } catch {
      throw new ChartInputError(`note-shapes is not valid JSON: ${raw.noteShapes}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ChartInputError("note-shapes must be a JSON object, e.g. '{\"3\":\"square\"}'");
    }
    noteShapes = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      noteShapes[Number(key) as 1 | 2 | 3 | 4 | 5 | 6] = parseNoteShape(value, `note-shapes string ${key}`);
    }
  }

  const markers = raw.markersJson !== undefined ? parseNoteMarkers(raw.markersJson) : undefined;
  const mutedStrings =
    raw.mutedStrings !== undefined
      ? (parseStringNumberList(raw.mutedStrings, "muted") as (1 | 2 | 3 | 4 | 5 | 6)[])
      : undefined;

  return {
    label: raw.label,
    stringLabels,
    fingerPositions,
    noteClasses,
    noteShapes,
    tuning: raw.tuning,
    labelPitches: raw.labelPitches,
    labelTuning: raw.labelTuning,
    stylesheetPath: raw.stylesheetPath,
    defsText: raw.defsText,
    defsPath: raw.defsPath,
    markers,
    mutedStrings,
    labelFrets: raw.labelFrets,
    brackets: raw.bracketsText !== undefined ? parseBrackets(raw.bracketsText) : undefined,
  };
}

/** Parses "6" or "4,2" (whitespace ignored) into [6] or [4, 2]. `fieldName` names the caller's field for error text. */
function parseStringNumberList(text: string, fieldName: string): number[] {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new ChartInputError(`${fieldName} must list at least one string number, e.g. "6" or "4,2"`);
  }
  return parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 6) {
      throw new ChartInputError(`invalid string number ${JSON.stringify(p)} in ${fieldName}: must be 1-6`);
    }
    return n;
  });
}

/**
 * Parses `--notes`'s raw text into NoteMarker objects. The input format is
 * auto-detected the same way `parseFingerPositions` (fingerPositions.ts)
 * does: a string starting with "[" (after trimming) is parsed as a JSON
 * array, anything else as the compact notation below. Exported (in
 * addition to being used internally by `resolveChartFields`) so
 * document.ts can reuse the same auto-detection for a document's own
 * string-form `notes:` field.
 */
export function parseNoteMarkers(text: string): NoteMarker[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    return parseNoteMarkersJson(trimmed);
  }
  return parseNoteMarkersCompact(trimmed);
}

/**
 * Parses `--notes`'s raw JSON text into NoteMarker objects. Thin wrapper
 * around `noteMarkersFromArray` -- everything past "is this valid JSON
 * holding an array" is shared with that function, so a caller that
 * already has a parsed array (e.g. a native YAML list in document.ts)
 * doesn't have to round-trip through JSON.stringify/JSON.parse to reuse
 * the same per-element validation.
 */
function parseNoteMarkersJson(json: string): NoteMarker[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ChartInputError(`notes is not valid JSON: ${json}`);
  }
  if (!Array.isArray(parsed)) {
    throw new ChartInputError('notes must be a JSON array of marker objects, e.g. \'[{"string":6,"fret":3}]\'');
  }
  return noteMarkersFromArray(parsed);
}

/**
 * Validates an already-parsed array of marker-shaped values into
 * NoteMarker objects, eagerly validating every element the same way
 * `parseFingerPositionsJson` (fingerPositions.ts) validates a finger
 * positions object -- every constraint checked here, not deferred to the
 * layout engine, which trusts already-well-typed input.
 */
export function noteMarkersFromArray(items: unknown[]): NoteMarker[] {
  return items.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ChartInputError(`notes[${i}] must be an object`);
    }
    const el = item as Record<string, unknown>;

    const stringNumber = Number(el.string);
    if (!Number.isInteger(stringNumber) || stringNumber < 1 || stringNumber > 6) {
      throw new ChartInputError(`notes[${i}]: invalid string number ${JSON.stringify(el.string)}: must be 1-6`);
    }

    const fret = Number(el.fret);
    if (!Number.isInteger(fret) || fret < 0) {
      throw new ChartInputError(`notes[${i}]: invalid fret ${JSON.stringify(el.fret)}: must be a non-negative integer`);
    }

    if (el.label !== undefined && typeof el.label !== "string") {
      throw new ChartInputError(`notes[${i}].label must be a string`);
    }
    if (el.className !== undefined && typeof el.className !== "string") {
      throw new ChartInputError(`notes[${i}].className must be a string`);
    }
    const shape = el.shape !== undefined ? parseNoteShape(el.shape, `notes[${i}]`) : undefined;
    const finger = el.finger !== undefined ? parseFingerNumber(el.finger, `notes[${i}]`) : undefined;

    return {
      string: stringNumber as 1 | 2 | 3 | 4 | 5 | 6,
      fret,
      label: el.label as string | undefined,
      className: el.className as string | undefined,
      shape,
      finger,
    };
  });
}

const NOTE_MARKER_COMPACT_EXAMPLE = "6:3:R:root;6:5:2;5:2:b3:root:2:square";

/**
 * Parses `--notes`'s compact notation: markers separated by `;` and/or a
 * newline, each one `string:fret[:label[:className[:finger[:shape]]]]` --
 * positional fields, trailing ones simply omittable ("6:3" alone is a
 * complete marker), a blank segment skips a field to reach a later one
 * ("6:3::root" sets className with no label). No JSON, no quoting -- the
 * whole point of this form is to be typeable inline in a shell without
 * escaping drama. The newline separator exists for a hand-written
 * FretCharts file's `notes: |` block scalar, so markers can be spread one
 * per line instead of crammed onto one `;`-joined line -- both forms (and
 * a mix of the two) parse identically.
 */
function parseNoteMarkersCompact(text: string): NoteMarker[] {
  const entries = text
    .split(/[;\n]/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (entries.length === 0) {
    throw new ChartInputError(`notes must list at least one marker, e.g. "${NOTE_MARKER_COMPACT_EXAMPLE}"`);
  }

  return entries.map((entry, i) => {
    const fields = entry.split(":").map((f) => f.trim());
    if (fields.length < 2 || fields.length > 6) {
      throw new ChartInputError(
        `notes[${i}] (${JSON.stringify(
          entry,
        )}): expected "string:fret[:label[:className[:finger[:shape]]]]", e.g. "${NOTE_MARKER_COMPACT_EXAMPLE}"`,
      );
    }
    const [stringText, fretText, labelText, classNameText, fingerText, shapeText] = fields;

    const stringNumber = Number(stringText);
    if (!Number.isInteger(stringNumber) || stringNumber < 1 || stringNumber > 6) {
      throw new ChartInputError(`notes[${i}]: invalid string number ${JSON.stringify(stringText)}: must be 1-6`);
    }

    const fret = Number(fretText);
    if (!Number.isInteger(fret) || fret < 0) {
      throw new ChartInputError(`notes[${i}]: invalid fret ${JSON.stringify(fretText)}: must be a non-negative integer`);
    }

    const label = labelText ? labelText : undefined;
    const className = classNameText ? classNameText : undefined;
    const finger = fingerText ? parseFingerNumber(fingerText, `notes[${i}]`) : undefined;
    const shape = shapeText ? parseNoteShape(shapeText, `notes[${i}]`) : undefined;

    return {
      string: stringNumber as 1 | 2 | 3 | 4 | 5 | 6,
      fret,
      label,
      className,
      finger,
      shape,
    };
  });
}

/** The reverse of one marker's compact form: trims trailing omitted fields but keeps an earlier blank placeholder (e.g. "6:3::root") when a later field is set, since position is all that identifies a field here. */
function compactNoteMarker(m: NoteMarker): string {
  const trailing = [m.label ?? "", m.className ?? "", m.finger !== undefined ? String(m.finger) : "", m.shape ?? ""];
  while (trailing.length > 0 && trailing[trailing.length - 1] === "") trailing.pop();
  return [String(m.string), String(m.fret), ...trailing].join(":");
}

/**
 * The reverse of `parseNoteMarkersCompact`/`noteMarkersFromArray`: renders
 * `markers` back as compact notation, one marker per line -- used when
 * writing a FretCharts file with `--compact-notes` (see cli.ts's
 * `documentFromSingleOptions`). A single marker degrades to one plain
 * line with no trailing newline, so the caller's YAML writer only picks a
 * block-scalar (`notes: |`) style once there's actually more than one
 * line to it.
 */
export function stringifyNoteMarkersCompact(markers: NoteMarker[]): string {
  return markers.map(compactNoteMarker).join("\n");
}

/**
 * Collects a fixed-order [string1, string2, ..., string6] tuple of raw
 * per-string values (as read off `--string-label-N`/`--finger-position-N`
 * flags, in that order) into a StringLabels-shaped object, skipping
 * whichever strings weren't given.
 */
function collectPerStringValues(values: readonly (string | undefined)[]): StringLabels {
  const result: StringLabels = {};
  STRING_NUMBERS.forEach((stringNumber, i) => {
    const value = values[i];
    if (value !== undefined) {
      result[stringNumber] = value;
    }
  });
  return result;
}

const BRACKET_COMPACT_EXAMPLE = "0-3:E shape;2-5:D shape;4-8:C shape";

/**
 * Parses `--brackets`'s raw text into FretBracket objects, auto-detecting
 * JSON vs. compact notation the same way {@link parseNoteMarkers} does: a
 * string starting with "[" is a JSON array of `{startFret, endFret,
 * label, className?}` objects, anything else is compact notation --
 * brackets separated by `;` and/or a newline, each
 * `startFret-endFret:label[:className]` (e.g. "2-5:C shape:caged-c").
 * A single fret is just "5-5:label". Compact labels can't contain ":" or
 * ";" -- use the JSON form for those.
 */
export function parseBrackets(text: string): FretBracket[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new ChartInputError(`brackets is not valid JSON: ${trimmed}`);
    }
    if (!Array.isArray(parsed)) {
      throw new ChartInputError(
        'brackets must be a JSON array of bracket objects, e.g. \'[{"startFret":2,"endFret":5,"label":"C shape"}]\'',
      );
    }
    return bracketsFromArray(parsed);
  }

  const entries = trimmed
    .split(/[;\n]/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (entries.length === 0) {
    throw new ChartInputError(`brackets must list at least one bracket, e.g. "${BRACKET_COMPACT_EXAMPLE}"`);
  }
  return entries.map((entry, i) => {
    const match = /^(\d+)\s*-\s*(\d+)\s*:([^:]*)(?::([^:]*))?$/.exec(entry);
    if (!match) {
      throw new ChartInputError(
        `brackets[${i}] (${JSON.stringify(entry)}): expected "startFret-endFret:label[:className]", ` +
          `e.g. "${BRACKET_COMPACT_EXAMPLE}"`,
      );
    }
    const [, startText, endText, labelText, classNameText] = match;
    return validateBracket(
      { startFret: Number(startText), endFret: Number(endText), label: labelText.trim(), className: classNameText?.trim() || undefined },
      i,
    );
  });
}

/** Validates an already-parsed array of bracket-shaped values (JSON, or a native YAML list in document.ts) into FretBracket objects. */
export function bracketsFromArray(items: unknown[]): FretBracket[] {
  return items.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ChartInputError(`brackets[${i}] must be an object`);
    }
    const el = item as Record<string, unknown>;
    if (typeof el.label !== "string") {
      throw new ChartInputError(`brackets[${i}].label is required and must be a string`);
    }
    if (el.className !== undefined && typeof el.className !== "string") {
      throw new ChartInputError(`brackets[${i}].className must be a string`);
    }
    return validateBracket(
      {
        startFret: Number(el.startFret),
        endFret: Number(el.endFret),
        label: el.label,
        className: el.className as string | undefined,
      },
      i,
    );
  });
}

function validateBracket(b: FretBracket, i: number): FretBracket {
  if (!Number.isInteger(b.startFret) || b.startFret < 0) {
    throw new ChartInputError(`brackets[${i}]: invalid startFret ${JSON.stringify(b.startFret)}: must be a non-negative integer`);
  }
  if (!Number.isInteger(b.endFret) || b.endFret < b.startFret) {
    throw new ChartInputError(
      `brackets[${i}]: invalid endFret ${JSON.stringify(b.endFret)}: must be an integer >= startFret (${b.startFret})`,
    );
  }
  if (b.label.length === 0) {
    throw new ChartInputError(`brackets[${i}]: label must not be empty`);
  }
  return b.className !== undefined ? b : { startFret: b.startFret, endFret: b.endFret, label: b.label };
}

/** The reverse of parseBrackets' compact form, one bracket per line -- same role as stringifyNoteMarkersCompact. */
export function stringifyBracketsCompact(brackets: FretBracket[]): string {
  return brackets
    .map((b) => `${b.startFret}-${b.endFret}:${b.label}${b.className !== undefined ? `:${b.className}` : ""}`)
    .join("\n");
}
