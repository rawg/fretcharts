/**
 * Renders a {@link NeckLayout} to a self-contained SVG string: a wide,
 * horizontal (nut-left, bridge-right) fretboard view over an explicit
 * fret range, as opposed to render/svg.ts's compact auto-fit vertical
 * grid. Same visual vocabulary as that renderer, axis-swapped -- frets
 * are now vertical lines spread left-to-right, strings are horizontal
 * lines stacked top-to-bottom (string 6/low-E on the bottom, string 1/
 * high-E on top -- matching standard tab notation, where the low-E line is
 * the bottom line of the staff and the high-E line is the top).
 *
 * Geometry summary (see src/types.ts for the frozen NeckLayout contract):
 *  - A full-canvas background rect sits behind everything, transparent by
 *    default, classed for stylesheet overrides -- same convention as
 *    render/svg.ts's chord-chart-background.
 *  - A second rect, the neck (`chord-neck`, same class as render/svg.ts's
 *    -- one stylesheet can restyle both diagram types' fretboard fill
 *    consistently), covers just the drawn fret range.
 *  - The first drawn fret LINE is not always `firstFret` itself: when
 *    `firstFret > 0`, there's one extra line before it (at
 *    `firstFret - 1`) so a marker exactly at `firstFret` still has a
 *    drawn cell to its left to be centered against -- exactly mirroring
 *    how the vertical grid's top line stands for the nut or "the fret
 *    just above the first one played." That line only gets the
 *    `chord-fret-nut` class when `firstFret === 0` (i.e. it really is
 *    the nut, not just an arbitrary boundary).
 *  - Neck-inlay-style fret position markers sit behind everything except
 *    the background/neck, at every SINGLE_FRET_MARKERS/DOUBLE_FRET_MARKERS
 *    fret within [firstFret, lastFret], regardless of whether fret-number
 *    labels are shown -- inlay dots are physically always on the neck.
 *  - Mute/open glyphs sit at the neck's left edge, one per string,
 *    unconditionally (muting isn't a fret-range concept; an open marker
 *    only ever exists when firstFret === 0, since fret 0 would otherwise
 *    be out of the shown window -- see computeNeckLayout).
 *  - Dots sit centered in their fret's column, on their string's line.
 *  - Finger labels are NOT a single shared band (unlike render/svg.ts) --
 *    each sits at a small offset from its own dot, since a wide neck
 *    diagram routinely has multiple dots per string at different frets,
 *    which would otherwise collide at one shared position.
 *  - Fret-number labels sit in a band above the neck, over string 1/
 *    high-E, at the standard inlay frets within [firstFret, lastFret] plus
 *    firstFret itself -- own class family (`chord-neck-fret-label`,
 *    `-<fret>` keyed by actual fret number), deliberately distinct from
 *    render/svg.ts's `chord-fret-label` (whose `-N` suffix already means
 *    grid row-position 1/3/5 there, not an absolute fret number). Optional
 *    (`labelFrets: false` omits them), default on.
 *  - Optional fret-range brackets sit in a band below the neck, past the
 *    bottom string's dots/finger labels: a horizontal line spanning the
 *    bracket's fret columns, inset just inside the bounding fret lines,
 *    with end ticks pointing back up at the neck and its label centered
 *    beneath. Overlapping brackets stack one row further from the neck
 *    per `level` (see stackBrackets in layout.ts). A bracket at fret 0
 *    starts under the open-string glyphs, left of the nut.
 *  - An optional per-chart label sits above everything else.
 *  - Optional tuning labels sit left of the glyphs, one per string.
 *
 * Outer element is `class="neck-diagram"`, not `chord-chart` -- lets a
 * stylesheet target neck diagrams specifically, while every inner element
 * reuses render/svg.ts's semantic class names wherever the role matches
 * exactly (chord-string, chord-fret, chord-dot, chord-glyph, etc.) so one
 * stylesheet restyles both diagram types consistently -- CSS doesn't care
 * that a "string" line is now horizontal instead of vertical.
 */

import type { NeckLayout } from "../types";
import { cdata, cls, escapeXml, fmt, renderDotShape, X_GLYPH_INK_HEIGHT_RATIO } from "./svg";

