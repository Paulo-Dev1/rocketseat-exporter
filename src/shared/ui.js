/**
 * Helpers de interface compartilhados pelas páginas da extensão.
 *
 * Todo conteúdo vindo da página da Rocketseat é inserido com textContent
 * (nunca innerHTML), evitando injeção de HTML nas páginas da extensão.
 *
 * Expõe em globalThis.RocketseatExporter.ui.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});

  /**
   * Cria um elemento.
   *
   * @param {string} tag
   * @param {object} [attrs] atributos; "className", "text", "dataset" e "on*" são tratados à parte
   * @param {...(Node|string|null|undefined|false)} children
   * @returns {HTMLElement}
   */
  function h(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'className') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key === 'dataset') Object.assign(element.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value);
      } else element.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
  }

  const STATUS_LABELS = {
    ok: 'Leitura completa',
    warning: 'Leitura com avisos',
    error: 'Leitura com problemas',
  };

  const LEVEL_LABELS = { error: 'Erro', warning: 'Aviso', info: 'Info' };

  function statusPill(status) {
    return h('span', { className: `pill pill--${status}`, text: STATUS_LABELS[status] || status });
  }

  /** Renderiza a lista de problemas/avisos da leitura. */
  function renderIssues(issues) {
    if (!issues || !issues.length) {
      return h('p', { className: 'issues-empty', text: 'Nenhum problema encontrado.' });
    }
    const order = { error: 0, warning: 1, info: 2 };
    const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
    return h(
      'ul',
      { className: 'issues' },
      sorted.map((issue) =>
        h(
          'li',
          { className: `issue issue--${issue.level}` },
          h('span', { className: 'issue__level', text: LEVEL_LABELS[issue.level] || issue.level }),
          h('span', { className: 'issue__message', text: issue.message })
        )
      )
    );
  }

  /** Valor de um campo de contexto, ou um aviso de "não identificado". */
  function contextValue(field) {
    if (field && field.value) return h('span', { className: 'value', text: field.value });
    return h('span', { className: 'value value--missing', text: 'Não identificado' });
  }

  function formatDateTime(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch (_error) {
      return iso;
    }
  }

  /** Mostra uma mensagem temporária num elemento (ex.: "Copiado!"). */
  function flash(element, message, ms = 1800) {
    const original = element.dataset.originalText || element.textContent;
    element.dataset.originalText = original;
    element.textContent = message;
    clearTimeout(element._flashTimer);
    element._flashTimer = setTimeout(() => {
      element.textContent = original;
    }, ms);
  }

  const api = { h, statusPill, renderIssues, contextValue, formatDateTime, flash, STATUS_LABELS };
  ns.ui = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

