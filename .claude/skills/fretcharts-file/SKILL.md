---
name: fretcharts-file
description: Write a FretCharts file (.yaml) — a chord chart, scale chart, neck diagram, or chord grid — from a musical description such as "A minor pentatonic in all five CAGED positions" or "ii-V-I triads in Bb on strings 2-4". Use when the user asks for a FretCharts file, chart, diagram, or chord sheet, or to edit one.
---

# Writing FretCharts files

A FretCharts file is a YAML document describing one image. The CLI renders it
with `fretcharts --file <path>`, and the web UI opens it from the File tab. The
format is documented in full in the README's "FretCharts files" section; this
skill is the working summary plus a workflow for getting a file right.

## Workflow

1. **Pick the type** (table below) from what the user wants to see.
2. **Work out the music first**, as frets per string, before writing YAML.
   Spell out intervals and check every fret against the tuning: a wrong fret
   renders without complaint. For triad progressions, generate the voicings
   instead of working them out by hand (see "Chord grids" below).
3. **Write the file** where the user asked; otherwise `~/Documents/FretCharts/`
   if it exists, else the current directory. Name it after the content, e.g.
   `a-minor-pentatonic.yaml`.
4. **Validate and look at it.** From the repo root:
   ```bash
   npm run build --silent        # once, if dist/ is missing or stale
   node dist/cli.js --file <file>.yaml --output <scratch>/<name>.png
   ```
   Write the PNG to a scratch directory, never the repo or next to the file
   (the repo's `.gitignore` only ignores stray images at its root). Read the
   PNG and check it: labels legible and not overlapping, root highlighted,
   the right frets shown, brackets where intended. A neck diagram that
   prints `warning: ...` auto-expanded its fret range — usually a sign a
   note or bracket is outside `firstFret`/`lastFret` by mistake.
5. **Report** the file path and what it shows. Don't add a `version:` field
   to a hand-written file; files the tools write are stamped automatically.

Unrecognized keys are a hard error, so a typo fails loudly at step 4 rather
than being silently dropped.

## Strings, frets, and notation

- **String numbers:** 6 = low E … 1 = high E, everywhere (labels, classes,
  markers, `root`, `mutedStrings`). Never array indexes.
- **Chord notation** (`notation:`, and the CSV `notes` column): one entry per
  string, **low E first**. `x` muted, `0` open, a number for a fret:
  `x02220`, `320003`. Frets of 10+ need separators when ambiguous:
  `x-x-x-12-10-10` (dashes, spaces, or dots). Quote all-digit notation in
  YAML (`notation: "133211"`) so it stays a string.
- **Per-string values** (`stringLabels`, `noteClasses`, `noteShapes`, and
  their CSV columns `string-labels`, `note-classes`, `note-shapes`):
  - positional, low E first, `-` for none: `- - - 5 R 3` (count must equal
    the string count: 6, or the tuning's length)
  - keyed, for a string or two: `3:diamond`, `6:R 1:R`
  - `|` instead of spaces when a value contains a space: `-|-|-|5|R|sus 4`

  Prefer these over JSON. In YAML, quote positional values (they start
  with `-`): `stringLabels: "R 3 5 R 3 R"`.
- **Markers** (`notes:` in scale/neck files): one per line in a `notes: |`
  block, each `string:fret[:label[:className[:finger[:shape]]]]`. Leave a
  field blank to skip it: `6:5:1:root::square` (no finger). Shapes:
  `circle` (default), `square`, `triangle`, `diamond`. Fret `0` is an open
  string.
- **Brackets** (scale/neck): `start-end:label[:className]`, one per line in a
  `brackets: |` block, inclusive frets: `4-7:E shape`. Overlapping brackets
  stack automatically.

## Types

| `type:` | Shows | Required |
|---|---|---|
| `chord` | one chord box | `notation` |
| `scale` | a compact vertical box, any number of notes per string; must fit in 5 frets | `notes` |
| `neck` | a horizontal fretboard over a fret range, nut on the left | `notes` |
| `chords` | a grid of chord boxes from inline CSV | `csv` (or `csvFile`) |

Fields every type takes: `label` (title; `collectionLabel` for `chords`),
`tuning` (low string first, e.g. `DADGBE`; its length sets the string
count), `labelTuning`, `transpose`, `stylesheet` / `stylesheetFile`,
`defs` / `defsFile`, `output`.

### `chord`

```yaml
type: chord
notation: "133211"
label: F Major
root: "6,4"                       # adds class "root" to those strings' notes
stringLabels: "R 5 R 3 5 R"
noteShapes: "3:diamond"
fingerPositions: "134211"         # finger numbers, chord-notation style
```

Also: `noteClasses` (custom CSS class per string), `labelPitches: true`
(label each fretted note with its pitch; explicit labels win).

### `scale`

```yaml
type: scale
label: A minor pentatonic, box 1
notes: |
  6:5:R:root
  6:8:b3
  5:5:4
  5:7:5
  4:5:b7
  4:7:R:root
  3:5:b3
  3:7:4
  2:5:5
  2:8:b7
  1:5:R:root
  1:8:b3
```

Also: `mutedStrings: "1,2"`, `labelPitches`, `labelFrets: false` (fret
numbers are on by default), `brackets`.

### `neck`

```yaml
type: neck
label: A minor pentatonic, low strings, 5th and 17th position
firstFret: 3
lastFret: 20
notes: |
  6:5:R:root
  6:8:b3
  5:5:4
  5:7:5
  6:17:R:root
  6:20:b3
  5:17:4
  5:19:5
brackets: |
  5-8:Box 1
  17-20:Box 1 (octave)
```

`firstFret` defaults to 0 and `lastFret` to `firstFret + 12`. Open-string
markers (fret 0) draw as small hollow circles, too small for a label, so
leave their label off. Fret-number
labels sit above string 1 at inlay frets. For colour-coded positions,
give each marker a className and style it (see "Styling").

### `chords` (chord grids)

```yaml
type: chords
collectionLabel: ii–V–I in C
columns: 3
csv: |
  header,notes,label,root,string-labels
  Strings 1-3,,,,
  ,x-x-x-14-15-13,Dm,2,- - - 5 R b3
  ,x-x-x-12-12-13,G7,3,- - - R 3 b7
  ,x-x-x-12-13-12,C,2,- - - 5 R 3
stylesheet: |
  circle.root, rect.root, polygon.root { fill: #d62828; }
```

- Column names are the CLI flags without `--`: `notes` (required),
  `label`, `root`, `string-labels`, `finger-positions`, `note-classes`,
  `note-shapes`, `tuning`, `label-pitches`, `string-label-1`…`6`, and so on.
  Unknown columns are ignored, so bookkeeping columns are fine.
- An optional `header` column starts a titled section. A header row with
  blank `notes` is a heading-only row. Leave its other cells empty but
  present (`Strings 1-3,,,,`).
- `columns` (default 4) is charts per row.
- `defaults:` sets a value for every row that leaves that column blank
  (any column except a stylesheet). Styling goes only in the top-level
  `stylesheet`.
- CSV quoting: a cell containing `,` or `"` must be quoted, with inner
  quotes doubled. The per-string forms above avoid this entirely.

**Triad progressions:** generate them, don't hand-voice them. The repo's
`fretcharts-triads` finds close voicings with minimal hand movement and
writes a CSV with interval labels and roots:

```bash
node dist/triadsCli.js G C Dsus4 Am Em --strings 1-3   # also: --strings 2-4,
#   --key G, --floor 5, --direction above, --max-fret 15, --tuning DADGBE
```

Paste its rows under the `csv: |` header. For several string groups in one
image, run it once per group and add a `header` column with a heading row
before each group's rows (shift each row's cells right by one, starting
with an empty `header` cell).

## Styling

`stylesheet: |` is CSS embedded in the SVG. Useful classes:

| Class | Element |
|---|---|
| `chord-dot`, `chord-dot-string-N` | a fretted note's marker |
| `chord-dot-label` | text on a marker |
| `chord-string`, `chord-fret` | the grid lines |
| `chord-title`, `chord-collection-label`, `chord-collection-section-label` | titles |
| `chord-chart-background`, `chord-collection-background` | backgrounds (transparent by default) |
| `chord-neck` | just the fretboard area |
| `chord-fret-marker` | inlay dots |
| `chord-bracket`, `chord-bracket-label` | brackets |
| `chord-glyph-mute`, `chord-glyph-open`, `chord-finger-label`, `chord-tuning-label`, `chord-fret-label`, `chord-neck-fret-label` | the rest |

A marker and its label are siblings that share any class from `root`,
`noteClasses`, or a marker's className. Target the marker by element type,
covering every shape, and the label separately:

```css
circle.root, rect.root, polygon.root { fill: #d62828; }
text.root { fill: #ffffff; font-weight: bold; }
```

Gradients and other SVG paint servers go in `defs: |` as raw SVG
(`<linearGradient id="g2e">…</linearGradient>`) and are referenced from CSS
with `fill: url(#g2e);`. That's how one marker shows two colours, e.g. notes
shared by neighbouring CAGED shapes.

For complete, working examples of every type, read `web/gallery.js`. The
entries in its `GALLERY_EXAMPLES` array are full FretCharts files, one string
per line, and `examples/` has a few more.
