/**
 * Renders a {@link ChartLayout} to a self-contained SVG string.
 *
 * Geometry summary (see src/types.ts for the frozen layout contract):
 *  - A full-canvas background rect sits behind everything, transparent by
 *    default (fill="none") but classed for stylesheet overrides.
 *  - A second rect, the neck, covers just the fretted grid area (between
 *    the outer strings and outer frets) -- also transparent by default,
 *    styleable independently of the full-canvas background, e.g. to give
 *    just the fretboard a wood-tone fill without extending into the
 *    margins where the title/glyphs/labels sit.
 *  - Neck-inlay-style fret position markers (light grey by default) sit
 *    behind everything except the background/neck: one at frets 3/5/7/9/15/
 *    17/19/21 (centered between strings 3-4) whenever that fret is within
 *    the visible grid, two at fret 12 (between strings 4-5 and 2-3).
 *  - `stringCount` evenly-spaced vertical lines span the full grid height.
 *  - A horizontal fret line is drawn at every row boundary, including the
 *    top of the grid (row 0's top edge) -- that top line stands for the nut
 *    when `startFret === 0`, or for the fret just above the first one played
 *    when the diagram is offset.
 *  - Mute glyphs ("x") sit above the grid, over their string's line. Open
 *    glyphs are an unfilled circle in the same spot, distinguishing them
 *    from a filled fretted-note dot. An open glyph may carry its own label
 *    (e.g. a scale degree on an open root) -- rendered in black, since the
 *    circle itself has no fill to contrast a white dot-label against. Mute
 *    glyphs never carry a label or custom class; a muted string isn't
 *    sounding a note.
 *  - Dots sit centered within their row, over their string's line.
 *  - An optional per-chart label sits above everything else.
 *  - Fret-number labels always sit to the right of the grid's 1st, 3rd, and
 *    (when shown) 5th rows -- the actual fret number at that row, not the
 *    row's position, and regardless of whether the chart starts at the nut.
 *  - Optional finger position labels sit centered below the bottom-most
 *    fret line, under their string.
 *  - Optional tuning labels sit above the mute/open glyphs, under the
 *    chart label -- every string gets one, since this describes the
 *    tuning itself rather than what's currently sounding.
 *  - Optional fret-range brackets (scale-chart mode) sit in a band left of
 *    the grid, beside the low-E string -- the same bass side render/
 *    neckSvg.ts draws them on ("below" its horizontal neck): a vertical
 *    line spanning the bracket's fret rows, inset just inside the bounding
 *    fret lines, end ticks pointing back at the grid, and a label rotated
 *    to read along it. Overlapping brackets stack one column further left
 *    per `level`. A fret-0 bracket starts in the open-glyph row above the
 *    nut. Same `chord-bracket*` classes as neck diagrams.
 *
 * Every element carries a semantic `class` (see the `cls*` helpers below),
 * including a per-string modifier class keyed by GUITAR STRING NUMBER
 * (6=low E/leftmost .. 1=high E/rightmost, matching PLAN.md's convention --
 * not the 0-based array index used internally). A dot or open-string circle
 * may also carry a caller-supplied custom class (see NoteClasses in
 * src/types.ts) -- e.g. tagging "the root note" consistently across many
 * charts even as its string position varies between inversions. A dot also
 * always carries a `chord-dot-shape-<circle|square|triangle|diamond>` class (see
 * {@link renderDotShape} below) -- the resolved shape, defaulted to
 * "circle" -- since a dot's actual SVG element (`<circle>`/`<rect>`/
 * `<polygon>`) is chosen server-side from {@link NoteShape}, not something
 * a stylesheet alone can change. All visual properties are
 * still set as presentation attributes (fill=, stroke=, etc.) for a sensible
 * look with no configuration, but presentation attributes are the lowest-
 * priority origin in the CSS cascade: an author stylesheet -- see
 * `SvgRenderOptions.stylesheet` -- targeting these classes always overrides
 * them, including through PNG rasterization (verified against this
 * project's actual sharp/librsvg pipeline).
 */