export interface NeckSvgRenderOptions {
  /** px between adjacent fret lines (horizontal spacing). Default 44. */
  fretSpacing?: number;
  /** px between adjacent string lines (vertical spacing). Default 34. */
  stringSpacing?: number;
  /** px radius of a fretted-note dot. Default 11.5. */
  dotRadius?: number;
  /** px radius of a fret position marker (neck inlay dot). Default 7. */
  fretMarkerRadius?: number;
  /** px of space above the neck, for the chart title. Default 40. */
  marginTop?: number;
  /** px of space to the left of the neck, for glyphs (and tuning labels, if any). Default 30. */
  marginLeft?: number;
  /** px of space to the right of the neck's last fret line. Default 20. */
  marginRight?: number;
  /** px of baseline space below the neck (covers finger-label overflow past the bottom string). Default 20. Grows to fit brackets, if any. */
  marginBottom?: number;
  /** px between the bottom string and the first row of brackets. Default 18. */
  bracketGap?: number;
  /** px of vertical space per stacked row of brackets (tick + label). Default 30. */
  bracketLevelHeight?: number;
  /** px stroke width for fret lines and glyph outlines. Default 2. */
  strokeWidth?: number;
  /** px stroke width of the bottom (6th/low-E) string line. Default 3. */
  stringStrokeWidthMax?: number;
  /** px stroke width of the top (1st/high-E) string line. Default 1. */
  stringStrokeWidthMin?: number;
  /** CSS font-family stack used for all text. */
  fontFamily?: string;
  /** Raw CSS embedded into the SVG as a `<style>` element -- same mechanism/precedence as render/svg.ts's SvgRenderOptions.stylesheet. */
  stylesheet?: string;
  /** Raw SVG markup embedded into the SVG as a `<defs>` element -- same mechanism as render/svg.ts's SvgRenderOptions.defs (see its doc comment). */
  defs?: string;
}

interface ResolvedOptions {
  fretSpacing: number;
  stringSpacing: number;
  dotRadius: number;
  fretMarkerRadius: number;
  marginTop: number;
  marginLeft: number;
  marginRight: number;
  marginBottom: number;
  bracketGap: number;
  bracketLevelHeight: number;
  strokeWidth: number;
  stringStrokeWidthMax: number;
  stringStrokeWidthMin: number;
  fontFamily: string;
  stylesheet?: string;
  defs?: string;
}

const DEFAULTS: ResolvedOptions = {
  fretSpacing: 44,
  stringSpacing: 34,
  dotRadius: 11.5,
  fretMarkerRadius: 7,
  marginTop: 40,
  marginLeft: 30,
  marginRight: 20,
  marginBottom: 20,
  bracketGap: 18,
  bracketLevelHeight: 30,
  strokeWidth: 2,
  stringStrokeWidthMax: 3,
  stringStrokeWidthMin: 1,
  fontFamily: "Arial, Helvetica, sans-serif",
};

