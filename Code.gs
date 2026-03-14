/**
 * ModhaFlow - Google Apps Script Web App Server
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ModhaFlow — AI Swimlane Generator')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setFaviconUrl('https://www.gstatic.com/images/branding/product/1x/apps_script_48dp.png');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODEL LIST — server-side fetch (no CORS)
// ═══════════════════════════════════════════════════════════════════════════════
function getGeminiModels(apiKey) {
  if (!apiKey) return { error: 'No API key provided.' };

  const BLACKLIST = ['embedding', 'aqa', 'attribution', 'retrieval'];

  try {
    const url  = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=' + apiKey;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    const body = JSON.parse(resp.getContentText());

    if (code !== 200) {
      return { error: body?.error?.message || ('HTTP ' + code) };
    }

    const models = (body.models || [])
      .filter(function(m) {
        var id = (m.name || '').replace('models/', '').toLowerCase();
        var hasGenerate = Array.isArray(m.supportedGenerationMethods) &&
                          m.supportedGenerationMethods.indexOf('generateContent') !== -1;
        var notBlacklisted = !BLACKLIST.some(function(b) { return id.indexOf(b) !== -1; });
        return hasGenerate && notBlacklisted;
      })
      .map(function(m) {
        return {
          id:          m.name.replace('models/', ''),
          displayName: m.displayName || m.name.replace('models/', ''),
          description: m.description || ''
        };
      })
      .sort(function(a, b) {
        var score = function(s) { return s.id.indexOf('flash') !== -1 ? 0 : s.id.indexOf('pro') !== -1 ? 1 : 2; };
        return score(a) - score(b) || a.id.localeCompare(b.id);
      });

    return { models: models };

  } catch(e) {
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENTERPRISE FLOW EXCEL EXPORT
//  Receives a JSON spec from the client, returns base64-encoded .xlsx bytes
// ═══════════════════════════════════════════════════════════════════════════════
function buildEnterpriseFlowExcel(specJson) {
  try {
    var spec   = JSON.parse(specJson);
    var bytes  = _generateExcel(spec);
    return { ok: true, base64: Utilities.base64Encode(bytes) };
  } catch(e) {
    return { ok: false, error: e.message + '\n' + e.stack };
  }
}

function _generateExcel(spec) {
  var tools   = spec.tools   || [];
  var actors  = spec.actors  || [];
  var nodes   = spec.nodes   || [];
  var edges   = spec.edges   || [];
  var title   = spec.title   || 'Process Flow';
  var ft      = spec.flow_type || 'AS-IS';

  // ── Grid constants (matches AS-IS template exactly) ─────────────────────
  var HEADER_ROWS  = 5;    // rows 1-5: column headers
  var TOOL_ROWS    = 15;   // Excel rows per tool band
  var ACTOR_START  = 4;    // first actor column (D = col 4, 1-based)

  // Column allocation per actor (mirrors AS-IS: Requestor=10, Approver=6, Manual=54)
  var colWidths = _computeActorCols(actors);

  // Map actor -> { c1, c2 } 1-based column indices
  var actorCols = {};
  var cur = ACTOR_START;
  for (var i = 0; i < actors.length; i++) {
    actorCols[actors[i]] = { c1: cur, c2: cur + colWidths[i] - 1 };
    cur += colWidths[i];
  }
  var totalCols = cur + 2;

  // Map tool -> { r1, r2 } 1-based row indices
  var toolRows = {};
  cur = HEADER_ROWS + 1;
  for (var j = 0; j < tools.length; j++) {
    toolRows[tools[j]] = { r1: cur, r2: cur + TOOL_ROWS - 1 };
    cur += TOOL_ROWS;
  }
  var totalRows = cur + 5;

  // ── Build worksheet XML ──────────────────────────────────────────────────
  var sheetXml = _buildSheetXml(
    tools, actors, actorCols, toolRows,
    totalRows, totalCols, title, ft, HEADER_ROWS, TOOL_ROWS
  );

  // ── Build drawing XML (shapes + connectors) ───────────────────────────────
  var positions = _computeNodePositions(nodes, actorCols, toolRows);
  var drawingXml = _buildDrawingXml(nodes, edges, positions);

  // ── Assemble xlsx ZIP ────────────────────────────────────────────────────
  return _assembleXlsx(sheetXml, drawingXml, title + ' ' + ft);
}

function _computeActorCols(actors) {
  // Default: Requestor=10, Approver=6, rest share remaining
  if (actors.length === 3) return [10, 6, 54];
  if (actors.length === 2) return [10, 60];
  if (actors.length === 1) return [70];
  var perActor = Math.floor(70 / actors.length);
  var widths = [];
  for (var i = 0; i < actors.length; i++) widths.push(perActor);
  widths[actors.length - 1] += 70 - (perActor * actors.length);
  return widths;
}

function _computeNodePositions(nodes, actorCols, toolRows) {
  // For each node: compute 0-based (fc, fr, tc, tr) for Excel drawing anchors
  var STEP_W   = 4;   // columns wide per step
  var STEP_H   = 6;   // rows tall per process step
  var DEC_W    = 5;   // decision wider
  var DEC_H    = 10;  // decision taller
  var ELLIP_W  = 3;
  var ELLIP_H  = 4;
  var INSET    = 1;   // row inset within tool band

  var positions = {};
  var colUsed = {};   // track "column cursor" per (actor, tool) pair

  // Sort nodes by their 'col' field so we lay them out chronologically
  var sorted = nodes.slice().sort(function(a, b) {
    return (a.col || 0) - (b.col || 0);
  });

  for (var i = 0; i < sorted.length; i++) {
    var node  = sorted[i];
    var nid   = node.id;
    var tool  = node.tool  || '';
    var actor = node.actor || '';
    var ntype = node.type  || 'process';
    var ncol  = node.col   !== undefined ? node.col : 0;

    var ac = actorCols[actor] || { c1: 4, c2: 13 };
    var tr = toolRows[tool]   || { r1: 6, r2: 20 };

    // Step column offset: each step is STEP_W columns
    var colOffset = ncol * STEP_W;

    var fc, fr, tc, tfr;
    if (ntype === 'decision') {
      fc  = ac.c1 + colOffset;
      tc  = fc + DEC_W;
      fr  = tr.r1 + INSET;
      tfr = fr + DEC_H;
    } else if (ntype === 'start' || ntype === 'end') {
      fc  = ac.c1 + colOffset;
      tc  = fc + ELLIP_W;
      fr  = tr.r1 + INSET + 1;
      tfr = fr + ELLIP_H;
    } else {
      fc  = ac.c1 + colOffset;
      tc  = fc + STEP_W;
      fr  = tr.r1 + INSET;
      tfr = fr + STEP_H;
    }

    // Convert to 0-based for drawing XML
    positions[nid] = { fc: fc - 1, fr: fr - 1, tc: tc - 1, tr: tfr - 1 };
  }
  return positions;
}

function _buildSheetXml(tools, actors, actorCols, toolRows, totalRows, totalCols, title, ft, HEADER_ROWS, TOOL_ROWS) {
  // Build minimal sheet XML (cells + merges + styles)
  // We keep it simple: just merged headers with fill/font
  var xml = [];
  xml.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  xml.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/sheet"');
  xml.push(' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');

  // Sheet view (freeze first 5 rows and first 3 cols)
  xml.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="5" xSplit="3" topLeftCell="D6" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>');

  // Column widths
  xml.push('<cols>');
  xml.push('<col min="1" max="1" width="3" customWidth="1"/>');   // A
  xml.push('<col min="2" max="3" width="15" customWidth="1"/>');  // B-C tool labels
  for (var c = 4; c <= totalCols; c++) {
    xml.push('<col min="' + c + '" max="' + c + '" width="9.14" customWidth="1"/>');
  }
  xml.push('</cols>');

  // Build sheetData (just styled cells for headers)
  xml.push('<sheetData>');

  // Row heights
  for (var r = 1; r <= totalRows; r++) {
    var ht = (r <= HEADER_ROWS) ? '42' : '15';
    xml.push('<row r="' + r + '" ht="' + ht + '" customHeight="1">');

    if (r >= 2 && r <= 5) {
      // Only write data on row 2 (merge spans rows 2-5)
      // Cells are defined via merges
    }

    xml.push('</row>');
  }

  xml.push('</sheetData>');

  // Merge cells
  xml.push('<mergeCells>');
  // Title cell B2:C5
  xml.push('<mergeCell ref="B2:C5"/>');

  // Actor header merges
  for (var actor in actorCols) {
    var ac = actorCols[actor];
    var c1l = _colLetter(ac.c1);
    var c2l = _colLetter(ac.c2);
    xml.push('<mergeCell ref="' + c1l + '2:' + c2l + '5"/>');
  }

  // Tool label merges
  for (var ti = 0; ti < tools.length; ti++) {
    var tool = tools[ti];
    var trows = toolRows[tool];
    xml.push('<mergeCell ref="B' + trows.r1 + ':C' + trows.r2 + '"/>');
  }

  xml.push('</mergeCells>');

  // Drawing reference
  xml.push('<drawing r:id="rId_drw1"/>');
  xml.push('</worksheet>');
  return xml.join('\n');
}

function _colLetter(n) {
  // 1-based column number to letter(s)
  var s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function _escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function _buildDrawingXml(nodes, edges, positions) {
  var NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  var NS_A   = 'http://schemas.openxmlformats.org/drawingml/2006/main';

  var parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<xdr:wsDr xmlns:xdr="' + NS_XDR + '" xmlns:a="' + NS_A + '">');

  // Assign shape IDs (start at 2, matching AS-IS)
  var idMap   = {};
  var nextId  = 2;
  for (var i = 0; i < nodes.length; i++) {
    idMap[nodes[i].id] = nextId++;
  }

  // ── Shapes ─────────────────────────────────────────────────────────────
  for (var i = 0; i < nodes.length; i++) {
    var node  = nodes[i];
    var nid   = node.id;
    var ntype = node.type || 'process';
    var text  = _escXml(node.text || '');
    var sid   = idMap[nid];
    var pos   = positions[nid];
    if (!pos) continue;

    var geom = ntype === 'start' || ntype === 'end' ? 'ellipse'
             : ntype === 'decision'                 ? 'flowChartDecision'
             : 'rect';

    var isBold = (ntype === 'start' || ntype === 'end') ? ' b="1"' : '';

    parts.push(
      '<xdr:twoCellAnchor editAs="oneCell">' +
      '<xdr:from><xdr:col>' + pos.fc + '</xdr:col><xdr:colOff>76200</xdr:colOff>' +
                '<xdr:row>' + pos.fr + '</xdr:row><xdr:rowOff>76200</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>' + pos.tc + '</xdr:col><xdr:colOff>0</xdr:colOff>' +
              '<xdr:row>' + pos.tr + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
      '<xdr:sp macro="" textlink="">' +
        '<xdr:nvSpPr><xdr:cNvPr id="' + sid + '" name="Shape ' + sid + '"/><xdr:cNvSpPr/></xdr:nvSpPr>' +
        '<xdr:spPr>' +
          '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>' +
          '<a:prstGeom prst="' + geom + '"><a:avLst/></a:prstGeom>' +
          '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:solidFill>' +
          '<a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln>' +
        '</xdr:spPr>' +
        '<xdr:txBody>' +
          '<a:bodyPr vertOverflow="clip" rtlCol="0" anchor="ctr"/><a:lstStyle/>' +
          '<a:p><a:pPr algn="ctr"/>' +
            '<a:r><a:rPr lang="en-US" sz="1000"' + isBold + '>' +
              '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
              '<a:latin typeface="+mn-lt"/></a:rPr>' +
            '<a:t>' + text + '</a:t></a:r>' +
          '</a:p>' +
        '</xdr:txBody>' +
      '</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>'
    );
  }

  // ── Connectors ──────────────────────────────────────────────────────────
  for (var j = 0; j < edges.length; j++) {
    var edge  = edges[j];
    var fromId = edge.from;
    var toId   = edge.to;
    var label  = edge.label || '';
    var fp = positions[fromId];
    var tp = positions[toId];
    if (!fp || !tp) continue;

    var fsid = idMap[fromId] || 0;
    var tsid = idMap[toId]   || 0;
    var sid  = nextId++;

    // Choose connector geometry based on relative position
    var goingRight = tp.fc >= fp.tc;
    var goingDown  = tp.fr > fp.tr;
    var geom = goingRight ? 'straightConnector1'
             : goingDown  ? 'bentConnector2'
             : 'bentConnector4';

    var fromIdx = goingRight ? 2 : goingDown ? 3 : 1;
    var toIdx   = goingRight ? 0 : goingDown ? 1 : 3;

    var labelXml = '';
    if (label) {
      labelXml = '<xdr:txBody><a:bodyPr/><a:lstStyle/>' +
        '<a:p><a:pPr algn="ctr"/><a:r>' +
        '<a:rPr lang="en-US" sz="800" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>' +
        '<a:t>' + _escXml(label) + '</a:t></a:r></a:p></xdr:txBody>';
    }

    // Connector from right-mid of source to left-mid of target (or top/bottom for vertical)
    var cfc = goingRight ? fp.tc : fp.fc;
    var cfr = goingRight ? fp.fr : fp.tr;
    var ctc = goingRight ? tp.fc : tp.tc;
    var ctr = goingRight ? tp.tr : tp.fr;

    parts.push(
      '<xdr:twoCellAnchor editAs="oneCell">' +
      '<xdr:from><xdr:col>' + cfc + '</xdr:col><xdr:colOff>0</xdr:colOff>' +
                '<xdr:row>' + cfr + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>' + ctc + '</xdr:col><xdr:colOff>0</xdr:colOff>' +
              '<xdr:row>' + ctr + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
      '<xdr:cxnSp macro="">' +
        '<xdr:nvCxnSpPr>' +
          '<xdr:cNvPr id="' + sid + '" name="Connector ' + sid + '"/>' +
          '<xdr:cNvCxnSpPr><a:cxnSpLocks/>' +
            '<a:stCxn id="' + fsid + '" idx="' + fromIdx + '"/>' +
            '<a:endCxn id="' + tsid + '" idx="' + toIdx + '"/>' +
          '</xdr:cNvCxnSpPr>' +
        '</xdr:nvCxnSpPr>' +
        '<xdr:spPr>' +
          '<a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>' +
          '<a:prstGeom prst="' + geom + '"><a:avLst/></a:prstGeom>' +
          '<a:ln w="22225"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
          '<a:tailEnd type="triangle"/></a:ln>' +
        '</xdr:spPr>' +
        labelXml +
      '<xdr:clientData/></xdr:cxnSp></xdr:twoCellAnchor>'
    );
  }

  parts.push('</xdr:wsDr>');
  return parts.join('\n');
}

function _assembleXlsx(sheetXml, drawingXml, sheetTitle) {
  // Build a minimal valid .xlsx from scratch as individual XML strings
  var safeTitle = sheetTitle.replace(/[\\\/\?\*\[\]\:]/g, '_').substring(0, 31);

  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml"  ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
    '</Types>';

  var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/sheet"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="' + _escXml(safeTitle) + '" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>';

  var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  var sheetRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId_drw1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
    '</Relationships>';

  var drawingRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

  // Minimal styles.xml — accent1 = cornflower blue (matches Office default theme)
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/sheet">' +
    '<fonts><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '</styleSheet>';

  // Build as Blob entries and zip via Utilities
  // Apps Script doesn't have a native zip writer, so we use base64 trick:
  // We build each file, then use the Utilities.zip approach
  var files = [
    { name: '[Content_Types].xml',                      data: contentTypes  },
    { name: '_rels/.rels',                              data: rootRels      },
    { name: 'xl/workbook.xml',                          data: workbook      },
    { name: 'xl/_rels/workbook.xml.rels',               data: wbRels        },
    { name: 'xl/worksheets/sheet1.xml',                 data: sheetXml      },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels',      data: sheetRels     },
    { name: 'xl/styles.xml',                            data: styles        },
    { name: 'xl/drawings/drawing1.xml',                 data: drawingXml    },
    { name: 'xl/drawings/_rels/drawing1.xml.rels',      data: drawingRels   },
  ];

  var blobs = files.map(function(f) {
    return Utilities.newBlob(f.data, 'application/octet-stream', f.name);
  });

  var zipped = Utilities.zip(blobs, 'flow.xlsx');
  return zipped.getBytes();
}
