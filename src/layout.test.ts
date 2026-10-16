import { describe, it, expect } from "vitest";
import type { Chord } from "./chordparse";
import { computeLayout, computeMarkerLayout, computeNeckLayout, stackBrackets } from "./layout";
import { LayoutError, NoteMarker } from "./types";

describe("computeLayout", () => {
  it("lays out a nut-start chord (G: 320003)", () => {
    const chord: Chord = [3, 2, 0, 0, 0, 3];
    const layout = computeLayout(chord);

    expect(layout.startFret).toBe(0);
    expect(layout.fretRowLabels).toEqual([
      { row: 0, label: "1" },
      { row: 2, label: "3" },
    ]);
    expect(layout.visibleFrets).toBe(4); // highest fret 3, clamped up to min 4
    expect(layout.stringCount).toBe(6);

    // Fretted notes: index 0 -> fret 3 (row 2), index 1 -> fret 2 (row 1),
    // index 5 -> fret 3 (row 2).
    expect(layout.dots).toEqual(
      expect.arrayContaining([
        { stringIndex: 0, row: 2 },
        { stringIndex: 1, row: 1 },
        { stringIndex: 5, row: 2 },
      ]),
    );
    expect(layout.dots).toHaveLength(3);

    // Open strings at indices 2, 3, 4.
    expect(layout.glyphs).toEqual(
      expect.arrayContaining([
        { stringIndex: 2, glyph: "0" },
        { stringIndex: 3, glyph: "0" },
        { stringIndex: 4, glyph: "0" },
      ]),
    );
    expect(layout.glyphs).toHaveLength(3);
  });

  it("lays out a nut-start chord with mutes and opens (A: x02220)", () => {
    const chord: Chord = [null, 0, 2, 2, 2, 0];
    const layout = computeLayout(chord);

    expect(layout.startFret).toBe(0);
    expect(layout.visibleFrets).toBe(4);

    expect(layout.glyphs).toEqual(
      expect.arrayContaining([
        { stringIndex: 0, glyph: "x" },
        { stringIndex: 1, glyph: "0" },
        { stringIndex: 5, glyph: "0" },
      ]),
    );
    expect(layout.glyphs).toHaveLength(3);

    expect(layout.dots).toEqual(
      expect.arrayContaining([
        { stringIndex: 2, row: 1 },
        { stringIndex: 3, row: 1 },
        { stringIndex: 4, row: 1 },
      ]),
    );
    expect(layout.dots).toHaveLength(3);
  });

  it("shows 5 visible rows when the highest fret is exactly 5", () => {
    const chord: Chord = [null, null, null, null, null, 5];
    const layout = computeLayout(chord);

    expect(layout.startFret).toBe(0);
    expect(layout.visibleFrets).toBe(5);
    expect(layout.dots).toEqual([{ stringIndex: 5, row: 4 }]);
    // With 5 rows shown, the 5th-row label now applies too.
    expect(layout.fretRowLabels).toEqual([
      { row: 0, label: "1" },
      { row: 2, label: "3" },
      { row: 4, label: "5" },
    ]);
  });

  it("offsets the start fret when the lowest fretted note is above 5", () => {
    // lowest fretted note 8, highest 10 -> startFret = 7.
    const chord: Chord = [8, null, null, null, null, 10];
    const layout = computeLayout(chord);

    expect(layout.startFret).toBe(7);
    expect(layout.visibleFrets).toBe(4); // 10 - 7 = 3, clamped up to 4
    // Row 0 = fret 8, row 2 = fret 10 -- plain numbers, no "fr" suffix.
    // Position 5 doesn't apply since only 4 rows are shown.
    expect(layout.fretRowLabels).toEqual([
      { row: 0, label: "8" },
      { row: 2, label: "10" },
    ]);

    expect(layout.dots).toEqual(
      expect.arrayContaining([
        { stringIndex: 0, row: 0 }, // fret 8 -> row 8-7-1 = 0
        { stringIndex: 5, row: 2 }, // fret 10 -> row 10-7-1 = 2
      ]),
    );
    expect(layout.dots).toHaveLength(2);
  });

  it("handles an all-muted chord", () => {
    const chord: Chord = [null, null, null, null, null, null];
    const layout = computeLayout(chord);

    expect(layout.startFret).toBe(0);
    expect(layout.visibleFrets).toBe(4);
    expect(layout.dots).toHaveLength(0);
    expect(layout.glyphs).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(layout.glyphs).toContainEqual({ stringIndex: i, glyph: "x" });
    }
  });

  it("handles an all-open chord", () => {
    const chord: Chord = [0, 0, 0, 0, 0, 0];
    const layout = computeLayout(chord);

    expect(layout.startFret).toBe(0);
    expect(layout.visibleFrets).toBe(4);
    expect(layout.dots).toHaveLength(0);
    expect(layout.glyphs).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(layout.glyphs).toContainEqual({ stringIndex: i, glyph: "0" });
    }
  });

  describe("stringLabels translation", () => {
    it("labels a dot addressed by string number 6 (leftmost / index 0)", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3]; // G
      const layout = computeLayout(chord, { stringLabels: { 6: "R" } });

      const dot = layout.dots.find((d) => d.stringIndex === 0);
      expect(dot).toBeDefined();
      expect(dot?.label).toBe("R");

      // No other dot should have picked up the label.
      const otherLabeled = layout.dots.filter(
        (d) => d.stringIndex !== 0 && d.label !== undefined,
      );
      expect(otherLabeled).toHaveLength(0);
    });

    it("labels a dot addressed by string number 1 (rightmost / last index)", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3]; // G, length 6
      const layout = computeLayout(chord, { stringLabels: { 1: "5" } });

      const dot = layout.dots.find((d) => d.stringIndex === 5);
      expect(dot).toBeDefined();
      expect(dot?.label).toBe("5");
    });

    it("silently drops a label given for a muted/open string", () => {
      const chord: Chord = [null, 0, 2, 2, 2, 0]; // A: x02220
      // String 6 (index 0) is muted; string 2 (index 4) is fretted at 2.
      expect(() =>
        computeLayout(chord, { stringLabels: { 6: "should-not-appear" } }),
      ).not.toThrow();

      const layout = computeLayout(chord, {
        stringLabels: { 6: "should-not-appear", 1: "also-dropped" },
      });

      const anyLabeled = layout.dots.some((d) => d.label !== undefined);
      expect(anyLabeled).toBe(false);
      expect(layout.dots.find((d) => d.label === "should-not-appear")).toBeUndefined();
      expect(layout.dots.find((d) => d.label === "also-dropped")).toBeUndefined();
    });
  });

  describe("fingerPositions translation", () => {
    it("adds a finger label for a fretted string addressed by string number", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3]; // G
      const layout = computeLayout(chord, { fingerPositions: { 6: 3, 5: 2, 1: 4 } });

      expect(layout.fingerLabels).toEqual(
        expect.arrayContaining([
          { stringIndex: 0, finger: 3 }, // string 6 -> index 0
          { stringIndex: 1, finger: 2 }, // string 5 -> index 1
          { stringIndex: 5, finger: 4 }, // string 1 -> index 5
        ]),
      );
      expect(layout.fingerLabels).toHaveLength(3);
    });

    it("never labels a muted or open string, even if given a finger position", () => {
      const chord: Chord = [null, 0, 2, 2, 2, 0]; // A: x02220
      // String 6 (index 0) muted, string 5 (index 1) open, string 1 (index
      // 5) open; strings 4/3/2 (indices 2/3/4) are fretted.
      const layout = computeLayout(chord, {
        fingerPositions: { 6: 1, 5: 1, 4: 2, 1: 1 },
      });

      expect(layout.fingerLabels.some((f) => f.stringIndex === 0)).toBe(false); // string 6, muted
      expect(layout.fingerLabels.some((f) => f.stringIndex === 1)).toBe(false); // string 5, open
      expect(layout.fingerLabels.some((f) => f.stringIndex === 5)).toBe(false); // string 1, open
      // The fretted string (4, index 2) still gets its label.
      expect(layout.fingerLabels).toEqual([{ stringIndex: 2, finger: 2 }]);
    });

    it("defaults to an empty array when no fingerPositions are given", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3];
      const layout = computeLayout(chord);
      expect(layout.fingerLabels).toEqual([]);
    });
  });

  describe("noteClasses translation", () => {
    it("adds a custom class to a dot addressed by string number", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3]; // G
      const layout = computeLayout(chord, { noteClasses: { 6: "root" } });

      const dot = layout.dots.find((d) => d.stringIndex === 0);
      expect(dot?.className).toBe("root");
      const otherClassed = layout.dots.filter(
        (d) => d.stringIndex !== 0 && d.className !== undefined,
      );
      expect(otherClassed).toHaveLength(0);
    });

    it("adds a custom class to an OPEN string's circle glyph, since a root note can be open", () => {
      const chord: Chord = [null, 0, 2, 2, 2, 0]; // A: x02220
      // String 5 (index 1) and string 1 (index 5) are open.
      const layout = computeLayout(chord, { noteClasses: { 5: "root", 1: "fifth" } });

      const openGlyph5 = layout.glyphs.find((g) => g.stringIndex === 1);
      const openGlyph1 = layout.glyphs.find((g) => g.stringIndex === 5);
      expect(openGlyph5).toMatchObject({ glyph: "0", className: "root" });
      expect(openGlyph1).toMatchObject({ glyph: "0", className: "fifth" });
    });

    it("never classes a MUTED string, even if given a note class", () => {
      const chord: Chord = [null, 0, 2, 2, 2, 0]; // A: x02220
      const layout = computeLayout(chord, { noteClasses: { 6: "root" } }); // string 6, muted

      const mutedGlyph = layout.glyphs.find((g) => g.stringIndex === 0);
      expect(mutedGlyph).toMatchObject({ glyph: "x" });
      expect(mutedGlyph?.className).toBeUndefined();
      // Nothing else picked it up either.
      expect(layout.dots.every((d) => d.className === undefined)).toBe(true);
      expect(layout.glyphs.every((g) => g.className === undefined)).toBe(true);
    });

    it("defaults to no className anywhere when noteClasses is omitted", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3];
      const layout = computeLayout(chord);
      expect(layout.dots.every((d) => d.className === undefined)).toBe(true);
      expect(layout.glyphs.every((g) => g.className === undefined)).toBe(true);
    });
  });

  describe("noteShapes translation", () => {
    it("adds a shape to a dot addressed by string number", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3]; // G
      const layout = computeLayout(chord, { noteShapes: { 6: "square" } });

      const dot = layout.dots.find((d) => d.stringIndex === 0);
      expect(dot?.shape).toBe("square");
      const othersShaped = layout.dots.filter((d) => d.stringIndex !== 0 && d.shape !== undefined);
      expect(othersShaped).toHaveLength(0);
    });

    it("never shapes an open string's glyph or a muted string -- there's no dot there to shape", () => {
      const chord: Chord = [null, 0, 2, 2, 2, 0]; // A: x02220 -- string 6 muted, strings 5/1 open
      const layout = computeLayout(chord, { noteShapes: { 6: "square", 5: "triangle", 1: "triangle" } });

      expect(layout.glyphs.every((g) => (g as { shape?: unknown }).shape === undefined)).toBe(true);
      expect(layout.dots.every((d) => d.shape === undefined)).toBe(true);
    });

    it("defaults to no shape anywhere when noteShapes is omitted", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3];
      const layout = computeLayout(chord);
      expect(layout.dots.every((d) => d.shape === undefined)).toBe(true);
    });
  });

  describe("tuningLabels", () => {
    it("labels every string, in chord-array index order, regardless of fret/mute/open state", () => {
      const chord: Chord = [null, 0, 2, 2, 2, 0]; // A: x02220 (one muted, two open, three fretted)
      const layout = computeLayout(chord, {
        tuningLabels: ["E", "A", "D", "G", "B", "E"],
      });
      expect(layout.tuningLabels).toEqual([
        { stringIndex: 0, label: "E" },
        { stringIndex: 1, label: "A" },
        { stringIndex: 2, label: "D" },
        { stringIndex: 3, label: "G" },
        { stringIndex: 4, label: "B" },
        { stringIndex: 5, label: "E" },
      ]);
    });

    it("defaults to an empty array when tuningLabels is omitted", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3];
      const layout = computeLayout(chord);
      expect(layout.tuningLabels).toEqual([]);
    });
  });

  describe("fretRowLabels", () => {
    it("always labels rows 1 and 3 even at the nut (no offset)", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3]; // G, startFret=0, visibleFrets=4
      const layout = computeLayout(chord);
      expect(layout.fretRowLabels).toEqual([
        { row: 0, label: "1" },
        { row: 2, label: "3" },
      ]);
    });

    it("labels row 5 only when visibleFrets is 5", () => {
      const fourRows: Chord = [3, 2, 0, 0, 0, 3]; // visibleFrets=4
      expect(computeLayout(fourRows).fretRowLabels.some((f) => f.row === 4)).toBe(false);

      const fiveRows: Chord = [null, null, null, null, null, 5]; // visibleFrets=5
      expect(computeLayout(fiveRows).fretRowLabels).toContainEqual({ row: 4, label: "5" });
    });

    it("uses the actual fret number at each row, not the row position, when offset", () => {
      const chord: Chord = [8, null, null, null, null, 10]; // startFret=7
      const layout = computeLayout(chord);
      expect(layout.fretRowLabels).toEqual([
        { row: 0, label: "8" },
        { row: 2, label: "10" },
      ]);
    });

    it("labels never include an 'fr' suffix", () => {
      const chord: Chord = [8, null, null, null, null, 10];
      const layout = computeLayout(chord);
      for (const f of layout.fretRowLabels) {
        expect(f.label).not.toContain("fr");
      }
    });
  });

  describe("fretMarkers", () => {
    it("places a single marker at fret 3, centered between strings 3 and 4, when visible", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3]; // G, startFret=0, visibleFrets=4 (frets 1-4 shown)
      const layout = computeLayout(chord);
      expect(layout.fretMarkers).toEqual([{ row: 2, betweenIndex: 2.5, kind: "single" }]);
    });

    it("adds the fret-5 marker too once visibleFrets is 5", () => {
      const chord: Chord = [null, null, null, null, null, 5]; // startFret=0, visibleFrets=5
      const layout = computeLayout(chord);
      expect(layout.fretMarkers).toEqual(
        expect.arrayContaining([
          { row: 2, betweenIndex: 2.5, kind: "single" }, // fret 3
          { row: 4, betweenIndex: 2.5, kind: "single" }, // fret 5
        ]),
      );
      expect(layout.fretMarkers).toHaveLength(2);
    });

    it("places no markers when none of 3/5/7/9/12/15/17/19/21 are visible", () => {
      // startFret=21, visibleFrets=4 -> frets 22-25 shown; none of the marker
      // frets (which top out at 21) apply.
      const chord: Chord = [22, null, null, null, null, 25];
      const layout = computeLayout(chord);
      expect(layout.fretMarkers).toEqual([]);
    });

    it("places two markers at fret 12 (between strings 4-5 and strings 2-3), and a single marker at fret 15", () => {
      // startFret=11, visibleFrets=4 -> frets 12-15 shown.
      const chord: Chord = [12, null, null, null, null, 15];
      const layout = computeLayout(chord);
      expect(layout.fretMarkers).toEqual(
        expect.arrayContaining([
          { row: 0, betweenIndex: 1.5, kind: "double" }, // fret 12, between strings 4 and 5
          { row: 0, betweenIndex: 3.5, kind: "double" }, // fret 12, between strings 2 and 3
          { row: 3, betweenIndex: 2.5, kind: "single" }, // fret 15, between strings 3 and 4
        ]),
      );
      expect(layout.fretMarkers).toHaveLength(3);
    });

    it("skips a marker whose string number exceeds stringCount (e.g. a 4-string instrument)", () => {
      // 4 strings: "between 4 and 5" doesn't exist, but "between 2 and 3" and
      // "between 3 and 4" still do.
      const chord: Chord = [12, null, null, 15]; // stringCount=4, startFret=11, visibleFrets=4
      const layout = computeLayout(chord);
      expect(layout.fretMarkers).toEqual(
        expect.arrayContaining([
          { row: 0, betweenIndex: 4 - 2.5, kind: "double" }, // fret 12, between 2-3 only
          { row: 3, betweenIndex: 4 - 3.5, kind: "single" }, // fret 15, between 3-4
        ]),
      );
      // The "between 4 and 5" marker for fret 12 is skipped entirely.
      expect(layout.fretMarkers).toHaveLength(2);
    });

    it("is computed purely from the visible fret range, independent of what's actually fretted", () => {
      // All-muted: startFret still defaults to 0, visibleFrets to 4 (frets
      // 1-4 shown), so the fret-3 marker still applies even though nothing
      // is played anywhere.
      const chord: Chord = [null, null, null, null, null, null];
      const layout = computeLayout(chord);
      expect(layout.fretMarkers).toEqual([{ row: 2, betweenIndex: 2.5, kind: "single" }]);
    });
  });

  describe("LayoutError guard", () => {
    it("throws when the fretted span exceeds the 5-fret display cap", () => {
      // Constructed directly (bypassing chordparse's maxSpan enforcement):
      // fret 1 and fret 12 span 11 frets.
      const chord: Chord = [1, null, null, null, null, 12];
      expect(() => computeLayout(chord)).toThrow(LayoutError);
    });
  });

  describe("chartLabel passthrough", () => {
    it("carries options.label through as chartLabel", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3];
      const layout = computeLayout(chord, { label: "G Major" });
      expect(layout.chartLabel).toBe("G Major");
    });

    it("leaves chartLabel undefined when no label is given", () => {
      const chord: Chord = [3, 2, 0, 0, 0, 3];
      const layout = computeLayout(chord);
      expect(layout.chartLabel).toBeUndefined();
    });
  });
});

