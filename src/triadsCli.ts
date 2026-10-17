#!/usr/bin/env node

/**
 * `fretcharts-triads`: finds one triad voicing per chord of a progression (see
 * ./triads) and writes them as a FretCharts bulk-mode CSV, to stdout or to
 * --output. Same testability split as ./cli: `parseTriadArgs` and
 * `runTriads` never touch `process.argv` or call `process.exit`.
 */

import * as fs from "fs";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { ChordSymbolError, parseChordSymbol, parseKeyRoot } from "./chordSymbol";
import { TuningError, parseTuning, DEFAULT_TUNING } from "./tuning";
import {
  DEFAULT_MAX_FRET,
  DEFAULT_MAX_SPAN,
  Direction,
  Floor,
  TriadSearchError,
  TriadSearchOptions,
  findTriads,
  parseFloor,
  parseStrings,
  progressionToCsv,
} from "./triads";

import { VERSION } from "./version";

export interface TriadCliOptions {
  chords: string[];
  search: TriadSearchOptions;
  /** The --tuning text as given, echoed into the CSV; undefined for the default. */
  tuningText?: string;
  output?: string;
}

function parseNonNegativeInt(value: string, what: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new InvalidArgumentError(`${what} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

function buildProgram(): Command {
  return new Command()
    .name("fretcharts-triads")
    .description(
      "Find one triad voicing per chord of a progression, all on the same three adjacent strings, " +
        "and write them as a FretCharts bulk-mode CSV.",
    )
    .version(VERSION)
    .argument("<chords...>", 'chord symbols, e.g. D Bm G A7 (supported: maj, m, dim, aug, sus2, sus4, 6, m6, 7, maj7, m7, m7b5, dim7, add9)')
    .option("--key <note>", "key root, e.g. G; its first chord is the anchor. Default: the first chord's root")
    .option("--strings <list>", 'strings the triads may use, e.g. "1-4" or "1,2,3,4" (1 = highest). Default: all', parseStrings)
    .option(
      "--floor <value>",
      'one number: every note at or above this fret, e.g. "5". Two numbers, string and fret: ' +
        'no note lower than that pitch, e.g. "5,3" (C on the 5th string in standard tuning)',
      parseFloor,
    )
    .option("--direction <dir>", 'keep every other chord "above" or "below" the anchor on the neck. Default: least movement only')
    .option("--max-span <frets>", `largest fret span of a triad, inclusive (default ${DEFAULT_MAX_SPAN})`, (v) =>
      parseNonNegativeInt(v, "--max-span"),
    )
    .option("--max-fret <fret>", `highest fret a triad may use (default ${DEFAULT_MAX_FRET})`, (v) =>
      parseNonNegativeInt(v, "--max-fret"),
    )
    .option("--tuning <notation>", 'tuning notation, low string first, e.g. "DADGBE". Default: standard EADGBE')
    .option("--output <path>", "write the CSV to this file instead of stdout")
    .exitOverride();
}

export function parseTriadArgs(argv: string[]): TriadCliOptions {
  const program = buildProgram();
  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    key?: string;
    strings?: number[];
    floor?: Floor;
    direction?: string;
    maxSpan?: number;
    maxFret?: number;
    tuning?: string;
    output?: string;
  }>();

  if (opts.direction !== undefined && opts.direction !== "above" && opts.direction !== "below") {
    throw new InvalidArgumentError(`--direction must be "above" or "below", got ${JSON.stringify(opts.direction)}`);
  }

  return {
    chords: program.args,
    tuningText: opts.tuning,
    output: opts.output,
    search: {
      tuning: opts.tuning !== undefined ? parseTuning(opts.tuning) : DEFAULT_TUNING,
      strings: opts.strings,
      floor: opts.floor,
      direction: opts.direction as Direction | undefined,
      maxSpan: opts.maxSpan,
      maxFret: opts.maxFret,
      keyRoot: opts.key !== undefined ? parseKeyRoot(opts.key) : undefined,
    },
  };
}

export async function runTriads(argv: string[]): Promise<number> {
  try {
    const options = parseTriadArgs(argv);
    const chords = options.chords.map(parseChordSymbol);
    const csv = progressionToCsv(findTriads(chords, options.search), options.tuningText);
    if (options.output !== undefined) {
      fs.writeFileSync(options.output, csv);
    } else {
      process.stdout.write(csv);
    }
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // Commander already printed its own message.
      return err.exitCode;
    }
    if (
      err instanceof ChordSymbolError ||
      err instanceof TriadSearchError ||
      err instanceof TuningError ||
      err instanceof InvalidArgumentError
    ) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/* istanbul ignore next -- exercised via subprocess/manual smoke tests only */
if (require.main === module) {
  runTriads(process.argv.slice(2)).then((code) => process.exit(code));
}
