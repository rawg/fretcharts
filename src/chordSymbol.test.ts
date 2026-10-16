import { describe, it, expect } from "vitest";
import { parseChordSymbol, parseKeyRoot, ChordSymbolError } from "./chordSymbol";

const labels = (s: string) => parseChordSymbol(s).tones.map((t) => t.label);

describe("parseChordSymbol", () => {
  it("parses roots with accidentals", () => {
    expect(parseChordSymbol("D").rootPitchClass).toBe(2);
    expect(parseChordSymbol("F#m").rootPitchClass).toBe(6);
    expect(parseChordSymbol("Bbmaj7").rootPitchClass).toBe(10);
  });

  it("keeps three-note chords whole", () => {
    expect(labels("D")).toEqual(["R", "3", "5"]);
    expect(labels("Bm")).toEqual(["R", "b3", "5"]);
    expect(labels("Gsus4")).toEqual(["R", "4", "5"]);
    expect(labels("Cdim")).toEqual(["R", "b3", "b5"]);
    expect(labels("Caug")).toEqual(["R", "3", "#5"]);
  });

  it("drops the 5th from four-note chords", () => {
    expect(labels("A7")).toEqual(["R", "3", "b7"]);
    expect(labels("Fmaj7")).toEqual(["R", "3", "7"]);
    expect(labels("Em7")).toEqual(["R", "b3", "b7"]);
    expect(labels("C6")).toEqual(["R", "3", "6"]);
  });

  it("orders add9 as a close voicing (9 below the 3rd)", () => {
    expect(labels("Cadd9")).toEqual(["R", "9", "3"]);
  });

  it("drops the 3rd instead when the 5th is altered", () => {
    expect(labels("Bm7b5")).toEqual(["R", "b5", "b7"]);
    expect(labels("Bdim7")).toEqual(["R", "b5", "bb7"]);
  });

  it("accepts common aliases", () => {
    expect(labels("C-7")).toEqual(labels("Cm7"));
    expect(labels("CM7")).toEqual(labels("Cmaj7"));
    expect(labels("Cø")).toEqual(labels("Cm7b5"));
    expect(labels("Csus")).toEqual(labels("Csus4"));
  });

  it("rejects unknown qualities, slash chords, and bad roots", () => {
    expect(() => parseChordSymbol("C13")).toThrow(ChordSymbolError);
    expect(() => parseChordSymbol("D/F#")).toThrow(/slash chords/);
    expect(() => parseChordSymbol("H")).toThrow(ChordSymbolError);
  });
});

describe("parseKeyRoot", () => {
  it("takes a note or a chord symbol's root", () => {
    expect(parseKeyRoot("G")).toBe(7);
    expect(parseKeyRoot("Ebm")).toBe(3);
    expect(() => parseKeyRoot("x")).toThrow(ChordSymbolError);
  });
});