describe("computeMarkerLayout", () => {
  it("places multiple dots on the same string at different frets", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 3 },
      { string: 6, fret: 5 },
    ];
    const layout = computeMarkerLayout({ stringCount: 6, markers });

    // String 6 -> array index 0.
    expect(layout.dots).toEqual(
      expect.arrayContaining([
        { stringIndex: 0, row: expect.any(Number), label: undefined, className: undefined },
        { stringIndex: 0, row: expect.any(Number), label: undefined, className: undefined },
      ]),
    );
    expect(layout.dots).toHaveLength(2);
    expect(new Set(layout.dots.map((d) => d.row)).size).toBe(2); // distinct rows
  });

  it("carries a marker's own label/className onto its dot", () => {
    const markers: NoteMarker[] = [{ string: 3, fret: 5, label: "b3", className: "scale-degree" }];
    const layout = computeMarkerLayout({ stringCount: 6, markers });
    expect(layout.dots).toContainEqual({
      stringIndex: 3,
      row: expect.any(Number),
      label: "b3",
      className: "scale-degree",
    });
  });

  it("renders an open (fret 0) marker as a glyph, not a dot, carrying its own label/className", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 0, label: "1", className: "root" }];
    const layout = computeMarkerLayout({ stringCount: 6, markers });
    expect(layout.dots).toHaveLength(0);
    expect(layout.glyphs).toContainEqual({ stringIndex: 0, glyph: "0", label: "1", className: "root" });
  });

  it("carries a marker's own shape onto its dot, but never onto an open marker's glyph", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 3, shape: "square" },
      { string: 5, fret: 0, shape: "triangle" }, // shape is meaningless on an open glyph
    ];
    const layout = computeMarkerLayout({ stringCount: 6, markers });
    expect(layout.dots).toContainEqual({ stringIndex: 0, row: expect.any(Number), shape: "square" });
    expect(layout.glyphs.find((g) => g.stringIndex === 1)).toEqual({ stringIndex: 1, glyph: "0" });
  });

  it("renders a muted string as an 'x' glyph with no label/className", () => {
    const layout = computeMarkerLayout({ stringCount: 6, markers: [], mutedStrings: [6] });
    expect(layout.glyphs).toEqual([{ stringIndex: 0, glyph: "x" }]);
  });

  it("muted wins over a marker targeting the same string -- the marker is silently dropped", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 3, label: "should not appear" }];
    const layout = computeMarkerLayout({ stringCount: 6, markers, mutedStrings: [6] });
    expect(layout.dots).toHaveLength(0);
    expect(layout.glyphs).toEqual([{ stringIndex: 0, glyph: "x" }]);
  });

  it("a duplicate {string, fret} pair: the later marker in the array wins", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 3, label: "first" },
      { string: 6, fret: 3, label: "second" },
    ];
    const layout = computeMarkerLayout({ stringCount: 6, markers });
    expect(layout.dots).toHaveLength(1);
    expect(layout.dots[0].label).toBe("second");
  });

  it("only honors finger on a fretted (dot) marker, never an open one", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 3, finger: 3 },
      { string: 5, fret: 0, finger: 1 },
    ];
    const layout = computeMarkerLayout({ stringCount: 6, markers });
    expect(layout.fingerLabels).toEqual([{ stringIndex: 0, finger: 3 }]);
  });

  it("throws LayoutError when the fretted markers' span exceeds the 5-fret display cap", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 1 },
      { string: 1, fret: 12 },
    ];
    expect(() => computeMarkerLayout({ stringCount: 6, markers })).toThrow(LayoutError);
  });

  it("silently drops a marker/muted entry whose string number exceeds stringCount", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 3 }];
    const layout = computeMarkerLayout({ stringCount: 4, markers, mutedStrings: [6] });
    expect(layout.dots).toHaveLength(0);
    expect(layout.glyphs).toHaveLength(0);
  });

  it("renders nothing for an empty markers/mutedStrings input, defaulting to a 4-row grid", () => {
    const layout = computeMarkerLayout({ stringCount: 6, markers: [] });
    expect(layout.startFret).toBe(0);
    expect(layout.visibleFrets).toBe(4);
    expect(layout.dots).toHaveLength(0);
    expect(layout.glyphs).toHaveLength(0);
  });

  it("passes tuningLabels and label (chartLabel) through unchanged", () => {
    const layout = computeMarkerLayout({
      stringCount: 6,
      markers: [],
      label: "Major Scale",
      tuningLabels: ["E", "A", "D", "G", "B", "E"],
    });
    expect(layout.chartLabel).toBe("Major Scale");
    expect(layout.tuningLabels).toEqual([
      { stringIndex: 0, label: "E" },
      { stringIndex: 1, label: "A" },
      { stringIndex: 2, label: "D" },
      { stringIndex: 3, label: "G" },
      { stringIndex: 4, label: "B" },
      { stringIndex: 5, label: "E" },
    ]);
  });

  it("matches computeLayout's grid math (startFret/visibleFrets/fretMarkers/fretRowLabels) for an equivalent shape", () => {
    // Same shape as the "lays out a nut-start chord (G: 320003)" chord test.
    const chord: Chord = [3, 2, 0, 0, 0, 3];
    const chordLayout = computeLayout(chord);

    const markers: NoteMarker[] = [
      { string: 6, fret: 3 },
      { string: 5, fret: 2 },
      { string: 4, fret: 0 },
      { string: 3, fret: 0 },
      { string: 2, fret: 0 },
      { string: 1, fret: 3 },
    ];
    const markerLayout = computeMarkerLayout({ stringCount: 6, markers });

    expect(markerLayout.startFret).toBe(chordLayout.startFret);
    expect(markerLayout.visibleFrets).toBe(chordLayout.visibleFrets);
    expect(markerLayout.fretMarkers).toEqual(chordLayout.fretMarkers);
    expect(markerLayout.fretRowLabels).toEqual(chordLayout.fretRowLabels);
  });

  it("labelFrets: false omits fretRowLabels entirely", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 3 }];
    const layout = computeMarkerLayout({ stringCount: 6, markers, labelFrets: false });
    expect(layout.fretRowLabels).toEqual([]);
  });

  it("computes fretRowLabels by default when labelFrets is omitted", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 3 }];
    const layout = computeMarkerLayout({ stringCount: 6, markers });
    expect(layout.fretRowLabels.length).toBeGreaterThan(0);
  });
});
describe("computeNeckLayout", () => {
  it("defaults firstFret to 0 (the nut) and lastFret to firstFret + 12", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [] });
    expect(layout.firstFret).toBe(0);
    expect(layout.lastFret).toBe(12);
  });

  it("defaults lastFret to a given firstFret + 12", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [], firstFret: 5 });
    expect(layout.firstFret).toBe(5);
    expect(layout.lastFret).toBe(17);
  });

  it("has fretNumberLabels at the standard inlay frets, including at the nut, by default", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 3 }, { string: 5, fret: 12 }];
    const layout = computeNeckLayout({ stringCount: 6, markers }); // firstFret 0, lastFret 12
    // Inlay frets in [0,12]: 3,5,7,9,12 -- plus firstFret(0) itself.
    expect(layout.fretNumberLabels.map((l) => l.fret)).toEqual([0, 3, 5, 7, 9, 12]);
  });

  it("has fretNumberLabels at the standard inlay frets (deduped, including firstFret itself) when offset from the nut", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [], firstFret: 5, lastFret: 17 });
    // Inlay frets in [5,17]: 5,7,9,12,15,17 -- plus firstFret(5) itself, already included.
    expect(layout.fretNumberLabels.map((l) => l.fret)).toEqual([5, 7, 9, 12, 15, 17]);
  });

  it("includes firstFret itself in fretNumberLabels even when it isn't a standard inlay fret", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [], firstFret: 6, lastFret: 10 });
    expect(layout.fretNumberLabels.map((l) => l.fret)).toEqual([6, 7, 9]);
  });

  it("labelFrets: false omits fretNumberLabels entirely", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [], labelFrets: false });
    expect(layout.fretNumberLabels).toEqual([]);
  });

  it("computes fretMarkers (inlay dots) independently of labelFrets", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [], labelFrets: false });
    expect(layout.fretMarkers.length).toBeGreaterThan(0);
    expect(layout.fretNumberLabels).toEqual([]);
  });

  it("fret 12 produces two fretMarkers (doubled inlay) but only one fretNumberLabels entry", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [], firstFret: 10, lastFret: 14 });
    const twelves = layout.fretMarkers.filter((m) => m.fret === 12);
    expect(twelves).toHaveLength(2);
    expect(twelves.every((m) => m.kind === "double")).toBe(true);
    expect(layout.fretNumberLabels.filter((l) => l.fret === 12)).toHaveLength(1);
  });

  it("expands the fret range to include a marker above lastFret or below firstFret, and warns about it", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 2 }, // below firstFret
      { string: 6, fret: 20 }, // above lastFret
      { string: 6, fret: 8 }, // in range
    ];
    const layout = computeNeckLayout({ stringCount: 6, markers, firstFret: 5, lastFret: 12 });
    expect(layout.firstFret).toBe(2);
    expect(layout.lastFret).toBe(20);
    expect(layout.dots).toEqual([
      { stringIndex: 0, fret: 2, label: undefined, className: undefined },
      { stringIndex: 0, fret: 8, label: undefined, className: undefined },
      { stringIndex: 0, fret: 20, label: undefined, className: undefined },
    ]);
    expect(layout.warnings).toHaveLength(1);
    expect(layout.warnings[0]).toMatch(/\[5, 12\]/);
    expect(layout.warnings[0]).toMatch(/\[2, 20\]/);
  });

  it("expands firstFret down to 0 to include an explicit fret:0 (open) marker when firstFret > 0", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 0, label: "should appear" }];
    const layout = computeNeckLayout({ stringCount: 6, markers, firstFret: 5 });
    expect(layout.firstFret).toBe(0);
    expect(layout.glyphs).toEqual([{ stringIndex: 0, glyph: "0", label: "should appear", className: undefined }]);
    expect(layout.dots).toEqual([]);
    expect(layout.warnings).toHaveLength(1);
  });

  it("does not warn or change the range when every marker already fits", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 8 }];
    const layout = computeNeckLayout({ stringCount: 6, markers, firstFret: 5, lastFret: 12 });
    expect(layout.firstFret).toBe(5);
    expect(layout.lastFret).toBe(12);
    expect(layout.warnings).toEqual([]);
  });

  it("does not expand or warn for a marker dropped for an unrelated reason (muted string, out-of-range string number)", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 20 }, // muted -- dropped regardless of fret
    ];
    const layout = computeNeckLayout({ stringCount: 6, markers, mutedStrings: [6], firstFret: 0, lastFret: 12 });
    expect(layout.firstFret).toBe(0);
    expect(layout.lastFret).toBe(12);
    expect(layout.warnings).toEqual([]);
  });

  it("renders an open marker as a glyph when firstFret is the nut", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 0, label: "1" }];
    const layout = computeNeckLayout({ stringCount: 6, markers });
    expect(layout.glyphs).toEqual([{ stringIndex: 0, glyph: "0", label: "1", className: undefined }]);
  });

  it("renders a muted glyph regardless of firstFret", () => {
    const layout = computeNeckLayout({ stringCount: 6, markers: [], mutedStrings: [6], firstFret: 8, lastFret: 20 });
    expect(layout.glyphs).toEqual([{ stringIndex: 0, glyph: "x" }]);
  });

  it("carries a marker's own shape onto its dot, but never onto an open marker's glyph", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 3, shape: "triangle" },
      { string: 5, fret: 0, shape: "square" },
    ];
    const layout = computeNeckLayout({ stringCount: 6, markers });
    expect(layout.dots).toContainEqual({ stringIndex: 0, fret: 3, shape: "triangle" });
    expect(layout.glyphs.find((g) => g.stringIndex === 1)).toEqual({ stringIndex: 1, glyph: "0" });
  });

  it("does not drop a marker exactly at firstFret (inclusive boundary)", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 5 }];
    const layout = computeNeckLayout({ stringCount: 6, markers, firstFret: 5, lastFret: 17 });
    expect(layout.dots).toHaveLength(1);
    expect(layout.dots[0].fret).toBe(5);
  });

  it("gives two same-string markers at different frets distinct finger labels (no collision, unlike FingerLabelPosition)", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 3, finger: 1 },
      { string: 6, fret: 5, finger: 3 },
    ];
    const layout = computeNeckLayout({ stringCount: 6, markers });
    expect(layout.fingerLabels).toEqual(
      expect.arrayContaining([
        { stringIndex: 0, fret: 3, finger: 1 },
        { stringIndex: 0, fret: 5, finger: 3 },
      ]),
    );
    expect(layout.fingerLabels).toHaveLength(2);
  });

  it("muted wins over a marker targeting the same string", () => {
    const markers: NoteMarker[] = [{ string: 6, fret: 3, label: "should not appear" }];
    const layout = computeNeckLayout({ stringCount: 6, markers, mutedStrings: [6] });
    expect(layout.dots).toEqual([]);
    expect(layout.glyphs).toEqual([{ stringIndex: 0, glyph: "x" }]);
  });

  it("a duplicate {string, fret} pair: the later marker wins", () => {
    const markers: NoteMarker[] = [
      { string: 6, fret: 3, label: "first" },
      { string: 6, fret: 3, label: "second" },
    ];
    const layout = computeNeckLayout({ stringCount: 6, markers });
    expect(layout.dots).toHaveLength(1);
    expect(layout.dots[0].label).toBe("second");
  });

  it("throws LayoutError for a negative or non-integer firstFret", () => {
    expect(() => computeNeckLayout({ stringCount: 6, markers: [], firstFret: -1 })).toThrow(LayoutError);
    expect(() => computeNeckLayout({ stringCount: 6, markers: [], firstFret: 1.5 })).toThrow(LayoutError);
  });

  it("throws LayoutError when lastFret isn't a greater integer than firstFret", () => {
    expect(() => computeNeckLayout({ stringCount: 6, markers: [], firstFret: 5, lastFret: 5 })).toThrow(
      LayoutError,
    );
    expect(() => computeNeckLayout({ stringCount: 6, markers: [], firstFret: 5, lastFret: 4 })).toThrow(
      LayoutError,
    );
    expect(() => computeNeckLayout({ stringCount: 6, markers: [], lastFret: 3.5 })).toThrow(LayoutError);
  });

  it("supports a non-6-string stringCount, correctly omitting out-of-range inlay markers", () => {
    const layout = computeNeckLayout({ stringCount: 4, markers: [], firstFret: 10, lastFret: 14 });
    // DOUBLE_FRET_MARKERS(12) needs strings up to 5 for one of its pair --
    // on a 4-string instrument only the 2-3 side qualifies, not 4-5.
    const twelves = layout.fretMarkers.filter((m) => m.fret === 12);
    expect(twelves).toHaveLength(1);
    expect(twelves[0].kind).toBe("double");
  });

  it("passes tuningLabels and label (chartLabel) through unchanged", () => {
    const layout = computeNeckLayout({
      stringCount: 6,
      markers: [],
      label: "Major Scale",
      tuningLabels: ["E", "A", "D", "G", "B", "E"],
    });
    expect(layout.chartLabel).toBe("Major Scale");
    expect(layout.tuningLabels).toEqual([
      { stringIndex: 0, label: "E" },
      { stringIndex: 1, label: "A" },
      { stringIndex: 2, label: "D" },
      { stringIndex: 3, label: "G" },
      { stringIndex: 4, label: "B" },
      { stringIndex: 5, label: "E" },
    ]);
  });
});

