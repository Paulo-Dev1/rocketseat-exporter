/**
 * Constantes de mensagens trocadas entre as partes da extensão.
 *
 * Expõe em globalThis.RocketseatExporter.messages.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});

  const api = Object.freeze({
    /** Página da extensão → content script: ler os dados da aula. */
    READ_LESSON_PAGE: 'rse:read-lesson-page',
    /** Página da extensão → service worker: abrir o painel de gerenciamento. */
    OPEN_DASHBOARD: 'rse:open-dashboard',
    /** Página da extensão → service worker: abrir a página de diagnóstico. */
    OPEN_DIAGNOSTICS: 'rse:open-diagnostics',
  });
  ns.messages = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
