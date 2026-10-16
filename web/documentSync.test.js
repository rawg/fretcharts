import { describe, it, expect } from 'vitest';
import DocumentSync from './documentSync.js';

describe('DocumentSync.stringify', () => {
  it('serializes a type: chord document with only the fields that are set', () => {
    const text = DocumentSync.stringify('chord', { notation: 'x02220', label: 'A Major', root: '5' });
    // "A Major" needs no quoting -- an internal space has no special
    // meaning in a plain YAML scalar outside flow context (verified
    // against the real `yaml` package). "5" does need quoting: unquoted,
    // it would parse back as the number 5, not the string "5".
    expect(text).toBe('type: chord\nnotation: x02220\nlabel: A Major\nroot: "5"\n');
  });

  it('quotes a numeric-looking string (root) so it round-trips as a string, not a YAML integer', () => {
    const text = DocumentSync.stringify('chord', { notation: 'x02220', root: '5' });
    expect(text).toContain('root: "5"\n');
  });

  it('quotes a JSON-blob field so it is not misread as a YAML flow mapping', () => {
    const text = DocumentSync.stringify('chord', { notation: 'x02220', stringLabels: '{"3":"b3"}' });
    expect(text).toContain('stringLabels: "{\\"3\\":\\"b3\\"}"\n');
  });

  it('emits a block scalar for a multi-line stylesheet', () => {
    const text = DocumentSync.stringify('chord', {
      notation: 'x02220',
      stylesheet: '.chord-dot { fill: red; }\n.chord-title { fill: blue; }',
    });
    expect(text).toContain('stylesheet: |\n  .chord-dot { fill: red; }\n  .chord-title { fill: blue; }\n');
  });

  it('emits and round-trips a defs field (single-line and multi-line)', () => {
    const text = DocumentSync.stringify('chord', {
      notation: 'x02220',
      defs: '<linearGradient id="g" />',
    });
    // Quoted (with internal quotes escaped) because the raw SVG markup
    // contains a literal double quote, same as any other scalar field.
    expect(text).toContain('defs: "<linearGradient id=\\"g\\" />"\n');
    expect(DocumentSync.parse(text).fields.defs).toBe('<linearGradient id="g" />');

    const multiLine = DocumentSync.stringify('neck', {
      notes: '6:3',
      defs: '<linearGradient id="g">\n<stop offset="0%" />\n</linearGradient>',
    });
    expect(multiLine).toContain('defs: |\n');
    expect(DocumentSync.parse(multiLine).fields.defs).toBe(
      '<linearGradient id="g">\n<stop offset="0%" />\n</linearGradient>\n',
    );
  });

  it('omits false booleans and undefined/empty fields entirely', () => {
    const text = DocumentSync.stringify('chord', { notation: 'x02220', labelPitches: false, label: '' });
    expect(text).toBe('type: chord\nnotation: x02220\n');
  });

  it('emits true booleans bare', () => {
    const text = DocumentSync.stringify('chord', { notation: 'x02220', labelPitches: true, labelTuning: true });
    expect(text).toContain('labelPitches: true\n');
    expect(text).toContain('labelTuning: true\n');
  });

  it('serializes a type: scale document with a native marker list', () => {
    const text = DocumentSync.stringify('scale', {
      label: 'Minor Pentatonic Box',
      notes: [
        { string: 6, fret: 3, label: 'R', className: 'root' },
        { string: 6, fret: 5, label: '2' },
      ],
      mutedStrings: '1,2',
    });
    expect(text).toBe(
      'type: scale\n' +
        'notes:\n' +
        '  - { string: 6, fret: 3, label: R, className: root }\n' +
        '  - { string: 6, fret: 5, label: "2" }\n' +
        'label: Minor Pentatonic Box\n' +
        'mutedStrings: 1,2\n',
    );
  });

  it('quotes a className containing a comma in the native marker list, since a bare comma there would be misread as ending the field early', () => {
    const notes = [{ string: 6, fret: 3, className: 'root,shapeG' }];
    const text = DocumentSync.stringify('scale', { notes: notes });
    expect(text).toBe('type: scale\nnotes:\n  - { string: 6, fret: 3, className: "root,shapeG" }\n');
    // The real bug report: an unquoted comma splits the flow mapping into
    // a bogus extra field with no ":", which used to throw ParseError.
    expect(DocumentSync.parse(text).fields.notes).toEqual(notes);
  });

  it('quotes a label/shape containing a comma or brace in the native marker list', () => {
    const notes = [
      { string: 6, fret: 3, label: 'a, b' },
      { string: 5, fret: 2, shape: 'weird}shape' },
    ];
    const text = DocumentSync.stringify('scale', { notes: notes });
    expect(text).toContain('label: "a, b"');
    expect(text).toContain('shape: "weird}shape"');
    expect(DocumentSync.parse(text).fields.notes).toEqual(notes);
  });

  it('serializes a marker\'s shape in the native marker list', () => {
    const text = DocumentSync.stringify('scale', {
      notes: [{ string: 6, fret: 3, label: 'R', shape: 'square' }],
    });
    expect(text).toBe('type: scale\nnotes:\n  - { string: 6, fret: 3, label: R, shape: square }\n');
  });

  it('with options.compactNotes, emits shape as the 6th field', () => {
    const notes = [{ string: 6, fret: 3, label: 'R', className: 'root', finger: 2, shape: 'square' }];
    const text = DocumentSync.stringify('scale', { notes: notes }, { compactNotes: true });
    expect(text).toBe('type: scale\nnotes: 6:3:R:root:2:square\n');
    expect(DocumentSync.parse(text).fields.notes).toEqual(notes);
  });

  it('serializes labelPitches for type: scale and type: neck documents', () => {
    expect(DocumentSync.stringify('scale', { notes: '6:3', labelPitches: true })).toBe(
      'type: scale\nnotes: 6:3\nlabelPitches: true\n',
    );
    expect(DocumentSync.stringify('neck', { notes: '6:3', labelPitches: true })).toBe(
      'type: neck\nnotes: 6:3\nlabelPitches: true\n',
    );
  });

  it('writes labelFrets: false explicitly for type: scale/neck (unlike every other boolean, its default is true, so omitting would silently mean "on")', () => {
    expect(DocumentSync.stringify('scale', { notes: '6:3', labelFrets: false })).toBe(
      'type: scale\nnotes: 6:3\nlabelFrets: false\n',
    );
    expect(DocumentSync.stringify('neck', { notes: '6:3', labelFrets: false })).toBe(
      'type: neck\nnotes: 6:3\nlabelFrets: false\n',
    );
  });

  it('writes labelFrets: true explicitly when set, and omits it entirely when undefined', () => {
    expect(DocumentSync.stringify('scale', { notes: '6:3', labelFrets: true })).toContain('labelFrets: true');
    expect(DocumentSync.stringify('scale', { notes: '6:3' })).not.toContain('labelFrets');
  });

  it('round-trips labelFrets: false through stringify then parse', () => {
    const text = DocumentSync.stringify('neck', { notes: '6:3', labelFrets: false });
    expect(DocumentSync.parse(text).fields.labelFrets).toBe(false);
  });

  it('with options.compactNotes, emits a marker array as compact-notation text, one marker per line, instead of a native list', () => {
    const text = DocumentSync.stringify(
      'scale',
      {
        label: 'Minor Pentatonic Box',
        notes: [
          { string: 6, fret: 3, label: 'R', className: 'root' },
          { string: 6, fret: 5, label: '2' },
          { string: 5, fret: 3 },
        ],
      },
      { compactNotes: true },
    );
    expect(text).toBe(
      'type: scale\nnotes: |\n  6:3:R:root\n  6:5:2\n  5:3\nlabel: Minor Pentatonic Box\n',
    );
  });

  it('a single marker with options.compactNotes degrades to one plain scalar line, not a block scalar', () => {
    const text = DocumentSync.stringify('scale', { notes: [{ string: 6, fret: 3, label: 'R' }] }, { compactNotes: true });
    expect(text).toBe('type: scale\nnotes: 6:3:R\n');
  });

  it('with options.compactNotes, a marker needing a later field but not an earlier one keeps empty placeholders for position (finger is the 5th colon-separated field)', () => {
    const notes = [{ string: 6, fret: 3, className: 'root' }, { string: 5, fret: 2, finger: 1 }];
    const text = DocumentSync.stringify('neck', { notes: notes }, { compactNotes: true });
    expect(text).toContain('notes: |\n  6:3::root\n  5:2:::1\n');
    expect(DocumentSync.parse(text).fields.notes).toEqual(notes);
  });

  it('options.compactNotes round-trips through parse to the same marker objects as the native list form', () => {
    const notes = [
      { string: 6, fret: 3, label: 'R', className: 'root' },
      { string: 5, fret: 2, label: 'b3' },
    ];
    const compactText = DocumentSync.stringify('scale', { notes: notes }, { compactNotes: true });
    const nativeText = DocumentSync.stringify('scale', { notes: notes });
    expect(DocumentSync.parse(compactText).fields.notes).toEqual(DocumentSync.parse(nativeText).fields.notes);
  });

  it('options.compactNotes has no effect on a notes value that is already a compact-notation string', () => {
    const text = DocumentSync.stringify('scale', { notes: '6:3:R' }, { compactNotes: true });
    expect(text).toContain('notes: 6:3:R\n');
  });

  it('parses a hand-written multi-line compact notes block scalar, one marker per line', () => {
    const text = 'type: scale\nnotes: |\n  6:3:R:root\n  6:5:2\n  5:2:b3\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.fields.notes).toEqual([
      { string: 6, fret: 3, label: 'R', className: 'root' },
      { string: 6, fret: 5, label: '2' },
      { string: 5, fret: 2, label: 'b3' },
    ]);
  });

  it('parses a compact notes block scalar mixing ";" and newline separators identically', () => {
    const text = 'type: scale\nnotes: |\n  6:3:R;6:5:2\n  5:2:b3\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.fields.notes).toEqual([
      { string: 6, fret: 3, label: 'R' },
      { string: 6, fret: 5, label: '2' },
      { string: 5, fret: 2, label: 'b3' },
    ]);
  });

  it('serializes a type: neck document including firstFret/lastFret', () => {
    const text = DocumentSync.stringify('neck', {
      notes: [{ string: 6, fret: 7, label: 'R' }],
      firstFret: 5,
      lastFret: 17,
      label: 'Root-5 shape',
    });
    expect(text).toContain('firstFret: 5\n');
    expect(text).toContain('lastFret: 17\n');
    expect(text).toContain('- { string: 6, fret: 7, label: R }\n');
  });

  it('serializes a type: chords document with defaults and inline csv', () => {
    const text = DocumentSync.stringify('chords', {
      collectionLabel: 'Open Chords',
      columns: 4,
      defaults: { root: '5', tuning: 'DADGBE' },
      csv: 'notes,label\nx02220,A\n320003,G\n',
    });
    expect(text).toBe(
      'type: chords\n' +
        'collectionLabel: Open Chords\n' +
        'columns: 4\n' +
        'defaults:\n' +
        '  root: "5"\n' +
        '  tuning: DADGBE\n' +
        'csv: |\n' +
        '  notes,label\n' +
        '  x02220,A\n' +
        '  320003,G\n',
    );
  });

  it('serializes and round-trips a type: chords document\'s transpose field', () => {
    const text = DocumentSync.stringify('chords', {
      csv: 'notes\nx02220\n',
      transpose: 2,
    });
    expect(text).toContain('transpose: 2\n');
    expect(DocumentSync.parse(text).fields.transpose).toBe(2);
  });

  it('serializes and round-trips a type: chord document\'s transpose field, including 0', () => {
    const text = DocumentSync.stringify('chord', { notation: 'x02220', transpose: 0 });
    expect(text).toContain('transpose: 0\n');
    expect(DocumentSync.parse(text).fields.transpose).toBe(0);
  });

  it('throws for an unknown type', () => {
    expect(() => DocumentSync.stringify('banana', {})).toThrow(DocumentSync.ParseError);
  });
});