describe("computeNeckLayout brackets", () => {
  it("defaults to no brackets", () => {
    expect(computeNeckLayout({ stringCount: 6, markers: [] }).brackets).toEqual([]);
  });

  it("passes brackets through in input order with stacking levels", () => {
    const layout = computeNeckLayout({
      stringCount: 6,
      markers: [],
      brackets: [
        { startFret: 2, endFret: 5, label: "C", className: "caged-c" },
        { startFret: 6, endFret: 8, label: "A" },
      ],
    });
    expect(layout.brackets).toEqual([
      { startFret: 2, endFret: 5, label: "C", className: "caged-c", level: 0 },
      { startFret: 6, endFret: 8, label: "A", level: 0 },
    ]);
  });

  it("grows the fret window to fit a bracket outside it, with a warning", () => {
    const layout = computeNeckLayout({
      stringCount: 6,
      markers: [],
      firstFret: 5,
      lastFret: 12,
      brackets: [{ startFret: 3, endFret: 15, label: "wide" }],
    });
    expect(layout.firstFret).toBe(3);
    expect(layout.lastFret).toBe(15);
    expect(layout.warnings).toHaveLength(1);
  });

  it("rejects a bracket whose endFret is before its startFret", () => {
    expect(() =>
      computeNeckLayout({ stringCount: 6, markers: [], brackets: [{ startFret: 5, endFret: 2, label: "x" }] }),
    ).toThrow(LayoutError);
  });

  it("rejects a negative or non-integer bracket fret", () => {
    expect(() =>
      computeNeckLayout({ stringCount: 6, markers: [], brackets: [{ startFret: -1, endFret: 2, label: "x" }] }),
    ).toThrow(LayoutError);
    expect(() =>
      computeNeckLayout({ stringCount: 6, markers: [], brackets: [{ startFret: 1.5, endFret: 2, label: "x" }] }),
    ).toThrow(LayoutError);
  });
});

