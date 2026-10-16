'use strict';

// ---------------------------------------------------------------------------
// Gallery examples: complete FretCharts files, shown beside their rendered
// SVG on the Gallery tab. Each is rendered live through the same /document
// route the FretCharts File tab uses, so what you see is exactly what that
// text produces -- "Open in editor" loads it into the tab matching its
// type. Every entry here is rendered by web/gallery.test.js, so a typo or
// a breaking renderer change fails the suite instead of shipping a broken
// card.
// ---------------------------------------------------------------------------

var GALLERY_EXAMPLES = [
  {
    id: 'chord-c-major',
    title: 'Open C major',
    kind: 'Chord',
    description: 'Chord notation, low E first, with finger numbers and tuning labels in the default style.',
    document: [
      'type: chord',
      'notation: x32010',
      'label: C Major',
      'root: "5"',
      'fingerPositions: x32x1x',
      'labelTuning: true'
    ].join('\n')
  },
  {
    id: 'chord-f-barre',
    title: 'F barre chord, interval labels',
    kind: 'Chord',
    description: 'Per-string labels and shapes, plus an embedded stylesheet.',
    document: [
      'type: chord',
      'notation: "133211"',
      'label: F Major',
      'root: "6,4"',
      'stringLabels: \'{"6":"R","5":"5","4":"R","3":"3","2":"5","1":"R"}\'',
      'noteShapes: \'{"3":"diamond"}\'',
      'stylesheet: |',
      '  .chord-dot { fill: #264653; }',
      '  .chord-dot-label { fill: #ffffff; font-weight: bold; }',
      '  circle.root, rect.root, polygon.root { fill: #e76f51; }',
      '  polygon.chord-dot { fill: #2a9d8f; }',
      '  .chord-title { fill: #264653; font-weight: bold; }'
    ].join('\n')
  },
  {
    id: 'chord-gradient',
    title: 'Gradient fill with SVG defs',
    kind: 'Chord',
    description: 'Raw <defs> markup, referenced from the stylesheet with url(#id).',
    document: [
      'type: chord',
      'notation: "022000"',
      'label: E Minor',
      'root: "6"',
      'defs: |',
      '  <linearGradient id="dot" x1="0" y1="0" x2="0" y2="1">',
      '    <stop offset="0" stop-color="#f2a054"/>',
      '    <stop offset="1" stop-color="#c2410c"/>',
      '  </linearGradient>',
      '  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
      '    <stop offset="0" stop-color="#fffaf2"/>',
      '    <stop offset="1" stop-color="#f3e3cc"/>',
      '  </linearGradient>',
      'stylesheet: |',
      '  .chord-chart-background { fill: url(#bg); }',
      '  .chord-dot { fill: url(#dot); }',
      '  circle.root { stroke: #7c2d12; stroke-width: 2; }',
      '  .chord-title { fill: #7c2d12; font-weight: bold; }'
    ].join('\n')
  },
  {
    id: 'scale-pentatonic',
    title: 'A minor pentatonic, box 1',
    kind: 'Scale chart',
    description: 'Compact notes notation (string:fret:label:class), one marker per line.',
    document: [
      'type: scale',
      'label: A Minor Pentatonic',
      'notes: |',
      '  6:5:R:root',
      '  6:8:b3',
      '  5:5:4',
      '  5:7:5',
      '  4:5:b7',
      '  4:7:R:root',
      '  3:5:b3',
      '  3:7:4',
      '  2:5:5',
      '  2:8:b7',
      '  1:5:R:root',
      '  1:8:b3',
      'stylesheet: |',
      '  circle.root { fill: #d62828; }',
      '  text.root { fill: #ffffff; font-weight: bold; }'
    ].join('\n')
  },
  {
    id: 'scale-g-major',
    title: 'G major scale, E shape',
    kind: 'Scale chart',
    description: 'A native YAML marker list with per-note shapes, muted strings, and a bracket naming the shape.',
    document: [
      'type: scale',
      'label: G Major, E shape',
      'notes:',
      '  - { string: 6, fret: 3, label: R, className: root }',
      '  - { string: 6, fret: 5, label: "2" }',
      '  - { string: 5, fret: 2, label: "3", shape: square }',
      '  - { string: 5, fret: 3, label: "4" }',
      '  - { string: 5, fret: 5, label: "5" }',
      '  - { string: 4, fret: 2, label: "6" }',
      '  - { string: 4, fret: 4, label: "7", shape: triangle }',
      '  - { string: 4, fret: 5, label: R, className: root }',
      'mutedStrings: "1,2,3"',
      'brackets: "2-5:E shape"',
      'stylesheet: |',
      '  circle.root { fill: #1d4ed8; }',
      '  text.root { fill: #ffffff; font-weight: bold; }'
    ].join('\n')
  },
  {
    id: 'neck-caged',
    title: 'C major across the neck, CAGED',
    kind: 'Neck diagram',
    description: 'Every root of C from the nut to the 12th fret, with stacked CAGED brackets.',
    document: [
      'type: neck',
      'label: C Major Roots (CAGED)',
      'notes: "5:3:R:root;2:1:R:root;4:10:R:root;3:5:R:root;6:8:R:root;1:8:R:root;5:15:R:root;2:13:R:root"',
      'firstFret: 0',
      'lastFret: 15',
      'brackets: |',
      '  0-3:C shape',
      '  2-5:A shape',
      '  5-8:G shape',
      '  7-10:E shape',
      '  10-13:D shape',
      '  12-15:C shape',
      'stylesheet: |',
      '  circle.root { fill: #d62828; }',
      '  text.root { fill: #ffffff; font-weight: bold; }'
    ].join('\n')
  },
  {
    id: 'neck-dark',
    title: 'Blues scale, dark theme',
    kind: 'Neck diagram',
    description: 'An offset fret range with pitch labels, shapes for the blue notes, and a full theme.',
    document: [
      'type: neck',
      'label: E Blues Scale',
      'notes: |',
      '  6:12:R:root',
      '  6:15:b3',
      '  5:12:4',
      '  5:13:b5:blue::diamond',
      '  5:14:5',
      '  4:12:b7',
      '  4:14:R:root',
      '  3:12:b3',
      '  3:14:4',
      '  3:15:b5:blue::diamond',
      '  2:12:5',
      '  2:15:b7',
      '  1:12:R:root',
      '  1:15:b3',
      'firstFret: 10',
      'lastFret: 17',
      'labelTuning: true',
      'stylesheet: |',
      '  .chord-chart-background { fill: #1c1c21; }',
      '  .chord-fret-marker { fill: #3a3a42; }',
      '  .chord-string, .chord-fret { stroke: #d8d8dc; }',
      '  .chord-dot { fill: #ef8a3d; }',
      '  .chord-dot-label { fill: #1c1c21; font-weight: bold; }',
      '  .chord-tuning-label, .chord-neck-fret-label { fill: #9a9aa2; }',
      '  .chord-title { fill: #f2f2f4; font-weight: bold; }',
      '  circle.root { fill: #ef4d4d; }',
      '  polygon.blue { fill: #60a5fa; }'
    ].join('\n')
  },
  {
    id: 'chords-open',
    title: 'Open chord sheet',
    kind: 'Chord grid',
    description: 'An inline CSV, one chord per row, laid out in a grid with shared defaults.',
    document: [
      'type: chords',
      'collectionLabel: Open Chords',
      'columns: 4',
      'defaults:',
      '  labelTuning: false',
      'csv: |',
      '  notes,label,root,finger-positions',
      '  x32010,C,5,x32x1x',
      '  x02220,A,5,xx123x',
      '  320003,G,6,21xxx3',
      '  022100,E,6,x231xx',
      '  xx0232,D,4,xxx132',
      '  x02210,Am,5,xx231x',
      '  022000,Em,6,x23xxx',
      '  xx0231,Dm,4,xxx231',
      'stylesheet: |',
      '  circle.root { fill: #d62828; }',
      '  .chord-collection-label { font-weight: bold; }'
    ].join('\n')
  },
  {
    id: 'chords-jazz',
    title: 'ii–V–I shell voicings',
    kind: 'Chord grid',
    description: 'Shell voicings with interval labels per row, written in C and transposed up a whole step to D at render time.',
    document: [
      'type: chords',
      'collectionLabel: ii–V–I (in D, via transpose)',
      'columns: 3',
      'transpose: 2',
      'csv: |',
      '  notes,label,root,string-labels',
      '  x3x33x,Dm7,5,"{""5"":""R"",""3"":""b7"",""2"":""b3""}"',
      '  3x343x,G7,6,"{""6"":""R"",""4"":""b7"",""3"":""3""}"',
      '  x3x45x,Cmaj7,5,"{""5"":""R"",""3"":""7"",""2"":""3""}"',
      'stylesheet: |',
      '  .chord-chart-background, .chord-collection-background { fill: #fffbea; }',
      '  .chord-fret-marker { fill: #ffd166; }',
      '  .chord-dot { fill: #577590; }',
      '  .chord-dot-label { fill: #ffffff; font-weight: bold; }',
      '  circle.root { fill: #e63946; }',
      '  .chord-title, .chord-collection-label { fill: #d62828; font-weight: bold; }'
    ].join('\n')
  }
];
