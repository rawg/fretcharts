# FretCharts

Renders guitar chord, scale, and neck diagrams to SVG or PNG from compact
tablature notation, as a command-line tool, a Node/TypeScript library, or
a web page that runs entirely in the browser.

```
$ fretcharts x02220 --label "A" --output a.png
```

## Install

The package isn't published to npm, but the `fretcharts` command can still
be installed globally straight from GitHub:

```bash
npm install -g github:rawg/fretcharts
```

This builds and installs the latest commit on `main`. To pin a released
version instead, point at its tag:

```bash
npm install -g github:rawg/fretcharts#v0.1.0
```

Or grab a prebuilt tarball from the [Releases
page](https://github.com/rawg/fretcharts/releases) and install it
directly -- no clone or local TypeScript build required:

```bash
npm install -g https://github.com/rawg/fretcharts/releases/download/v0.1.0/fretcharts-0.1.0.tgz
```

### From source

```bash
npm install
npm run build
```

This produces `dist/cli.js` (the CLI entry point, matching the `bin` field in
`package.json`) and `dist/chart.js` (the programmatic API entry point).

To run it locally without installing globally:

```bash
node dist/cli.js x02220
```

## Chord notation

Chords are written as one character per string, low string (6th/low-E) first,
high string (1st/high-E) last:

```
x02220   -> A major   (muted, open, 2, 2, 2, open)
320003   -> G major
xx0212   -> ...
```

- `x` or `X` — muted string
- `0` — open string
- a digit or two — fretted at that fret

Two-digit frets (10 and above) are written inline with no separator and are
resolved unambiguously as long as the fretted notes span 5 frets or fewer
(the default). If you need to bypass that — a wider span, or just to avoid
thinking about it — separate tokens with spaces, dashes, or dots instead:

```
x-x-8-10-10-8
x x x 12 10 10
```

See `NOTATION.md` for the full grammar and why it's unambiguous.

## CLI reference

```
fretcharts [options] [notation]
```

`notation` is required unless `--bulk`, `--notes`, or `--file` is given instead.

| Option | Description |
|---|---|
| `--label <text>` | Chart title, rendered above the grid. |
| `--string-labels <json>` | Per-string labels rendered over the dot of a fretted note, e.g. `'{"3":"b3"}'`. Keyed by guitar string number (`"1"`..`"6"`, 6 = low E on the left, 1 = high E on the right) — never the array index. Silently ignored for open/muted strings. |
| `--string-label-1` .. `--string-label-6 <text>` | Set (or override) just one string's label at a time, e.g. `--string-label-6 R`. Wins over a same-numbered entry in `--string-labels` when both are given. |
| `--finger-positions <value>` | Finger numbers (1–5) rendered below the bottom-most fret, under their string. Either a JSON object keyed by string number (`'{"6":"1"}'`) or chord-notation-style shorthand where digits are finger numbers instead of frets (`"xx0321"` → string 3 = finger 3, string 2 = finger 2, string 1 = finger 1). Never applied to open/muted strings. |
| `--finger-position-1` .. `--finger-position-6 <n>` | Set (or override) just one string's finger number (1–5) at a time, e.g. `--finger-position-6 3`. Wins over a same-numbered entry in `--finger-positions` when both are given. |
| `--note-classes <json>` | Adds a custom CSS class to a string's sounding note (a fretted dot or an open-string circle — never a muted string), e.g. `'{"3":"root"}'`. Pairs with `--stylesheet` to style something like "the root note" consistently across many charts even as its string position varies between inversions. |
| `--root <strings>` | Shorthand for `--note-classes` that tags the given string(s) with the `root` class — a single string number (`"6"`) or a comma-separated list (`"4,2"`, whitespace ignored). `--note-classes` wins over `--root` if both target the same string. |
| `--note-shapes <json>` | Sets a string's sounding fretted note to `"circle"` (the default), `"square"`, `"triangle"`, or `"diamond"`, e.g. `'{"3":"square"}'`. Only applies to a fretted dot, never an open-string circle or a muted string's glyph. |
| `--tuning <notation>` | Tuning, low string first, e.g. `"DADGBE"` (drop D) or `"BEADF#B"` (baritone B). Each note is a capital letter A–G optionally followed by `b` (flat) or `#` (sharp). The tuning's length sets the chord's string count. Defaults to standard `EADGBE`. |
| `--label-pitches` | Auto-labels each fretted note with its computed pitch (e.g. `"F#"`), using `--tuning`. Never applied to open strings. An explicit `--string-labels` entry for a string wins over its computed pitch. Also works in scale-chart/neck-diagram mode (`--notes`), where a marker's own explicit label wins the same way. |
| `--label-tuning` | Labels *every* string with its open pitch from `--tuning`, above the mute/open indicators and below the chart title. Unlike `--label-pitches`, this applies unconditionally — it shows what the string is tuned to, not what's currently sounding. |
| `--no-label-frets` | Scale-chart/neck-diagram mode only (`--notes`): omit fret-number reference labels — **on by default**. In scale-chart mode these sit to the right of the grid's 1st/3rd/(5th) rows, same placement as chord-notation mode's own (non-optional) fret labels. In neck-diagram mode, labels appear above the neck, over string 1/high-E, at the standard inlay frets (3/5/7/9/12/etc.) within `[--first-fret, --last-fret]` plus `--first-fret` itself, regardless of whether the diagram starts at the nut. See [Neck diagrams](#neck-diagrams) below. |
| `--stylesheet <path>` | Path to a CSS file embedded into the SVG, overriding the default look. See [Styling](#styling) below. |
| `--svg-defs <xml>` | Raw SVG markup embedded into the SVG as a `<defs>` element, e.g. one or more `<linearGradient id="...">`/`<radialGradient id="...">` elements — reference one from `--stylesheet` as an ordinary `fill: url(#that-id)` rule to blend two colors on a marker (CSS alone can only ever set one flat fill). Mutually exclusive with `--svg-defs-file`. See [Styling](#styling) below. |
| `--svg-defs-file <path>` | Path to a file holding raw SVG markup for `<defs>`, same meaning as `--svg-defs`. Mutually exclusive with `--svg-defs`. |
| `--output <path>` | Output file path. Format is inferred from the extension: `.svg`/`.png` renders the chart; `.yaml`/`.yml`/`.json` instead writes a [FretCharts file](#fretcharts-files) capturing this invocation's parameters (not a render) — the CLI equivalent of the web UI's "FretCharts File" (download) button. Omit `--output` to write SVG text to stdout. |
| `--compact-notes` | Scale-chart/neck-diagram `--output` FretCharts file only: write `notes` as compact notation, one marker per line, instead of the native YAML marker list. No effect on an SVG/PNG render. Mutually exclusive with `--file`. |
| `--transpose <n>` | Shifts every note by `<n>` frets/half-steps (positive = up, negative = down) before building/writing. Works with a notation argument, `--notes`, `--bulk`, and `--file` alike. See [Transposing](#transposing) below. |
| `--bake-transpose` | `--output` FretCharts file only (including a `--file` reformat of one): writes `--transpose`'s shift directly into `notation`/`notes` (a `type: chords`/`--bulk` document's CSV `notes` column included) instead of recording a separate `transpose:` field. No effect without `--transpose`, on a render, or on a document referencing an external `csvFile`. See [Baking a transposition into notes](#baking-a-transposition-into-notes---bake-transpose) below. |
| `--notes <value>` | Scale-chart mode: multiple independently labeled/classed/shaped/fingered markers. Compact notation (`"6:3:R:root;6:5:2"`) or a JSON array of marker objects — see [Scale charts](#scale-charts) below for both forms. `fret: 0` renders as an open-string glyph, same as chord notation's `"0"`. Mutually exclusive with a `notation` argument and with `--bulk`. |
| `--muted <strings>` | Scale-chart mode only: string(s) to render muted (`"x"`), same format as `--root` — a single string number (`"6"`) or a comma-separated list (`"4,2"`). A muted string silently drops any `--notes` marker targeting the same string. |
| `--neck` | Neck-diagram mode: a wide, horizontal (nut-left, bridge-right) view over an explicit fret range, instead of the default compact auto-fit chart. Requires `--notes`; mutually exclusive with a `notation` argument and with `--bulk`. See [Neck diagrams](#neck-diagrams) below. |
| `--first-fret <n>` | Neck-diagram mode only: first fret shown. Defaults to `0` (the nut/open position). Auto-expands downward (with a stderr warning) if a note falls below it. See [Neck diagrams](#neck-diagrams) below. |
| `--last-fret <n>` | Neck-diagram mode only: last fret shown. Defaults to `--first-fret` + 12. Auto-expands upward (with a stderr warning) if a note falls above it. |
| `--brackets <value>` | Scale-chart/neck-diagram mode only (`--notes`): labeled fret-range brackets, e.g. `"0-3:E shape;2-5:D shape"` — below the neck in a neck diagram, left of the grid in a scale chart. See [Fret-range brackets](#fret-range-brackets) below. |
| `--bulk <path>` | Bulk mode: render every row of a CSV file into one grid image. See [Bulk mode](#bulk-mode) below. Cannot be combined with a `notation` argument or `--notes`. |
| `--columns <n>` | Bulk mode only: charts per row in the grid. Default `4`. |
| `--collection-label <text>` | Bulk mode only: optional title for the whole composite grid image, centered above it. |
| `--file <path>` | FretCharts file mode: render from a self-contained FretCharts YAML/JSON file. See [FretCharts files](#fretcharts-files) below. Mutually exclusive with a `notation` argument and every other flag except `--output` (which overrides the file's own optional `output:` field). |

Run `fretcharts --help` for the exact same reference from the tool itself
(it opens with a "Modes" quick-summary before the full flag list, since
there are five of them). `fretcharts --version`/`-V` prints the
installed version.

### Examples

```bash
# SVG to stdout
fretcharts x02220

# PNG file, with a title
fretcharts 320003 --label "G" --output g.png

# Finger positions and a per-string label
fretcharts 320003 --label "G" --finger-positions "3xxxxx" --string-labels '{"6":"R"}'

# Same thing, set one string at a time instead of via JSON
fretcharts 320003 --label "G" --finger-position-6 3 --string-label-6 R

# Drop D tuning, with computed pitch labels
fretcharts 0xxxxx --tuning "DADGBE" --label-pitches --label "D (open)"

# Highlight the root note (works whether it lands on a fretted or open string)
echo '.root { fill: #d62828; }' > root.css
fretcharts x32010 --root 5 --stylesheet root.css --output c.png

# Scale chart: multiple markers per string, each independently labeled/classed
fretcharts --notes "6:3:R:root;6:5:2;5:2:b3;5:5:4" --muted 1,2 \
  --label "Minor Pentatonic Box (partial)" --output scale.png
```

## Scale charts

`--notes <value>` renders multiple independently labeled/classed/fingered
markers per string, for patterns a single chord notation string can't
express — a scale box, an arpeggio shape, anything with more than one
fretted note on the same string. It's mutually exclusive with a `notation`
argument and with `--bulk` (see [CLI reference](#cli-reference) above) —
exactly one of `notation`/`--notes` must be given, unless `--bulk` is used
instead of either.

Two input forms, auto-detected the same way `--finger-positions` picks
between its JSON and notation forms (a value starting with `[` is parsed
as JSON, anything else as compact notation):

**Compact notation** — markers separated by `;` and/or a newline, each one
`string:fret[:label[:className[:finger[:shape]]]]`. Trailing fields are
simply omittable; a blank field skips ahead to a later one. No quoting to
fight with, so it's the friendlier form for typing inline in a shell:

```bash
fretcharts --notes "6:3:R:root;6:5:2;5:2:b3;5:5:4" --muted 1,2
```

The newline separator matters for a hand-written FretCharts file: a
`notes: |` block scalar can spread markers one per line instead of
cramming them onto a single `;`-joined line —

```yaml
notes: |
  6:3:R:root
  6:5:2
  5:2:b3
  5:5:4
```

— and `--compact-notes` (below) writes exactly this shape when saving a
scale/neck FretCharts file from the command line.

**JSON** — an array of marker objects, useful for generating `--notes`
programmatically or when a label genuinely needs a `:`/`;` character:

```bash
fretcharts --notes '[{"string":6,"fret":3,"label":"R","className":"root"},{"string":6,"fret":5,"label":"2"}]'
```

Marker fields, either form:

| Field | Compact position | Required | Meaning |
|---|---|---|---|
| `string` | 1st | yes | Guitar string number, `1`-`6` (6 = low E, 1 = high E) — same convention as `--string-labels`/`--root`/etc. |
| `fret` | 2nd | yes | Fret number. `0` renders as an open-string glyph (a hollow circle), never a dot — same as chord notation's `"0"`. |
| `label` | 3rd | no | Text rendered on the marker — a scale degree, note name, whatever. Works on both dots and open-string glyphs. |
| `className` | 4th | no | Custom CSS class added to the marker (and its label), for `--stylesheet` targeting — same idea as `--note-classes`. |
| `finger` | 5th | no | Finger number, `1`-`5`. Only meaningful on a fretted marker (`fret > 0`) — silently ignored on an open one, same rule as `--finger-positions`. |
| `shape` | 6th | no | `"circle"` (the default), `"square"`, `"triangle"`, or `"diamond"`. Only meaningful on a fretted marker (`fret > 0`) — an open marker always renders as a hollow circle glyph regardless. |

```bash
# A square marker on string 6, fret 3 -- shape is the 6th compact field.
fretcharts --notes "6:3:R:root:2:square"
```

`--muted <strings>` marks string(s) as muted (`"x"`), same format as
`--root`. A muted string always wins over a `--notes` marker targeting the
same string — the marker is silently dropped. A string with no marker and
not listed as muted simply renders nothing for that string (no dot, no
glyph) — a scale pattern doesn't have to touch every string the way a
chord's notation always does.

`--string-labels`/`--finger-positions`/`--note-classes`/`--note-shapes` are
chord-notation-specific and have no effect in `--notes` mode — each marker
already carries its own label/class/shape/finger directly. `--tuning`,
`--label-tuning`, `--stylesheet`, and `--output` all work exactly the same
as chord mode. `--label-pitches` also works the same way, auto-labeling
any fretted marker (`fret > 0`) that doesn't already carry its own
explicit label — open markers (`fret: 0`) are never labeled, and a
marker's own label always wins over its computed pitch.
`--label-frets` (on by default; `--no-label-frets` turns it off) shows a
fret-number label to the right of the grid's 1st, 3rd, and (when shown)
5th rows, same class/placement as chord-notation mode's own (non-optional)
fret labels.

## Neck diagrams

`--neck` renders a wide, horizontal fretboard view — nut on the left,
bridge on the right — over an explicit fret range, instead of the default
compact auto-fit chart. It's the same marker model as scale-chart mode
(`--notes`, `--muted`, `--tuning`, `--label-pitches`, `--label-tuning`,
`--label-frets`), just laid out differently: any number of notes, on any
strings, at any frets. `--neck` requires `--notes` and is mutually
exclusive with a `notation` argument and with `--bulk`.

```bash
# Default range: the nut through fret 12.
fretcharts --neck --notes "6:3:R:root;6:5:2;5:2:b3;5:5:4" --muted 1,2 \
  --label "Minor Pentatonic Box (partial)" --output neck.png

# An offset range further up the neck.
fretcharts --neck --notes "6:7:R;5:7:5;4:7:R" \
  --first-fret 5 --last-fret 17 --output neck-offset.png
```

`--first-fret`/`--last-fret` are both optional. The default first fret is
the nut (open position, `0`); the default last fret is 12 frets after the
first. A note outside `[--first-fret, --last-fret]` (explicit or defaulted)
-- including an explicit `fret: 0` open marker when the range doesn't
include the nut -- is never silently dropped: the range auto-expands to
include it, and a `warning: ...` line is printed to stderr (the CLI), or
an amber warning box is shown above the result (the web UI) saying so.

**`--label-frets` (on by default) shows a fret-number label above the neck,
over string 1/high-E, at the standard inlay frets (3/5/7/9/12/etc.) within
`[--first-fret, --last-fret]`, plus `--first-fret` itself** — regardless of
whether the diagram starts at the nut, so an offset diagram whose start
isn't a standard inlay fret still has a reference point. Pass
`--no-label-frets` to omit them.

Tuning/muting/open-string handling is identical to scale-chart mode
(`--muted`, `--tuning`, `--label-pitches`, `--label-tuning`) — they're just
rendered at the neck's left (nut) edge instead of above a vertical grid.
Guitar string 6
(low E) is the bottom row, string 1 (high E) is the top row, matching
standard tab notation.

### Fret-range brackets

`--brackets` labels ranges of frets with brackets drawn below the neck —
e.g. to mark which frets belong to which CAGED shape or scale/arpeggio
position:

```sh
fretcharts --neck --notes "6:3:R;5:5;4:5;3:4;2:3;1:3:R" \
  --brackets "0-3:E shape;2-5:D shape;4-8:C shape;7-10:A shape;9-12:G shape"
```

Each bracket is `startFret-endFret:label[:className]`, separated by `;`
and/or newlines (a JSON array of `{startFret, endFret, label, className?}`
objects also works, and is the way to use a label containing `:` or `;`).
Both ends are inclusive fret numbers: `2-5` spans the 2nd through 5th fret
columns, drawn just inside the fret lines bounding them, so brackets that
are merely adjacent (`2-5` and `6-8`) never touch. A bracket starting at
fret `0` begins under the open-string glyphs, left of the nut.

Brackets that overlap — sharing at least one fret, as neighboring CAGED
shapes do — stack vertically, each further from the neck than the last;
non-overlapping brackets share a row. Wider brackets are placed nearer the
neck than narrower ones nested inside them. Like a note, a bracket outside
`[--first-fret, --last-fret]` grows the shown range (with a warning), and
`--transpose` shifts brackets along with the notes.

Scale charts (`--notes` without `--neck`) take the same `--brackets`. On
the compact vertical grid they're drawn **left of the grid** — the bass
side, beside the low-E string, the same side "below the neck" is on a
neck diagram — running top to bottom with their labels rotated to read
along them, and overlapping brackets stack further left:

```sh
fretcharts --notes "6:5:R;6:8;5:5;5:7;4:5;4:7:R;3:5;3:7;2:5;2:8;1:5:R;1:8" \
  --brackets "5-7:Box 1;7-8:B2"
```

A scale chart picks its own 4-5 fret window to fit the notes, and brackets
are fitted into that window along with them — so a bracket can stretch the
window, but notes and brackets together still have to fit the 5-fret cap
(an error otherwise, never a silently clipped bracket). A fret-`0` bracket
starts in the open-string row above the nut, which requires the chart to
start at the nut. Brackets aren't available for chord notation or `--bulk`.

## Styling

Every element in the generated SVG carries a semantic CSS class, so you can
restyle a chart without touching the tool itself. `--stylesheet <path>` reads
a CSS file and embeds it into the SVG, where it overrides the default look
(this works for `.png` output too — the stylesheet is embedded before
rasterization).

Classes are keyed by **guitar string number** (6 = low E on the left, 1 =
high E on the right), not array index. Neck diagrams reuse the same
semantic class names for shared elements (strings/frets/dots/glyphs/finger
labels/etc.), so one stylesheet restyles both diagram types -- the outer
element is just `<svg class="neck-diagram">` instead of
`<svg class="chord-chart">`, letting a stylesheet target one diagram type
specifically via that wrapper if needed. On a neck diagram, guitar string 6
(low E) is the bottom row and string 1 (high E) is the top row, so
`chord-string-6`/`chord-dot-string-6`/etc. refer to the bottom row there
rather than the leftmost column.

| Class | Element |
|---|---|
| `chord-string`, `chord-string-N` | A string's vertical line. |
| `chord-fret`, `chord-fret-top`, `chord-fret-nut` | A fret's horizontal line. `chord-fret-top` is the topmost line (nut or the fret above what's shown); `chord-fret-nut` only when it's the actual nut. |
| `chord-dot`, `chord-dot-string-N` | A fretted note's marker -- a `<circle>`, `<rect>`, or `<polygon>` depending on `shape` (see `--note-shapes`/a marker's own `shape`). |
| `chord-dot-shape-circle`/`chord-dot-shape-square`/`chord-dot-shape-triangle`/`chord-dot-shape-diamond` | The dot's *resolved* shape (defaulted to `circle` when unset) -- always present alongside `chord-dot`, so a stylesheet can target "whatever's drawn as a square" without caring whether that came from an explicit `shape` or the default. |
| `chord-dot-label`, `chord-dot-label-string-N` | Text on top of a dot (from `--string-labels` or `--label-pitches`). |
| `chord-glyph`, `chord-glyph-mute`/`chord-glyph-open`, `chord-glyph-string-N` | The `x` (muted) or unfilled circle (open) above the grid. |
| `chord-finger-label`, `chord-finger-label-string-N` | A finger number below the grid. |
| `chord-tuning-label`, `chord-tuning-label-string-N` | An open-pitch label above the glyphs. |
| `chord-fret-label`, `chord-fret-label-N` | A fret-number label to the right of the grid's 1st, 3rd, or (when shown) 5th row -- `N` is that row position (1/3/5), regardless of whether the chart starts at the nut. Non-optional in chord-notation mode (single chord/bulk); in scale-chart mode, opt out with `--no-label-frets`. Compact/scale-chart charts only -- see `chord-neck-fret-label` below for the neck-diagram equivalent. |
| `chord-title` | The chart's title text. |
| `chord-fret-marker`, `chord-fret-marker-single`/`chord-fret-marker-double` | A neck-inlay-style position marker dot, light grey by default. One at frets 3/5/7/9/15/17/19/21 (centered between strings 3-4) whenever that fret is in the visible grid; two at fret 12 (between strings 4-5 and strings 2-3). Not tied to any string, so no `-string-N` variant. Behind everything except the background/neck. |
| `chord-chart-background` | A full-canvas rect behind everything, transparent (`fill="none"`) by default. Style it to set the chart's overall background color, including the margins around the grid. |
| `chord-neck` | A rect covering just the fretted grid area -- between the outer strings and outer frets, not the margins where the title/glyphs/labels sit. Transparent (`fill="none"`) by default, styleable independently of `chord-chart-background`, e.g. for a distinct fretboard color/texture. Same class name in both compact charts and neck diagrams, so one stylesheet restyles the fretboard fill consistently across both. |
| `chord-bracket`, `chord-bracket-level-N` | Scale charts and neck diagrams (`--brackets`): a fret-range bracket's line (a `<path>` with `fill="none"` -- restyle with `stroke`) -- `N` is its stacking row/column, 0 nearest the fretboard. Same classes on both chart types, so one stylesheet covers both. Also carries the bracket's own `className`, if any. See [Fret-range brackets](#fret-range-brackets). |
| `chord-bracket-label`, `chord-bracket-label-level-N` | Scale charts and neck diagrams: a bracket's label -- centered beneath its line on a neck diagram, rotated alongside it on a scale chart. Also carries the bracket's own `className`, if any. |
| `chord-neck-fret-label`, `chord-neck-fret-label-N` | Neck-diagram (`--neck`) only: a fret-number label above the neck, over string 1/high-E -- `N` is the *actual* fret number (not a row position, unlike `chord-fret-label-N` above). At the standard inlay frets within `[--first-fret, --last-fret]` plus `--first-fret` itself, on by default regardless of whether `--first-fret` is the nut -- opt out with `--no-label-frets`. |

Plus anything from `--note-classes`/`--root` on the targeted dot or open
circle (and its label, if any). In bulk mode, the composite grid also has
`chord-collection-label` (the `--collection-label` text),
`chord-collection-section-label` (each `header` row's text -- see
[Section headers](#section-headers)), and
`chord-collection-background` (a rect covering the *entire* composite,
including the gutters between charts -- distinct from each individual
chart's own `chord-chart-background`, which only covers its own cell).

A dot's marker and its label text are siblings, not nested -- both get
tagged with the same `--note-classes`/`--root` class, so `.root` alone
matches both. Use the element type to target just one -- `text.root` for
the label, or `circle.root`/`rect.root`/`polygon.root` for the marker
itself, depending on its shape (or `.chord-dot-shape-square.root`, etc.,
to stay shape-agnostic).

Example stylesheet:

```css
.chord-chart-background { fill: #fdf6e3; } /* overall background color */
.chord-neck { fill: #8b5a2b; }              /* just the fretboard, e.g. a wood tone */
.chord-fret-marker { fill: #ccc; }          /* neck-inlay position dots */
.chord-dot-string-6 { fill: navy; }        /* one specific string's dot */
circle.root, rect.root, polygon.root { fill: #d62828; } /* whatever's tagged --root, any shape */
text.root { fill: white; }                  /* just that dot's label text */
.chord-dot-label { fill: white; font-weight: bold; }
.chord-string-6 { stroke: navy; }
.chord-title { fill: #457b9d; }
```

### Gradients (`--svg-defs`)

A CSS `fill` rule can only ever set one flat color. To blend two colors on a
single marker (e.g. color-coding overlapping CAGED pentatonic shapes on a
neck diagram, or marking a passing-tone dot as "half root, half third"), an
SVG gradient has to exist as real markup — `--svg-defs`/`--svg-defs-file`
embed raw SVG into a `<defs>` element, which a stylesheet rule can then
reference by id:

```
fretcharts --neck --notes "6:3:R:root;5:2:b3:blend" \
  --svg-defs '<linearGradient id="rootBlend" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#d62828" />
    <stop offset="100%" stop-color="#457b9d" />
  </linearGradient>' \
  --stylesheet blend.css
```

where `blend.css` contains:

```css
circle.blend, rect.blend, polygon.blend { fill: url(#rootBlend); }
```

`--svg-defs`/`--svg-defs-file` are mutually exclusive (exactly one, or
neither); the same option exists in the web UI (an "SVG defs" field next to
each Stylesheet field) and in [FretCharts files](#fretcharts-files) as
`defs`/`defsFile`.

## Bulk mode

`--bulk <file.csv>` renders every row of a CSV file to its own chart, then
composites them into a single grid image (`--columns` per row, default 4,
wrapping to additional rows as needed; a short last row is left-aligned, not
centered). `--collection-label <text>` optionally titles the whole grid,
centered above it — separate from each chart's own `label`.

Each column heading names a parameter, matching the CLI flags above minus
their `--` prefix (`string-labels`, `finger-positions`, `note-classes`,
`note-shapes`, `root`, `tuning`, `label-pitches`, `label-tuning`,
`stylesheet`, `label`, and the per-string `string-label-1`..`string-label-6`/
`finger-position-1`..`finger-position-6` columns — same "wins over a
same-numbered entry in the aggregate column" precedence as their CLI
equivalents). Chord notation has no named flag on the command line, so its
column must be called **`notes`** — this is the only required column.

Any flag given on the command line becomes the *default* for a row that
leaves its column blank or omits it entirely; a non-empty cell always wins.
Unrecognized column headings are ignored, so you can keep extra bookkeeping
columns (e.g. a song title) without breaking rendering.

Example `chords.csv`:

```csv
notes,label,root,finger-positions
x02220,A,5,
320003,G,6,3xxxxx
xx0232,D,4,
022100,Em,5,
```

```bash
echo '.root { fill: #d62828; }' > root.css
fretcharts --bulk chords.csv --stylesheet root.css --columns 4 \
  --collection-label "Open Chords" --output chords.png
```

Every chart in the grid gets `--stylesheet root.css` and `--columns 4` as
defaults; each row supplies its own `notes`, `label`, `root`, and
(optionally) `finger-positions`. `--collection-label` applies once, to the
grid as a whole.

### Section headers

An optional `header` column splits the grid into titled sections, so one
image can hold several progressions. A row with a non-empty `header` cell
starts a new section on a fresh grid row, with that text centered above it
(below the `--collection-label`, if any). The row can carry the section's
first chart, or leave `notes` blank to be a heading-only row:

```csv
header,notes,label
I IV V in G,320003,G
,x32010,C
,xx0232,D
ii V I in C,,
,xx0211,Dm
,320001,G7
,x32010,C
```

Charts before the first header row form an untitled leading section. A row
with neither `notes` nor `header` is still an error.

**Caveat:** if different rows use different `--stylesheet`/`stylesheet`
column values, each row's CSS is embedded in that row's own nested `<svg>`,
but SVG `<style>` rules are not scoped to their containing element — they
cascade across the *entire* composited image. Two rows with different rules
for the same class name (e.g. both defining `.root`) will affect each
other, not stay isolated to their own chart. This isn't a problem when every
row shares one stylesheet (the common case), only when they genuinely
differ.

## Finding triads (`fretcharts-triads`)

A second command, `fretcharts-triads`, picks one triad voicing for each chord of
a progression and writes them as a [bulk mode](#bulk-mode) CSV:

```bash
fretcharts-triads D Bm G A --strings 1-3 --output triads.csv
fretcharts --bulk triads.csv --output triads.png
```

```csv
notes,label,root,string-labels
x-x-x-11-10-10,D,1,"{""1"":""R"",""2"":""5"",""3"":""3""}"
x-x-x-11-12-10,Bm,2,"{""1"":""b3"",""2"":""R"",""3"":""5""}"
x-x-x-12-12-10,G,3,"{""1"":""5"",""2"":""3"",""3"":""R""}"
x-x-x-9-10-9,A,2,"{""1"":""3"",""2"":""R"",""3"":""5""}"
```

Every triad uses one group of three **adjacent** strings, and the same group
is used for the whole progression. For each chord, string group, and
inversion there is a single arrangement: the close voicing. Root position,
1st and 2nd inversions are all considered equally.

Chords are written as common symbols: `D`, `Bm`, `Gsus4`, `Cadd9`, `A7`,
`Fmaj7`, `F#m7b5`, and so on. The supported qualities are maj, m, dim, aug, sus2, sus4,
6, m6, 7, maj7, m7, m7b5, dim7, and add9. A triad only has room for three
notes, so four-note chords drop their 5th (A7 → A, C#, G). The exceptions
are m7b5 and dim7: their altered 5th is the characteristic tone, so they
drop the 3rd instead (Bm7b5 → B, F, A). Slash chords aren't supported,
since every inversion is already a candidate.

| Option | Description |
|---|---|
| `--strings <list>` | Strings the triads may use: `"1-4"`, `"1,2,3,4"`, or a mix like `"1-3,5"` (1 = highest). Default: all. |
| `--floor <value>` | One number: every note is at or above that fret (inclusive, so `--floor 1` rules out open strings). Two numbers, string and fret (`"5,3"`, `"5:3"`, or `"5 3"`): no note sounds lower than the pitch at that string and fret. |
| `--key <note>` | Key root, e.g. `G`. The first chord with that root is the **anchor**. Default: the first chord. |
| `--direction <above\|below>` | Keeps every other chord strictly above (or below) the anchor on the neck. Repeats of the anchor's own chord may share its position. Without it, the tool only minimizes movement. |
| `--max-span <frets>` | Largest inclusive fret span of a triad's fretted notes. Default `3`. |
| `--max-fret <fret>` | Highest fret a triad may use. Default `15`. |
| `--tuning <notation>` | Same as `fretcharts --tuning`. Also written to the CSV as a `tuning` column. |
| `--output <path>` | Write the CSV to a file instead of stdout. |

**How the progression is chosen.** The tool tries every voicing of the
anchor chord on every allowed string group. For each one, it picks the rest
of the progression to minimize **fretting-hand travel**: how far the hand
slides along the neck between chords, where the hand's position is the
lowest fretted note. Ties go to less total finger movement, then to more
compact shapes, then to lower positions. The progression is not treated as
a loop, so there is no cost for moving from the last chord back to the
first.

The CSV's `root` column marks the string carrying each chord's root, which
works with a `.root` stylesheet rule. `string-labels` shows each note's
interval (`R`, `b3`, `5`, `b7`, ...).

## Transposing

`--transpose <n>` shifts every sounding note by `n` frets/half-steps
(positive = up the neck, negative = down) before rendering -- "frets" and
"half-steps" mean the same thing on a fretted instrument, so one signed
integer covers both. It works the same way everywhere a chart has notes:

```bash
# A major (x02220) shifted up 2 frets -> the same shape as a B major barre.
fretcharts x02220 --transpose 2

# Scale/neck notes: every marker's fret shifts by the same amount.
fretcharts --notes "6:3:R;6:5:2;5:2:b3" --transpose -2
fretcharts --neck --notes "6:7:R" --first-fret 5 --last-fret 17 --transpose 3
```

A muted (`x`) string is left alone; an open string (fret `0`) becomes
fretted if shifted up. A shift that would put any note below the nut
(fret `0`) is a clean error, not silently clamped -- that isn't a shape
the instrument can actually play. `--label-pitches`/`--label-frets`
reflect the *transposed* frets, so labels stay correct. For `--neck`, an
explicit `--first-fret`/`--last-fret` window shifts along with the notes,
so the diagram doesn't need [auto-expansion](#neck-diagrams) to catch up
on every transposed render.

`--bulk`/a `type: chords` document apply the same shift to every row's
chord notation. A [FretCharts file](#fretcharts-files) can also carry
`transpose:` as a genuine field (chord/scale/neck/chords documents alike)
-- the document's own `notation`/`notes` stay exactly as written, and the
shift is applied at render time, same as any other render option
(`--transpose` on the CLI, alongside `--file`, overrides a document's own
`transpose:` field, the same "CLI flag wins" precedent `--output` already
has). This means writing a document with `--transpose` (via `--output`)
records the *original*, untransposed shape plus a `transpose:` field, not
a baked-in transposed one:

```bash
fretcharts x02220 --transpose 2 --output b-major.yaml
# b-major.yaml: notation: x02220 / transpose: 2 -- rendering it applies
# the shift, exactly like the original --transpose 2 invocation did.
```

### Baking a transposition into notes (`--bake-transpose`)

Keeping the original shape plus a `transpose:` field is convenient when
you want to preserve what was actually played, but sometimes it's more
useful to permanently commit to the new position instead -- for example,
moving a shape up the neck so you can then layer a *different* shape at
the vacated position, to suit a different key. `--bake-transpose` (only
with `--transpose`) writes the shift directly into `notation`/`notes`
instead of recording it as a separate field:

```bash
fretcharts x02220 --transpose 2 --bake-transpose --output b-major.yaml
# b-major.yaml: notation: x 2 4 4 4 2 -- no transpose: field at all.
```

It also works on an existing FretCharts file via `--file` (with or
without also overriding the shift with a fresh `--transpose`):

```bash
# Bake in whatever transpose: b-major.yaml already carries.
fretcharts --file b-major.yaml --bake-transpose --output b-major-baked.yaml

# Or override the shift and bake the new one in one step.
fretcharts --file a-major.yaml --transpose 2 --bake-transpose --output b-major.yaml
```

Scale/neck notes keep whichever form they already had (a compact string
stays a compact string, a native list stays a native list) -- baking
changes the fret *values*, not the format `--compact-notes` controls. A
shift that would put a note below the nut is still a clean error, same as
without `--bake-transpose`.

`--bulk`/an inline-`csv` `type: chords` document work too -- the CSV's
`notes` column is rewritten in place, every other column left exactly as
it was (just re-escaped if it needs quoting; the transposed notation
itself never does):

```bash
fretcharts --bulk chords.csv --transpose 2 --bake-transpose --output chords-up-a-step.yaml
```

**No effect** on an SVG/PNG render (only a `.yaml`/`.yml`/`.json`
`--output` writes anything to bake into), or on a `type: chords` document
that references an external file via `csvFile:` instead of inline `csv:`
— rewriting that file isn't supported (`--file`'s reformat mode never
touches any file but the one you pointed it at), so the `transpose:`
field is left in place instead. `--bulk <file.csv>` always reads its CSV
directly, so this limitation only applies to a hand-written `csvFile:`
reference inside a document.

## FretCharts files

`--file <path>` renders from a single, self-contained YAML FretCharts file
describing one chart end to end — notation/notes plus every styling option, a
stylesheet, and SVG defs, in one version-controllable file instead of a
shell command.
`.json` files work too, as a rule of thumb (YAML's core schema is a JSON
superset for values), but aren't a 100% guarantee for every edge case —
prefer `.yaml`/`.yml` if you want the multi-line block scalars below.

A `type:` field selects which of the tool's four artifacts the file
describes:

| `type:` | Equivalent to | Required field |
|---|---|---|
| `chord` | a `notation` argument | `notation` |
| `scale` | `--notes` | `notes` |
| `neck` | `--neck --notes` | `notes` |
| `chords` | `--bulk` | `csv` or `csvFile` |

Every other key is the same internal name used throughout this README's
CLI reference (`stringLabels`, `fingerPositions`, `noteClasses`,
`noteShapes`, `root`, `labelPitches`, `labelTuning`, `labelFrets`,
`mutedStrings`, `firstFret`, `lastFret`, `brackets`, `collectionLabel`,
`columns`, `transpose`), not the `--kebab-case` flag spelling. `brackets`
(scale/neck files only), like `notes`, may be compact text or a native list of
`{startFret, endFret, label, className?}` objects. `labelFrets`
(scale/neck files only) defaults to `true` when omitted -- unlike every
other boolean field here -- so write `labelFrets: false` explicitly to
turn it off. `transpose` (all four document types) applies at render time
to the `notation`/`notes` as written -- see [Transposing](#transposing)
above.
**Unrecognized fields are a hard error** (not silently ignored) — a
hand-written, version-controlled FretCharts file is a worse place for a
silent typo than a spreadsheet's bookkeeping column, unlike bulk mode's CSV
columns (see [Bulk mode](#bulk-mode) above), which *are* lenient about
unrecognized headings.

### Versions

A file may carry a `version:` -- the FretCharts release that wrote it,
and so the minimum needed to render it. Every file FretCharts writes (the
CLI's `.yaml`/`.yml`/`.json` `--output`, and the web UI's download, Copy
link, and live preview) is stamped with the running version, right after
`type:`; reformatting a file with `--file` restamps it. Hand-written files
can leave it out.

A file from a *newer* release than the one reading it still renders, as a
best effort: FretCharts prints a warning, and any field it doesn't
recognize -- most likely a feature added since -- is dropped with a
warning of its own instead of being an error. A wrong-typed value or an
unknown `type:` still fails, since there's nothing sensible to render. The
web UI keeps such a file as text on the File tab rather than
loading it into a tab whose fields would silently drop what it doesn't
know about.

```yaml
type: chord
version: 0.2.0
notation: x02220
```

`--file` is mutually exclusive with a `notation` argument, `--notes`,
`--bulk`, `--neck`, and every other field flag — the file is meant to
be fully self-contained. Only `--output <path>` layers on top, overriding
the file's own optional `output:` field if it has one.

### `type: chord`

```yaml
type: chord
notation: x02220
label: A Major
root: "5"
tuning: EADGBE
stylesheet: |
  circle.root { fill: #d62828; }
  .chord-title { fill: #457b9d; }
output: a.png              # optional; CLI --output wins if also given
```

`stylesheet`/`stylesheetFile` (inline text vs. an external file, resolved
relative to *this file's own directory*, never the current working
directory) are mutually exclusive; `defs`/`defsFile` work the same way for
raw SVG `<defs>` markup (see [Gradients](#gradients---svg-defs) above).

### `type: scale`

`notes:` accepts either the compact string notation `--notes` already
does, or a native YAML list of marker objects — useful once a pattern has
enough notes that the compact form gets hard to read. `stylesheetFile:`/
`defsFile:` (instead of inline `stylesheet:`/`defs:`) are paths to external
files, resolved relative to *this file's own directory*, never the
current working directory:

```yaml
type: scale
label: "Minor Pentatonic Box (partial)"
notes:
  - { string: 6, fret: 3, label: R, className: root }
  - { string: 6, fret: 5, label: "2" }
  - { string: 5, fret: 2, label: b3 }
  - { string: 5, fret: 5, label: "4" }
mutedStrings: "1,2"
stylesheetFile: ./theme.css
defsFile: ./gradients.svg
```

### `type: neck`

```yaml
type: neck
notes: "6:7:R;5:7:5;4:7:R"
firstFret: 5
lastFret: 17
label: Root-5 shape
tuning: DADGBE
brackets: |
  5-8:E shape
  7-10:D shape
```

### `type: chords` (bulk/series, inline CSV)

`csv:` is typically a YAML block scalar (`csv: |`) holding raw CSV text
verbatim — no escaping, unlike JSON's lack of a multi-line string
literal. `csvFile:` (a path, resolved the same way `stylesheetFile:` is)
is the external-file alternative when the CSV already lives in its own
file. Exactly one of the two is required.

```yaml
type: chords
collectionLabel: Open Chords
columns: 4
defaults:
  root: "5"
csv: |
  notes,label,root,finger-positions
  x02220,A,5,
  320003,G,6,3xxxxx
  xx0232,D,4,
  022100,Em,5,
stylesheet: |
  .root { fill: #d62828; }
output: chords.png
```

`defaults:` accepts the same fields `--bulk`'s own command-line defaults
do (see [Bulk mode](#bulk-mode) above) — **except** `stylesheet`/
`stylesheetPath`. A `chords` FretCharts file has exactly one place to set
styling (the top-level `stylesheet`/`stylesheetFile`/`defs`/`defsFile`
fields above, applied to the whole grid), never per-row — the same
reasoning documented in Bulk mode's cascading-`<style>` caveat, extended
here to reject a `defaults` stylesheet *and* a `stylesheet` CSV column
outright, rather than letting per-row CSS silently leak across the
composited image.

### Running a FretCharts file

```bash
fretcharts --file examples/a-major.yaml
fretcharts --file examples/pentatonic-box.yaml --output pentatonic.png
```

### Writing a FretCharts file

Any CLI invocation — a plain chord, `--notes`, `--neck`, `--bulk`, or even
`--file` itself — writes a FretCharts file instead of rendering when
`--output` ends in `.yaml`, `.yml`, or `.json`, capturing that invocation's
parameters rather than an image. For a plain chord/`--notes`/`--neck`/
`--bulk` invocation, the chord/CSV is still fully validated first (an
invalid notation, malformed `--notes`, or bad CSV row still exits 1,
without writing a file), and a `--stylesheet <path>`/`--svg-defs-file
<path>` file's contents are read and embedded inline (`stylesheet:`/
`defs:`), not left as a path — a path recorded as-is wouldn't be portable
if the FretCharts file later moves. `--file` with a `.yaml`/`.yml`/`.json`
`--output` is different: a plain reformat/convert of the already-parsed
file (e.g. hand-written YAML into canonical form, or YAML↔JSON), not a
render — so it only checks file *structure* (same as any `--file`
invocation), not full chord-parseability or CSV validity, and
`stylesheetFile`/`defsFile`/`csvFile` references are left exactly as
written rather than resolved, so (unlike an actual render) the files they
point at don't even need to exist.

```bash
# Same options either way -- write a FretCharts file, edit it, then render it.
fretcharts 320003 --label "G" --finger-positions "3xxxxx" --output g.yaml
fretcharts --file g.yaml --output g.png

# Bulk mode too -- the CSV ends up embedded inline (csv: |) in the file.
fretcharts --bulk chords.csv --collection-label "Open Chords" --output chords.yaml

# --compact-notes: notes as compact notation (one marker per line) instead
# of the native YAML marker list.
fretcharts --notes "6:3:R:root;6:5:2;5:2:b3" --compact-notes --output pentatonic.yaml
```

This is the CLI equivalent of the web UI's "FretCharts File" (download) button —
see [Web UI](#web-ui) below.

## Library usage

The programmatic API (`dist/chart.js` / `src/chart.ts`) has no dependency on
`process.argv`, stdout, or `process.exit`, so it's suitable for embedding —
the web UI runs it in the browser (see [Web UI](#web-ui)).

```ts
import { buildChart, tryBuildChart, renderChartPng, buildNeckDiagram } from "fretcharts"; // resolves to dist/chart.js

const { svg } = buildChart("x02220", { label: "A" });

const png: Buffer = await renderChartPng("320003", {
  label: "G",
  tuning: "DADGBE",
  labelPitches: true,
});

const result = tryBuildChart("qqqqqq"); // { ok: false, error: ChordParseError }

// Scale chart: pass `notes` instead of a notation string. See
// "Scale charts" above for the full NoteMarker field reference.
const scale = buildChart(undefined, {
  notes: [
    { string: 6, fret: 3, label: "R", className: "root" },
    { string: 6, fret: 5, label: "2" },
  ],
  mutedStrings: [1, 2],
  label: "Minor Pentatonic Box (partial)",
});

// Neck diagram: a separate entry point, sharing the same NoteMarker model.
// `notes` is a required positional parameter -- there's no notation-string
// alternative to guard against here.
const neck = buildNeckDiagram(
  [
    { string: 6, fret: 7, label: "R" },
    { string: 5, fret: 7, label: "5" },
  ],
  { firstFret: 5, lastFret: 17, label: "Root-5 shape" },
);
```

## Web UI

`web/` is a static HTML/JS UI that renders
everything in the browser — there's no backend. `src/browser/engine.ts`
(bundled into `web/engine.js` by `npm run build:web`) runs the same
TypeScript the CLI uses, through the request handlers in `src/api/`
(`/chart`, `/bulk`, `/triads`, `/neck`, `/document`), and rasterizes PNGs
on a `<canvas>` instead of with `sharp`. Each tab has a "Stylesheet" field and, next to
it, an "SVG defs" field (see [Gradients](#gradients---svg-defs) above) for
raw `<defs>` markup, plus a "Transpose" field (see [Transposing](#transposing)
above) that shifts every note by that many frets/half-steps. The FretCharts File tab can either upload a file or have
YAML/JSON pasted directly into it. `stylesheetFile`/`defsFile`/`csvFile`
external references aren't honored in the browser (there's no local
filesystem to resolve them against) — use inline `stylesheet`/`defs`/`csv`
fields there, or the CLI's `--file` for full external-file support.

Each form sits beside its rendered result on wide screens (stacked on
narrow ones). The Scale and Neck tabs also have a collapsible "FretCharts file"
panel showing the FretCharts file their current fields would produce, live
as you edit, with a "Compact notation for notes" checkbox (on by default)
that also governs the format the "FretCharts File"/"Copy link" buttons on
that tab actually emit — uncheck it to get the native YAML marker list
instead. Beside it, a "Bake transpose into notes" checkbox
(unchecked by default) governs the same buttons the same way: checked, it
writes the shift directly into each marker's fret (and First fret/Last
fret) instead of keeping the originals plus a separate `transpose:` field
— see [Baking a transposition into notes](#baking-a-transposition-into-notes---bake-transpose)
above. This is a client-side convenience limited to marker-based notes
(chord notation isn't handled this way — the Chord/Chord sheet
tabs' Transpose field always stays a `transpose:` field when downloaded
from the web UI, even though the CLI's `--bake-transpose` *does* support
both); a shift that would put a
marker below the nut leaves notes unbaked with an alert, rather than
attempting it.

The tabs are grouped as **Start** | **Chord**, **Chord sheet** (bulk CSV),
**Triads**, **Scale**, **Neck** | **File** (a raw FretCharts file). The page
reopens whichever tab was used last (remembered in `localStorage`), or Start
on a first visit; a `#doc=` link opens its own tab instead.

The Start tab has a short overview of the notation, styling, and saving,
followed by complete example FretCharts files (`web/gallery.js`), each
beside its live render, covering every `type:`. The examples are only
rendered once Start is shown. **Open in editor** loads one into the tab
matching its type. `web/gallery.test.js` renders every example, so a
broken one fails the test suite.

The Triads tab is the web version of [`fretcharts-triads`](#finding-triads-fretcharts-triads).
It has the same chord list and constraints, renders the result as a grid,
and shows the generated CSV below it. **Download CSV** (shown with the result) saves the CSV.
**Send to Chord sheet** copies the CSV and the grid/styling options into
the Chord sheet tab, where its FretCharts File and Copy link buttons and
per-chart defaults apply as usual.

The Neck and File tabs also show an amber warning box
above the rendered result when the render produces
warnings (currently just the fret-range auto-expansion described
in [Neck diagrams](#neck-diagrams) above).

Uploading a FretCharts file auto-populates the tab matching its `type:` —
a `type: chord` file fills in and switches to the Chord tab,
`scale`/`neck`/`chords` do the same for their own tabs — so a file can be
picked up, tweaked using that tab's normal fields, and re-downloaded.
Every tab has a "FretCharts File" button that downloads its current field
values as a `.yaml` file.
This uses a small purpose-built reader/writer (`web/documentSync.js`)
scoped to this tool's own file schema rather than a full YAML
implementation — see that file's doc comment — so a hand-written file
using YAML syntax outside that scope simply won't auto-populate a tab;
the FretCharts File tab shows a clear message instead and falls back to
just loading the raw text, and rendering itself is unaffected either way,
since the `/document` renderer (backed by the real `yaml` package) is
what actually renders, both here and from the CLI.

Every tab also has a "Copy link" button — it encodes the current
FretCharts file straight into the page's own URL as a `#doc=...` fragment
(never sent to any server; a fragment isn't part of the HTTP request at
all) and copies that link to the clipboard, so a chart/scale/neck
diagram/CSV grid can be shared with just a link, no file attachment
needed. Opening a link with a `#doc=` fragment auto-populates the
matching tab on load, exactly like uploading the same file would.
Clipboard access needs a secure context (HTTPS, or `localhost` for local
testing) — where it isn't available, the link is shown for you to copy
by hand instead of failing silently.

Once a tab has rendered something, a **Print** button appears above the
result (the Start tab has its own, beside the examples). Printing — by
button or the browser's own Print command — includes only the active tab's
result: the header, tabs, form, and buttons are left out, and the page
switches to a white background whatever the screen theme. The print
dialog's "Save as PDF" covers PDF export. A grid (Chord sheet, Triads, or
a `type: chords` file) is one composite SVG on screen, which a browser
can't split across pages, so `/bulk`, `/triads`, and `/document` also
return each chart on its own (`grid` in the result); the page lays those
out for print with the same charts per row and the collection label as a
heading, keeping each row whole so a long sheet continues onto the next
page.

It's a fully static site, so any static file host can serve `web/` once
`web/engine.js` is built. To run it locally:

```bash
npm run build:web    # bundles src/browser/engine.ts into web/engine.js
npx serve web        # or: python3 -m http.server 8080 --directory web
```

Re-run `npm run build:web` after changing anything under `src/`.
Open the static server's URL in a browser.

## Development

```bash
npm run typecheck # tsc --noEmit (Node code, then src/browser with DOM types)
npm test # vitest run
npm run build # tsc, then chmod +x on the CLI entry point
npm run build:web # esbuild bundle of src/browser/engine.ts -> web/engine.js
```

### Releasing

`package.json`'s `version` is the one source of the running version:
`--version` prints it, and it's what gets stamped into written FretCharts
files. Bump it and tag in one step with `npm version <x.y.z>` (or
`npm version <x.y.z>-rc.1` for a prerelease), then push the tag. The
release workflow refuses a tag that doesn't match `package.json`. A
prerelease sorts before its release, so a file written by `0.2.0-rc.1`
renders without a warning on `0.2.0`.

The test suite includes an exhaustive check of every legal 6-string chord
(~1.4M combinations) confirming `chordparse.ts`'s notation is never
ambiguous under its default settings; expect that one test to take several
seconds.

## Project layout

| File | Responsibility |
|---|---|
| `chordparse.ts` | Parses compact tablature notation into a fret array. |
| `src/types.ts` | Shared contracts (`ChartLayout`, `StringLabels`, `NoteClasses`, etc.) between the layout engine and renderers. |
| `src/layout.ts` | Turns a parsed chord (`computeLayout`) or a `--notes` marker list (`computeMarkerLayout`) into the same renderer-agnostic compact layout (fret range, dot/glyph/label positions) -- one shared engine underneath both. Also `computeNeckLayout`, the analogous engine for `--neck`'s wide, explicit-fret-range diagrams. |
| `src/render/svg.ts` | Renders a compact `ChartLayout` (chord or scale chart) to an SVG string. |
| `src/render/neckSvg.ts` | Renders a `NeckLayout` (`--neck`) to an SVG string -- a separate, axis-swapped renderer, since a neck diagram's frets-as-columns/strings-as-rows layout is the opposite of the compact chart's. |
| `src/render/png.ts` | Rasterizes an SVG string to PNG (via `sharp`) for the CLI/library. The web UI uses a `<canvas>` instead (`src/browser/engine.ts`). |
| `src/tuning.ts` | Tuning notation parsing and pitch computation. |
| `src/fingerPositions.ts` | Parses `--finger-positions`' two input forms; also validates a single finger value, reused for `--finger-position-N` and `--notes` marker `finger` fields. |
| `src/chartFieldResolver.ts` | Shared parsing for `--string-labels`/`--note-classes`/`--note-shapes`/`--root`/`--notes`/`--muted`, used by both single-chord and bulk CLI paths. |
| `src/chart.ts` | Programmatic API: `buildChart` builds a chord (from notation) or a scale chart (from `notes`) -- the one entry point for both, sharing layout/render underneath. `buildNeckDiagram` is the separate entry point for `--neck`. I/O-free. |
| `src/bulk.ts` | CSV parsing and grid composition for `--bulk`. |
| `src/document.ts` | Parses and builds `--file`'s single-file FretCharts format (YAML/JSON) -- a thin translation/dispatch layer over `chart.ts`/`bulk.ts`, no rendering logic duplicated. |
| `src/outputWriter.ts` | Shared stdout/`.svg`/`.png` output handling, plus writing a FretCharts file instead when `--output` ends in `.yaml`/`.yml`/`.json` (see [Writing a FretCharts file](#writing-a-fretcharts-file)). |
| `src/cli.ts` | Command-line entry point. |
| `src/api/` | The web UI's request handlers (`/chart`, `/bulk`, `/neck`, `/document`, `/triads`): validate a form's JSON-shaped request and return SVG plus any warnings/CSV. |
| `src/browser/engine.ts` | Browser entry point (bundled to `web/engine.js` by `scripts/build-web.mjs`): calls `src/api` and rasterizes PNGs on a `<canvas>`. |