import type { ChartLayout, DotPosition, GlyphPosition, NoteShape } from "../types";

export interface SvgRenderOptions {
  /** px between adjacent string lines (horizontal spacing). Default 34. */
  columnSpacing?: number;
  /** px height of each fret row (vertical spacing). Default 44. */
  rowHeight?: number;
  /** px radius of a fretted-note dot. Default 11.5. */
  dotRadius?: number;
  /** px radius of a fret position marker (neck inlay dot). Default 7. */
  fretMarkerRadius?: number;
  /** px of space above the grid for glyphs + chart label. Default 60. */
  marginTop?: number;
  /** px of space to the right of the grid for the fret-row labels. Default 50. */
  marginRight?: number;
  /** px of side margin so string lines aren't flush with the SVG edge. Default 20. */
  marginX?: number;
  /** px between the leftmost (low-E) string and the first column of brackets. Default 18. */
  bracketGap?: number;
  /** px of horizontal space per stacked column of brackets (tick + rotated label). Default 30. */
  bracketLevelWidth?: number;
  /** px stroke width for fret lines and glyph outlines. Default 2. */
  strokeWidth?: number;
  /** px stroke width of the leftmost (6th/low-E) string line. Default 3. */
  stringStrokeWidthMax?: number;
  /** px stroke width of the rightmost (1st/high-E) string line. Default 1. */
  stringStrokeWidthMin?: number;
  /** CSS font-family stack used for all text. */
  fontFamily?: string;
  /**
   * Raw CSS embedded into the SVG as a `<style>` element. Rules here
   * override the default presentation attributes (fill, stroke, font, ...)
   * on the classed elements described in this module's doc comment -- e.g.
   * `.chord-dot-string-6 { fill: red; stroke: navy; }` to restyle just the
   * low-E string's fretted-note dots, or `.chord-dot-label { fill: gold; }`
   * to restyle every dot's label text.
   */
  stylesheet?: string;
  /**
   * Raw SVG markup embedded into the SVG as a `<defs>` element, unescaped
   * (unlike `stylesheet`, which is CDATA-wrapped) since it has to parse as
   * actual SVG elements, not CSS text -- e.g. one or more `<linearGradient
   * id="...">`/`<radialGradient id="...">` elements, referenced from
   * `stylesheet` as an ordinary `fill: url(#that-id)` rule (already
   * supported: CSS `fill` can name any paint-server element by id). This is
   * the only way to blend two colors on a marker -- CSS alone can only ever
   * set one flat fill, and a gradient must exist as a real SVG element
   * somewhere in the document for `url(#id)` to resolve. Malformed markup
   * here produces a malformed (but immediately visible) SVG document; this
   * module makes no attempt to validate it, same trust-the-caller stance
   * `stylesheet` already takes.
   */
  defs?: string;
}

interface ResolvedOptions {
  columnSpacing: number;
  rowHeight: number;
  dotRadius: number;
  fretMarkerRadius: number;
  marginTop: number;
  marginRight: number;
  marginX: number;
  bracketGap: number;
  bracketLevelWidth: number;
  strokeWidth: number;
  stringStrokeWidthMax: number;
  stringStrokeWidthMin: number;
  fontFamily: string;
  stylesheet?: string;
  defs?: string;
}

const DEFAULTS: ResolvedOptions = {
  columnSpacing: 34, // 40 * 0.85 -- 15% narrower than the original uniform 40px cell
  rowHeight: 44, // 40 * 1.10 -- 10% taller than the original uniform 40px cell
  dotRadius: 11.5, // 10 * 1.15 -- 15% larger
  fretMarkerRadius: 7,
  marginTop: 60,
  marginRight: 50,
  marginX: 20,
  bracketGap: 18,
  bracketLevelWidth: 30,
  strokeWidth: 2,
  stringStrokeWidthMax: 3, // leftmost (6th/low-E) string -- slightly thicker than the old uniform 2
  stringStrokeWidthMin: 1, // rightmost (1st/high-E) string -- tapered down
  fontFamily: "Arial, Helvetica, sans-serif",
};

