#!/usr/bin/env node

/**
 * Command-line entry point. Thin wrapper around `./chart` (single-chord
 * mode) and `./bulk` (bulk CSV mode via --bulk): parses argv into options,
 * decides where output goes (stdout as SVG, or a file inferred from
 * `--output`'s extension -- .svg/.png renders, .yaml/.yml/.json instead
 * writes a FretCharts file capturing this invocation -- see
 * `./outputWriter`), and translates the library's typed errors into
 * clean, single-line stderr messages instead of raw stack traces.
 *
 * Everything here is testable without spawning a subprocess: `parseArgs`
 * and `run` never touch `process.argv` or call `process.exit` -- only the
 * bootstrap at the bottom of the file does that, and only when this module
 * is executed directly.
 */

import * as fs from "fs";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { ChordParseError } from "./chordparse";
import { LayoutError } from "./types";
import { TuningError, parseTuning, DEFAULT_TUNING } from "./tuning";
import {
  ChartInputError,
  RawChartFields,
  ResolvedChartFields,
  resolveChartFields,
  stringifyBracketsCompact,
  stringifyPerStringCompact,
  stringifyNoteMarkersCompact,
} from "./chartFieldResolver";
import { buildChart, buildNeckDiagram } from "./chart";
import { runBulk } from "./bulk";
import { runDocument } from "./document";
import type { ChartDocument } from "./document";
import { transposeBrackets, transposeNotation, transposeMarkers, transposeFretRange } from "./transpose";
import { writeSvgOutput, isDocumentOutputPath, writeDocumentOutput } from "./outputWriter";
import { VERSION } from "./version";

export interface SingleCliOptions extends ResolvedChartFields {
  mode: "single";
  /** Undefined in scale-chart mode, where `markers` (from --notes) is used instead. */
  notation?: string;
  output?: string;
  /** Neck-diagram mode: a wide, horizontal (nut-left, bridge-right) view over an explicit fret range, instead of the default compact chart. Requires --notes. */
  neck?: boolean;
  /** --neck only: first fret shown. Defaults to 0 (the nut/open position). */
  firstFret?: number;
  /** --neck only: last fret shown. Defaults to firstFret + 12. */
  lastFret?: number;
  /** Scale/neck FretCharts-file output only: write `notes` (and `brackets`) as compact notation (one entry per line) instead of a native YAML list. No effect on an SVG/PNG render or a chord-notation document (which has no `notes` field). */
  compactNotes?: boolean;
  /** Shifts every note by this many frets/half-steps (positive = up, negative = down) before building/writing. See transpose.ts. */
  transpose?: number;
  /** FretCharts-file output only, and only with --transpose: write the shift directly into notation/notes instead of recording a separate transpose: field. No effect without --transpose. */
  bakeTranspose?: boolean;
}

export interface BulkCliOptions {
  mode: "bulk";
  csvPath: string;
  columns: number;
  /** Raw, per-field values from the command line -- the default for any
   *  CSV row that leaves that column blank or omits it. */
  defaults: RawChartFields;
  output?: string;
  /** Optional title for the whole composite grid image. */
  collectionLabel?: string;
  /** Shifts every row's chord notation by this many frets/half-steps. See transpose.ts. */
  transpose?: number;
  /** Only with a non-undefined transpose: writes the shift directly into the written document's CSV `notes` column instead of leaving a transpose: field. See bulk.ts's transposeCsvNotes. */
  bakeTranspose?: boolean;
}

export interface DocumentCliOptions {
  mode: "document";
  documentPath: string;
  /** Overrides the document's own optional `output:` field, if given. */
  output?: string;
  /** Shifts every note in the loaded document by this many frets/half-steps before rendering. See transpose.ts. */
  transpose?: number;
  /** Only with --transpose, and only for a document written back out (--output to .yaml/.yml/.json) -- writes the shift directly into notation/notes (a type: chords document's inline CSV notes column, via bulk.ts's transposeCsvNotes) instead of leaving a transpose: field. No effect on a type: chords document referencing an external csvFile (rewriting that file isn't supported), or on a render. */
  bakeTranspose?: boolean;
}

