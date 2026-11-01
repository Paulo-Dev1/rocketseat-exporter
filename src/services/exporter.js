/**
 * Exportação dos arquivos Markdown locais utilizando a File System Access API
 * (Seções 4, 7, 8 e 11 da especificação).
 *
 * Responsabilidades:
 * - Selecionar a pasta de destino (`showDirectoryPicker`) em uma página da
 *   extensão mediante clique explícito do usuário.
 * - Persistir o `FileSystemDirectoryHandle` no IndexedDB (`database.js`) e o
 *   nome/status leve no `chrome.storage.local` (`storage.js`).
 * - Verificar e solicitar permissões de gravação (`queryPermission` / `requestPermission`).
 * - Criar automaticamente a estrutura `<Pasta>/<Pós-graduação>/<Trilha>/<materia>.md`.
 * - Criar ou atualizar o arquivo `.md` correspondente à matéria a partir do
 *   IndexedDB, sem nunca apagar pastas ou arquivos de outras matérias.
 *
 * Depende de: utils/slugify.js, services/database.js, services/storage.js, services/markdown.js.
 * Expõe as funções em globalThis.RocketseatExporter.exporter.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});
  const hasRequire = typeof require === 'function';
  const slugUtils = ns.slugify || (hasRequire ? require('../utils/slugify.js') : null);
  const database = ns.database || (hasRequire ? require('./database.js') : null);
  const storage = ns.storage || (hasRequire ? require('./storage.js') : null);
  const markdown = ns.markdown || (hasRequire ? require('./markdown.js') : null);

  if (!slugUtils || !database || !storage || !markdown) {
    throw new Error('exporter.js: carregue slugify.js, database.js, storage.js e markdown.js antes.');
  }

  const { toSafeFolderName, toMarkdownFilename } = slugUtils;
  const { generateSubjectMarkdown } = markdown;

  const READWRITE_OPTIONS = Object.freeze({ mode: 'readwrite' });

  /**
   * Consulta o estado atual da permissão de um FileSystemDirectoryHandle.
   *
   * @param {FileSystemDirectoryHandle|null} handle
   * @returns {Promise<'granted'|'prompt'|'denied'|'missing'>}
   */
  async function queryHandlePermission(handle) {
    if (!handle) return 'missing';
    if (typeof handle.queryPermission !== 'function') return 'granted';
    try {
      return await handle.queryPermission(READWRITE_OPTIONS);
    } catch (_error) {
      return 'prompt';
    }
  }

  /**
   * Solicita permissão de escrita ao usuário para um FileSystemDirectoryHandle
   * já armazenado (precisa ser chamado em resposta a um clique do usuário).
   *
   * @param {FileSystemDirectoryHandle|null} [customHandle]
   * @returns {Promise<{ granted: boolean, permission: string, name: string|null }>}
   */
  async function requestDirectoryPermission(customHandle = null) {
    const record = customHandle ? { handle: customHandle, name: customHandle.name } : await database.getDirectoryHandleRecord();
    if (!record || !record.handle) {
      throw new Error('Nenhuma pasta de destino selecionada ainda. Clique em "Selecionar pasta".');
    }

    const handle = record.handle;
    let permission = await queryHandlePermission(handle);
    if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission(READWRITE_OPTIONS);
    }

    return {
      granted: permission === 'granted',
      permission,
      name: record.name || handle.name || null,
    };
  }

  /**
   * Retorna o status completo da pasta de destino (se está configurada, nome
   * da pasta e estado atual da permissão `granted` | `prompt` | `denied` | `missing`).
   *
   * @returns {Promise<{
   *   configured: boolean,
   *   name: string|null,
   *   savedAt: string|null,
   *   permission: 'granted'|'prompt'|'denied'|'missing',
   *   canWriteNow: boolean,
   *   needsPermissionPrompt: boolean
   * }>}
   */
  async function getDirectoryStatus() {
    const [record, settings] = await Promise.all([
      database.getDirectoryHandleRecord(),
      storage.getSettings(),
    ]);

    if (!record || !record.handle) {
      return {
        configured: false,
        name: settings.directoryName || null,
        savedAt: settings.directorySelectedAt || null,
        permission: 'missing',
        canWriteNow: false,
        needsPermissionPrompt: false,
      };
    }

    const permission = await queryHandlePermission(record.handle);
    return {
      configured: true,
      name: record.name || record.handle.name || settings.directoryName || 'Pasta selecionada',
      savedAt: record.savedAt || settings.directorySelectedAt || null,
      permission,
      canWriteNow: permission === 'granted',
      needsPermissionPrompt: permission === 'prompt' || permission === 'denied',
    };
  }

  /**
   * Abre o seletor de pastas do navegador (`window.showDirectoryPicker`),
   * persiste o handle no IndexedDB e registra o nome nas configurações.
   *
   * Deve ser chamado exclusivamente a partir de uma página da extensão (ex.:
   * `dashboard.html`) mediante clique explícito do usuário.
   *
   * @param {Function} [pickerFn] injetável para testes
   * @returns {Promise<{ name: string, savedAt: string, permission: string }>}
   */
  async function selectArchiveDirectory(pickerFn = null) {
    const picker =
      pickerFn ||
      (typeof root.showDirectoryPicker === 'function' ? root.showDirectoryPicker.bind(root) : null);

    if (!picker) {
      throw new Error(
        'A API showDirectoryPicker() não está disponível neste contexto. Abra o Painel de Gerenciamento no Google Chrome.'
      );
    }

    const handle = await picker({ mode: 'readwrite' });
    if (!handle) {
      throw new Error('Nenhuma pasta foi selecionada.');
    }

    let permission = await queryHandlePermission(handle);
    if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission(READWRITE_OPTIONS);
    }

    const record = await database.saveDirectoryHandle(handle);
    await storage.updateSettings({
      directoryName: record.name,
      directorySelectedAt: record.savedAt,
    });

    return {
      name: record.name,
      savedAt: record.savedAt,
      permission,
    };
  }

  /**
   * Garante que temos o handle da pasta raiz com permissão `granted`.
   *
   * @param {{ requestIfNeeded?: boolean }} [options]
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  async function getWritableRootHandle(options = {}) {
    const { requestIfNeeded = true } = options;
    const record = await database.getDirectoryHandleRecord();

    if (!record || !record.handle) {
      throw new Error(
        'Pasta de destino ainda não selecionada. Abra o Painel de Gerenciamento e escolha uma pasta local.'
      );
    }

    const handle = record.handle;
    let permission = await queryHandlePermission(handle);

    if (permission !== 'granted' && requestIfNeeded && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission(READWRITE_OPTIONS);
    }

    if (permission !== 'granted') {
      throw new Error(
        'A permissão de escrita na pasta expirou ou foi negada. Clique em "Conceder permissão" ou selecione a pasta novamente no Painel de Gerenciamento.'
      );
    }

    return handle;
  }

  /**
   * Escreve um arquivo Markdown na estrutura `<root>/<Pós>/<Trilha>/<arquivo>.md`.
   *
   * @param {FileSystemDirectoryHandle} rootHandle
   * @param {{ postgraduate: string, track: string, subject: string, lessons: Array<object> }} subjectData
   * @returns {Promise<{
   *   subjectKey: string,
   *   relativePath: string,
   *   filename: string,
   *   lessonCount: number,
   *   exportedAt: string,
   *   bytesWritten: number
   * }>}
   */
  async function writeSubjectMarkdownToDirectory(rootHandle, subjectData) {
    const postFolder = toSafeFolderName(subjectData.postgraduate);
    const trackFolder = toSafeFolderName(subjectData.track);
    const filename = subjectData.markdownFilename || toMarkdownFilename(subjectData.subject);
    const exportedAt = new Date().toISOString();

    const markdownContent = generateSubjectMarkdown({
      postgraduate: subjectData.postgraduate,
      track: subjectData.track,
      subject: subjectData.subject,
      lessons: subjectData.lessons,
      updatedAt: exportedAt,
    });

    // Cria ou abre as pastas <Pós-graduação>/<Trilha>
    const postDirHandle = await rootHandle.getDirectoryHandle(postFolder, { create: true });
    const trackDirHandle = await postDirHandle.getDirectoryHandle(trackFolder, { create: true });

    // Cria ou substitui exclusivamente o arquivo .md desta matéria
    const fileHandle = await trackDirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(markdownContent);
    await writable.close();

    const relativePath = `${postFolder}/${trackFolder}/${filename}`;
    await storage.recordSubjectExport(subjectData.subjectKey, {
      exportedAt,
      lessonCount: subjectData.lessons.length,
      relativePath,
    });

    return {
      subjectKey: subjectData.subjectKey,
      relativePath,
      filename,
      lessonCount: subjectData.lessons.length,
      exportedAt,
      bytesWritten: markdownContent.length,
    };
  }

  /**
   * Exporta (cria ou atualiza) o arquivo Markdown de uma única matéria a partir
   * de todas as aulas daquela matéria salvas no IndexedDB.
   *
   * @param {string} subjectKey
   * @param {{ requestPermissionIfNeeded?: boolean, rootHandle?: FileSystemDirectoryHandle }} [options]
   * @returns {Promise<object>}
   */
  async function exportSubjectByKey(subjectKey, options = {}) {
    if (!subjectKey) {
      throw new Error('Chave da matéria não informada para exportação.');
    }

    const lessons = await database.getLessonsBySubject(subjectKey);
    if (!lessons.length) {
      throw new Error('Nenhuma aula encontrada no IndexedDB para esta matéria.');
    }

    const rootHandle =
      options.rootHandle ||
      (await getWritableRootHandle({
        requestIfNeeded: options.requestPermissionIfNeeded !== false,
      }));

    const first = lessons[0];
    return writeSubjectMarkdownToDirectory(rootHandle, {
      subjectKey,
      postgraduate: first.postgraduate,
      track: first.track,
      subject: first.subject,
      markdownFilename: first.markdownFilename,
      lessons,
    });
  }

  /**
   * Exporta/atualiza os arquivos Markdown de todas as matérias cadastradas no
   * IndexedDB. Nunca apaga arquivos de outras matérias.
   *
   * @param {{ rootHandle?: FileSystemDirectoryHandle }} [options]
   * @returns {Promise<{
   *   exportedAt: string,
   *   totalSubjects: number,
   *   totalLessons: number,
   *   results: Array<object>,
   *   failures: Array<{ subjectKey: string, subject: string, error: string }>
   * }>}
   */
  async function exportAllSubjects(options = {}) {
    const summary = await database.getArchiveSummary();
    if (!summary.subjects.length) {
      throw new Error('Ainda não há aulas capturadas no IndexedDB para exportar.');
    }

    const rootHandle = options.rootHandle || (await getWritableRootHandle({ requestIfNeeded: true }));
    const results = [];
    const failures = [];

    for (const subjectEntry of summary.subjects) {
      try {
        const res = await writeSubjectMarkdownToDirectory(rootHandle, subjectEntry);
        results.push(res);
      } catch (error) {
        failures.push({
          subjectKey: subjectEntry.subjectKey,
          subject: subjectEntry.subject,
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    const exportedAt = new Date().toISOString();
    if (results.length > 0 && failures.length === 0) {
      await storage.updateSettings({ lastFullExportAt: exportedAt });
    }

    return {
      exportedAt,
      totalSubjects: results.length,
      totalLessons: results.reduce((acc, item) => acc + item.lessonCount, 0),
      results,
      failures,
    };
  }

  const api = {
    queryHandlePermission,
    requestDirectoryPermission,
    getDirectoryStatus,
    selectArchiveDirectory,
    getWritableRootHandle,
    writeSubjectMarkdownToDirectory,
    exportSubjectByKey,
    exportAllSubjects,
  };
  ns.exporter = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