describe('DocumentSync.parse', () => {
  it('round-trips a type: chord document through stringify then parse', () => {
    const fields = {
      notation: 'x02220',
      label: 'A Major',
      root: '5',
      tuning: 'EADGBE',
      stringLabels: '{"6":"R"}',
      labelPitches: true,
      // Block scalars always normalize to exactly one trailing newline on
      // the way back out (YAML's "clip" chomping, same as the real `yaml`
      // package's default) -- harmless for CSS/CSV text, so the input
      // here already has one for a byte-exact round-trip assertion below.
      stylesheet: 'circle.root { fill: #d62828; }\n.chord-title { fill: #457b9d; }\n',
    };
    const parsed = DocumentSync.parse(DocumentSync.stringify('chord', fields));
    expect(parsed.type).toBe('chord');
    expect(parsed.fields).toEqual(fields);
  });

  it('round-trips a type: scale document (native marker list) through stringify then parse', () => {
    const fields = {
      label: 'Minor Pentatonic Box (partial)',
      notes: [
        { string: 6, fret: 3, label: 'R', className: 'root' },
        { string: 6, fret: 5, label: '2' },
        { string: 5, fret: 2, label: 'b3' },
      ],
      mutedStrings: '1,2',
    };
    const parsed = DocumentSync.parse(DocumentSync.stringify('scale', fields));
    expect(parsed.type).toBe('scale');
    expect(parsed.fields).toEqual(fields);
  });

  it('round-trips a type: neck document through stringify then parse', () => {
    const fields = {
      notes: [{ string: 6, fret: 7, label: 'R' }, { string: 5, fret: 7, label: '5' }],
      firstFret: 5,
      lastFret: 17,
      label: 'Root-5 shape',
      tuning: 'DADGBE',
    };
    const parsed = DocumentSync.parse(DocumentSync.stringify('neck', fields));
    expect(parsed.type).toBe('neck');
    expect(parsed.fields).toEqual(fields);
  });

  it("round-trips a marker's shape through stringify then parse, native list and compact notation alike", () => {
    const fields = { notes: [{ string: 6, fret: 3, label: 'R', shape: 'triangle' }] };
    const nativeParsed = DocumentSync.parse(DocumentSync.stringify('scale', fields));
    expect(nativeParsed.fields.notes).toEqual(fields.notes);

    const compactParsed = DocumentSync.parse(DocumentSync.stringify('scale', fields, { compactNotes: true }));
    expect(compactParsed.fields.notes).toEqual(fields.notes);
  });

  it('round-trips a type: chords document (defaults + inline csv) through stringify then parse', () => {
    const fields = {
      collectionLabel: 'Open Chords',
      columns: 4,
      defaults: { root: '5', tuning: 'DADGBE' },
      csv: 'notes,label,root\nx02220,A,5\n320003,G,6\n',
      stylesheet: '.root { fill: #d62828; }',
    };
    const parsed = DocumentSync.parse(DocumentSync.stringify('chords', fields));
    expect(parsed.type).toBe('chords');
    expect(parsed.fields).toEqual(fields);
  });

  it('parses the README\'s type: chord example verbatim', () => {
    const text =
      'type: chord\n' +
      'notation: x02220\n' +
      'label: A Major\n' +
      'root: "5"\n' +
      'tuning: EADGBE\n' +
      'stylesheet: |\n' +
      '  circle.root { fill: #d62828; }\n' +
      '  .chord-title { fill: #457b9d; }\n' +
      'output: a.png              # optional; CLI --output wins if also given\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.type).toBe('chord');
    expect(parsed.fields.notation).toBe('x02220');
    expect(parsed.fields.label).toBe('A Major');
    expect(parsed.fields.root).toBe('5');
    expect(parsed.fields.tuning).toBe('EADGBE');
    expect(parsed.fields.stylesheet).toBe('circle.root { fill: #d62828; }\n.chord-title { fill: #457b9d; }\n');
    expect(parsed.fields.output).toBe('a.png');
  });

  it('parses the README\'s type: scale example (native marker list) verbatim', () => {
    const text =
      'type: scale\n' +
      'label: "Minor Pentatonic Box (partial)"\n' +
      'notes:\n' +
      '  - { string: 6, fret: 3, label: R, className: root }\n' +
      '  - { string: 6, fret: 5, label: "2" }\n' +
      '  - { string: 5, fret: 2, label: b3 }\n' +
      '  - { string: 5, fret: 5, label: "4" }\n' +
      'mutedStrings: "1,2"\n' +
      'stylesheetFile: ./theme.css\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.type).toBe('scale');
    expect(parsed.fields.label).toBe('Minor Pentatonic Box (partial)');
    expect(parsed.fields.notes).toEqual([
      { string: 6, fret: 3, label: 'R', className: 'root' },
      { string: 6, fret: 5, label: '2' },
      { string: 5, fret: 2, label: 'b3' },
      { string: 5, fret: 5, label: '4' },
    ]);
    expect(parsed.fields.mutedStrings).toBe('1,2');
    expect(parsed.fields.stylesheetFile).toBe('./theme.css');
  });

  it('parses the README\'s type: neck example verbatim', () => {
    const text =
      'type: neck\n' +
      'notes: "6:7:R;5:7:5;4:7:R"\n' +
      'firstFret: 5\n' +
      'lastFret: 17\n' +
      'label: Root-5 shape\n' +
      'tuning: DADGBE\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.type).toBe('neck');
    // Compact-notation notes strings are normalized to marker objects.
    expect(parsed.fields.notes).toEqual([
      { string: 6, fret: 7, label: 'R' },
      { string: 5, fret: 7, label: '5' },
      { string: 4, fret: 7, label: 'R' },
    ]);
    expect(parsed.fields.firstFret).toBe(5);
    expect(parsed.fields.lastFret).toBe(17);
    expect(parsed.fields.label).toBe('Root-5 shape');
  });

  it('parses the README\'s type: chords example (inline csv + defaults) verbatim', () => {
    const text =
      'type: chords\n' +
      'collectionLabel: Open Chords\n' +
      'columns: 4\n' +
      'defaults:\n' +
      '  root: "5"\n' +
      'csv: |\n' +
      '  notes,label,root,finger-positions\n' +
      '  x02220,A,5,\n' +
      '  320003,G,6,3xxxxx\n' +
      '  xx0232,D,4,\n' +
      '  022100,Em,5,\n' +
      'stylesheet: |\n' +
      '  .root { fill: #d62828; }\n' +
      'output: chords.png\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.type).toBe('chords');
    expect(parsed.fields.collectionLabel).toBe('Open Chords');
    expect(parsed.fields.columns).toBe(4);
    expect(parsed.fields.defaults).toEqual({ root: '5' });
    expect(parsed.fields.csv).toBe(
      'notes,label,root,finger-positions\nx02220,A,5,\n320003,G,6,3xxxxx\nxx0232,D,4,\n022100,Em,5,\n',
    );
    expect(parsed.fields.stylesheet).toBe('.root { fill: #d62828; }\n');
    expect(parsed.fields.output).toBe('chords.png');
  });

  it('parses a block-style (not flow-mapping) notes list', () => {
    const text = 'type: scale\nnotes:\n  - string: 6\n    fret: 3\n    label: R\n  - string: 5\n    fret: 2\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.fields.notes).toEqual([
      { string: 6, fret: 3, label: 'R' },
      { string: 5, fret: 2 },
    ]);
  });

  it('ignores full-line and trailing comments outside block scalars', () => {
    const text = '# a comment\ntype: chord # trailing comment\nnotation: x02220\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.type).toBe('chord');
    expect(parsed.fields.notation).toBe('x02220');
  });

  it('does not strip a "#" inside a block scalar', () => {
    const text = 'type: chord\nnotation: x02220\nstylesheet: |\n  .foo { content: "#fff"; }\n';
    const parsed = DocumentSync.parse(text);
    expect(parsed.fields.stylesheet).toBe('.foo { content: "#fff"; }\n');
  });

  it('throws a ParseError for a missing type field', () => {
    expect(() => DocumentSync.parse('notation: x02220\n')).toThrow(DocumentSync.ParseError);
  });

  it('throws a ParseError for an unrecognized type', () => {
    expect(() => DocumentSync.parse('type: banana\n')).toThrow(DocumentSync.ParseError);
  });

  it('throws a ParseError for a malformed line', () => {
    expect(() => DocumentSync.parse('type: chord\nnotation x02220\n')).toThrow(DocumentSync.ParseError);
  });

  it('round-trips a marker\'s finger as a number, not a string', () => {
    const fields = { notes: [{ string: 6, fret: 3, finger: 2 }] };
    const parsed = DocumentSync.parse(DocumentSync.stringify('scale', fields));
    expect(parsed.fields.notes).toEqual([{ string: 6, fret: 3, finger: 2 }]);
    expect(typeof parsed.fields.notes[0].finger).toBe('number');
  });

  it('round-trips a string containing a literal double quote', () => {
    const fields = { notation: 'x02220', label: 'The "Open A" shape' };
    const parsed = DocumentSync.parse(DocumentSync.stringify('chord', fields));
    expect(parsed.fields.label).toBe('The "Open A" shape');
  });
});

