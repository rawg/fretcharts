/**
 * Turns raw string/boolean CLI-shaped input (one value per named parameter,
 * e.g. `--string-labels` or a CSV column of the same name) into the parsed
 * options `chart.ts`'s `buildChart` understands. Shared by the single-chord
 * CLI path (`cli.ts`) and the bulk CSV path (`bulk.ts`) so the two don't
 * duplicate JSON parsing, `--root` merging, or error formatting.
 */

import { StringLabels, FingerPositions, FretBracket, NoteClasses, NoteMarker, NoteShape, NoteShapes } from "./types";
import { parseFingerNumber, parseFingerPositions } from "./fingerPositions";
import { DEFAULT_TUNING, parseTuning } from "./tuning";

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
 *   is malformed in any of its forms (see parsePerStringText), if a `noteShapes` value isn't
 *   "circle"/"square"/"triangle"/"diamond", or if `root` isn't a valid
 *   string number/comma-separated list.
 * @throws {FingerPositionError} if `fingerPositions` is malformed, in
 *   either its JSON or notation form.
 */
export function resolveChartFields(raw: RawChartFields): ResolvedChartFields {
  const stringCount = stringCountFor(raw.tuning);

  let stringLabels: StringLabels | undefined;
  if (raw.stringLabels !== undefined) {
    stringLabels = parsePerStringText(raw.stringLabels, "string-labels", stringCount) as StringLabels;
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
    noteClasses = parsePerStringText(raw.noteClasses, "note-classes", stringCount) as NoteClasses;
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
    const parsed = parsePerStringText(raw.noteShapes, "note-shapes", stringCount);
    noteShapes = {};
    for (const [key, value] of Object.entries(parsed)) {
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

/**
 * The chord's string count, from `tuning` (default standard 6-string). A
 * malformed tuning falls back to 6 here rather than throwing: it's
 * reported, with its own error, wherever the tuning itself is parsed.
 */
export function stringCountFor(tuning: string | undefined): number {
  if (tuning === undefined) return DEFAULT_TUNING.length;
  try {
    return parseTuning(tuning).length;
  } catch {
    return DEFAULT_TUNING.length;
  }
}

/** The "no value for this string" placeholder in positional per-string text. */
const NO_VALUE = "-";

/**
 * Parses one per-string text field (`string-labels`, `note-classes`,
 * `note-shapes`) into string number -> value. Three forms, told apart by
 * content:
 *
 * - JSON: starts with `{`, e.g. `{"1":"3","2":"R"}`.
 * - Keyed: any entry contains `:`, e.g. `3:5 2:R 1:3` -- string number,
 *   then the value after the first colon (so a value may itself contain
 *   colons).
 * - Positional: one entry per string, low string first like chord
 *   notation, `-` for none, e.g. `- - - 5 R 3`. The entry count must
 *   match `stringCount`.
 *
 * Entries are separated by whitespace, or by `|` whenever the text
 * contains one -- the way to write a value with a space in it
 * (`-|-|-|5|R|sus 4`). Exported so the web UI's tests and document
 * writers can share the exact rules.
 *
 * @throws {ChartInputError} for invalid JSON, a non-object JSON value, an
 *   out-of-range or repeated string number, a wrong positional count, or
 *   an empty field.
 */
export function parsePerStringText(
  text: string,
  fieldName: string,
  stringCount: number = DEFAULT_TUNING.length,
): Record<number, string> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new ChartInputError(`${fieldName} is not valid JSON: ${text}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ChartInputError(`${fieldName} must be a JSON object, e.g. '{"3":"b3"}'`);
    }
    return parsed as Record<number, string>;
  }

  if (trimmed === "") {
    throw new ChartInputError(`${fieldName} is empty`);
  }
  const entries = trimmed.includes("|") ? trimmed.split("|").map((e) => e.trim()) : trimmed.split(/\s+/);

  const result: Record<number, string> = {};
  if (entries.some((e) => e.includes(":"))) {
    for (const entry of entries) {
      if (entry === "") continue;
      const colon = entry.indexOf(":");
      const key = colon < 0 ? entry : entry.slice(0, colon);
      const n = Number(key);
      if (colon < 0 || !Number.isInteger(n) || n < 1 || n > stringCount) {
        throw new ChartInputError(
          `${fieldName}: ${JSON.stringify(entry)} should be a string number 1-${stringCount}, a colon, and a value, e.g. "3:b3"`,
        );
      }
      if (n in result) {
        throw new ChartInputError(`${fieldName}: string ${n} is given more than once`);
      }
      const value = entry.slice(colon + 1).trim();
      if (value !== "") result[n] = value;
    }
    return result;
  }

  if (entries.length !== stringCount) {
    throw new ChartInputError(
      `${fieldName} has ${entries.length} ${entries.length === 1 ? "entry" : "entries"} but the chord has ${stringCount} strings: ` +
        `give one per string, low string first, with "${NO_VALUE}" for none (e.g. "- - - 5 R 3"), or name strings ("1:3 2:R")`,
    );
  }
  entries.forEach((value, i) => {
    if (value !== "" && value !== NO_VALUE) result[stringCount - i] = value;
  });
  return result;
}

/**
 * Writes string number -> value back as per-string text that
 * parsePerStringText reads to the same result, in the most compact form
 * that can hold it: positional (`- - - 5 R 3`) when `stringCount` is
 * known and keyed (`3:diamond`) isn't shorter, otherwise keyed; `|`-separated when a value has
 * whitespace; JSON as a last resort for a value positional/keyed text
 * can't carry (one with a `|`, or that is exactly `-`). Undefined when
 * there's nothing to write.
 */
export function stringifyPerStringCompact(
  values: Partial<Record<number, string>> | undefined,
  stringCount?: number,
): string | undefined {
  if (!values) return undefined;
  const keys = Object.keys(values)
    .map(Number)
    .filter((n) => values[n] !== undefined && values[n] !== "")
    .sort((a, b) => b - a);
  if (keys.length === 0) return undefined;
  const items = keys.map((n) => values[n] as string);

  const outOfRange = stringCount !== undefined && keys.some((n) => !Number.isInteger(n) || n < 1 || n > stringCount);
  if (outOfRange || items.some((v) => v.includes("|") || v.trim() !== v || v === NO_VALUE || v.startsWith("{"))) {
    const json: Record<string, string> = {};
    for (const n of keys.slice().sort((a, b) => a - b)) json[n] = values[n] as string;
    return JSON.stringify(json);
  }

  const separator = items.some((v) => /\s/.test(v)) ? "|" : " ";
  const keyed = keys.map((n) => `${n}:${values[n]}`).join(separator);
  // A value containing ":" would read back as keyed text, so positional
  // only works when none does.
  if (stringCount !== undefined && !items.some((v) => v.includes(":"))) {
    const entries: string[] = [];
    for (let n = stringCount; n >= 1; n--) entries.push(values[n] ? (values[n] as string) : NO_VALUE);
    const positional = entries.join(separator);
    // Positional reads like the chord itself, so it wins ties; keyed wins
    // for a value or two on a mostly-blank chord ("3:diamond").
    return keyed.length < positional.length ? keyed : positional;
  }
  return keyed;
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
