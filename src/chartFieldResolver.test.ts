import { describe, it, expect } from "vitest";
import {
  resolveChartFields,
  ChartInputError,
  noteMarkersFromArray,
  parseNoteMarkers,
  stringifyNoteMarkersCompact,
  parseBrackets,
  stringifyBracketsCompact,
} from "./chartFieldResolver";
import { FingerPositionError } from "./fingerPositions";

describe("resolveChartFields", () => {
  it("passes label and tuning through unchanged", () => {
    const resolved = resolveChartFields({ label: "G Major", tuning: "DADGBE" });
    expect(resolved.label).toBe("G Major");
    expect(resolved.tuning).toBe("DADGBE");
  });

  it("parses stringLabels JSON", () => {
    const resolved = resolveChartFields({ stringLabels: '{"6":"R"}' });
    expect(resolved.stringLabels).toEqual({ 6: "R" });
  });

  it("rejects malformed stringLabels JSON", () => {
    expect(() => resolveChartFields({ stringLabels: "{not json" })).toThrow(ChartInputError);
  });

  it("rejects stringLabels that parses but isn't an object", () => {
    expect(() => resolveChartFields({ stringLabels: "[1,2,3]" })).toThrow(ChartInputError);
  });

  it("parses fingerPositions in both JSON and notation form", () => {
    expect(resolveChartFields({ fingerPositions: '{"6":"1"}' }).fingerPositions).toEqual({ 6: 1 });
    expect(resolveChartFields({ fingerPositions: "xx0321" }).fingerPositions).toEqual({
      3: 3,
      2: 2,
      1: 1,
    });
  });

  it("propagates FingerPositionError for malformed fingerPositions", () => {
    expect(() => resolveChartFields({ fingerPositions: "{bad" })).toThrow(FingerPositionError);
  });

  describe("per-string overrides (stringLabelN/fingerPositionN)", () => {
    it("builds stringLabels from individual per-string fields alone", () => {
      const resolved = resolveChartFields({ stringLabel6: "R", stringLabel1: "b3" });
      expect(resolved.stringLabels).toEqual({ 6: "R", 1: "b3" });
    });

    it("builds fingerPositions from individual per-string fields alone, parsed to numbers", () => {
      const resolved = resolveChartFields({ fingerPosition6: "3", fingerPosition1: "1" });
      expect(resolved.fingerPositions).toEqual({ 6: 3, 1: 1 });
    });

    it("merges per-string fields into the aggregate stringLabels/fingerPositions for other strings", () => {
      const resolved = resolveChartFields({
        stringLabels: '{"5":"aggregate"}',
        stringLabel6: "R",
        fingerPositions: '{"5":"2"}',
        fingerPosition6: "3",
      });
      expect(resolved.stringLabels).toEqual({ 5: "aggregate", 6: "R" });
      expect(resolved.fingerPositions).toEqual({ 5: 2, 6: 3 });
    });

    it("a per-string field wins over a same-numbered entry in the aggregate blob", () => {
      const resolved = resolveChartFields({
        stringLabels: '{"6":"aggregate"}',
        stringLabel6: "override",
        fingerPositions: '{"6":"1"}',
        fingerPosition6: "5",
      });
      expect(resolved.stringLabels).toEqual({ 6: "override" });
      expect(resolved.fingerPositions).toEqual({ 6: 5 });
    });

    it("rejects an out-of-range fingerPositionN value", () => {
      expect(() => resolveChartFields({ fingerPosition3: "9" })).toThrow(FingerPositionError);
      expect(() => resolveChartFields({ fingerPosition3: "9" })).toThrow(/string 3/);
    });

    it("leaves stringLabels/fingerPositions undefined when no per-string fields or aggregate are given", () => {
      const resolved = resolveChartFields({});
      expect(resolved.stringLabels).toBeUndefined();
      expect(resolved.fingerPositions).toBeUndefined();
    });
  });

  it("parses noteClasses JSON", () => {
    const resolved = resolveChartFields({ noteClasses: '{"3":"root"}' });
    expect(resolved.noteClasses).toEqual({ 3: "root" });
  });

  it("rejects malformed noteClasses JSON", () => {
    expect(() => resolveChartFields({ noteClasses: "{nope" })).toThrow(ChartInputError);
  });

  it("expands root into noteClasses, single string", () => {
    const resolved = resolveChartFields({ root: "6" });
    expect(resolved.noteClasses).toEqual({ 6: "root" });
  });

  it("expands root into noteClasses, comma-separated with whitespace", () => {
    const resolved = resolveChartFields({ root: "4, 2" });
    expect(resolved.noteClasses).toEqual({ 4: "root", 2: "root" });
  });

  it("noteClasses wins over root on a conflicting string", () => {
    const resolved = resolveChartFields({ root: "6", noteClasses: '{"6":"highlight"}' });
    expect(resolved.noteClasses).toEqual({ 6: "highlight" });
  });

  it("rejects an out-of-range root string number", () => {
    expect(() => resolveChartFields({ root: "7" })).toThrow(ChartInputError);
  });

  it("rejects empty root", () => {
    expect(() => resolveChartFields({ root: "" })).toThrow(ChartInputError);
  });

  describe("noteShapes", () => {
    it("parses noteShapes JSON with valid shape values", () => {
      const resolved = resolveChartFields({ noteShapes: '{"3":"square","6":"triangle","2":"diamond"}' });
      expect(resolved.noteShapes).toEqual({ 3: "square", 6: "triangle", 2: "diamond" });
    });

    it("rejects malformed noteShapes JSON", () => {
      expect(() => resolveChartFields({ noteShapes: "{nope" })).toThrow(ChartInputError);
    });

    it("rejects noteShapes that parses but isn't an object", () => {
      expect(() => resolveChartFields({ noteShapes: "[1,2,3]" })).toThrow(ChartInputError);
    });

    it("rejects an invalid shape value", () => {
      expect(() => resolveChartFields({ noteShapes: '{"3":"hexagon"}' })).toThrow(ChartInputError);
    });

    it("is undefined when omitted", () => {
      const resolved = resolveChartFields({});
      expect(resolved.noteShapes).toBeUndefined();
    });
  });

  it("passes labelPitches/labelTuning booleans through unchanged", () => {
    const resolved = resolveChartFields({ labelPitches: true, labelTuning: false });
    expect(resolved.labelPitches).toBe(true);
    expect(resolved.labelTuning).toBe(false);
  });

  it("passes stylesheetPath through unchanged (no file I/O here)", () => {
    const resolved = resolveChartFields({ stylesheetPath: "/some/path.css" });
    expect(resolved.stylesheetPath).toBe("/some/path.css");
  });

  it("passes defsText/defsPath through unchanged (no file I/O here)", () => {
    const resolved = resolveChartFields({ defsText: "<x/>", defsPath: "/some/path.svg" });
    expect(resolved.defsText).toBe("<x/>");
    expect(resolved.defsPath).toBe("/some/path.svg");
  });

  it("returns all-undefined fields for an empty input", () => {
    const resolved = resolveChartFields({});
    expect(resolved).toEqual({
      label: undefined,
      stringLabels: undefined,
      fingerPositions: undefined,
      noteClasses: undefined,
      tuning: undefined,
      labelPitches: undefined,
      labelTuning: undefined,
      stylesheetPath: undefined,
    });
    expect(resolved.markers).toBeUndefined();
    expect(resolved.mutedStrings).toBeUndefined();
  });

  describe("markersJson (--notes)", () => {
    it("parses a valid markers array", () => {
      const resolved = resolveChartFields({
        markersJson: '[{"string":6,"fret":3,"label":"R","className":"root","finger":3}]',
      });
      expect(resolved.markers).toEqual([{ string: 6, fret: 3, label: "R", className: "root", finger: 3 }]);
    });

    it("defaults label/className/finger to undefined when omitted", () => {
      const resolved = resolveChartFields({ markersJson: '[{"string":6,"fret":0}]' });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 0, label: undefined, className: undefined, finger: undefined },
      ]);
    });

    it("rejects malformed JSON", () => {
      expect(() => resolveChartFields({ markersJson: "{not valid json" })).toThrow(ChartInputError);
    });

    it("rejects a JSON value that isn't an array", () => {
      expect(() => resolveChartFields({ markersJson: '{"string":6,"fret":3}' })).toThrow(ChartInputError);
    });

    it("rejects an array element that isn't an object", () => {
      expect(() => resolveChartFields({ markersJson: "[1, 2, 3]" })).toThrow(ChartInputError);
    });

    it("rejects a missing or out-of-range string number", () => {
      expect(() => resolveChartFields({ markersJson: "[{}]" })).toThrow(ChartInputError);
      expect(() => resolveChartFields({ markersJson: '[{"string":7,"fret":3}]' })).toThrow(ChartInputError);
    });

    it("rejects a missing or negative fret", () => {
      expect(() => resolveChartFields({ markersJson: '[{"string":6}]' })).toThrow(ChartInputError);
      expect(() => resolveChartFields({ markersJson: '[{"string":6,"fret":-1}]' })).toThrow(ChartInputError);
    });

    it("rejects a non-string label/className", () => {
      expect(() => resolveChartFields({ markersJson: '[{"string":6,"fret":3,"label":5}]' })).toThrow(
        ChartInputError,
      );
      expect(() => resolveChartFields({ markersJson: '[{"string":6,"fret":3,"className":5}]' })).toThrow(
        ChartInputError,
      );
    });

    it("rejects an out-of-range finger, via the same rule as fingerPositions/fingerPositionN", () => {
      expect(() => resolveChartFields({ markersJson: '[{"string":6,"fret":3,"finger":9}]' })).toThrow(
        FingerPositionError,
      );
    });

    it("parses a valid shape", () => {
      const resolved = resolveChartFields({ markersJson: '[{"string":6,"fret":3,"shape":"square"}]' });
      expect(resolved.markers).toEqual([{ string: 6, fret: 3, shape: "square" }]);
    });

    it("parses diamond as a valid shape", () => {
      const resolved = resolveChartFields({ markersJson: '[{"string":6,"fret":3,"shape":"diamond"}]' });
      expect(resolved.markers).toEqual([{ string: 6, fret: 3, shape: "diamond" }]);
    });

    it("rejects an invalid shape value", () => {
      expect(() => resolveChartFields({ markersJson: '[{"string":6,"fret":3,"shape":"hexagon"}]' })).toThrow(
        ChartInputError,
      );
    });

    it("still rejects malformed input that looks like JSON (starts with '[') via the JSON path specifically", () => {
      expect(() => resolveChartFields({ markersJson: "[not valid json" })).toThrow(ChartInputError);
    });
  });

  describe("markersJson compact notation (--notes)", () => {
    it("parses a full marker: string:fret:label:className:finger", () => {
      const resolved = resolveChartFields({ markersJson: "6:3:R:root:3" });
      expect(resolved.markers).toEqual([{ string: 6, fret: 3, label: "R", className: "root", finger: 3 }]);
    });

    it("parses the minimal string:fret form, leaving label/className/finger undefined", () => {
      const resolved = resolveChartFields({ markersJson: "6:3" });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 3, label: undefined, className: undefined, finger: undefined },
      ]);
    });

    it("parses fret 0 (open) the same as any other fret", () => {
      const resolved = resolveChartFields({ markersJson: "6:0:1" });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 0, label: "1", className: undefined, finger: undefined },
      ]);
    });

    it("a blank segment skips a field to reach a later one (className with no label)", () => {
      const resolved = resolveChartFields({ markersJson: "6:3::root" });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 3, label: undefined, className: "root", finger: undefined },
      ]);
    });

    it("parses multiple markers separated by ';', trimming whitespace around both ';' and ':'", () => {
      const resolved = resolveChartFields({ markersJson: " 6:3:R:root ; 6:5:2 ; 5 : 2 : b3 " });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 3, label: "R", className: "root", finger: undefined },
        { string: 6, fret: 5, label: "2", className: undefined, finger: undefined },
        { string: 5, fret: 2, label: "b3", className: undefined, finger: undefined },
      ]);
    });

    it("parses multiple markers separated by newlines, one per line (a hand-written FretCharts file block scalar)", () => {
      const resolved = resolveChartFields({ markersJson: "6:3:R:root\n6:5:2\n5:2:b3\n" });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 3, label: "R", className: "root", finger: undefined },
        { string: 6, fret: 5, label: "2", className: undefined, finger: undefined },
        { string: 5, fret: 2, label: "b3", className: undefined, finger: undefined },
      ]);
    });

    it("mixes ';' and newline separators identically", () => {
      const resolved = resolveChartFields({ markersJson: "6:3:R;6:5:2\n5:2:b3" });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 3, label: "R", className: undefined, finger: undefined },
        { string: 6, fret: 5, label: "2", className: undefined, finger: undefined },
        { string: 5, fret: 2, label: "b3", className: undefined, finger: undefined },
      ]);
    });

    it("rejects an out-of-range string number", () => {
      expect(() => resolveChartFields({ markersJson: "7:3" })).toThrow(ChartInputError);
    });

    it("rejects a negative fret", () => {
      expect(() => resolveChartFields({ markersJson: "6:-1" })).toThrow(ChartInputError);
    });

    it("rejects a non-numeric string or fret", () => {
      expect(() => resolveChartFields({ markersJson: "x:3" })).toThrow(ChartInputError);
      expect(() => resolveChartFields({ markersJson: "6:x" })).toThrow(ChartInputError);
    });

    it("rejects a marker with only one field (missing fret)", () => {
      expect(() => resolveChartFields({ markersJson: "6" })).toThrow(ChartInputError);
    });

    it("rejects a marker with too many fields", () => {
      expect(() => resolveChartFields({ markersJson: "6:3:R:root:3:circle:extra" })).toThrow(ChartInputError);
    });

    it("parses shape as the 6th field", () => {
      const resolved = resolveChartFields({ markersJson: "6:3:R:root:3:square" });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 3, label: "R", className: "root", finger: 3, shape: "square" },
      ]);
    });

    it("a blank shape segment leaves shape undefined while an earlier field is still set", () => {
      const resolved = resolveChartFields({ markersJson: "6:3:R:root:3:" });
      expect(resolved.markers).toEqual([
        { string: 6, fret: 3, label: "R", className: "root", finger: 3, shape: undefined },
      ]);
    });

    it("rejects an invalid shape value", () => {
      expect(() => resolveChartFields({ markersJson: "6:3:R:root:3:hexagon" })).toThrow(ChartInputError);
    });

    it("rejects an out-of-range finger, via the same rule as the JSON form", () => {
      expect(() => resolveChartFields({ markersJson: "6:3:R:root:9" })).toThrow(FingerPositionError);
    });

    it("rejects empty input", () => {
      expect(() => resolveChartFields({ markersJson: "" })).toThrow(ChartInputError);
      expect(() => resolveChartFields({ markersJson: "   " })).toThrow(ChartInputError);
    });
  });

  describe("mutedStrings (--muted)", () => {
    it("parses a single string number", () => {
      const resolved = resolveChartFields({ mutedStrings: "6" });
      expect(resolved.mutedStrings).toEqual([6]);
    });

    it("parses a comma-separated list with whitespace", () => {
      const resolved = resolveChartFields({ mutedStrings: "4, 2" });
      expect(resolved.mutedStrings).toEqual([4, 2]);
    });

    it("rejects an out-of-range string number", () => {
      expect(() => resolveChartFields({ mutedStrings: "7" })).toThrow(ChartInputError);
    });

    it("rejects empty input", () => {
      expect(() => resolveChartFields({ mutedStrings: "" })).toThrow(ChartInputError);
    });
  });
});

