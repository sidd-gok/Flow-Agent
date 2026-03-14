'use strict';

const {
  _colLetter,
  _escXml,
  _computeActorCols,
  _computeNodePositions,
} = require('./server-utils');

// ═══════════════════════════════════════════════════════════════════════════════
//  _colLetter — Excel-style column letter from 1-based index
// ═══════════════════════════════════════════════════════════════════════════════
describe('_colLetter', () => {
  test('single-letter columns A–Z', () => {
    expect(_colLetter(1)).toBe('A');
    expect(_colLetter(2)).toBe('B');
    expect(_colLetter(26)).toBe('Z');
  });

  test('two-letter columns starting at AA (27)', () => {
    expect(_colLetter(27)).toBe('AA');
    expect(_colLetter(28)).toBe('AB');
    expect(_colLetter(52)).toBe('AZ');
    expect(_colLetter(53)).toBe('BA');
  });

  test('column 702 is ZZ', () => {
    expect(_colLetter(702)).toBe('ZZ');
  });

  test('column 703 is AAA', () => {
    expect(_colLetter(703)).toBe('AAA');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  _escXml — XML special-character escaping
// ═══════════════════════════════════════════════════════════════════════════════
describe('_escXml', () => {
  test('escapes & < > " \'', () => {
    expect(_escXml('a & b')).toBe('a &amp; b');
    expect(_escXml('<tag>')).toBe('&lt;tag&gt;');
    expect(_escXml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(_escXml("it's")).toBe('it&apos;s');
  });

  test('leaves plain text unchanged', () => {
    expect(_escXml('hello world')).toBe('hello world');
  });

  test('coerces non-strings to string before escaping', () => {
    expect(_escXml(42)).toBe('42');
    expect(_escXml(null)).toBe('null');
  });

  test('escapes multiple occurrences in the same string', () => {
    expect(_escXml('<a> & <b>')).toBe('&lt;a&gt; &amp; &lt;b&gt;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  _computeActorCols — column-width allocation per swimlane actor
// ═══════════════════════════════════════════════════════════════════════════════
describe('_computeActorCols', () => {
  test('1 actor gets the full 70-column budget', () => {
    expect(_computeActorCols(['Requestor'])).toEqual([70]);
  });

  test('2 actors: Requestor=10, rest=60', () => {
    expect(_computeActorCols(['Requestor', 'Approver'])).toEqual([10, 60]);
  });

  test('3 actors: fixed widths 10, 6, 54', () => {
    expect(_computeActorCols(['Requestor', 'Approver', 'Manual'])).toEqual([10, 6, 54]);
  });

  test('4 actors: total width always sums to 70', () => {
    const widths = _computeActorCols(['A', 'B', 'C', 'D']);
    const total  = widths.reduce((s, w) => s + w, 0);
    expect(total).toBe(70);
    expect(widths).toHaveLength(4);
  });

  test('5 actors: total width always sums to 70', () => {
    const widths = _computeActorCols(['A', 'B', 'C', 'D', 'E']);
    const total  = widths.reduce((s, w) => s + w, 0);
    expect(total).toBe(70);
    expect(widths).toHaveLength(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  _computeNodePositions — drawing anchor coordinates (0-based)
// ═══════════════════════════════════════════════════════════════════════════════
describe('_computeNodePositions', () => {
  const actorCols = { Requestor: { c1: 4, c2: 13 } };
  const toolRows  = { 'Email': { r1: 6, r2: 20 } };

  test('process node at col=0 has correct 0-based anchor', () => {
    const nodes = [{ id: 'n1', type: 'process', actor: 'Requestor', tool: 'Email', col: 0 }];
    const pos   = _computeNodePositions(nodes, actorCols, toolRows);
    // fc = c1 + 0*4 - 1 = 3,  tc = fc + 4 - 1 = 6,  fr = r1+1-1=6,  tr = fr+6-1=11
    expect(pos['n1']).toEqual({ fc: 3, fr: 6, tc: 7, tr: 12 });
  });

  test('process node at col=1 shifts right by STEP_W=4', () => {
    const nodes = [{ id: 'n2', type: 'process', actor: 'Requestor', tool: 'Email', col: 1 }];
    const pos   = _computeNodePositions(nodes, actorCols, toolRows);
    // fc = 4 + 4 - 1 = 7
    expect(pos['n2'].fc).toBe(7);
  });

  test('decision node is wider (DEC_W=5) and taller (DEC_H=10)', () => {
    const nodes = [{ id: 'dec1', type: 'decision', actor: 'Requestor', tool: 'Email', col: 0 }];
    const pos   = _computeNodePositions(nodes, actorCols, toolRows);
    const width  = pos['dec1'].tc - pos['dec1'].fc;
    const height = pos['dec1'].tr - pos['dec1'].fr;
    expect(width).toBe(5);
    expect(height).toBe(10);
  });

  test('start/end node is narrower (ELLIP_W=3) and shorter (ELLIP_H=4)', () => {
    const nodes = [{ id: 'start', type: 'start', actor: 'Requestor', tool: 'Email', col: 0 }];
    const pos   = _computeNodePositions(nodes, actorCols, toolRows);
    const width  = pos['start'].tc - pos['start'].fc;
    const height = pos['start'].tr - pos['start'].fr;
    expect(width).toBe(3);
    expect(height).toBe(4);
  });

  test('nodes with unknown actor/tool fall back to defaults', () => {
    const nodes = [{ id: 'x1', type: 'process', actor: 'Unknown', tool: 'Unknown', col: 0 }];
    const pos   = _computeNodePositions(nodes, actorCols, toolRows);
    // Default: ac={ c1:4, c2:13 }, tr={ r1:6, r2:20 }
    expect(pos['x1']).toBeDefined();
    expect(pos['x1'].fc).toBeGreaterThanOrEqual(0);
  });

  test('nodes are sorted by col before positioning', () => {
    const nodes = [
      { id: 'b', type: 'process', actor: 'Requestor', tool: 'Email', col: 1 },
      { id: 'a', type: 'process', actor: 'Requestor', tool: 'Email', col: 0 },
    ];
    const pos = _computeNodePositions(nodes, actorCols, toolRows);
    expect(pos['a'].fc).toBeLessThan(pos['b'].fc);
  });

  test('returns positions keyed by node id', () => {
    const nodes = [
      { id: 'n1', type: 'process', actor: 'Requestor', tool: 'Email', col: 0 },
      { id: 'n2', type: 'process', actor: 'Requestor', tool: 'Email', col: 1 },
    ];
    const pos = _computeNodePositions(nodes, actorCols, toolRows);
    expect(Object.keys(pos)).toEqual(expect.arrayContaining(['n1', 'n2']));
  });

  test('uses process geometry when node.type is undefined (fallback default)', () => {
    // Omitting type and col triggers the `|| 'process'` and `!== undefined ? ... : 0` branches
    const nodes = [{ id: 'def', actor: 'Requestor', tool: 'Email' }];
    const pos   = _computeNodePositions(nodes, actorCols, toolRows);
    // Should behave exactly like type='process', col=0
    const expected = _computeNodePositions(
      [{ id: 'def', type: 'process', actor: 'Requestor', tool: 'Email', col: 0 }],
      actorCols,
      toolRows
    );
    expect(pos['def']).toEqual(expected['def']);
  });
});
