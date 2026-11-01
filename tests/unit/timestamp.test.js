const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSeconds,
  formatTimestamp,
  secondsToTimestamp,
  parseVisualTimestamp,
} = require('../../src/utils/timestamp.js');

test('converte os exemplos da especificação', () => {
  assert.equal(secondsToTimestamp('0'), '00:00:00');
  assert.equal(secondsToTimestamp('65'), '00:01:05');
  assert.equal(secondsToTimestamp('3661'), '01:01:01');
});

test('aceita números além de strings', () => {
  assert.equal(secondsToTimestamp(0), '00:00:00');
  assert.equal(secondsToTimestamp(65), '00:01:05');
  assert.equal(secondsToTimestamp(3661), '01:01:01');
});

test('valores decimais usam a parte inteira, sem erro de precisão', () => {
  assert.equal(secondsToTimestamp('59.999999999'), '00:00:59');
  assert.equal(secondsToTimestamp('60.0'), '00:01:00');
  assert.equal(secondsToTimestamp('8.48'), '00:00:08');
  assert.equal(secondsToTimestamp('3599.9999999999995'), '00:59:59');
  assert.equal(secondsToTimestamp(0.1 + 0.2), '00:00:00');
  assert.equal(secondsToTimestamp('12,5'), '00:00:12');
  assert.equal(secondsToTimestamp(' 65 '), '00:01:05');
});

test('limites de minutos e horas', () => {
  assert.equal(secondsToTimestamp('59'), '00:00:59');
  assert.equal(secondsToTimestamp('3599'), '00:59:59');
  assert.equal(secondsToTimestamp('3600'), '01:00:00');
  assert.equal(secondsToTimestamp('86399'), '23:59:59');
  assert.equal(secondsToTimestamp('360000'), '100:00:00');
});

test('valores inválidos retornam null', () => {
  for (const value of ['', '  ', 'abc', '-1', '-0.5', 'NaN', 'Infinity', null, undefined, '1:00']) {
    assert.equal(secondsToTimestamp(value), null, `valor: ${JSON.stringify(value)}`);
  }
});

test('parseSeconds preserva o valor original para ordenação', () => {
  const parsed = parseSeconds('8.48');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.wholeSeconds, 8);
  assert.equal(parsed.seconds, 8.48);
  assert.equal(parsed.raw, '8.48');
  assert.equal(parseSeconds('1e3').wholeSeconds, 1000);
});

test('formatTimestamp rejeita valores não inteiros ou negativos', () => {
  assert.throws(() => formatTimestamp(1.5));
  assert.throws(() => formatTimestamp(-1));
  assert.throws(() => formatTimestamp(NaN));
});

test('parseVisualTimestamp interpreta MM:SS, MM:S.cc e H:MM:SS', () => {
  assert.equal(parseVisualTimestamp('00:00'), 0);
  assert.equal(parseVisualTimestamp('01:05'), 65);
  assert.equal(parseVisualTimestamp('00:6.52'), 6);
  assert.equal(parseVisualTimestamp('00:10.06'), 10);
  assert.equal(parseVisualTimestamp('00:15.9'), 15);
  assert.equal(parseVisualTimestamp('1:01:01'), 3661);
  assert.equal(parseVisualTimestamp('75:30'), 4530);
  assert.equal(parseVisualTimestamp(' 00:08 '), 8);
  assert.equal(parseVisualTimestamp('00:60'), null);
  assert.equal(parseVisualTimestamp('1:60:00'), null);
  assert.equal(parseVisualTimestamp('abc'), null);
  assert.equal(parseVisualTimestamp(''), null);
});