describe("noteMarkersFromArray (exported for document.ts's native-YAML-list notes)", () => {
  it("validates an already-parsed array into the same NoteMarker shape parseNoteMarkersJson produces", () => {
    const markers = noteMarkersFromArray([{ string: 6, fret: 3, label: "R", className: "root", finger: 2 }]);
    expect(markers).toEqual([{ string: 6, fret: 3, label: "R", className: "root", finger: 2 }]);
  });

  it("accepts a native (non-string) number for string/fret/finger, not just JSON-parsed ones", () => {
    // A native YAML list gives real numbers directly, unlike JSON.parse'd
    // text which also gives real numbers -- this just confirms nothing in
    // the validation path secretly assumed string input.
    const markers = noteMarkersFromArray([{ string: 6, fret: 3, finger: 2 }]);
    expect(markers).toEqual([{ string: 6, fret: 3, label: undefined, className: undefined, finger: 2 }]);
  });

  it("rejects an out-of-range string number, same message shape as the JSON-text path", () => {
    expect(() => noteMarkersFromArray([{ string: 7, fret: 3 }])).toThrow(ChartInputError);
  });

  it("rejects a non-object element", () => {
    expect(() => noteMarkersFromArray(["not an object"])).toThrow(ChartInputError);
  });

  it("validates shape, rejecting a value outside circle/square/triangle/diamond", () => {
    expect(noteMarkersFromArray([{ string: 6, fret: 3, shape: "triangle" }])).toEqual([
      { string: 6, fret: 3, shape: "triangle" },
    ]);
    expect(noteMarkersFromArray([{ string: 6, fret: 3, shape: "diamond" }])).toEqual([
      { string: 6, fret: 3, shape: "diamond" },
    ]);
    expect(() => noteMarkersFromArray([{ string: 6, fret: 3, shape: "hexagon" }])).toThrow(ChartInputError);
  });
});

