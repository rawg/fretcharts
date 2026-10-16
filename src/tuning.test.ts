import { describe, it, expect } from "vitest";
import {
  parseTuning,
  pitchAt,
  pitchLabelsForChord,
  pitchLabelsForMarkers,
  TuningError,
  DEFAULT_TUNING,
} from "./tuning";
import type { Chord } from "./chordparse";

describe("parseTuning", () => {
  it("parses standard tuning", () => {
    expect(parseTuning("EADGBE")).toEqual(["E", "A", "D", "G", "B", "E"]);
  });

  it("parses drop-D tuning", () => {
    expect(parseTuning("DADGBE")).toEqual(["D", "A", "D", "G", "B", "E"]);
  });

  it("parses baritone tuning with a sharp accidental", () => {
    expect(parseTuning("BEADF#B")).toEqual(["B", "E", "A", "D", "F#", "B"]);
  });

  it("parses flats", () => {
    expect(parseTuning("BbEbAbDbGbBb")).toEqual(["Bb", "Eb", "Ab", "Db", "Gb", "Bb"]);
  });

  it("supports a non-6-string tuning (e.g. 7-string, or bass)", () => {
    expect(parseTuning("BEADGBE")).toEqual(["B", "E", "A", "D", "G", "B", "E"]);
    expect(parseTuning("EADG")).toEqual(["E", "A", "D", "G"]);
  });

  it("rejects a lowercase note letter", () => {
    expect(() => parseTuning("eADGBE")).toThrow(TuningError);
  });

  it("rejects an invalid letter (not A-G)", () => {
    expect(() => parseTuning("HADGBE")).toThrow(TuningError);
  });

  it("rejects an accidental with no preceding letter", () => {
    expect(() => parseTuning("#ADGBE")).toThrow(TuningError);
  });

  it("rejects empty input", () => {
    expect(() => parseTuning("")).toThrow(TuningError);
  });

  it("distinguishes a 'B' note from a 'b' flat accidental (case-sensitive)", () => {
    // "AB" is two notes (A, B), not "A" + stray "b".
    expect(parseTuning("AB")).toEqual(["A", "B"]);
  });
});

describe("pitchAt", () => {
  it("computes the open pitch at fret 0", () => {
    expect(pitchAt("E", 0)).toBe("E");
  });

  it("computes a natural note with no accidental needed", () => {
    expect(pitchAt("E", 1)).toBe("F");
  });

  it("defaults to sharp spelling for accidentals", () => {
    expect(pitchAt("A", 6)).toBe("D#");
  });

  it("uses flat spelling when requested", () => {
    expect(pitchAt("A", 6, "flat")).toBe("Eb");
  });

  it("wraps around the octave", () => {
    expect(pitchAt("B", 1)).toBe("C");
    expect(pitchAt("G", 12)).toBe("G"); // full octave
  });

  it("handles an open string tuned to an accidental", () => {
    expect(pitchAt("F#", 1)).toBe("G");
  });

  it("handles unusual but valid enharmonic spellings (Cb, B#)", () => {
    expect(pitchAt("Cb", 0)).toBe("B");
    expect(pitchAt("B#", 0)).toBe("C");
  });
});

