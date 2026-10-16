import { describe, it, expect } from "vitest";
import { transposeNotation, transposeChord, transposeMarkers, transposeFretRange, transposeBrackets } from "./transpose";
import { ChartInputError } from "./chartFieldResolver";
import { ChordParseError } from "./chordparse";

describe("transposeNotation", () => {
  it("shifts every fretted/open string up by a positive amount", () => {
    // A major (x02220) shifted up 2 half-steps -> B major shape.
    expect(transposeNotation("x02220", 2)).toBe("x 2 4 4 4 2");
  });

  it("shifts every fretted/open string down by a negative amount", () => {
    expect(transposeNotation("x24442", -2)).toBe("x 0 2 2 2 0");
  });

  it("leaves muted strings (x) untouched", () => {
    expect(transposeNotation("xx0232", 3)).toBe("x x 3 5 6 5");
  });

  it("a zero shift is a no-op (aside from reformatting to space-separated)", () => {
    expect(transposeNotation("320003", 0)).toBe("3 2 0 0 0 3");
  });

  it("throws ChartInputError when the shift would put a note below the nut", () => {
    expect(() => transposeNotation("x02220", -3)).toThrow(ChartInputError);
  });

  it("an open string (fret 0) transposed up becomes a fretted note at the shift amount", () => {
    expect(transposeNotation("000000", 5)).toBe("5 5 5 5 5 5");
  });

  it("correctly interprets a two-digit tight notation input before transposing", () => {
    // "xxx121010": string 4 at fret 12, strings 3/2 at fret 10 each.
    expect(transposeNotation("xxx121010", 1)).toBe("x x x 13 11 11");
  });

  it("propagates ChordParseError for invalid input, unchanged", () => {
    expect(() => transposeNotation("qqqqqq", 1)).toThrow(ChordParseError);
  });

  it("respects a custom stringCount via parseOptions, for non-6-string tunings", () => {
    expect(transposeNotation("0220", 2, { stringCount: 4 })).toBe("2 4 4 2");
  });
});

describe("transposeChord", () => {
  it("shifts every fretted/open fret, leaving null (muted) entries alone", () => {
    expect(transposeChord([null, 0, 2, 2, 2, 0], 2)).toEqual([null, 2, 4, 4, 4, 2]);
  });

  it("throws ChartInputError when the shift would put a fret below the nut", () => {
    expect(() => transposeChord([3, 2, 0, 0, 0, 3], -1)).toThrow(ChartInputError);
  });
});

describe("transposeMarkers", () => {
  it("shifts every marker's fret, leaving every other field untouched", () => {
    const markers = transposeMarkers(
      [
        { string: 6, fret: 3, label: "R", className: "root", finger: 2, shape: "square" },
        { string: 5, fret: 2, label: "b3" },
      ],
      2,
    );
    expect(markers).toEqual([
      { string: 6, fret: 5, label: "R", className: "root", finger: 2, shape: "square" },
      { string: 5, fret: 4, label: "b3" },
    ]);
  });

  it("shifts an open marker (fret 0) into a fretted one", () => {
    expect(transposeMarkers([{ string: 6, fret: 0, label: "R" }], 3)).toEqual([
      { string: 6, fret: 3, label: "R" },
    ]);
  });

  it("throws ChartInputError when the shift would put a marker below the nut", () => {
    expect(() => transposeMarkers([{ string: 6, fret: 2 }], -5)).toThrow(ChartInputError);
  });

  it("does not mutate the input array/objects", () => {
    const markers = [{ string: 6 as const, fret: 3 }];
    const result = transposeMarkers(markers, 2);
    expect(markers[0].fret).toBe(3);
    expect(result[0].fret).toBe(5);
    expect(result).not.toBe(markers);
  });

  it("returns an empty array for an empty input", () => {
    expect(transposeMarkers([], 5)).toEqual([]);
  });
});

describe("transposeFretRange", () => {
  it("shifts both bounds by the same amount", () => {
    expect(transposeFretRange(5, 17, 3)).toEqual({ firstFret: 8, lastFret: 20 });
  });

  it("clamps firstFret at 0 rather than going negative", () => {
    expect(transposeFretRange(2, 14, -5)).toEqual({ firstFret: 0, lastFret: 9 });
  });

  it("does not clamp lastFret -- an impossible resulting range surfaces downstream instead", () => {
    expect(transposeFretRange(0, 12, -20)).toEqual({ firstFret: 0, lastFret: -8 });
  });

  it("leaves an omitted bound as undefined", () => {
    expect(transposeFretRange(undefined, undefined, 5)).toEqual({ firstFret: undefined, lastFret: undefined });
  });
});

describe("transposeBrackets", () => {
  it("shifts both ends, keeping label/className", () => {
    expect(transposeBrackets([{ startFret: 2, endFret: 5, label: "C", className: "c" }], 3)).toEqual([
      { startFret: 5, endFret: 8, label: "C", className: "c" },
    ]);
  });

  it("rejects a shift below the nut", () => {
    expect(() => transposeBrackets([{ startFret: 1, endFret: 4, label: "x" }], -2)).toThrow(ChartInputError);
  });
});
