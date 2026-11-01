/**
 * Configurações pequenas da extensão armazenadas em `chrome.storage.local`
 * (Seção 2 e Seção 10 da especificação).
 *
 * Nunca armazena o FileSystemDirectoryHandle (que fica no IndexedDB), apenas
 * preferências e carimbos leves:
 * - nome da pasta escolhida;
 * - data/hora da última exportação geral;
 * - status/carimbo de exportação por matéria;
 * - preferência de exportar automaticamente ao capturar.
 *
 * Possui fallback em memória quando executado fora do contexto de extensão
 * (ex.: testes automatizados em Node).
 *
 * Expõe as funções em globalThis.RocketseatExporter.storage.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});

  const STORAGE_KEY = 'rse_settings_v1';

  const DEFAULT_SETTINGS = Object.freeze({
    directoryName: null,
    directorySelectedAt: null,
    autoExportOnCapture: true,
    lastFullExportAt: null,
    subjectExports: {}, // { [subjectKey]: { exportedAt, lessonCount, relativePath } }
  });

  const memoryFallback = {};

  function hasChromeStorage() {
    return (
      typeof chrome === 'object' &&
      chrome !== null &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function'
    );
  }

  async function readRaw() {
    if (hasChromeStorage()) {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      return data && data[STORAGE_KEY] ? data[STORAGE_KEY] : {};
    }
    return memoryFallback[STORAGE_KEY] || {};
  }

  async function writeRaw(value) {
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [STORAGE_KEY]: value });
      return;
    }
    memoryFallback[STORAGE_KEY] = structuredClone(value);
  }

  /**
   * Obtém as configurações mescladas com os valores padrão.
   *
   * @returns {Promise<object>}
   */
  async function getSettings() {
    const stored = await readRaw();
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      subjectExports: {
        ...(DEFAULT_SETTINGS.subjectExports || {}),
        ...(stored.subjectExports || {}),
      },
    };
  }

  /**
   * Atualiza parcialmente as configurações.
   *
   * @param {object} patch
   * @returns {Promise<object>} configurações atualizadas
   */
  async function updateSettings(patch) {
    const current = await getSettings();
    const next = {
      ...current,
      ...patch,
      subjectExports: {
        ...current.subjectExports,
        ...(patch.subjectExports || {}),
      },
    };
    await writeRaw(next);
    return next;
  }

  /**
   * Registra a conclusão da exportação de uma matéria.
   *
   * @param {string} subjectKey
   * @param {{ exportedAt?: string, lessonCount: number, relativePath: string }} meta
   * @returns {Promise<object>}
   */
  async function recordSubjectExport(subjectKey, meta) {
    const current = await getSettings();
    const exportedAt = meta.exportedAt || new Date().toISOString();
    const next = {
      ...current,
      subjectExports: {
        ...current.subjectExports,
        [subjectKey]: {
          exportedAt,
          lessonCount: Number(meta.lessonCount || 0),
          relativePath: String(meta.relativePath || ''),
        },
      },
    };
    await writeRaw(next);
    return next;
  }

  const api = {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    getSettings,
    updateSettings,
    recordSubjectExport,
  };
  ns.storage = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

