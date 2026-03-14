/**
 * server-utils.js
 *
 * Pure-JavaScript extracts of the server-side helper functions from Code.gs.
 * These functions contain no Google Apps Script API calls, making them fully
 * testable in a standard Node.js environment.
 */

'use strict';

/**
 * Converts a 1-based column number to an Excel-style column letter (A, B, … Z, AA, AB, …).
 * @param {number} n - 1-based column index
 * @returns {string}
 */
function _colLetter(n) {
  var s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/**
 * Escapes a string for safe embedding in XML/HTML.
 * @param {string} s
 * @returns {string}
 */
function _escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Computes the column widths (in Excel columns) for each actor swimlane.
 * @param {string[]} actors
 * @returns {number[]}
 */
function _computeActorCols(actors) {
  if (actors.length === 3) return [10, 6, 54];
  if (actors.length === 2) return [10, 60];
  if (actors.length === 1) return [70];
  var perActor = Math.floor(70 / actors.length);
  var widths = [];
  for (var i = 0; i < actors.length; i++) widths.push(perActor);
  widths[actors.length - 1] += 70 - (perActor * actors.length);
  return widths;
}

/**
 * Computes drawing anchor positions for each node given actorCols and toolRows maps.
 * @param {Object[]} nodes
 * @param {Object} actorCols  - { actorName: { c1, c2 } }
 * @param {Object} toolRows   - { toolName:  { r1, r2 } }
 * @returns {Object} - { nodeId: { fc, fr, tc, tr } } (0-based)
 */
function _computeNodePositions(nodes, actorCols, toolRows) {
  var STEP_W  = 4;
  var STEP_H  = 6;
  var DEC_W   = 5;
  var DEC_H   = 10;
  var ELLIP_W = 3;
  var ELLIP_H = 4;
  var INSET   = 1;

  var positions = {};

  var sorted = nodes.slice().sort(function(a, b) {
    return (a.col || 0) - (b.col || 0);
  });

  for (var i = 0; i < sorted.length; i++) {
    var node  = sorted[i];
    var nid   = node.id;
    var tool  = node.tool  || '';
    var actor = node.actor || '';
    var ntype = node.type  || 'process';
    var ncol  = node.col !== undefined ? node.col : 0;

    var ac = actorCols[actor] || { c1: 4, c2: 13 };
    var tr = toolRows[tool]   || { r1: 6, r2: 20 };

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

    positions[nid] = { fc: fc - 1, fr: fr - 1, tc: tc - 1, tr: tfr - 1 };
  }
  return positions;
}

module.exports = { _colLetter, _escXml, _computeActorCols, _computeNodePositions };
