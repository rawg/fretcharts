import { describe, it, expect } from "vitest";
import { parseChordSymbol } from "./chordSymbol";
import { DEFAULT_TUNING, parseTuning, pitchAt } from "./tuning";
import {
  findTriads,
  formatVoicing,
  openPitches,
  progressionToCsv,
  stringGroups,
  TriadSearchError,
  TriadSearchOptions,
} from "./triads";

const chords = (...symbols: string[]) => symbols.map(parseChordSymbol);
const search = (symbols: string[], options: Partial<TriadSearchOptions> = {}) =>
  findTriads(chords(...symbols), { tuning: DEFAULT_TUNING, ...options });

/** The pitch classes a voicing actually sounds, as note names. */
const sounding = (frets: (number | null)[], tuning = DEFAULT_TUNING) =>
  frets.flatMap((f, i) => (f === null ? [] : [pitchAt(tuning[i], f)]));

describe("openPitches", () => {
  it("stacks standard tuning correctly (B string a major 3rd above G)", () => {
    expect(openPitches(DEFAULT_TUNING)).toEqual([4, 9, 14, 19, 23, 28]);
  });
});

describe("stringGroups", () => {
  it("lists only fully allowed contiguous groups", () => {
    expect(stringGroups(6)).toHaveLength(4);
    expect(stringGroups(6, [1, 2, 3, 4])).toEqual([
      [2, 3, 4],
      [3, 4, 5],
    ]);
    expect(stringGroups(6, [1, 3, 4])).toEqual([]);
  });
});