describe("stackBrackets", () => {
  const levels = (ranges: [number, number][]) =>
    stackBrackets(ranges.map(([startFret, endFret], i) => ({ startFret, endFret, label: String(i) }))).map(
      (b) => b.level,
    );

  it("keeps non-overlapping (including merely adjacent) brackets on level 0", () => {
    expect(levels([[1, 3], [4, 6], [7, 9]])).toEqual([0, 0, 0]);
  });

  it("stacks brackets that share a boundary fret", () => {
    expect(levels([[2, 5], [5, 8]])).toEqual([0, 1]);
  });

  it("reuses the nearest free level once an overlap ends", () => {
    // CAGED-style chain: each shape overlaps only its neighbors.
    expect(levels([[0, 3], [2, 5], [4, 8], [7, 10], [9, 12]])).toEqual([0, 1, 0, 1, 0]);
  });

  it("places a wider bracket nearer the neck than one nested inside it, regardless of input order", () => {
    expect(levels([[3, 5], [1, 10]])).toEqual([1, 0]);
  });

  it("returns brackets in input order", () => {
    const out = stackBrackets([
      { startFret: 7, endFret: 9, label: "b" },
      { startFret: 1, endFret: 3, label: "a" },
    ]);
    expect(out.map((b) => b.label)).toEqual(["b", "a"]);
  });
});