/** Extra flat pixel nudge applied to a fret-row label's x position. */
const FRET_ROW_LABEL_SHIFT = 6;

/**
 * Ratio of the muted "x" glyph's rendered ink height to its font-size, in
 * this project's font stack. Measured empirically by rasterizing the glyph
 * at font-size 22 through the same `renderPng` pipeline used at runtime and
 * finding its pixel bounding box: 12px ink height / 22px font-size. Used so
 * the open-string circle's diameter matches the "x" glyph's actual height
 * rather than its font-size (which is noticeably taller than the glyph's ink).
 */
export const X_GLYPH_INK_HEIGHT_RATIO = 12 / 22;

/**
 * Escapes the basic XML special characters in user-supplied content. Safe
 * for both text-node content and attribute values (e.g. NoteClasses'
 * custom class names, embedded in `class="..."`) -- escaping `"` is a
 * no-op in a text node but required once a value can land inside a
 * double-quoted attribute.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmt(n: number): string {
  // Trim to a sane precision and drop unnecessary trailing zeros so the
  // output stays readable (e.g. "60" instead of "60.00000000001").
  return Number(n.toFixed(3)).toString();
}

/**
 * Wraps CSS in a CDATA section so selectors containing `<` or `&` (e.g.
 * attribute selectors) don't need HTML-entity escaping. Guards against the
 * CSS itself containing the CDATA terminator by splitting the section,
 * the standard escaping trick for this case.
 */
export function cdata(css: string): string {
  return `<![CDATA[${css.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/**
 * class="a b c" from a list of class names, skipping falsy entries and
 * XML-escaping each one -- some (like NoteClasses' custom names) are
 * user-supplied and land inside a double-quoted attribute value.
 */
export function cls(...names: Array<string | false | undefined>): string {
  return names.filter((n): n is string => Boolean(n)).map(escapeXml).join(" ");
}

/** sin(60deg) -- half the width of an equilateral triangle at circumradius 1, used by renderDotShape's "triangle" case below. */
const TRIANGLE_HALF_WIDTH_RATIO = 0.8660254037844386;

/**
 * Renders one fretted-note dot as whichever SVG element its `shape` calls
 * for -- shared by render/svg.ts's compact grid and render/neckSvg.ts's
 * wide neck diagram, since a dot's shape means the same thing in both
 * (same reasoning as their other shared chord-dot-* classes). `shape`
 * defaults to "circle" when unset, same as {@link NoteShape}'s own
 * contract.
 *
 * Always carries a `chord-dot-shape-<shape>` class (the *resolved* shape,
 * even when defaulted) alongside `extraClasses` -- unlike a tag-name
 * check, this lets a stylesheet target "whatever's drawn as a square"
 * without caring whether that's from an explicit `shape` or the default,
 * and without needing to know square-shaped dots render as `<rect>`
 * elements internally.
 *
 * "square"/"triangle"/"diamond" are sized to have roughly the same visual
 * weight as a circle of the same `r` (a square spans 2r per side; an
 * upward-pointing equilateral triangle has circumradius r; a diamond is a
 * square rotated 45 degrees with the same r-from-center vertices) -- not
 * pixel-identical areas, which would need more complex per-shape scale
 * factors for a difference most viewers won't consciously notice anyway.
 */
export function renderDotShape(
  shape: NoteShape | undefined,
  extraClasses: Array<string | false | undefined>,
  cx: number,
  cy: number,
  r: number,
): string {
  const resolved = shape ?? "circle";
  const classAttr = cls(...extraClasses, `chord-dot-shape-${resolved}`);
  if (resolved === "square") {
    const side = r * 2;
    return `<rect class="${classAttr}" x="${fmt(cx - r)}" y="${fmt(
      cy - r,
    )}" width="${fmt(side)}" height="${fmt(side)}" fill="black" />`;
  }
  if (resolved === "triangle") {
    const dx = r * TRIANGLE_HALF_WIDTH_RATIO;
    const dy = r * 0.5;
    const points = `${fmt(cx)},${fmt(cy - r)} ${fmt(cx + dx)},${fmt(cy + dy)} ${fmt(cx - dx)},${fmt(cy + dy)}`;
    return `<polygon class="${classAttr}" points="${points}" fill="black" />`;
  }
  if (resolved === "diamond") {
    const points = `${fmt(cx)},${fmt(cy - r)} ${fmt(cx + r)},${fmt(cy)} ${fmt(cx)},${fmt(cy + r)} ${fmt(
      cx - r,
    )},${fmt(cy)}`;
    return `<polygon class="${classAttr}" points="${points}" fill="black" />`;
  }
  return `<circle class="${classAttr}" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="black" />`;
}

