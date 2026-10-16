/**
 * Parses the two input forms PLAN.md allows for finger position labels into
 * a normalized {@link FingerPositions} record:
 *
 *  - A JSON object keyed by GUITAR STRING NUMBER, e.g. `{"6":"1"}`.
 *  - Compact notation, reusing chordparse's exact grammar with digits
 *    standing for finger numbers instead of frets, e.g. "xx0321" labels
 *    string 3 with finger 3, string 2 with finger 2, string 1 with finger 1
 *    (strings 6/5 get "x" = no finger, string 4 gets "0" = no finger).
 *
 * The input format is auto-detected: a string starting with "{" (after
 * trimming) is parsed as JSON, anything else as notation.
 */

import { ChordParseError, parseChord } from "./chordparse";
import type { FingerPositions } from "./types";

/** The input admits no valid reading as finger positions. */
export class FingerPositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FingerPositionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const MIN_FINGER = 1;
const MAX_FINGER = 5;

/**
 * Parses and validates a single finger value (1-5) -- a JSON object value
 * (via {@link parseFingerPositions}'s JSON form, where it may already be a
 * JSON number rather than a string) or a per-string `--finger-position-N`
 * flag/CSV column value (always a string there). `context` names what's
 * being parsed (e.g. "string 3") for the error message.
 */
export function parseFingerNumber(value: unknown, context: string): number {
  const finger = Number(value);
  if (!Number.isInteger(finger) || finger < MIN_FINGER || finger > MAX_FINGER) {
    throw new FingerPositionError(
      `invalid finger ${JSON.stringify(value)} for ${context}: must be an integer 1-5`,
    );
  }
  return finger;
}

/**
 * Any maxFret below 10 makes a two-character token impossible (the
 * tokenizer only accepts a two-digit token whose value is >= 10), which
 * forces every character to map 1:1 to a string -- exactly the shorthand
 * finger notation needs, with no ambiguity possible regardless of maxSpan.
 */
const NOTATION_MAX_FRET = 9;

export function parseFingerPositions(
  input: string,
  stringCount = 6,
): FingerPositions {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    return parseFingerPositionsJson(trimmed);
  }
  return parseFingerPositionsNotation(trimmed, stringCount);
}

function parseFingerPositionsJson(text: string): FingerPositions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FingerPositionError(`finger positions is not valid JSON: ${text}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FingerPositionError(
      'finger positions must be a JSON object, e.g. \'{"6":"1"}\'',
    );
  }

  const result: FingerPositions = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const stringNumber = Number(key);
    if (!Number.isInteger(stringNumber) || stringNumber < 1 || stringNumber > 6) {
      throw new FingerPositionError(
        `invalid string number ${JSON.stringify(key)} in finger positions: must be 1-6`,
      );
    }
    const finger = parseFingerNumber(value, `string ${key}`);
    result[stringNumber as 1 | 2 | 3 | 4 | 5 | 6] = finger;
  }
  return result;
}

function parseFingerPositionsNotation(
  text: string,
  stringCount: number,
): FingerPositions {
  let chord;
  try {
    chord = parseChord(text, { stringCount, maxFret: NOTATION_MAX_FRET, maxSpan: null });
  } catch (err) {
    if (err instanceof ChordParseError) {
      throw new FingerPositionError(
        `invalid finger-position notation ${JSON.stringify(text)}: ${err.message}`,
      );
    }
    throw err;
  }

  const result: FingerPositions = {};
  chord.forEach((value, index) => {
    if (value === null || value === 0) return; // "x" or "0" -- no finger
    if (value < MIN_FINGER || value > MAX_FINGER) {
      throw new FingerPositionError(
        `invalid finger ${value} in ${JSON.stringify(
          text,
        )}: must be 0 (none), "x" (none), or 1-5`,
      );
    }
    const stringNumber = stringCount - index;
    result[stringNumber as 1 | 2 | 3 | 4 | 5 | 6] = value;
  });
  return result;
}