describe("computeMarkerLayout brackets", () => {
  const markers: NoteMarker[] = [
    { string: 6, fret: 5 },
    { string: 1, fret: 7 },
  ];

  it("has no brackets by default, and chord-mode computeLayout never sets them", () => {
    expect(computeMarkerLayout({ stringCount: 6, markers }).brackets).toEqual([]);
    expect(computeLayout([null, 0, 2, 2, 2, 0]).brackets).toBeUndefined();
  });

  it("stacks brackets and passes them through in input order", () => {
    const layout = computeMarkerLayout({
      stringCount: 6,
      markers,
      brackets: [
        { startFret: 5, endFret: 7, label: "a" },
        { startFret: 7, endFret: 8, label: "b", className: "c" },
      ],
    });
    expect(layout.brackets).toEqual([
      { startFret: 5, endFret: 7, label: "a", level: 0 },
      { startFret: 7, endFret: 8, label: "b", className: "c", level: 1 },
    ]);
  });

  it("fits bracket frets into the visible window along with the notes", () => {
    const layout = computeMarkerLayout({ stringCount: 6, markers, brackets: [{ startFret: 5, endFret: 9, label: "x" }] });
    expect(layout.startFret).toBe(4);
    expect(layout.visibleFrets).toBe(5);
  });

  it("throws when notes and brackets together exceed the 5-fret cap", () => {
    expect(() =>
      computeMarkerLayout({ stringCount: 6, markers, brackets: [{ startFret: 5, endFret: 11, label: "x" }] }),
    ).toThrow(/notes and brackets/);
  });

  it("allows a fret-0 bracket when the window starts at the nut", () => {
    const layout = computeMarkerLayout({
      stringCount: 6,
      markers: [{ string: 6, fret: 3 }],
      brackets: [{ startFret: 0, endFret: 3, label: "E" }],
    });
    expect(layout.startFret).toBe(0);
    expect(layout.brackets).toHaveLength(1);
  });

  it("rejects a fret-0 bracket when the window doesn't start at the nut", () => {
    expect(() =>
      computeMarkerLayout({ stringCount: 6, markers, brackets: [{ startFret: 0, endFret: 0, label: "open" }] }),
    ).toThrow(LayoutError);
  });

  it("rejects an invalid bracket range", () => {
    expect(() =>
      computeMarkerLayout({ stringCount: 6, markers, brackets: [{ startFret: 7, endFret: 5, label: "x" }] }),
    ).toThrow(LayoutError);
  });
});
