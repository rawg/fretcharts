/**
 * Shared result shaping for the request handlers in this directory. The
 * handlers take the same JSON-shaped request objects the web UI builds
 * from its forms and return either the rendered SVG (plus any extras like
 * warnings or a generated CSV) or a user-facing error message. They run
 * entirely in-process -- in the browser via ../browser/engine.ts, or in
 * Node for tests -- so there's no HTTP layer, only this success/error
 * envelope.
 */

import { ChordParseError } from "../chordparse";
import { LayoutError } from "../types";
import { TuningError } from "../tuning";
import { FingerPositionError } from "../fingerPositions";
import { ChartInputError } from "../chartFieldResolver";
import { DocumentError } from "../document";
import { ChordSymbolError } from "../chordSymbol";
import { TriadSearchError } from "../triads";
import type { BulkGrid, BulkSection } from "../bulk";

export interface RenderOutput {
  svg: string;
  /** Non-fatal notes about the render, e.g. a neck diagram's auto-expanded fret range. */
  warnings?: string[];
  /** /triads only: the generated bulk-mode CSV. */
  csv?: string;
  /** Grid renders only (/bulk, /triads, a type: chords /document): each chart on its own, for the print view. */
  grid?: GridParts;
}

export interface GridParts {
  charts: string[];
  /** The same charts grouped under the CSV's `header` rows. */
  sections: BulkSection[];
  columns: number;
  collectionLabel?: string;
}

/** The print-view parts of a bulk render -- everything but the composite svg. */
export function gridParts(grid: BulkGrid): GridParts {
  return { charts: grid.charts, sections: grid.sections, columns: grid.columns, collectionLabel: grid.collectionLabel };
}

export type ApiResult = { ok: true; data: RenderOutput } | { ok: false; error: string };

export function ok(data: RenderOutput): ApiResult {
  return { ok: true, data };
}

export function invalid(error: string): ApiResult {
  return { ok: false, error };
}

/**
 * True for this project's own well-formed, user-facing error classes --
 * their `.message` is already clean, safe text intended for direct display
 * (matching how the CLI shows them).
 */
function isKnownInputError(err: unknown): err is Error {
  return (
    err instanceof ChordParseError ||
    err instanceof LayoutError ||
    err instanceof TuningError ||
    err instanceof FingerPositionError ||
    err instanceof ChartInputError ||
    err instanceof DocumentError ||
    err instanceof ChordSymbolError ||
    err instanceof TriadSearchError
  );
}

/**
 * Maps a thrown error to an error result: the error's own message for a
 * known input-validation problem, or a generic message (with the original
 * logged to the console) for anything unexpected -- i.e. a bug, whose raw
 * message wasn't written for end users.
 */
export function errorResult(err: unknown): ApiResult {
  if (isKnownInputError(err)) {
    return invalid(err.message);
  }
  console.error(err);
  return invalid("Something went wrong while rendering. Please try again.");
}
