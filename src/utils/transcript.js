/**
 * Formatação de transcrições já capturadas.
 *
 * Expõe as funções em globalThis.RocketseatExporter.transcript.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});

  /**
   * Gera uma linha "[HH:MM:SS] texto" para um segmento.
   *
   * @param {{ timestamp: string, text: string }} segment
   * @returns {string}
   */
  function formatSegmentLine(segment) {
    return `[${segment.timestamp}] ${segment.text}`;
  }

  /**
   * Gera o texto completo da transcrição, um segmento por parágrafo,
   * preservando a ordem recebida.
   *
   * @param {Array<{ timestamp: string, text: string }>} segments
   * @returns {string}
   */
  function toPlainText(segments) {
    return (segments || []).map(formatSegmentLine).join('\n\n');
  }

  const api = { formatSegmentLine, toPlainText };
  ns.transcript = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

