import { describe, it, expect } from "vitest";
import {
  parseChord,
  tryParseChord,
  formatChord,
  ChordParseError,
  AmbiguousChordError,
  __internal,
  type Chord,
} from "./chordparse";

const cases: Array<[string, Chord | "error"]> = [
  ["320003", [3, 2, 0, 0, 0, 3]],
  ["x02220", [null, 0, 2, 2, 2, 0]],
  ["xxx121010", [null, null, null, 12, 10, 10]],
  ["x1013121110", [null, 10, 13, 12, 11, 10]],
  ["022100", [0, 2, 2, 1, 0, 0]],
  ["101212119", "error"], // 9 chars forces 3 pairs; no valid arrangement
  ["x x x 12 10 10", [null, null, null, 12, 10, 10]],
  ["10-12-12-12-10-10", [10, 12, 12, 12, 10, 10]],
  ["xxxxxx", [null, null, null, null, null, null]],
  ["0", "error"],
  ["3200O3", "error"], // letter O instead of zero
];

describe("tryParseChord", () => {
  it.each(cases)("parses %j", (text, expected) => {
    const result = tryParseChord(text);
    if (expected === "error") {
      expect(result.ok).toBe(false);
    } else {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.chord).toEqual(expected);
      }
    }
  });
});

it("reports AmbiguousChordError (not just any error) when maxSpan is disabled", () => {
  expect(() => parseChord("1212121212", { maxSpan: null })).toThrow(
    AmbiguousChordError,
  );
});

it("supports non-default string counts (ukulele)", () => {
  const uke = parseChord("0232", { stringCount: 4 });
  expect(uke).toEqual([0, 2, 3, 2]);
});

describe("exhaustive uniqueness over every legal 6-string chord (maxSpan 5)", () => {
  it(
    "produces exactly one reading for every packed chord, with no ambiguous collisions",
    { timeout: 30_000 },
    () => {
      const values: (number | null)[] = [null];
      for (let f = 0; f <= 24; f++) values.push(f);

      let total = 0;
      let collisions = 0;
      const chord: Chord = new Array(6).fill(null);
      const collisionSamples: string[] = [];

      const enumerate = (depth: number): void => {
        if (depth === 6) {
          if (!__internal.spanOk(chord, 5)) return;
          total += 1;
          const packed = formatChord(chord, "");
          const readings = __internal
            .tokenizations(packed, 6, 24)
            .filter((c) => __internal.spanOk(c, 5));
          if (readings.length !== 1) {
            collisions += 1;
            if (collisionSamples.length < 4) {
              collisionSamples.push(`${packed} -> ${readings.length} readings`);
            }
          }
          return;
        }
        for (const v of values) {
          chord[depth] = v;
          enumerate(depth + 1);
        }
      };

      enumerate(0);

      expect(total).toBe(1_466_516);
      expect(collisions, collisionSamples.join("; ")).toBe(0);
    },
  );
});
