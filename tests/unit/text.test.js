const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWhitespace, isSeparatorText, looselyEqual } = require('../../src/utils/text.js');
const { toPlainText, formatSegmentLine } = require('../../src/utils/transcript.js');

test('normalizeWhitespace remove apenas espaços desnecessários', () => {
  assert.equal(normalizeWhitespace(' Última coisa que a gente vai fazer'), 'Última coisa que a gente vai fazer');
  assert.equal(normalizeWhitespace('linha 1\n\n  linha 2\t\tfim  '), 'linha 1 linha 2 fim');
  assert.equal(normalizeWhitespace('a\u00A0\u00A0b'), 'a b');
  assert.equal(normalizeWhitespace(null), '');
  assert.equal(normalizeWhitespace(undefined), '');
});

test('normalizeWhitespace preserva pontuação, acentos e símbolos', () => {
  const text = 'Então, vamos usar `npm run build` — ok? 100% (sim)! <div> & "aspas"';
  assert.equal(normalizeWhitespace(text), text);
});

test('isSeparatorText reconhece separadores de breadcrumb', () => {
  for (const value of ['/', '>', '›', '»', '|', '•', '—', '  /  ', '']) {
    assert.equal(isSeparatorText(value), true, value);
  }
  for (const value of ['Trilha', 'Upload widget Server', 'C#', 'A/B']) {
    assert.equal(isSeparatorText(value), false, value);
  }
});

test('looselyEqual ignora espaços e caixa', () => {
  assert.equal(looselyEqual('  Upload  Widget server', 'upload widget Server'), true);
  assert.equal(looselyEqual('Aula 1', 'Aula 2'), false);
});

test('toPlainText gera uma linha por segmento, na ordem recebida', () => {
  const segments = [
    { timestamp: '00:00:00', text: 'Última coisa que a gente vai fazer.' },
    { timestamp: '00:00:08', text: 'Agora vamos configurar o projeto.' },
  ];
  assert.equal(formatSegmentLine(segments[0]), '[00:00:00] Última coisa que a gente vai fazer.');
  assert.equal(
    toPlainText(segments),
    '[00:00:00] Última coisa que a gente vai fazer.\n\n[00:00:08] Agora vamos configurar o projeto.'
  );
  assert.equal(toPlainText([]), '');
});

