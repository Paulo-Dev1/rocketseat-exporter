/**
 * Cliente usado pelas páginas da extensão (popup e diagnóstico) para pedir
 * ao content script a leitura de uma aba da plataforma.
 *
 * Se o content script ainda não estiver presente na aba (por exemplo, a aba
 * foi aberta antes de instalar/recarregar a extensão), ele é injetado com
 * chrome.scripting, somente no domínio da plataforma.
 *
 * Depende de: shared/messages.js.
 * Expõe em globalThis.RocketseatExporter.pageReader.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});

  const PLATFORM_ORIGIN = 'https://ftr.rocketseat.com.br';

  class PageReaderError extends Error {
    /**
     * @param {'not-platform'|'no-tab'|'read-failed'|'injection-failed'} code
     * @param {string} message
     */
    constructor(code, message) {
      super(message);
      this.name = 'PageReaderError';
      this.code = code;
    }
  }

  function isPlatformUrl(url) {
    if (!url) return false;
    try {
      return new URL(url).origin === PLATFORM_ORIGIN;
    } catch (_error) {
      return false;
    }
  }

  function contentScriptFiles() {
    const entries = chrome.runtime.getManifest().content_scripts || [];
    const entry = entries.find((item) => (item.matches || []).some((m) => m.startsWith(PLATFORM_ORIGIN)));
    return entry ? entry.js : [];
  }

  function isMissingReceiverError(error) {
    const message = error && error.message ? error.message : '';
    return /Receiving end does not exist|Could not establish connection/i.test(message);
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  /** Lista as abas abertas da plataforma (visíveis graças à host permission). */
  async function listPlatformTabs() {
    return chrome.tabs.query({ url: `${PLATFORM_ORIGIN}/*` });
  }

  function requestRead(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: ns.messages.READ_LESSON_PAGE });
  }

  /**
   * Lê os dados da aula de uma aba.
   *
   * @param {number} tabId
   * @returns {Promise<object>} resultado do course-parser
   */
  async function readLessonFromTab(tabId) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_error) {
      throw new PageReaderError('no-tab', 'A aba da aula não está mais aberta.');
    }

    if (!isPlatformUrl(tab.url)) {
      throw new PageReaderError(
        'not-platform',
        'Esta aba não é uma página da plataforma Rocketseat (ftr.rocketseat.com.br). Abra uma aula e tente novamente.'
      );
    }

    let response;
    try {
      response = await requestRead(tabId);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        throw new PageReaderError('read-failed', `Falha ao comunicar com a página: ${error.message}`);
      }
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: contentScriptFiles() });
        response = await requestRead(tabId);
      } catch (injectionError) {
        throw new PageReaderError(
          'injection-failed',
          `Não foi possível acessar a página. Recarregue a aba da aula (F5) e tente novamente. Detalhe: ${injectionError.message}`
        );
      }
    }

    if (!response) {
      throw new PageReaderError('read-failed', 'A página não respondeu. Recarregue a aba da aula e tente novamente.');
    }
    if (!response.ok) {
      throw new PageReaderError('read-failed', `Erro ao ler a página: ${response.error}`);
    }
    return response.result;
  }

  const api = {
    PLATFORM_ORIGIN,
    PageReaderError,
    isPlatformUrl,
    getActiveTab,
    listPlatformTabs,
    readLessonFromTab,
  };
  ns.pageReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

