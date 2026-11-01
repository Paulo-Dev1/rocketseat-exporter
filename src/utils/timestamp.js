/**
 * Conversão de tempos da transcrição.
 *
 * Evita problemas de precisão decimal: quando o valor é uma string decimal
 * simples (ex.: "65", "65.48"), a parte inteira é extraída diretamente do
 * texto, sem passar por aritmética de ponto flutuante. Os cálculos de horas,
 * minutos e segundos usam apenas inteiros.
 *
 * Expõe as funções em globalThis.RocketseatExporter.timestamp.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});

  const PLAIN_DECIMAL = /^\+?(\d+)(?:[.,](\d*))?$/;

  /**
   * Interpreta o valor bruto do atributo `time` (segundos).
   *
   * @param {unknown} raw
   * @returns {{ valid: boolean, wholeSeconds: number, seconds: number, raw: string }}
   *   wholeSeconds: segundos inteiros (parte inteira, sem arredondar para cima).
   *   seconds: valor numérico original (útil para ordenação/comparação).
   */
  function parseSeconds(raw) {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    const invalid = { valid: false, wholeSeconds: 0, seconds: NaN, raw: text };
    if (!text) return invalid;

    const match = PLAIN_DECIMAL.exec(text);
    if (match) {
      const wholeSeconds = parseInt(match[1], 10);
      if (!Number.isSafeInteger(wholeSeconds)) return invalid;
      const fraction = match[2] ? `.${match[2]}` : '';
      return {
        valid: true,
        wholeSeconds,
        seconds: Number(`${match[1]}${fraction}`),
        raw: text,
      };
    }

    // Formatos menos comuns (ex.: notação científica "1e3").
    const numeric = Number(text);
    if (!Number.isFinite(numeric) || numeric < 0) return invalid;
    const wholeSeconds = Math.floor(numeric);
    if (!Number.isSafeInteger(wholeSeconds)) return invalid;
    return { valid: true, wholeSeconds, seconds: numeric, raw: text };
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /**
   * Formata segundos inteiros como HH:MM:SS.
   * 0 → "00:00:00", 65 → "00:01:05", 3661 → "01:01:01".
   *
   * @param {number} totalSeconds inteiro não negativo
   * @returns {string}
   */
  function formatTimestamp(totalSeconds) {
    if (!Number.isSafeInteger(totalSeconds) || totalSeconds < 0) {
      throw new TypeError(`Segundos inválidos: ${totalSeconds}`);
    }
    const hours = Math.trunc(totalSeconds / 3600);
    const minutes = Math.trunc((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }

  /**
   * Converte o valor bruto do atributo `time` diretamente para HH:MM:SS.
   *
   * @param {unknown} raw
   * @returns {string|null} null se o valor for inválido
   */
  function secondsToTimestamp(raw) {
    const parsed = parseSeconds(raw);
    return parsed.valid ? formatTimestamp(parsed.wholeSeconds) : null;
  }

  /**
   * Interpreta um timestamp visual ("00:00", "01:05", "00:6.52", "00:10.06", "1:01:01").
   *
   * @param {unknown} value
   * @returns {number|null} segundos inteiros, ou null se não reconhecido
   */
  function parseVisualTimestamp(value) {
    const text = value === null || value === undefined ? '' : String(value).trim();
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,]\d+)?$/.exec(text);
    if (!match) return null;
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    if (seconds > 59 || (match[1] && minutes > 59)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  const api = { parseSeconds, formatTimestamp, secondsToTimestamp, parseVisualTimestamp };
  ns.timestamp = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