describe("findTriads", () => {
  it("returns one voicing per chord, each sounding exactly the chord's triad", () => {
    const { voicings } = search(["G", "C", "D", "Em"]);
    expect(voicings.map((v) => v.chord.symbol)).toEqual(["G", "C", "D", "Em"]);
    expect(new Set(sounding(voicings[0].frets))).toEqual(new Set(["G", "B", "D"]));
    expect(new Set(sounding(voicings[3].frets))).toEqual(new Set(["E", "G", "B"]));
    for (const v of voicings) expect(v.frets.filter((f) => f !== null)).toHaveLength(3);
  });

  it("keeps the whole progression on one string group", () => {
    const { voicings, strings } = search(["D", "Bm", "G", "A"]);
    for (const v of voicings) {
      const used = v.frets.flatMap((f, i) => (f === null ? [] : [6 - i]));
      expect(used).toEqual(strings);
    }
  });

  it("respects --strings", () => {
    const { strings } = search(["D", "Bm", "G", "A"], { strings: [1, 2, 3] });
    expect(strings).toEqual([3, 2, 1]);
  });

  it("uses close voicings within the span limit", () => {
    const { voicings } = search(["C", "F", "G7", "Am"], { maxSpan: 3, strings: [1, 2, 3] });
    for (const v of voicings) {
      const fretted = v.frets.filter((f): f is number => f !== null && f > 0);
      if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted) + 1).toBeLessThanOrEqual(3);
    }
  });

  it("minimizes hand travel", () => {
    // I-IV-V on the top strings can all be played within a couple of frets.
    const { voicings } = search(["G", "C", "D"], { strings: [1, 2, 3], floor: { kind: "fret", fret: 1 } });
    const positions = voicings.map((v) => v.position);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(2);
  });

  it("applies a fret floor inclusively", () => {
    const { voicings } = search(["G", "C", "D", "Em"], { floor: { kind: "fret", fret: 5 } });
    for (const v of voicings) for (const f of v.frets) if (f !== null) expect(f).toBeGreaterThanOrEqual(5);
  });

  it("treats the fret floor as inclusive", () => {
    // G as 7-8-7 on the top strings is the only G there with nothing below fret 7 (under fret 10).
    const g = (fret: number) =>
      search(["G"], { strings: [1, 2, 3], floor: { kind: "fret", fret }, maxFret: 9 }).voicings[0].frets;
    expect(formatVoicing(g(7))).toBe("xxx787");
    expect(() => g(8)).toThrow(TriadSearchError);
  });

  it("applies a pitch floor (string, fret)", () => {
    // 4th string, 5th fret = G3; nothing may sound below it.
    const open = openPitches(DEFAULT_TUNING);
    const { voicings } = search(["G", "C", "D", "Em"], { floor: { kind: "pitch", string: 4, fret: 5 } });
    for (const v of voicings) {
      v.frets.forEach((f, i) => {
        if (f !== null) expect(open[i] + f).toBeGreaterThanOrEqual(open[2] + 5);
      });
    }
  });

  it("keeps other chords above the anchor with direction 'above'", () => {
    const { voicings, anchorIndex } = search(["G", "C", "D", "G", "Em"], { direction: "above", strings: [1, 2, 3] });
    const anchor = voicings[anchorIndex].position;
    expect(voicings[3].position).toBeGreaterThanOrEqual(anchor);
    for (const i of [1, 2, 4]) expect(voicings[i].position).toBeGreaterThan(anchor);
  });

  it("keeps other chords below the anchor with direction 'below'", () => {
    const { voicings, anchorIndex } = search(["D", "G", "A"], { direction: "below", strings: [1, 2, 3] });
    for (const i of [1, 2]) expect(voicings[i].position).toBeLessThan(voicings[anchorIndex].position);
  });

  it("anchors on the key's chord when --key is given", () => {
    const { anchorIndex } = search(["Am", "F", "C", "G"], { keyRoot: 0 });
    expect(anchorIndex).toBe(2);
    expect(() => search(["Am", "F"], { keyRoot: 7 })).toThrow(TriadSearchError);
  });

  it("labels intervals and the root string", () => {
    const [v] = search(["A7"], { strings: [2, 3, 4] }).voicings;
    expect(Object.values(v.intervals).sort()).toEqual(["3", "R", "b7"]);
    expect(v.intervals[v.rootString]).toBe("R");
    expect(pitchAt(DEFAULT_TUNING[6 - v.rootString], v.frets[6 - v.rootString]!)).toBe("A");
  });

  it("works in alternate tunings", () => {
    const tuning = parseTuning("DADGBE");
    const { voicings } = findTriads(chords("D"), { tuning, strings: [4, 5, 6] });
    expect(new Set(sounding(voicings[0].frets, tuning))).toEqual(new Set(["D", "F#", "A"]));
  });

  it("reports impossible constraints", () => {
    expect(() => search(["G"], { strings: [1, 3, 5] })).toThrow(/three adjacent strings/);
    expect(() => search(["G"], { strings: [7] })).toThrow(/out of range/);
    expect(() => search(["G", "C"], { floor: { kind: "fret", fret: 14 }, maxFret: 15, maxSpan: 1 })).toThrow(
      /no triad progression/,
    );
  });
});

describe("formatVoicing", () => {
  it("uses compact notation for single-digit frets and dashes otherwise", () => {
    expect(formatVoicing([null, null, null, 7, 8, 7])).toBe("xxx787");
    expect(formatVoicing([null, null, null, 11, 10, 10])).toBe("x-x-x-11-10-10");
  });
});

describe("progressionToCsv", () => {
  it("writes FretCharts bulk columns, quoting the JSON labels", () => {
    const csv = progressionToCsv(search(["G"], { strings: [1, 2, 3], floor: { kind: "fret", fret: 1 } }));
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe("notes,label,root,string-labels");
    expect(row).toMatch(/^xxx\d+,G,[123],"\{.*""R"".*\}"$/);
  });

  it("adds a tuning column when given", () => {
    const csv = progressionToCsv(search(["G"]), "DADGBE");
    expect(csv.split("\n")[0]).toBe("notes,label,root,string-labels,tuning");
    expect(csv.split("\n")[1].endsWith(",DADGBE")).toBe(true);
  });
});
