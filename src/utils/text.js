/**
 * Utilitários de texto.
 *
 * Arquivo em formato "script clássico": funciona como content script,
 * em páginas da extensão (via <script>) e no Node.js (via require) para testes.
 * Expõe as funções em globalThis.RocketseatExporter.text.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});

  /**
   * Normaliza apenas espaços e quebras de linha desnecessários.
   * - Converte qualquer sequência de espaços, tabs, quebras de linha e
   *   espaços não separáveis (NBSP) em um único espaço.
   * - Remove espaços no início e no fim.
   * Nenhum outro caractere é alterado ou removido.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeWhitespace(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/[\s\u00A0\u2007\u202F]+/g, ' ')
      .trim();
  }

  /**
   * Indica se um texto é apenas um separador visual de breadcrumb
   * (ex.: "/", ">", "›", "»", "|", "•").
   *
   * @param {string} value
   * @returns {boolean}
   */
  function isSeparatorText(value) {
    const text = normalizeWhitespace(value);
    if (!text) return true;
    return /^[\/\\>›»<‹«|•·\-–—:]+$/.test(text);
  }

  /**
   * Compara dois textos ignorando diferenças de espaços e de caixa.
   *
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  function looselyEqual(a, b) {
    return (
      normalizeWhitespace(a).toLocaleLowerCase('pt-BR') ===
      normalizeWhitespace(b).toLocaleLowerCase('pt-BR')
    );
  }

  const api = { normalizeWhitespace, isSeparatorText, looselyEqual };
  ns.text = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