export type CliOptions = SingleCliOptions | BulkCliOptions | DocumentCliOptions;

interface RawCliOptions {
  label?: string;
  stringLabels?: string;
  fingerPositions?: string;
  noteClasses?: string;
  noteShapes?: string;
  root?: string;
  tuning?: string;
  labelPitches?: boolean;
  labelTuning?: boolean;
  /** Defaults to `true` -- see the `--no-label-frets` option below. */
  labelFrets: boolean;
  output?: string;
  stylesheet?: string;
  svgDefs?: string;
  svgDefsFile?: string;
  bulk?: string;
  columns: number;
  collectionLabel?: string;
  stringLabel1?: string;
  stringLabel2?: string;
  stringLabel3?: string;
  stringLabel4?: string;
  stringLabel5?: string;
  stringLabel6?: string;
  fingerPosition1?: string;
  fingerPosition2?: string;
  fingerPosition3?: string;
  fingerPosition4?: string;
  fingerPosition5?: string;
  fingerPosition6?: string;
  notes?: string;
  muted?: string;
  neck?: boolean;
  firstFret?: number;
  lastFret?: number;
  brackets?: string;
  file?: string;
  compactNotes?: boolean;
  transpose?: number;
  bakeTranspose?: boolean;
}

/**
 * Every field-shaped flag other than the mode selectors (--bulk/--notes/
 * --neck, each already checked individually with their own message) and
 * --output (allowed to layer on top of --file, overriding the document's
 * own optional output: field). Commander's camelCase attribute names, for
 * use with getOptionValueSource -- see the --file gating in parseArgs.
 */
const OTHER_FIELD_OPTION_NAMES = [
  "label",
  "stringLabels",
  "fingerPositions",
  "noteClasses",
  "noteShapes",
  "root",
  "tuning",
  "labelPitches",
  "labelTuning",
  "labelFrets",
  "stylesheet",
  "svgDefs",
  "svgDefsFile",
  "muted",
  "firstFret",
  "lastFret",
  "brackets",
  "columns",
  "collectionLabel",
  "compactNotes",
  "stringLabel1",
  "stringLabel2",
  "stringLabel3",
  "stringLabel4",
  "stringLabel5",
  "stringLabel6",
  "fingerPosition1",
  "fingerPosition2",
  "fingerPosition3",
  "fingerPosition4",
  "fingerPosition5",
  "fingerPosition6",
] as const;