describe('DocumentSync neck brackets', () => {
  const brackets = [
    { startFret: 0, endFret: 3, label: 'E shape' },
    { startFret: 2, endFret: 5, label: 'D shape', className: 'caged-d' },
  ];

  it('writes a brackets array as a native YAML list after the fret range by default', () => {
    expect(DocumentSync.stringify('neck', { notes: '6:3', lastFret: 12, brackets })).toBe(
      'type: neck\nnotes: 6:3\nlastFret: 12\nbrackets:\n' +
        '  - { startFret: 0, endFret: 3, label: E shape }\n' +
        '  - { startFret: 2, endFret: 5, label: D shape, className: caged-d }\n'
    );
  });

  it('writes compact bracket text with compactNotes', () => {
    expect(DocumentSync.stringify('neck', { notes: '6:3', brackets }, { compactNotes: true })).toBe(
      'type: neck\nnotes: 6:3\nbrackets: |\n  0-3:E shape\n  2-5:D shape:caged-d\n'
    );
  });

  it('keeps a native list even with compactNotes when a label has a ":" or ";"', () => {
    const text = DocumentSync.stringify(
      'neck',
      { notes: '6:3', brackets: [{ startFret: 2, endFret: 5, label: 'C: root' }] },
      { compactNotes: true }
    );
    expect(text).toContain('brackets:\n  - {');
    expect(DocumentSync.parse(text).fields.brackets).toEqual([{ startFret: 2, endFret: 5, label: 'C: root' }]);
  });

  it('omits an empty brackets array', () => {
    expect(DocumentSync.stringify('neck', { notes: '6:3', brackets: [] })).toBe('type: neck\nnotes: 6:3\n');
  });

  it('round-trips both forms back to an array', () => {
    expect(DocumentSync.parse(DocumentSync.stringify('neck', { notes: '6:3', brackets })).fields.brackets).toEqual(brackets);
    expect(
      DocumentSync.parse(DocumentSync.stringify('neck', { notes: '6:3', brackets }, { compactNotes: true })).fields.brackets
    ).toEqual(brackets);
  });

  it('parses a block-style native list and a ";"-joined compact string', () => {
    expect(
      DocumentSync.parse(
        'type: neck\nnotes: "6:3"\nbrackets:\n  - startFret: 2\n    endFret: 5\n    label: D shape\n    className: caged-d\n'
      ).fields.brackets
    ).toEqual([brackets[1]]);
    expect(DocumentSync.parse('type: neck\nnotes: "6:3"\nbrackets: "0-3:E shape;2-5:D shape:caged-d"\n').fields.brackets).toEqual(
      brackets
    );
  });

  it('throws a ParseError for malformed compact brackets', () => {
    expect(() => DocumentSync.parse('type: neck\nnotes: "6:3"\nbrackets: "banana"\n')).toThrow(DocumentSync.ParseError);
  });

  it('supports brackets on type: scale documents too', () => {
    const text = DocumentSync.stringify('scale', { notes: '6:5', brackets: [{ startFret: 5, endFret: 7, label: 'Box 1' }] }, { compactNotes: true });
    expect(text).toBe('type: scale\nnotes: 6:5\nbrackets: 5-7:Box 1\n');
    expect(DocumentSync.parse(text).fields.brackets).toEqual([{ startFret: 5, endFret: 7, label: 'Box 1' }]);
  });
});
