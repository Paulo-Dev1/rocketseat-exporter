/**
 * Service Worker da extensão (Manifest V3).
 *
 * Responsabilidades (Seção 10):
 * - Coordenação de mensagens internas da extensão (ex.: abrir ou focar o
 *   painel de gerenciamento e a página de diagnóstico).
 * - Nunca chama `showDirectoryPicker()` (que só pode rodar em página da
 *   extensão mediante clique explícito do usuário) nem faz requisições externas.
 */
'use strict';

importScripts('../shared/messages.js');

const { messages } = globalThis.RocketseatExporter;

async function openOrFocusExtensionPage(relativePath) {
  const targetUrl = chrome.runtime.getURL(relativePath);
  const basePath = targetUrl.split('?')[0];
  const existingTabs = await chrome.tabs.query({ url: `${basePath}*` });

  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id, { active: true, url: targetUrl });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return tab;
  }

  return chrome.tabs.create({ url: targetUrl });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === messages.OPEN_DASHBOARD) {
    const query = message.subjectKey
      ? `?subjectKey=${encodeURIComponent(message.subjectKey)}`
      : '';
    openOrFocusExtensionPage(`src/dashboard/dashboard.html${query}`)
      .then((tab) => sendResponse({ ok: true, tabId: tab.id }))
      .catch((error) =>
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) })
      );
    return true;
  }

  if (message.type === messages.OPEN_DIAGNOSTICS) {
    const query = message.tabId ? `?tabId=${encodeURIComponent(message.tabId)}` : '';
    openOrFocusExtensionPage(`src/diagnostics/diagnostics.html${query}`)
      .then((tab) => sendResponse({ ok: true, tabId: tab.id }))
      .catch((error) =>
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) })
      );
    return true;
  }

  return false;
});