/** Converts a commander camelCase attribute name back to its "--kebab-case" flag spelling, for error messages -- e.g. "stringLabel1" -> "string-label-1". */
function kebabCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "-$1")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("fretcharts")
    .description("Render a guitar chord chart from compact tablature notation.")
    .version(VERSION)
    .addHelpText(
      "before",
      "\nModes (pick exactly one):\n" +
        "  fretcharts <notation>               a single chord (the default)\n" +
        "  fretcharts --notes <value>          a scale chart (multiple markers per string)\n" +
        "  fretcharts --neck --notes <value>   a neck diagram (wide, explicit fret range)\n" +
        "  fretcharts --bulk <file.csv>        many chords composited into one grid\n" +
        "  fretcharts --file <file.yaml>       a self-contained FretCharts file\n" +
        "\nSee the README's CLI reference for the full flag-by-flag breakdown.\n",
    )
    .argument(
      "[notation]",
      "chord notation, e.g. x02220 (see chordparse.ts for the grammar). Omit when using --bulk.",
    )
    .option("--label <text>", "optional chart title, rendered above the grid")
    .option(
      "--string-labels <labels>",
      'optional per-string label text: one per string, low E first, "-" for none ("- - - 5 R 3"); ' +
        'string:label pairs ("3:b3 1:R", 6=low E .. 1=high E); or a JSON object (\'{"3":"b3"}\'). ' +
        'Separate with "|" instead of spaces for a label with a space in it. See also --string-label-1..--string-label-6 ' +
        "to set/override just one string at a time; those win when both are given for the same string.",
    )
    .option(
      "--finger-positions <value>",
      "optional finger numbers (1-5), never shown for open/muted strings. Either a JSON object " +
        'keyed by string number, e.g. \'{"6":"1"}\', or chord-notation-style shorthand, e.g. ' +
        '"xx0321" (finger notation: "x"/"0" = no finger, digit = finger number). See also ' +
        "--finger-position-1..--finger-position-6 to set/override just one string at a time; " +
        "those win when both are given for the same string.",
    )
    .option(
      "--note-classes <classes>",
      "optional custom CSS class per string, added to that string's note (a fretted dot or an " +
        'open-string circle, never a muted string), in any --string-labels form, e.g. "3:root" -- useful with --stylesheet to style "the root note" consistently ' +
        "across many charts even as its string position varies",
    )
    .option(
      "--root <strings>",
      'shorthand for --note-classes tagging the given string(s) with the "root" class -- a ' +
        'single string number ("6") or a comma-separated list ("4,2"), whitespace ignored. ' +
        "Combine with --note-classes for any other classes; --note-classes wins on conflicts.",
    )
    .option(
      "--note-shapes <shapes>",
      "optional dot shape per string, in any --string-labels form -- " +
        '"circle" (the default), "square", "triangle", or "diamond" -- e.g. "3:square". ' +
        "Only applies to a fretted note's dot, never an open-string circle or a muted string's glyph.",
    )
    .option(
      "--tuning <notation>",
      'tuning notation, low string first, e.g. "DADGBE" (drop D) or "BEADF#B" (baritone B). ' +
        "Its length sets the string count. Defaults to standard EADGBE.",
    )
    .option(
      "--label-pitches",
      'auto-label each fretted note with its pitch (e.g. "F#"), computed from --tuning. Never ' +
        "applied to open strings. An explicit --string-labels entry for a string wins over its " +
        "computed pitch label. Also works in scale-chart/neck-diagram mode (--notes), where a " +
        "marker's own explicit label wins the same way.",
    )
    .option(
      "--label-tuning",
      "label every string with its open pitch from --tuning, above the mute/open indicators and " +
        "below the chart label. Unlike --label-pitches, every string gets one regardless of " +
        "fret/mute/open state -- this shows the tuning itself, not what's currently sounding.",
    )
    .option(
      "--no-label-frets",
      "scale-chart/neck-diagram mode only (--notes): omit fret-number reference labels -- on by " +
        "default. In scale-chart mode these sit to the right of the grid's 1st/3rd/(5th) rows, " +
        "same as chord-notation mode's (non-optional) fret labels. In neck-diagram mode, labels " +
        "appear above the neck, over string 1/high-E, at the standard inlay frets (3/5/7/9/12/etc.) " +
        "within [--first-fret, --last-fret] plus --first-fret itself, regardless of whether the " +
        "diagram starts at the nut.",
    )
    .option(
      "--output <path>",
      "output file path; format is inferred from the extension. .svg or .png renders the chart; " +
        ".yaml/.yml/.json instead writes a FretCharts file (see the FretCharts files section of " +
        "the README) capturing this invocation's parameters, not a render -- the same idea as the " +
        "web UI's \"FretCharts File\" button. Omit --output to write SVG to stdout.",
    )
    .option(
      "--compact-notes",
      "scale-chart/neck-diagram --output FretCharts file only: write `notes` as compact notation " +
        '(one marker per line, e.g. "6:3:R" -- see --notes above) instead of the native YAML marker ' +
        "list. No effect on an SVG/PNG render. Mutually exclusive with --file.",
    )
    .option(
      "--transpose <n>",
      "shifts every note by <n> frets/half-steps (positive = up, negative = down) before " +
        "building/writing -- a chord notation's muted (x) strings are left alone, an open (0) " +
        "string becomes fretted if shifted up, and a shift that would put any note below the nut " +
        "(fret 0) is rejected. Works with a notation argument, --notes, --bulk, and --file alike.",
      (value) => {
        const n = Number(value);
        if (!Number.isInteger(n)) {
          throw new InvalidArgumentError("must be an integer.");
        }
        return n;
      },
    )
    .option(
      "--bake-transpose",
      "--output FretCharts file only (including a --file reformat of one): write --transpose's " +
        "shift directly into the notation/notes (--bulk/type: chords: the CSV's notes column) " +
        "instead of recording it as a separate transpose: field. Use this to permanently move a " +
        "shape to a new position (e.g. before layering a different shape at the old one for a key " +
        "change) rather than keeping the original shape plus an offset. No effect without " +
        "--transpose, on an SVG/PNG render, or on a type: chords document loaded via --file that " +
        "references an external csvFile (rewriting that file isn't supported -- the transpose: " +
        "field is kept instead).",
    )
    .option(
      "--stylesheet <path>",
      "path to a CSS file embedded into the SVG, overriding default element styles " +
        "(see the chord-string-*, chord-dot-string-*, chord-glyph-*, etc. classes in the generated SVG)",
    )
    .option(
      "--svg-defs <xml>",
      "raw SVG markup embedded into the SVG as a <defs> element, e.g. one or more " +
        '\'<linearGradient id="...">\'/\'<radialGradient id="...">\' elements -- reference one from ' +
        "--stylesheet as an ordinary \"fill: url(#that-id)\" rule to blend two colors on a marker " +
        "(CSS alone can only ever set one flat fill). Mutually exclusive with --svg-defs-file.",
    )
    .option(
      "--svg-defs-file <path>",
      "path to a file holding raw SVG markup for <defs>, same meaning as --svg-defs. Mutually " +
        "exclusive with --svg-defs.",
    )
    .option(
      "--notes <value>",
      "scale-chart mode: multiple independently labeled/classed/shaped/fingered markers. Either " +
        'compact notation -- markers separated by ";", each one ' +
        '"string:fret[:label[:className[:finger[:shape]]]]" (trailing fields omittable, a blank ' +
        'field skips ahead, e.g. "6:3:R:root;6:5:2;5:2:b3:root:2:square") -- or a JSON array of marker ' +
        'objects, e.g. \'[{"string":6,"fret":3,"label":"R","className":"root","shape":"square"}]\'. ' +
        '`shape` is "circle" (the default), "square", "triangle", or "diamond" -- only applies to a fretted ' +
        '(fret > 0) marker, never an open (fret 0) one. fret 0 renders as an open-string glyph, ' +
        'same as chord notation\'s "0". Mutually exclusive with a notation argument and with --bulk.',
    )
    .option(
      "--muted <strings>",
      "scale-chart mode only: string(s) to render muted (\"x\"), same format as --root -- a single " +
        'string number ("6") or a comma-separated list ("4,2"). A muted string silently drops any ' +
        "--notes marker targeting the same string.",
    )
    .option(
      "--neck",
      "neck-diagram mode: a wide, horizontal (nut-left, bridge-right) view over an explicit " +
        "fret range, instead of the default compact auto-fit chart. Requires --notes; mutually " +
        "exclusive with a notation argument and with --bulk. Tuning/muting/open-string options " +
        "work the same as in scale-chart mode, rendered at the neck's left (nut) edge.",
    )
    .option(
      "--first-fret <n>",
      "--neck only: first fret shown. Defaults to 0 (the nut/open position).",
      (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw new InvalidArgumentError("must be a non-negative integer.");
        }
        return n;
      },
    )
    .option(
      "--last-fret <n>",
      "--neck only: last fret shown. Defaults to --first-fret + 12.",
      (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw new InvalidArgumentError("must be a non-negative integer.");
        }
        return n;
      },
    )
    .option(
      "--brackets <value>",
      "scale-chart/neck-diagram mode only (--notes): labeled fret-range brackets (e.g. CAGED shapes " +
        "or scale positions), drawn below the neck with --neck or left of the grid in a scale chart, " +
        'as compact notation -- "startFret-endFret:label[:className]" entries separated ' +
        'by ";", e.g. "0-3:E shape;2-5:D shape" -- or a JSON array of {startFret, endFret, label, ' +
        "className?} objects. Both ends are inclusive frets; overlapping brackets stack away from " +
        "the fretboard. A bracket outside --first-fret/--last-fret grows a neck diagram's shown range, " +
        "same as a note; in a scale chart, brackets are fitted into the auto-chosen window with the notes.",
    )
    .option(
      "--file <path>",
      "render from a self-contained FretCharts YAML/JSON file (see the FretCharts files section " +
        "of the README) -- a type: chord, scale, neck, or chords file holding its own notation/" +
        "notes/csv plus every styling option and a stylesheet. Mutually exclusive with a notation " +
        "argument, --notes, --bulk, --neck, and every other chart-field flag -- the file is " +
        "meant to be fully self-contained. Only --output layers on top, overriding the file's " +
        "own optional output: field if it has one.",
    )
    .option(
      "--bulk <path>",
      "bulk mode: path to a CSV file, one chord per row, rendered into a single grid image. " +
        'Each column heading names a parameter (e.g. "string-labels" for --string-labels); the ' +
        'chord notation column must be called "notes". Any other option given on the command ' +
        "line becomes the default for a row that leaves its column blank. Cannot be combined " +
        "with a notation argument.",
    )
    .option(
      "--columns <n>",
      "bulk mode only: charts per row in the grid output",
      (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) {
          throw new InvalidArgumentError("must be a positive integer.");
        }
        return n;
      },
      4,
    )
    .option(
      "--collection-label <text>",
      "bulk mode only: optional title for the whole composite grid image, centered above it",
    )
    // Never let commander call process.exit -- callers of run()/parseArgs()
    // need a normal thrown error or a return value, always.
    .exitOverride();

  // --string-label-N/--finger-position-N, one pair per guitar string --
  // generated rather than 12 near-identical .option() calls. Commander
  // camelCases these to stringLabel1..6/fingerPosition1..6 on .opts(),
  // matching RawChartFields exactly (verified: "--string-label-1" ->
  // "stringLabel1", not e.g. "stringLabel-1" or "stringLabel_1").
  for (const n of [1, 2, 3, 4, 5, 6] as const) {
    program.option(
      `--string-label-${n} <text>`,
      `set/override just string ${n}'s label (see --string-labels)`,
    );
    program.option(
      `--finger-position-${n} <n>`,
      `set/override just string ${n}'s finger number, 1-5 (see --finger-positions)`,
    );
  }

  return program;
}

