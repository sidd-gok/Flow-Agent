'use strict';

const { extractXml, extractJson, cleanTranscript, formatModelLabel } = require('./client-utils');

// ═══════════════════════════════════════════════════════════════════════════════
//  extractXml — pull Draw.io XML from a Gemini raw response
// ═══════════════════════════════════════════════════════════════════════════════
describe('extractXml', () => {
  const VALID_XML = '<mxGraphModel><root></root></mxGraphModel>';

  test('returns bare XML unchanged', () => {
    expect(extractXml(VALID_XML)).toBe(VALID_XML);
  });

  test('strips leading markdown ```xml fences', () => {
    const raw = '```xml\n' + VALID_XML + '\n```';
    expect(extractXml(raw)).toBe(VALID_XML);
  });

  test('strips generic ``` fences', () => {
    const raw = '```\n' + VALID_XML + '\n```';
    expect(extractXml(raw)).toBe(VALID_XML);
  });

  test('strips surrounding prose', () => {
    const raw = 'Here is the diagram:\n' + VALID_XML + '\nLet me know if you need changes.';
    expect(extractXml(raw)).toBe(VALID_XML);
  });

  test('returns null when <mxGraphModel is missing', () => {
    expect(extractXml('<root></root>')).toBeNull();
  });

  test('returns null when </mxGraphModel> closing tag is missing', () => {
    expect(extractXml('<mxGraphModel><root></root>')).toBeNull();
  });

  test('returns null on empty string', () => {
    expect(extractXml('')).toBeNull();
  });

  test('includes attributes on the opening tag', () => {
    const xml = '<mxGraphModel dx="100" dy="200"><root></root></mxGraphModel>';
    expect(extractXml(xml)).toBe(xml);
  });

  test('handles multiple fences — extracts the XML block', () => {
    const xml  = '<mxGraphModel><root></root></mxGraphModel>';
    const raw  = 'Step 1:\n```\nsome code\n```\nHere is the XML:\n```xml\n' + xml + '\n```';
    expect(extractXml(raw)).toBe(xml);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  extractJson — pull enterprise flow JSON from a Gemini raw response
// ═══════════════════════════════════════════════════════════════════════════════
describe('extractJson', () => {
  const OBJ = { title: 'Test', nodes: [], edges: [] };
  const OBJ_STR = JSON.stringify(OBJ);

  test('parses a bare JSON object string', () => {
    expect(extractJson(OBJ_STR)).toEqual(OBJ);
  });

  test('strips ```json fences', () => {
    const raw = '```json\n' + OBJ_STR + '\n```';
    expect(extractJson(raw)).toEqual(OBJ);
  });

  test('strips generic ``` fences', () => {
    const raw = '```\n' + OBJ_STR + '\n```';
    expect(extractJson(raw)).toEqual(OBJ);
  });

  test('strips surrounding prose', () => {
    const raw = 'Here is the JSON:\n' + OBJ_STR + '\nEnd.';
    expect(extractJson(raw)).toEqual(OBJ);
  });

  test('returns null for text with no { }', () => {
    expect(extractJson('no json here')).toBeNull();
  });

  test('returns null for malformed JSON', () => {
    expect(extractJson('{ "a": }')).toBeNull();
  });

  test('returns null on empty string', () => {
    expect(extractJson('')).toBeNull();
  });

  test('parses nested objects correctly', () => {
    const nested = { nodes: [{ id: 'n1', type: 'process' }], edges: [{ from: 'n1', to: 'n2' }] };
    expect(extractJson(JSON.stringify(nested))).toEqual(nested);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  cleanTranscript — strip filler words from a voice transcript
// ═══════════════════════════════════════════════════════════════════════════════
describe('cleanTranscript', () => {
  test('removes "um" variants', () => {
    expect(cleanTranscript('Um, the process starts here')).toBe('the process starts here');
    expect(cleanTranscript('umm the step')).toBe('the step');
  });

  test('removes "uh" variants', () => {
    expect(cleanTranscript('uh the form is submitted')).toBe('the form is submitted');
    expect(cleanTranscript('uhh, next')).toBe('next');
  });

  test('removes "er" variants', () => {
    expect(cleanTranscript('er, the manager approves')).toBe('the manager approves');
  });

  test('removes "ah" and "hmm"', () => {
    expect(cleanTranscript('ah, I see. Hmm, ok')).toBe('I see. ok');
  });

  test('removes "you know"', () => {
    expect(cleanTranscript('you know, the flow is simple')).toBe('the flow is simple');
  });

  test('removes "i mean"', () => {
    expect(cleanTranscript('I mean the request is sent')).toBe('the request is sent');
  });

  test('removes "like, " when followed by a lowercase word', () => {
    expect(cleanTranscript('it is like, a big process')).toBe('it is a big process');
  });

  test('collapses multiple spaces to one', () => {
    expect(cleanTranscript('the   form   is   filled')).toBe('the form is filled');
  });

  test('trims leading and trailing whitespace', () => {
    expect(cleanTranscript('  hello world  ')).toBe('hello world');
  });

  test('leaves clean text unchanged', () => {
    expect(cleanTranscript('An employee submits a purchase request.')).toBe(
      'An employee submits a purchase request.'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  formatModelLabel — human-readable label from a Gemini model ID
// ═══════════════════════════════════════════════════════════════════════════════
describe('formatModelLabel', () => {
  test('formats gemini-2.5-flash → Gemini 2.5 Flash', () => {
    expect(formatModelLabel('gemini-2.5-flash')).toBe('Gemini 2.5 Flash');
  });

  test('formats gemini-1.5-pro → Gemini 1.5 Pro', () => {
    expect(formatModelLabel('gemini-1.5-pro')).toBe('Gemini 1.5 Pro');
  });

  test('strips the "models/" prefix if present', () => {
    expect(formatModelLabel('models/gemini-2.0-flash')).toBe('Gemini 2.0 Flash');
  });

  test('capitalises each word', () => {
    expect(formatModelLabel('gemini-2.5-flash-lite')).toBe('Gemini 2.5 Flash Lite');
  });

  test('handles exp suffix', () => {
    expect(formatModelLabel('gemini-2.0-flash-exp')).toBe('Gemini 2.0 Flash Exp');
  });
});