describe("stringifyNoteMarkersCompact (exported for cli.ts's --compact-notes)", () => {
  it("renders one marker per line, joined by newlines", () => {
    const text = stringifyNoteMarkersCompact([
      { string: 6, fret: 3, label: "R", className: "root" },
      { string: 6, fret: 5, label: "2" },
      { string: 5, fret: 3 },
    ]);
    expect(text).toBe("6:3:R:root\n6:5:2\n5:3");
  });

  it("a single marker has no newline (degrades to a plain scalar when the caller writes it out)", () => {
    expect(stringifyNoteMarkersCompact([{ string: 6, fret: 3, label: "R" }])).toBe("6:3:R");
  });

  it("keeps an empty placeholder for a skipped field when a later one is set", () => {
    const text = stringifyNoteMarkersCompact([{ string: 6, fret: 3, className: "root" }]);
    expect(text).toBe("6:3::root");
  });

  it("round-trips through parseNoteMarkers back to the same markers", () => {
    const markers = [
      { string: 6 as const, fret: 3, label: "R", className: "root", finger: 2, shape: "square" as const },
      { string: 5 as const, fret: 2, label: "b3" },
    ];
    expect(parseNoteMarkers(stringifyNoteMarkersCompact(markers))).toEqual([
      { string: 6, fret: 3, label: "R", className: "root", finger: 2, shape: "square" },
      { string: 5, fret: 2, label: "b3", className: undefined, finger: undefined },
    ]);
  });

  it("returns an empty string for an empty array", () => {
    expect(stringifyNoteMarkersCompact([])).toBe("");
  });
});