/**
 * Parses argv (excluding the node/script prefix, i.e. `process.argv.slice(2)`)
 * into {@link CliOptions}.
 *
 * @throws {CommanderError} for malformed CLI invocations (missing/unknown
 *   arguments and options, or an invalid --columns); commander has already
 *   written its own usage message to stderr by the time this throws.
 * @throws {ChartInputError} if a notation argument, --notes, --bulk, --neck,
 *   and --file aren't given in a valid combination (exactly one of
 *   notation/--notes, unless --bulk or --file is given instead of either;
 *   --file rejects every other field flag, since a document is meant to
 *   be fully self-contained), or (single mode only, resolved eagerly) for
 *   malformed --string-labels/--note-classes/--note-shapes/--root/--notes/--muted.
 * @throws {FingerPositionError} (single mode only) if --finger-positions,
 *   any --finger-position-N, or a --notes marker's "finger" is malformed
 *   (not an integer 1-5), or --finger-positions is malformed in its JSON
 *   or notation form.
 */
export function parseArgs(argv: string[]): CliOptions {
  const program = buildProgram();
  program.parse(argv, { from: "user" });

  const opts = program.opts<RawCliOptions>();
  const [notation] = program.args;

  const raw: RawChartFields = {
    label: opts.label,
    stringLabels: opts.stringLabels,
    fingerPositions: opts.fingerPositions,
    noteClasses: opts.noteClasses,
    noteShapes: opts.noteShapes,
    root: opts.root,
    tuning: opts.tuning,
    labelPitches: opts.labelPitches,
    labelTuning: opts.labelTuning,
    labelFrets: opts.labelFrets,
    stylesheetPath: opts.stylesheet,
    defsText: opts.svgDefs,
    defsPath: opts.svgDefsFile,
    stringLabel1: opts.stringLabel1,
    stringLabel2: opts.stringLabel2,
    stringLabel3: opts.stringLabel3,
    stringLabel4: opts.stringLabel4,
    stringLabel5: opts.stringLabel5,
    stringLabel6: opts.stringLabel6,
    fingerPosition1: opts.fingerPosition1,
    fingerPosition2: opts.fingerPosition2,
    fingerPosition3: opts.fingerPosition3,
    fingerPosition4: opts.fingerPosition4,
    fingerPosition5: opts.fingerPosition5,
    fingerPosition6: opts.fingerPosition6,
    markersJson: opts.notes,
    mutedStrings: opts.muted,
    bracketsText: opts.brackets,
  };

  if (opts.svgDefs !== undefined && opts.svgDefsFile !== undefined) {
    throw new ChartInputError("cannot combine --svg-defs with --svg-defs-file -- give exactly one");
  }

  if (opts.file !== undefined) {
    if (notation !== undefined) {
      throw new ChartInputError("cannot combine a chord notation argument with --file");
    }
    if (opts.notes !== undefined) {
      throw new ChartInputError("cannot combine --notes with --file");
    }
    if (opts.bulk !== undefined) {
      throw new ChartInputError("cannot combine --bulk with --file");
    }
    if (opts.neck !== undefined) {
      throw new ChartInputError("cannot combine --neck with --file");
    }
    for (const name of OTHER_FIELD_OPTION_NAMES) {
      if (program.getOptionValueSource(name) === "cli") {
        throw new ChartInputError(`cannot combine --${kebabCase(name)} with --file`);
      }
    }
    return {
      mode: "document",
      documentPath: opts.file,
      output: opts.output,
      transpose: opts.transpose,
      bakeTranspose: opts.bakeTranspose,
    };
  }

  if (opts.bulk !== undefined) {
    if (notation !== undefined) {
      throw new ChartInputError("cannot combine a chord notation argument with --bulk");
    }
    if (opts.notes !== undefined) {
      throw new ChartInputError("cannot combine --notes with --bulk");
    }
    if (opts.neck !== undefined) {
      throw new ChartInputError("cannot combine --neck with --bulk");
    }
    if (opts.brackets !== undefined) {
      throw new ChartInputError("cannot combine --brackets with --bulk");
    }
    return {
      mode: "bulk",
      csvPath: opts.bulk,
      columns: opts.columns,
      defaults: raw,
      output: opts.output,
      transpose: opts.transpose,
      bakeTranspose: opts.bakeTranspose,
      collectionLabel: opts.collectionLabel,
    };
  }

  if (notation !== undefined && opts.notes !== undefined) {
    throw new ChartInputError("cannot combine a chord notation argument with --notes");
  }

  if (notation === undefined && opts.notes === undefined) {
    throw new ChartInputError(
      "missing required chord notation argument (or use --bulk <file.csv> or --notes <json>)",
    );
  }

  if (opts.brackets !== undefined && opts.notes === undefined) {
    throw new ChartInputError("--brackets requires --notes (scale-chart or neck-diagram mode)");
  }

  if (opts.neck !== undefined && notation !== undefined) {
    throw new ChartInputError(
      "cannot combine a chord notation argument with --neck (neck-diagram mode requires --notes)",
    );
  }

  return {
    mode: "single",
    notation,
    ...resolveChartFields(raw),
    output: opts.output,
    neck: opts.neck,
    firstFret: opts.firstFret,
    lastFret: opts.lastFret,
    compactNotes: opts.compactNotes,
    transpose: opts.transpose,
    bakeTranspose: opts.bakeTranspose,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Comma-joins a resolved string-number list back into --root/--muted's raw text form, or undefined if empty. */
function joinStringNumbers(nums: readonly (1 | 2 | 3 | 4 | 5 | 6)[] | undefined): string | undefined {
  return nums && nums.length > 0 ? nums.join(",") : undefined;
}

/** JSON-stringifies a resolved FingerPositions object back into --finger-positions' raw text form, or undefined if empty. */
function jsonOrUndefined(obj: Record<string, unknown> | undefined): string | undefined {
  return obj && Object.keys(obj).length > 0 ? JSON.stringify(obj) : undefined;
}

/**
 * Builds a ChartDocument capturing single-mode `options`' current values
 * (chord, scale, or neck, whichever `options` describes) -- used when
 * `--output` names a `.yaml`/`.yml`/`.json` path, so the document written
 * out is exactly equivalent to the render `options` would otherwise
 * produce. `options.compactNotes` (scale/neck only) renders `notes` as
 * compact notation via `stringifyNoteMarkersCompact` -- one marker per
 * line, which the `yaml` package's own stringifier then writes as a
 * `notes: |` block scalar once there's more than one line to it, same as
 * it already does for a multi-line `stylesheet`/`defs`. `stylesheet`/`defs`
 * are the already-read file content
 * (`--stylesheet <path>`'s/`--svg-defs-file <path>`'s target, or
 * `--svg-defs`'s inline text as-is), passed in rather than re-read from
 * disk here, since the caller already read it once to render -- this also
 * means a document generated from `--svg-defs-file` embeds the file's
 * *content* inline as `defs:`, never a `defsFile:` reference, so the
 * document stays self-contained if it's later moved somewhere the
 * original path wouldn't resolve.
 *
 * `--root`'s distinction from `--note-classes` doesn't survive
 * resolveChartFields (both merge into one `noteClasses` object before
 * `options` ever exists -- see chartFieldResolver.ts), so the generated
 * document always uses `noteClasses`, never `root`; this is a different
 * spelling of the identical result, not a loss of information. Likewise,
 * `--string-label-N`/`--finger-position-N` per-string overrides are
 * already merged into the aggregate `stringLabels`/`fingerPositions`
 * objects by the time `options` exists, so the document reflects their
 * *result*, not which flag form originally produced it.
 *
 * `--transpose` is written out as a `transpose:` field alongside the
 * *original*, untransposed `notation`/`notes` -- not baked into them --
 * so the document stays a faithful record of what was actually typed;
 * `buildDocument` (document.ts) applies the shift at render time, same as
 * every other render option. `--bake-transpose` (only with --transpose)
 * inverts this: the shift is applied directly to `notation`/`notes` here,
 * and no `transpose:` field is written at all -- for permanently moving a
 * shape to a new position (e.g. before layering a different shape at the
 * old one for a key change) rather than keeping the original shape plus
 * an offset.
 */
function documentFromSingleOptions(
  options: SingleCliOptions,
  stylesheet: string | undefined,
  defs: string | undefined,
): ChartDocument {
  const bake = options.bakeTranspose && options.transpose !== undefined;
  const transposeField = bake ? undefined : options.transpose;

  if (options.neck) {
    // Reachable only after buildNeckDiagram already succeeded with these
    // same options, which itself requires markers to be defined --
    // re-checked instead of asserted so this stays type-safe.
    if (options.markers === undefined) {
      throw new ChartInputError("--neck requires --notes");
    }
    const markers = bake ? transposeMarkers(options.markers, options.transpose!) : options.markers;
    const { firstFret, lastFret } = bake
      ? transposeFretRange(options.firstFret, options.lastFret, options.transpose!)
      : { firstFret: options.firstFret, lastFret: options.lastFret };
    const brackets =
      bake && options.brackets !== undefined ? transposeBrackets(options.brackets, options.transpose!) : options.brackets;
    return {
      type: "neck",
      notes: options.compactNotes ? stringifyNoteMarkersCompact(markers) : markers,
      firstFret,
      lastFret,
      brackets: brackets !== undefined && options.compactNotes ? stringifyBracketsCompact(brackets) : brackets,
      label: options.label,
      tuning: options.tuning,
      mutedStrings: joinStringNumbers(options.mutedStrings),
      labelPitches: options.labelPitches,
      labelTuning: options.labelTuning,
      labelFrets: options.labelFrets,
      transpose: transposeField,
      stylesheet,
      defs,
    };
  }

  if (options.notation === undefined) {
    if (options.markers === undefined) {
      throw new ChartInputError("buildChart requires either a chord notation string or --notes");
    }
    const markers = bake ? transposeMarkers(options.markers, options.transpose!) : options.markers;
    const brackets =
      bake && options.brackets !== undefined ? transposeBrackets(options.brackets, options.transpose!) : options.brackets;
    return {
      type: "scale",
      notes: options.compactNotes ? stringifyNoteMarkersCompact(markers) : markers,
      brackets: brackets !== undefined && options.compactNotes ? stringifyBracketsCompact(brackets) : brackets,
      label: options.label,
      tuning: options.tuning,
      mutedStrings: joinStringNumbers(options.mutedStrings),
      labelPitches: options.labelPitches,
      labelTuning: options.labelTuning,
      labelFrets: options.labelFrets,
      transpose: transposeField,
      stylesheet,
      defs,
    };
  }

  const stringCount = (options.tuning !== undefined ? parseTuning(options.tuning) : DEFAULT_TUNING).length;
  const notation = bake
    ? transposeNotation(options.notation, options.transpose!, { stringCount })
    : options.notation;

  return {
    type: "chord",
    notation,
    label: options.label,
    tuning: options.tuning,
    stringLabels: stringifyPerStringCompact(options.stringLabels, stringCount),
    fingerPositions: jsonOrUndefined(options.fingerPositions),
    noteClasses: stringifyPerStringCompact(options.noteClasses, stringCount),
    noteShapes: stringifyPerStringCompact(options.noteShapes, stringCount),
    labelPitches: options.labelPitches,
    labelTuning: options.labelTuning,
    transpose: transposeField,
    stylesheet,
    defs,
  };
}

/**
 * Runs the CLI end to end and returns an exit code. Never calls
 * `process.exit` and never reads `process.argv` -- callers (including
 * tests) pass argv explicitly.
 */
export async function run(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // Commander already printed a usage/error message via its default
      // output configuration; just propagate its suggested exit code.
      return err.exitCode;
    }
    process.stderr.write(`${errorMessage(err)}\n`);
    return 1;
  }

  if (options.mode === "bulk") {
    return runBulk(options);
  }

  if (options.mode === "document") {
    return runDocument(options);
  }

  try {
    const stylesheet =
      options.stylesheetPath !== undefined
        ? fs.readFileSync(options.stylesheetPath, "utf8")
        : undefined;
    const defs =
      options.defsPath !== undefined ? fs.readFileSync(options.defsPath, "utf8") : options.defsText;
    const svgOptions =
      stylesheet !== undefined || defs !== undefined ? { stylesheet, defs } : undefined;

    if (options.neck) {
      // parseArgs already guarantees --neck requires --notes (rejecting a
      // notation argument alongside it); re-checked here rather than
      // asserted so this stays type-safe without a non-null assertion.
      const markers = options.markers;
      if (markers === undefined) {
        throw new ChartInputError("--neck requires --notes");
      }
      const { svg, layout } = buildNeckDiagram(markers, {
        label: options.label,
        tuning: options.tuning,
        labelPitches: options.labelPitches,
        labelTuning: options.labelTuning,
        labelFrets: options.labelFrets,
        mutedStrings: options.mutedStrings,
        firstFret: options.firstFret,
        lastFret: options.lastFret,
        brackets: options.brackets,
        transpose: options.transpose,
        svgOptions,
      });
      for (const warning of layout.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
      }
      if (isDocumentOutputPath(options.output)) {
        return writeDocumentOutput(documentFromSingleOptions(options, stylesheet, defs), options.output);
      }
      return await writeSvgOutput(svg, options.output);
    }

    const { svg } = buildChart(options.notation, {
      label: options.label,
      stringLabels: options.stringLabels,
      fingerPositions: options.fingerPositions,
      noteClasses: options.noteClasses,
      noteShapes: options.noteShapes,
      tuning: options.tuning,
      labelPitches: options.labelPitches,
      labelTuning: options.labelTuning,
      labelFrets: options.labelFrets,
      notes: options.markers,
      mutedStrings: options.mutedStrings,
      brackets: options.brackets,
      transpose: options.transpose,
      svgOptions,
    });
    if (isDocumentOutputPath(options.output)) {
      return writeDocumentOutput(documentFromSingleOptions(options, stylesheet, defs), options.output);
    }
    return await writeSvgOutput(svg, options.output);
  } catch (err) {
    if (err instanceof ChordParseError || err instanceof LayoutError || err instanceof TuningError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    // File-read failures (bad stylesheet path, permissions, etc.) and
    // anything else unexpected still get a clean single-line message
    // rather than a raw stack trace.
    process.stderr.write(`${errorMessage(err)}\n`);
    return 1;
  }
}

/* istanbul ignore next -- exercised via subprocess/manual smoke tests only */
if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