export function renderSvg(layout: ChartLayout, options?: SvgRenderOptions): string {
  const opts: ResolvedOptions = { ...DEFAULTS, ...options };
  const {
    columnSpacing,
    rowHeight,
    dotRadius,
    fretMarkerRadius,
    marginTop,
    marginRight,
    marginX,
    bracketGap,
    bracketLevelWidth,
    strokeWidth,
    stringStrokeWidthMax,
    stringStrokeWidthMin,
    fontFamily,
    stylesheet,
    defs,
  } = opts;

  const {
    stringCount,
    visibleFrets,
    dots,
    glyphs,
    fingerLabels,
    tuningLabels,
    fretRowLabels,
    fretMarkers,
    chartLabel,
  } = layout;

  const brackets = layout.brackets ?? [];
  const bracketLevels = brackets.reduce((max, b) => Math.max(max, b.level + 1), 0);
  const bracketBandWidth = bracketLevels > 0 ? bracketGap + bracketLevels * bracketLevelWidth : 0;

  const gridOriginX = marginX + bracketBandWidth;
  // Extra vertical room above the glyphs for tuning labels, inserted
  // between the chart label and the mute/open glyph row. Zero (and thus
  // gridOriginY === marginTop, unchanged) when no tuning labels are shown.
  const tuningLabelBandHeight = tuningLabels.length > 0 ? rowHeight * 0.6 : 0;
  const gridOriginY = marginTop + tuningLabelBandHeight;
  const gridWidth = (stringCount - 1) * columnSpacing;
  const gridHeight = visibleFrets * rowHeight;

  const rightExtra = fretRowLabels.length > 0 ? marginRight : 0;
  // Extra vertical room below the grid for finger position labels, mirroring
  // the rowHeight*0.35 gap glyphs use above the grid.
  const fingerLabelBandHeight = fingerLabels.length > 0 ? rowHeight * 0.7 : 0;
  const bottomPad = marginX + fingerLabelBandHeight;

  const width = marginX * 2 + bracketBandWidth + gridWidth + rightExtra;
  const height = gridOriginY + gridHeight + bottomPad;

  const stringX = (stringIndex: number): number => gridOriginX + stringIndex * columnSpacing;

  // Guitar string NUMBER (6=low E/leftmost .. 1=high E/rightmost), for
  // per-string CSS classes -- the array index alone isn't meaningful to a
  // stylesheet author.
  const stringNumber = (stringIndex: number): number => stringCount - stringIndex;

  // String thickness tapers from thickest at the leftmost (6th/low-E)
  // string to thinnest at the rightmost (1st/high-E) string, mirroring
  // real string gauge.
  const stringStrokeWidth = (stringIndex: number): number => {
    if (stringCount <= 1) return stringStrokeWidthMax;
    const t = stringIndex / (stringCount - 1);
    return stringStrokeWidthMax - t * (stringStrokeWidthMax - stringStrokeWidthMin);
  };

  const elements: string[] = [];

  // Background, covering the full canvas. Transparent by default
  // (fill="none"), but classed so a stylesheet can set a color, e.g.
  // `.chord-chart-background { fill: white; }`.
  elements.push(
    `<rect class="chord-chart-background" x="0" y="0" width="${fmt(width)}" height="${fmt(
      height,
    )}" fill="none" />`,
  );

  // The neck: just the fretted grid area (between the outer strings and
  // outer frets), distinct from the full-canvas background above -- e.g.
  // a wood-tone fretboard color that doesn't extend into the margins where
  // the title/glyphs/labels sit. Transparent by default (fill="none"),
  // same convention as chord-chart-background; classed so a stylesheet can
  // set it independently, e.g. `.chord-neck { fill: #8b5a2b; }`.
  elements.push(
    `<rect class="chord-neck" x="${fmt(gridOriginX)}" y="${fmt(gridOriginY)}" width="${fmt(
      gridWidth,
    )}" height="${fmt(gridHeight)}" fill="none" />`,
  );

  // Fret position markers (neck inlay dots), behind everything except the
  // background/neck. Not tied to any single string, so no per-string class.
  for (const m of fretMarkers) {
    const x = gridOriginX + m.betweenIndex * columnSpacing;
    const y = gridOriginY + m.row * rowHeight + rowHeight / 2;
    elements.push(
      `<circle class="${cls(
        "chord-fret-marker",
        `chord-fret-marker-${m.kind}`,
      )}" cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(fretMarkerRadius)}" fill="lightgrey" />`,
    );
  }

  // Vertical string lines.
  for (let s = 0; s < stringCount; s++) {
    const x = stringX(s);
    const n = stringNumber(s);
    elements.push(
      `<line class="${cls("chord-string", `chord-string-${n}`)}" x1="${fmt(x)}" y1="${fmt(
        gridOriginY,
      )}" x2="${fmt(x)}" y2="${fmt(
        gridOriginY + gridHeight,
      )}" stroke="black" stroke-width="${fmt(stringStrokeWidth(s))}" />`,
    );
  }

  // Horizontal fret lines at every row boundary, including the top of the
  // grid (the nut, or the fret just above the first one played).
  for (let r = 0; r <= visibleFrets; r++) {
    const y = gridOriginY + r * rowHeight;
    const isTop = r === 0;
    const fretClass = cls(
      "chord-fret",
      isTop && "chord-fret-top",
      isTop && layout.startFret === 0 && "chord-fret-nut",
    );
    elements.push(
      `<line class="${fretClass}" x1="${fmt(gridOriginX)}" y1="${fmt(y)}" x2="${fmt(
        gridOriginX + gridWidth,
      )}" y2="${fmt(y)}" stroke="black" stroke-width="${fmt(strokeWidth)}" />`,
    );
  }

  // Tuning labels, one per string, above the mute/open glyphs -- sitting
  // where the glyph row used to be (marginTop-relative), with glyphs pushed
  // down by tuningLabelBandHeight to make room.
  if (tuningLabels.length > 0) {
    const tuningLabelFontSize = rowHeight * 0.5;
    const tuningLabelY = marginTop - rowHeight * 0.35;
    for (const t of tuningLabels) {
      const x = stringX(t.stringIndex);
      const n = stringNumber(t.stringIndex);
      elements.push(
        `<text class="${cls(
          "chord-tuning-label",
          `chord-tuning-label-string-${n}`,
        )}" x="${fmt(x)}" y="${fmt(tuningLabelY)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(
          tuningLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
          t.label,
        )}</text>`,
      );
    }
  }

  // Mute/open glyphs, centered above the grid over their string. Mute is an
  // "x" character; open is an unfilled circle of the same height so it
  // reads distinctly from a filled fretted-note dot.
  const glyphFontSize = rowHeight * 0.5;
  const glyphY = gridOriginY - rowHeight * 0.35;
  for (const g of glyphs as GlyphPosition[]) {
    const x = stringX(g.stringIndex);
    const n = stringNumber(g.stringIndex);
    if (g.glyph === "0") {
      // A circle's stroke is centered on its path, so the rendered visual
      // diameter is (2 * radius + strokeWidth); solve for radius so that
      // visual extent matches the "x" glyph's ink height exactly.
      const openGlyphRadius = (glyphFontSize * X_GLYPH_INK_HEIGHT_RATIO - strokeWidth) / 2;
      elements.push(
        `<circle class="${cls(
          "chord-glyph",
          "chord-glyph-open",
          `chord-glyph-string-${n}`,
          g.className,
        )}" cx="${fmt(x)}" cy="${fmt(glyphY)}" r="${fmt(
          openGlyphRadius,
        )}" fill="none" stroke="black" stroke-width="${fmt(strokeWidth)}" />`,
      );
      if (g.label) {
        // fill="black", not the dot-label convention's white -- the circle
        // itself is fill="none", so white text would be invisible here.
        const openGlyphLabelFontSize = glyphFontSize * 0.55;
        elements.push(
          `<text class="${cls(
            "chord-glyph-label",
            `chord-glyph-label-string-${n}`,
            g.className,
          )}" x="${fmt(x)}" y="${fmt(glyphY)}" font-family="${escapeXml(
            fontFamily,
          )}" font-size="${fmt(
            openGlyphLabelFontSize,
          )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(g.label)}</text>`,
        );
      }
    } else {
      elements.push(
        `<text class="${cls(
          "chord-glyph",
          "chord-glyph-mute",
          `chord-glyph-string-${n}`,
        )}" x="${fmt(x)}" y="${fmt(glyphY)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(glyphFontSize)}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
          g.glyph,
        )}</text>`,
      );
    }
  }

  // Dots, centered within their row, over their string.
  const dotLabelFontSize = dotRadius * 1.1;
  for (const d of dots as DotPosition[]) {
    const cx = stringX(d.stringIndex);
    const cy = gridOriginY + d.row * rowHeight + rowHeight / 2;
    const n = stringNumber(d.stringIndex);
    elements.push(
      renderDotShape(d.shape, ["chord-dot", `chord-dot-string-${n}`, d.className], cx, cy, dotRadius),
    );
    if (d.label) {
      elements.push(
        `<text class="${cls(
          "chord-dot-label",
          `chord-dot-label-string-${n}`,
          d.className,
        )}" x="${fmt(cx)}" y="${fmt(cy)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(
          dotLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="white">${escapeXml(
          d.label,
        )}</text>`,
      );
    }
  }

  // Finger position labels, centered below the bottom-most fret line.
  // computeLayout already excludes open/muted strings from fingerLabels.
  if (fingerLabels.length > 0) {
    const fingerLabelFontSize = rowHeight * 0.5;
    const fingerLabelY = gridOriginY + gridHeight + fingerLabelBandHeight / 2;
    for (const f of fingerLabels) {
      const x = stringX(f.stringIndex);
      const n = stringNumber(f.stringIndex);
      elements.push(
        `<text class="${cls(
          "chord-finger-label",
          `chord-finger-label-string-${n}`,
        )}" x="${fmt(x)}" y="${fmt(fingerLabelY)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(
          fingerLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
          String(f.finger),
        )}</text>`,
      );
    }
  }

  // Fret-number labels, to the right of the grid's 1st, 3rd, and (when
  // shown) 5th rows -- always present, regardless of startFret.
  if (fretRowLabels.length > 0) {
    const fretLabelFontSize = rowHeight * 0.4;
    const x = gridOriginX + gridWidth + columnSpacing * 0.2 + FRET_ROW_LABEL_SHIFT;
    for (const f of fretRowLabels) {
      const y = gridOriginY + f.row * rowHeight + rowHeight / 2;
      const position = f.row + 1;
      elements.push(
        `<text class="${cls(
          "chord-fret-label",
          `chord-fret-label-${position}`,
        )}" x="${fmt(x)}" y="${fmt(y)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(
          fretLabelFontSize,
        )}" text-anchor="start" dominant-baseline="middle" fill="black">${escapeXml(
          f.label,
        )}</text>`,
      );
    }
  }

  // Fret-range brackets, left of the grid: a vertical line spanning the
  // bracket's fret rows, inset just inside the bounding fret lines (so
  // adjacent brackets in one column don't touch), end ticks pointing back
  // at the grid, label rotated to read bottom-to-top along it. Fret 0's
  // "row" is the open-glyph row above the nut.
  if (brackets.length > 0) {
    const bracketInset = rowHeight * 0.08;
    const bracketTickWidth = bracketLevelWidth * 0.25;
    const bracketLabelFontSize = columnSpacing * 0.4;
    const bracketTopY = (fret: number): number =>
      fret === 0 ? gridOriginY - rowHeight * 0.6 : gridOriginY + (fret - layout.startFret - 1) * rowHeight + bracketInset;
    const bracketBottomY = (fret: number): number =>
      gridOriginY + (fret - layout.startFret) * rowHeight - bracketInset;
    for (const b of brackets) {
      const y1 = bracketTopY(b.startFret);
      const y2 = bracketBottomY(b.endFret);
      const tickX = gridOriginX - bracketGap - b.level * bracketLevelWidth;
      const lineX = tickX - bracketTickWidth;
      elements.push(
        `<path class="${cls(
          "chord-bracket",
          `chord-bracket-level-${b.level}`,
          b.className,
        )}" d="M ${fmt(tickX)} ${fmt(y1)} L ${fmt(lineX)} ${fmt(y1)} L ${fmt(lineX)} ${fmt(y2)} L ${fmt(
          tickX,
        )} ${fmt(y2)}" fill="none" stroke="black" stroke-width="${fmt(strokeWidth)}" />`,
      );
      const labelX = lineX - bracketLabelFontSize * 0.9;
      const labelY = (y1 + y2) / 2;
      elements.push(
        `<text class="${cls(
          "chord-bracket-label",
          `chord-bracket-label-level-${b.level}`,
          b.className,
        )}" x="${fmt(labelX)}" y="${fmt(labelY)}" transform="rotate(-90 ${fmt(labelX)} ${fmt(
          labelY,
        )})" font-family="${escapeXml(fontFamily)}" font-size="${fmt(
          bracketLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(b.label)}</text>`,
      );
    }
  }

  // Chart label, above everything else, centered over the grid.
  if (chartLabel) {
    const chartLabelFontSize = rowHeight * 0.5;
    const x = gridOriginX + gridWidth / 2;
    const y = chartLabelFontSize * 0.9;
    elements.push(
      `<text class="chord-title" x="${fmt(x)}" y="${fmt(y)}" font-family="${escapeXml(
        fontFamily,
      )}" font-size="${fmt(
        chartLabelFontSize,
      )}" text-anchor="middle" dominant-baseline="middle" font-weight="bold" fill="black">${escapeXml(
        chartLabel,
      )}</text>`,
    );
  }

  // Not CDATA-wrapped, unlike styleBlock -- see SvgRenderOptions.defs' doc
  // comment for why raw markup is exactly the point here.
  const defsBlock = defs ? `<defs>${defs}</defs>` : "";
  const styleBlock = stylesheet ? `<style>${cdata(stylesheet)}</style>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" class="chord-chart" width="${fmt(
    width,
  )}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(
    height,
  )}">${defsBlock}${styleBlock}${elements.join("")}</svg>`;
}