describe("parseNoteMarkers (exported for document.ts's string-form notes)", () => {
  it("auto-detects compact notation", () => {
    const markers = parseNoteMarkers("6:3:R:root;6:5:2");
    expect(markers).toEqual([
      { string: 6, fret: 3, label: "R", className: "root", finger: undefined },
      { string: 6, fret: 5, label: "2", className: undefined, finger: undefined },
    ]);
  });

  it("auto-detects JSON array text", () => {
    const markers = parseNoteMarkers('[{"string":6,"fret":3}]');
    expect(markers).toEqual([{ string: 6, fret: 3, label: undefined, className: undefined, finger: undefined }]);
  });
});

describe("parseBrackets", () => {
  it("parses compact notation, separated by ; and/or newlines", () => {
    expect(parseBrackets("0-3:E shape;2-5:D shape:caged-d\n 7 - 10 : A shape ")).toEqual([
      { startFret: 0, endFret: 3, label: "E shape" },
      { startFret: 2, endFret: 5, label: "D shape", className: "caged-d" },
      { startFret: 7, endFret: 10, label: "A shape" },
    ]);
  });

  it("parses a JSON array", () => {
    expect(parseBrackets('[{"startFret":2,"endFret":5,"label":"C: root","className":"c"}]')).toEqual([
      { startFret: 2, endFret: 5, label: "C: root", className: "c" },
    ]);
  });

  it("allows a single-fret bracket", () => {
    expect(parseBrackets("5-5:x")).toEqual([{ startFret: 5, endFret: 5, label: "x" }]);
  });

  it.each([
    ["missing label", "2-5"],
    ["empty label", "2-5:"],
    ["reversed range", "5-2:x"],
    ["negative fret", "-1-3:x"],
    ["too many fields", "2-5:a:b:c"],
    ["empty input", " ; "],
    ["bad JSON", "[{"],
    ["JSON label missing", '[{"startFret":2,"endFret":5}]'],
    ["JSON non-integer fret", '[{"startFret":2.5,"endFret":5,"label":"x"}]'],
  ])("rejects %s", (_name, text) => {
    expect(() => parseBrackets(text)).toThrow(ChartInputError);
  });

  it("round-trips through stringifyBracketsCompact", () => {
    const brackets = [
      { startFret: 0, endFret: 3, label: "E shape" },
      { startFret: 2, endFret: 5, label: "D shape", className: "caged-d" },
    ];
    expect(parseBrackets(stringifyBracketsCompact(brackets))).toEqual(brackets);
  });

  it("is wired through resolveChartFields as bracketsText", () => {
    expect(resolveChartFields({ bracketsText: "2-5:C" }).brackets).toEqual([{ startFret: 2, endFret: 5, label: "C" }]);
    expect(resolveChartFields({}).brackets).toBeUndefined();
  });
});