export function renderNeckSvg(layout: NeckLayout, options?: NeckSvgRenderOptions): string {
  const opts: ResolvedOptions = { ...DEFAULTS, ...options };
  const {
    fretSpacing,
    stringSpacing,
    dotRadius,
    fretMarkerRadius,
    marginTop,
    marginLeft,
    marginRight,
    marginBottom,
    bracketGap,
    bracketLevelHeight,
    strokeWidth,
    stringStrokeWidthMax,
    stringStrokeWidthMin,
    fontFamily,
    stylesheet,
    defs,
  } = opts;

  const {
    stringCount,
    firstFret,
    lastFret,
    dots,
    glyphs,
    fingerLabels,
    tuningLabels,
    fretMarkers,
    fretNumberLabels,
    brackets,
    chartLabel,
  } = layout;

  // The first drawn line is not always firstFret itself -- see this
  // module's doc comment above for why.
  const leftBoundaryFret = firstFret === 0 ? 0 : firstFret - 1;

  const tuningLabelBandWidth = tuningLabels.length > 0 ? fretSpacing * 0.6 : 0;
  const neckOriginX = marginLeft + tuningLabelBandWidth;
  // Fret-number labels (when present) sit in a band directly above string
  // 1/high-E, so they push the neck itself (and everything anchored to
  // neckOriginY -- fret lines, glyphs, tuning labels, dots) down to make
  // room -- unlike the chart label, which is positioned independently near
  // the very top of the canvas regardless of neckOriginY, so it never
  // collides with this band.
  // The band is tall enough that a label clears a dot on string 1 at its
  // own fret: the dot reaches dotRadius above the string, and the label
  // sits a small gap above that.
  const fretNumberLabelFontSize = fretSpacing * 0.4;
  const fretNumberLabelGap = 3;
  const fretNumberBandHeight =
    fretNumberLabels.length > 0 ? dotRadius + fretNumberLabelGap + fretNumberLabelFontSize : 0;
  const neckOriginY = marginTop + fretNumberBandHeight;
  const neckWidth = (lastFret - leftBoundaryFret) * fretSpacing;
  const neckHeight = (stringCount - 1) * stringSpacing;

  const neckBottomY = neckOriginY + neckHeight;
  const bracketLevels = brackets.reduce((max, b) => Math.max(max, b.level + 1), 0);
  const bracketBandHeight = bracketLevels > 0 ? bracketGap + bracketLevels * bracketLevelHeight : 0;

  const width = neckOriginX + neckWidth + marginRight;
  const height = neckBottomY + Math.max(marginBottom, bracketBandHeight);

  /** X of the vertical line drawn at a given absolute fret. */
  const fretX = (fret: number): number => neckOriginX + (fret - leftBoundaryFret) * fretSpacing;
  /** X centered within a given fret's column (where its dot/marker sits). */
  const fretCenterX = (fret: number): number => neckOriginX + (fret - leftBoundaryFret - 0.5) * fretSpacing;
  // Y of a given string's horizontal line. stringIndex 0 = string 6/low-E;
  // rows are drawn bottom-to-top by index (index 0 lowest on the canvas,
  // increasing index moving up) so string 6 ends up on the bottom row and
  // string 1 (index stringCount-1) on top, matching standard tab notation.
  const stringY = (stringIndex: number): number => neckOriginY + (stringCount - 1 - stringIndex) * stringSpacing;

  // Guitar string NUMBER (6=low E/bottom .. 1=high E/top), for per-string
  // CSS classes -- the array index alone isn't meaningful to a stylesheet
  // author. Same convention/formula as render/svg.ts.
  const stringNumber = (stringIndex: number): number => stringCount - stringIndex;

  // String thickness tapers from thickest for the low-E (string 6, index 0,
  // drawn on the bottom row) to thinnest for the high-E (string 1, drawn on
  // top), mirroring real string gauge -- keyed by array index/string
  // identity (same formula as render/svg.ts), independent of stringY's
  // separate top/bottom row placement above.
  const stringStrokeWidth = (stringIndex: number): number => {
    if (stringCount <= 1) return stringStrokeWidthMax;
    const t = stringIndex / (stringCount - 1);
    return stringStrokeWidthMax - t * (stringStrokeWidthMax - stringStrokeWidthMin);
  };

  const elements: string[] = [];

  // Background, covering the full canvas -- same convention as render/svg.ts.
  elements.push(
    `<rect class="chord-chart-background" x="0" y="0" width="${fmt(width)}" height="${fmt(
      height,
    )}" fill="none" />`,
  );

  // The neck: just the drawn fret range, same chord-neck class as
  // render/svg.ts so one stylesheet restyles both diagram types' fretboard
  // fill consistently.
  elements.push(
    `<rect class="chord-neck" x="${fmt(fretX(leftBoundaryFret))}" y="${fmt(neckOriginY)}" width="${fmt(
      neckWidth,
    )}" height="${fmt(neckHeight)}" fill="none" />`,
  );

  // Fret position markers (neck inlay dots), behind everything except the
  // background/neck. Not tied to any single string, so no per-string class.
  for (const m of fretMarkers) {
    const x = fretCenterX(m.fret);
    const y = neckOriginY + (stringCount - 1 - m.betweenIndex) * stringSpacing;
    elements.push(
      `<circle class="${cls(
        "chord-fret-marker",
        `chord-fret-marker-${m.kind}`,
      )}" cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(fretMarkerRadius)}" fill="lightgrey" />`,
    );
  }

  // Horizontal string lines.
  for (let s = 0; s < stringCount; s++) {
    const y = stringY(s);
    const n = stringNumber(s);
    elements.push(
      `<line class="${cls("chord-string", `chord-string-${n}`)}" x1="${fmt(fretX(leftBoundaryFret))}" y1="${fmt(
        y,
      )}" x2="${fmt(fretX(lastFret))}" y2="${fmt(
        y,
      )}" stroke="black" stroke-width="${fmt(stringStrokeWidth(s))}" />`,
    );
  }

  // Vertical fret lines, at every integer fret from leftBoundaryFret to
  // lastFret inclusive. chord-fret-nut only when this really is the nut
  // (firstFret === 0), not just an arbitrary left boundary.
  for (let fret = leftBoundaryFret; fret <= lastFret; fret++) {
    const x = fretX(fret);
    const isFirstLine = fret === leftBoundaryFret;
    const fretClass = cls("chord-fret", isFirstLine && firstFret === 0 && "chord-fret-nut");
    elements.push(
      `<line class="${fretClass}" x1="${fmt(x)}" y1="${fmt(neckOriginY)}" x2="${fmt(x)}" y2="${fmt(
        neckOriginY + neckHeight,
      )}" stroke="black" stroke-width="${fmt(strokeWidth)}" />`,
    );
  }

  // Tuning labels, one per string, left of the glyphs.
  if (tuningLabels.length > 0) {
    const tuningLabelFontSize = stringSpacing * 0.5;
    const tuningLabelX = marginLeft - fretSpacing * 0.35;
    for (const t of tuningLabels) {
      const y = stringY(t.stringIndex);
      const n = stringNumber(t.stringIndex);
      elements.push(
        `<text class="${cls(
          "chord-tuning-label",
          `chord-tuning-label-string-${n}`,
        )}" x="${fmt(tuningLabelX)}" y="${fmt(y)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(
          tuningLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
          t.label,
        )}</text>`,
      );
    }
  }

  // Mute/open glyphs, at the neck's left edge, over their string's line.
  const glyphFontSize = stringSpacing * 0.5;
  const glyphX = neckOriginX - fretSpacing * 0.35;
  for (const g of glyphs) {
    const y = stringY(g.stringIndex);
    const n = stringNumber(g.stringIndex);
    if (g.glyph === "0") {
      const openGlyphRadius = (glyphFontSize * X_GLYPH_INK_HEIGHT_RATIO - strokeWidth) / 2;
      elements.push(
        `<circle class="${cls(
          "chord-glyph",
          "chord-glyph-open",
          `chord-glyph-string-${n}`,
          g.className,
        )}" cx="${fmt(glyphX)}" cy="${fmt(y)}" r="${fmt(
          openGlyphRadius,
        )}" fill="none" stroke="black" stroke-width="${fmt(strokeWidth)}" />`,
      );
      if (g.label) {
        const openGlyphLabelFontSize = glyphFontSize * 0.55;
        elements.push(
          `<text class="${cls(
            "chord-glyph-label",
            `chord-glyph-label-string-${n}`,
            g.className,
          )}" x="${fmt(glyphX)}" y="${fmt(y)}" font-family="${escapeXml(
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
        )}" x="${fmt(glyphX)}" y="${fmt(y)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(glyphFontSize)}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
          g.glyph,
        )}</text>`,
      );
    }
  }

  // Dots, centered in their fret's column, over their string's line.
  const dotLabelFontSize = dotRadius * 1.1;
  for (const d of dots) {
    const cx = fretCenterX(d.fret);
    const cy = stringY(d.stringIndex);
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

  // Finger labels: NOT a shared band (unlike render/svg.ts) -- a wide neck
  // diagram routinely has multiple dots per string at different frets,
  // which would collide at one shared position. Each sits at a small
  // diagonal offset from its own dot instead.
  if (fingerLabels.length > 0) {
    const fingerLabelFontSize = dotRadius;
    for (const f of fingerLabels) {
      const x = fretCenterX(f.fret) + dotRadius * 0.9;
      const y = stringY(f.stringIndex) + dotRadius * 0.9;
      const n = stringNumber(f.stringIndex);
      elements.push(
        `<text class="${cls(
          "chord-finger-label",
          `chord-finger-label-string-${n}`,
        )}" x="${fmt(x)}" y="${fmt(y)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(
          fingerLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
          String(f.finger),
        )}</text>`,
      );
    }
  }

  // Fret-number labels, centered above their fret's column, in a band
  // directly above string 1/high-E -- own class family, distinct from
  // render/svg.ts's chord-fret-label (whose -N suffix means grid
  // row-position there, not an absolute fret number).
  if (fretNumberLabels.length > 0) {
    const y = neckOriginY - dotRadius - fretNumberLabelGap - fretNumberLabelFontSize / 2;
    for (const f of fretNumberLabels) {
      const x = fretCenterX(f.fret);
      elements.push(
        `<text class="${cls(
          "chord-neck-fret-label",
          `chord-neck-fret-label-${f.fret}`,
        )}" x="${fmt(x)}" y="${fmt(y)}" font-family="${escapeXml(
          fontFamily,
        )}" font-size="${fmt(
          fretNumberLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(
          String(f.fret),
        )}</text>`,
      );
    }
  }

  // Fret-range brackets, below the neck: a line spanning the bracket's
  // fret columns, inset just inside the bounding fret lines (so adjacent
  // brackets on one row don't touch), with end ticks pointing back up at
  // the neck and the label centered beneath. Fret 0's "column" is the
  // open-glyph area left of the nut.
  if (brackets.length > 0) {
    const bracketInset = fretSpacing * 0.08;
    const bracketTickHeight = bracketLevelHeight * 0.25;
    const bracketLabelFontSize = stringSpacing * 0.4;
    const bracketLeftX = (fret: number): number =>
      fret === 0 ? neckOriginX - fretSpacing * 0.6 : fretX(fret - 1) + bracketInset;
    for (const b of brackets) {
      const x1 = bracketLeftX(b.startFret);
      const x2 = fretX(b.endFret) - bracketInset;
      const tickTopY = neckBottomY + bracketGap + b.level * bracketLevelHeight;
      const lineY = tickTopY + bracketTickHeight;
      elements.push(
        `<path class="${cls(
          "chord-bracket",
          `chord-bracket-level-${b.level}`,
          b.className,
        )}" d="M ${fmt(x1)} ${fmt(tickTopY)} L ${fmt(x1)} ${fmt(lineY)} L ${fmt(x2)} ${fmt(lineY)} L ${fmt(
          x2,
        )} ${fmt(tickTopY)}" fill="none" stroke="black" stroke-width="${fmt(strokeWidth)}" />`,
      );
      elements.push(
        `<text class="${cls(
          "chord-bracket-label",
          `chord-bracket-label-level-${b.level}`,
          b.className,
        )}" x="${fmt((x1 + x2) / 2)}" y="${fmt(
          lineY + bracketLabelFontSize * 0.9,
        )}" font-family="${escapeXml(fontFamily)}" font-size="${fmt(
          bracketLabelFontSize,
        )}" text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(b.label)}</text>`,
      );
    }
  }

  // Chart label, above everything else, centered over the neck.
  if (chartLabel) {
    const chartLabelFontSize = stringSpacing * 0.5;
    const x = neckOriginX + neckWidth / 2;
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

  // Not CDATA-wrapped -- see SvgRenderOptions.defs' doc comment (src/render/svg.ts).
  const defsBlock = defs ? `<defs>${defs}</defs>` : "";
  const styleBlock = stylesheet ? `<style>${cdata(stylesheet)}</style>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" class="neck-diagram" width="${fmt(
    width,
  )}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(
    height,
  )}">${defsBlock}${styleBlock}${elements.join("")}</svg>`;
}