describe("pitchLabelsForChord", () => {
  it("labels every fretted string with its computed pitch", () => {
    const chord: Chord = [3, 2, 0, 0, 0, 3]; // G, standard tuning
    const labels = pitchLabelsForChord(chord, DEFAULT_TUNING);
    // string 6 (index0, low E) fret 3 -> G; string 5 (index1, A) fret 2 -> B;
    // string 1 (index5, high E) fret 3 -> G.
    expect(labels).toEqual({ 6: "G", 5: "B", 1: "G" });
  });

  it("never labels an open string", () => {
    const chord: Chord = [null, 0, 2, 2, 2, 0]; // A: x02220
    const labels = pitchLabelsForChord(chord, DEFAULT_TUNING);
    // Only the fretted strings (4, 3, 2 -> indices 2,3,4) get labels.
    expect(Object.keys(labels).sort()).toEqual(["2", "3", "4"]);
  });

  it("never labels a muted string", () => {
    const chord: Chord = [null, null, null, null, null, null];
    const labels = pitchLabelsForChord(chord, DEFAULT_TUNING);
    expect(labels).toEqual({});
  });

  it("uses the given tuning, not the standard default", () => {
    const dropD = parseTuning("DADGBE");
    // Open string produces no label regardless of tuning (the rule applies
    // before pitch is even computed).
    const openChord: Chord = [0, null, null, null, null, null];
    expect(pitchLabelsForChord(openChord, dropD)).toEqual({});
    // Fret 2 on the dropped low string observes the tuning's effect.
    const frettedChord: Chord = [2, null, null, null, null, null];
    expect(pitchLabelsForChord(frettedChord, dropD)).toEqual({ 6: "E" }); // D + 2 semitones
  });

  it("respects the accidental preference", () => {
    const chord: Chord = [null, 6, null, null, null, null]; // A string, fret 6
    expect(pitchLabelsForChord(chord, DEFAULT_TUNING, "sharp")).toEqual({ 5: "D#" });
    expect(pitchLabelsForChord(chord, DEFAULT_TUNING, "flat")).toEqual({ 5: "Eb" });
  });
});

describe("pitchLabelsForMarkers", () => {
  it("labels every fretted marker with no explicit label with its computed pitch", () => {
    const markers = [
      { string: 6 as const, fret: 3 },
      { string: 5 as const, fret: 2 },
    ];
    expect(pitchLabelsForMarkers(markers, DEFAULT_TUNING)).toEqual([
      { string: 6, fret: 3, label: "G" },
      { string: 5, fret: 2, label: "B" },
    ]);
  });

  it("leaves an explicit label untouched", () => {
    const markers = [{ string: 6 as const, fret: 3, label: "root" }];
    expect(pitchLabelsForMarkers(markers, DEFAULT_TUNING)).toEqual([{ string: 6, fret: 3, label: "root" }]);
  });

  it("never labels an open marker (fret 0)", () => {
    const markers = [{ string: 6 as const, fret: 0 }];
    expect(pitchLabelsForMarkers(markers, DEFAULT_TUNING)).toEqual([{ string: 6, fret: 0 }]);
  });

  it("preserves other marker fields (className, finger)", () => {
    const markers = [{ string: 6 as const, fret: 3, className: "root", finger: 2 }];
    expect(pitchLabelsForMarkers(markers, DEFAULT_TUNING)).toEqual([
      { string: 6, fret: 3, className: "root", finger: 2, label: "G" },
    ]);
  });

  it("leaves a marker untouched when its string falls outside tuning's range", () => {
    const shortTuning = parseTuning("EADG"); // 4 strings
    const markers = [{ string: 6 as const, fret: 3 }];
    expect(pitchLabelsForMarkers(markers, shortTuning)).toEqual([{ string: 6, fret: 3 }]);
  });

  it("uses the given tuning and respects the accidental preference", () => {
    const dropD = parseTuning("DADGBE");
    const markers = [{ string: 6 as const, fret: 2 }];
    expect(pitchLabelsForMarkers(markers, dropD)).toEqual([{ string: 6, fret: 2, label: "E" }]);

    const flatMarkers = [{ string: 5 as const, fret: 6 }];
    expect(pitchLabelsForMarkers(flatMarkers, DEFAULT_TUNING, "flat")).toEqual([
      { string: 5, fret: 6, label: "Eb" },
    ]);
  });

  it("does not mutate the input array", () => {
    const markers = [{ string: 6 as const, fret: 3 }];
    pitchLabelsForMarkers(markers, DEFAULT_TUNING);
    expect(markers[0]).toEqual({ string: 6, fret: 3 });
  });
});
