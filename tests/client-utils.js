/**
 * client-utils.js
 *
 * Pure-JavaScript extracts of client-side helper functions from Index.html.
 * These functions have no DOM, localStorage, or network dependencies and can
 * be tested in a standard Node.js environment.
 */

'use strict';

/**
 * Extracts the first <mxGraphModel … </mxGraphModel> block from a raw string
 * (which may include markdown fences or other prose from Gemini).
 * @param {string} raw
 * @returns {string|null}
 */
function extractXml(raw) {
  let clean = raw.replace(/```xml\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('<mxGraphModel');
  const end   = clean.lastIndexOf('</mxGraphModel>');
  if (start === -1 || end === -1) return null;
  return clean.slice(start, end + '</mxGraphModel>'.length);
}

/**
 * Extracts the first complete JSON object from a raw string, stripping any
 * markdown fences that Gemini may have added.
 * @param {string} raw
 * @returns {Object|null}
 */
function extractJson(raw) {
  let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch(e) {
    return null;
  }
}

/**
 * Strips common filler words and normalises whitespace from a voice transcript.
 * @param {string} text
 * @returns {string}
 */
function cleanTranscript(text) {
  return text
    .replace(/\b(um+|uh+|er+|ah+|hmm+)\b[,.]?\s*/gi, '')
    .replace(/\byou know[,.]?\s*/gi, '')
    .replace(/\bi mean[,.]?\s*/gi, '')
    .replace(/\blike,\s+(?=[a-z])/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Formats a raw Gemini model ID into a human-readable label.
 * @param {string} modelId
 * @returns {string}
 */
function formatModelLabel(modelId) {
  return modelId
    .replace(/^models\//, '')
    .replace(/gemini-/i, 'Gemini ')
    .replace(/-/g, ' ')
    .replace(/\b(\w)/g, c => c.toUpperCase())
    .trim();
}

module.exports = { extractXml, extractJson, cleanTranscript, formatModelLabel };
