/**
 * @jest-environment jsdom
 */
'use strict';

// ── validateXml ───────────────────────────────────────────────────────────────
// Extracted verbatim from Index.html
function validateXml(xml) {
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xml, 'text/xml');
    return !doc.querySelector('parsererror');
  } catch { return false; }
}

// ── fixContainerSize ──────────────────────────────────────────────────────────
// Extracted verbatim from Index.html
function fixContainerSize(xmlStr) {
  try {
    const doc = new DOMParser().parseFromString(xmlStr, 'text/xml');
    if (doc.querySelector('parsererror')) return xmlStr;

    const all = Array.from(doc.querySelectorAll('mxCell'));

    const laneIds = new Set(
      all.filter(c => {
        const s  = c.getAttribute('style') || '';
        const id = c.getAttribute('id')    || '';
        return s.includes('swimlane') && !['0','1','swim_container'].includes(id);
      }).map(c => c.getAttribute('id'))
    );

    let maxRight = 400;
    all.forEach(c => {
      const id = c.getAttribute('id') || '';
      if (['0','1','swim_container'].includes(id) || laneIds.has(id)) return;
      if (c.getAttribute('edge') === '1' || !c.getAttribute('vertex')) return;
      const g = c.querySelector('mxGeometry');
      if (!g) return;
      const r = +(g.getAttribute('x')||0) + +(g.getAttribute('width')||0);
      if (r > maxRight) maxRight = r;
    });
    const newW = Math.max(maxRight + 100, 900);

    let laneBottom = 300;
    all.forEach(c => {
      if (!laneIds.has(c.getAttribute('id')||'')) return;
      const g = c.querySelector('mxGeometry');
      if (!g) return;
      const b = +(g.getAttribute('y')||0) + +(g.getAttribute('height')||0);
      if (b > laneBottom) laneBottom = b;
    });
    const newH = laneBottom + 35 + 20;

    const cont = all.find(c => c.getAttribute('id') === 'swim_container');
    if (cont) {
      const g = cont.querySelector('mxGeometry');
      if (g) { g.setAttribute('width', String(newW)); g.setAttribute('height', String(newH)); }
    }
    all.forEach(c => {
      if (!laneIds.has(c.getAttribute('id')||'')) return;
      const g = c.querySelector('mxGeometry');
      if (g) g.setAttribute('width', String(newW));
    });

    const raw   = new XMLSerializer().serializeToString(doc);
    const clean = raw.replace(/\s+xmlns(?::[a-z0-9]+)?="[^"]*"/g, '');
    const s = clean.indexOf('<mxGraphModel');
    const e = clean.lastIndexOf('</mxGraphModel>');
    return s !== -1 && e !== -1 ? clean.slice(s, e + 15) : xmlStr;
  } catch(err) {
    return xmlStr;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal valid mxGraphModel with a swimlane container + one lane + one node */
function makeDiagramXml({ nodeX = 200, nodeWidth = 160, laneY = 35, laneHeight = 140 } = {}) {
  return `<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="swim_container" value="Test" style="swimlane;" vertex="1" parent="1">
      <mxGeometry x="20" y="20" width="1600" height="500" as="geometry"/>
    </mxCell>
    <mxCell id="lane1" value="Requestor" style="swimlane;" vertex="1" parent="swim_container">
      <mxGeometry y="${laneY}" width="1600" height="${laneHeight}" as="geometry"/>
    </mxCell>
    <mxCell id="n1" value="Step 1" style="rounded=1;" vertex="1" parent="lane1">
      <mxGeometry x="${nodeX}" y="45" width="${nodeWidth}" height="50" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  validateXml
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateXml', () => {
  test('returns true for valid mxGraphModel XML', () => {
    expect(validateXml('<mxGraphModel><root></root></mxGraphModel>')).toBe(true);
  });

  test('returns true for well-formed XML even without mxGraphModel', () => {
    // DOMParser does not require a specific root — just valid XML
    expect(validateXml('<foo><bar/></foo>')).toBe(true);
  });

  test('returns false for malformed XML (unclosed tag)', () => {
    expect(validateXml('<mxGraphModel><root>')).toBe(false);
  });

  test('returns false for completely broken input', () => {
    expect(validateXml('not xml at all <<<')).toBe(false);
  });

  test('returns true for a full swimlane diagram', () => {
    expect(validateXml(makeDiagramXml())).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  fixContainerSize
// ═══════════════════════════════════════════════════════════════════════════════
describe('fixContainerSize', () => {
  test('returns the input unchanged when it contains a parse error', () => {
    const bad = '<mxGraphModel><root>';
    expect(fixContainerSize(bad)).toBe(bad);
  });

  test('returns a string starting with <mxGraphModel', () => {
    const xml = makeDiagramXml();
    const result = fixContainerSize(xml);
    expect(result.startsWith('<mxGraphModel')).toBe(true);
  });

  test('returns a string ending with </mxGraphModel>', () => {
    const xml = makeDiagramXml();
    const result = fixContainerSize(xml);
    expect(result.endsWith('</mxGraphModel>')).toBe(true);
  });

  test('grows container width to fit a wide node (nodeX + nodeWidth > 400)', () => {
    const xml    = makeDiagramXml({ nodeX: 800, nodeWidth: 200 });
    const result = fixContainerSize(xml);
    const parser = new DOMParser();
    const doc    = parser.parseFromString(result, 'text/xml');
    const cont   = doc.querySelector('[id="swim_container"]');
    const geom   = cont && cont.querySelector('mxGeometry');
    const width  = geom ? parseInt(geom.getAttribute('width'), 10) : 0;
    // newW = max(800+200+100, 900) = 1100
    expect(width).toBe(1100);
  });

  test('sets container width to at least 900 even for narrow content', () => {
    const xml    = makeDiagramXml({ nodeX: 40, nodeWidth: 80 });
    const result = fixContainerSize(xml);
    const parser = new DOMParser();
    const doc    = parser.parseFromString(result, 'text/xml');
    const cont   = doc.querySelector('[id="swim_container"]');
    const geom   = cont && cont.querySelector('mxGeometry');
    const width  = geom ? parseInt(geom.getAttribute('width'), 10) : 0;
    expect(width).toBeGreaterThanOrEqual(900);
  });

  test('sets container height based on lane bottom + 55 (floor: 300+55=355)', () => {
    // laneY=35, laneHeight=140 → laneBottom=175, which is below the internal floor of 300.
    // So newH = 300 + 35 + 20 = 355.
    const xml    = makeDiagramXml({ laneY: 35, laneHeight: 140 });
    const result = fixContainerSize(xml);
    const parser = new DOMParser();
    const doc    = parser.parseFromString(result, 'text/xml');
    const cont   = doc.querySelector('[id="swim_container"]');
    const geom   = cont && cont.querySelector('mxGeometry');
    const height = geom ? parseInt(geom.getAttribute('height'), 10) : 0;
    expect(height).toBe(355);
  });

  test('uses actual lane bottom when it exceeds 300', () => {
    // laneY=200, laneHeight=200 → laneBottom=400 > 300, so newH = 400+55 = 455
    const xml    = makeDiagramXml({ laneY: 200, laneHeight: 200 });
    const result = fixContainerSize(xml);
    const parser = new DOMParser();
    const doc    = parser.parseFromString(result, 'text/xml');
    const cont   = doc.querySelector('[id="swim_container"]');
    const geom   = cont && cont.querySelector('mxGeometry');
    const height = geom ? parseInt(geom.getAttribute('height'), 10) : 0;
    expect(height).toBe(455);
  });

  test('updates lane width to match the new container width', () => {
    const xml    = makeDiagramXml({ nodeX: 800, nodeWidth: 200 });
    const result = fixContainerSize(xml);
    const parser = new DOMParser();
    const doc    = parser.parseFromString(result, 'text/xml');
    const lane   = doc.querySelector('[id="lane1"]');
    const geom   = lane && lane.querySelector('mxGeometry');
    const width  = geom ? parseInt(geom.getAttribute('width'), 10) : 0;
    expect(width).toBe(1100);
  });

  test('strips injected xmlns attributes from the serialised output', () => {
    const xml    = makeDiagramXml();
    const result = fixContainerSize(xml);
    expect(result).not.toMatch(/xmlns(?::[a-z0-9]+)?="/);
  });
});
