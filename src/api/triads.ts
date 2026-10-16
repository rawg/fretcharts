/**
 * /triads -- finds one triad voicing per chord of a progression (see
 * src/triads.ts) and renders them as a bulk-style grid. The response adds
 * the generated bulk-mode `csv` alongside the usual `svg`, so
 * the UI can show, download, or hand it to the Multiple chords tab.
 *
 * Same file-free posture as /bulk: `stylesheet` and `defs` are raw text,
 * never paths, and the generated CSV never has a stylesheet column.
 */

import { buildBulkGrid } from "../bulk";
import { parseChordSymbol, parseKeyRoot } from "../chordSymbol";
import { parseTuning, DEFAULT_TUNING } from "../tuning";
import { findTriads, parseFloor, parseStrings, progressionToCsv, TriadSearchOptions } from "../triads";
import { ok, invalid, gridParts, ApiResult } from "./result";

const DEFAULT_COLUMNS = 4;

/** Defensive bound, same spirit as /bulk's row cap. */
const MAX_CHORDS = 64;

/** Keeps the search's candidate count (and so its run time) bounded. */
const MAX_FRET_LIMIT = 24;

interface TriadsRequestBody {
  /** Chord symbols separated by spaces, commas, or bars, e.g. "D Bm G A7". */
  chords?: unknown;
  key?: unknown;
  strings?: unknown;
  floor?: unknown;
  direction?: unknown;
  maxSpan?: unknown;
  maxFret?: unknown;
  tuning?: unknown;
  columns?: unknown;
  collectionLabel?: unknown;
  stylesheet?: unknown;
  defs?: unknown;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export function handleTriads(body: unknown): ApiResult {
  if (typeof body !== "object" || body === null) {
    return invalid("request body must be a JSON object");
  }
  const req = body as TriadsRequestBody;

  if (!isNonEmptyString(req.chords)) {
    return invalid("chords is required and must be a non-empty string");
  }
  if (req.direction !== undefined && req.direction !== "above" && req.direction !== "below") {
    return invalid('direction must be "above" or "below"');
  }
  if (req.maxSpan !== undefined && !isPositiveInt(req.maxSpan)) {
    return invalid("maxSpan must be a positive integer");
  }
  if (req.maxFret !== undefined && !(isPositiveInt(req.maxFret) && req.maxFret <= MAX_FRET_LIMIT)) {
    return invalid(`maxFret must be an integer from 1 to ${MAX_FRET_LIMIT}`);
  }
  for (const field of ["key", "strings", "floor", "tuning"] as const) {
    if (req[field] !== undefined && !isString(req[field])) {
      return invalid(`${field} must be a string`);
    }
  }

  const symbols = req.chords.trim().split(/[\s,|]+/).filter((s) => s.length > 0);
  if (symbols.length > MAX_CHORDS) {
    return invalid(`too many chords (${symbols.length}); the maximum is ${MAX_CHORDS}`);
  }

  const nonEmpty = (v: unknown): string | undefined => (isNonEmptyString(v) ? v.trim() : undefined);
  const tuningText = nonEmpty(req.tuning);
  const strings = nonEmpty(req.strings);
  const floor = nonEmpty(req.floor);
  const key = nonEmpty(req.key);

  const options: TriadSearchOptions = {
    tuning: tuningText !== undefined ? parseTuning(tuningText) : DEFAULT_TUNING,
    strings: strings !== undefined ? parseStrings(strings) : undefined,
    floor: floor !== undefined ? parseFloor(floor) : undefined,
    keyRoot: key !== undefined ? parseKeyRoot(key) : undefined,
    direction: req.direction,
    maxSpan: req.maxSpan,
    maxFret: req.maxFret,
  };

  const csv = progressionToCsv(findTriads(symbols.map(parseChordSymbol), options), tuningText);

  const grid = buildBulkGrid(
    csv,
    { defsText: isString(req.defs) ? req.defs : undefined },
    isPositiveInt(req.columns) ? req.columns : DEFAULT_COLUMNS,
    isString(req.collectionLabel) && req.collectionLabel.trim() !== "" ? req.collectionLabel : undefined,
    isString(req.stylesheet) ? req.stylesheet : undefined,
  );

  return ok({ svg: grid.svg, csv, grid: gridParts(grid) });
}
