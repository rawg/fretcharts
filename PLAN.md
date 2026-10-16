# Chord Charts

A Node/TypeScript application that renders guitar chord charts to SVG or PNG files.

## Input

### Chord Notation

Chords are described using a compact tablature notation, e.g. x02210. The
notation and its implementation is described in @NOTATION.md, and a TypeScript
implementation is in @chordparse.ts.

## Output

### The Grid

6 vertical lines represent each string on a guitar. The leftmost line is the 6th string, most often tuned to E2. The next line is the 5th/A string, then the 4th/D string, and so on.

Horizontal lines represent guitar frets. The grid does not need a line at the top to represent the nut or fret above the chord being shown.

### Tablature

If the chord calls for a muted (`x`) string, an `x` should be displayed centered above the corresponding guitar string. The same goes for open strings, shown as fret 0.

For all other strings, a filled circle should be placed over the corresponding string line, centered between the corresponding fret and the fret vertically above it, closer to the nut. If no fret is shown above, center the dot between the start of the line and the corresponding fret.

### Fret Range

A minimum of 4 and maximum of 5 frets may be shown.

When possible, we should start the diagram at the nut. If the chord involves playing beyond the 5th fret, start the diagram at the fret before first fret to be played. For example, if the chord calls for playing fret 8 as the fret closest to the nut, then start at the 7th fret, but do not render that fret line. When not starting at the nut, a label for the first fret to be played to the right of the top most grid section.

### Labels

An optional text label for the entire chart should be rendered above the grid.

For strings that are not muted or open, an optional label may be specified. When provided, this label should be rendered over the dot.

## Invokation

A command line invokation is expected. It will require an argument (no label) with a chord in the notation described above. An optional parameter can provide a label for the whole diagram as a string. Another optional parameter accepts a JSON object, with numeric keys for string numbers (6 on the left, 1 on the right) and optional labels to be placed over the circles on those frets.



