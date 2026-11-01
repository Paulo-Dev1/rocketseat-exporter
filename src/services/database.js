/**
 * Persistência local no IndexedDB.
 *
 * Armazena as aulas capturadas com seus metadados e transcrições integrais.
 *
 * Regras de negócio atendidas (Seção 6):
 * - Cada aula possui: id, subjectKey, url, canonicalUrl, postgraduate, track,
 *   subject, lesson, segments, transcriptText, segmentCount, capturedAt, updatedAt.
 * - Identificação única baseada no contexto completo (pós + trilha + matéria + aula),
 *   evitando duplicatas da mesma aula e evitando colisões entre aulas de mesmo nome
 *   em matérias diferentes.
 * - Ao salvar uma aula já existente:
 *   - Não cria duplicata;
 *   - Preserva `capturedAt` (data/hora da captura original);
 *   - Atualiza `updatedAt`, `segments`, `transcriptText`, `segmentCount` e metadados.
 *
 * Depende de: utils/text.js, utils/slugify.js, utils/transcript.js.
 * Expõe as funções em globalThis.RocketseatExporter.database.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});
  const hasRequire = typeof require === 'function';
  const textUtils = ns.text || (hasRequire ? require('../utils/text.js') : null);
  const slugUtils = ns.slugify || (hasRequire ? require('../utils/slugify.js') : null);
  const transcriptUtils = ns.transcript || (hasRequire ? require('../utils/transcript.js') : null);

  if (!textUtils || !slugUtils || !transcriptUtils) {
    throw new Error('database.js: carregue text.js, slugify.js e transcript.js antes.');
  }

  const { normalizeWhitespace } = textUtils;
  const { buildSubjectKey, buildLessonId, toMarkdownFilename, toSafeFolderName } = slugUtils;
  const { toPlainText } = transcriptUtils;

  const DB_NAME = 'rocketseat-exporter-db';
  const DB_VERSION = 1;
  const LESSONS_STORE = 'lessons';
  const HANDLES_STORE = 'handles'; // reservado para persistir FileSystemDirectoryHandle na Etapa 4

  let dbPromise = null;

  /**
   * Abre (ou reutiliza) a conexão com o IndexedDB.
   *
   * @returns {Promise<IDBDatabase>}
   */
  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB não está disponível neste ambiente.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(LESSONS_STORE)) {
          const store = db.createObjectStore(LESSONS_STORE, { keyPath: 'id' });
          store.createIndex('by_subjectKey', 'subjectKey', { unique: false });
          store.createIndex('by_postgraduate', 'postgraduate', { unique: false });
          store.createIndex('by_track', 'track', { unique: false });
          store.createIndex('by_capturedAt', 'capturedAt', { unique: false });
          store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(HANDLES_STORE)) {
          db.createObjectStore(HANDLES_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('Não foi possível abrir o IndexedDB.'));
      };
    });

    return dbPromise;
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falha em operação do IndexedDB.'));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Transação abortada no IndexedDB.'));
      tx.onerror = () => reject(tx.error || new Error('Erro na transação do IndexedDB.'));
    });
  }

  /**
   * Extrai e valida os campos obrigatórios a partir do resultado do courseParser.
   *
   * @param {object} pageResult retorno de courseParser.readLessonPage
   * @returns {object} dados prontos para persistência
   */
  function extractLessonPayload(pageResult) {
    if (!pageResult || typeof pageResult !== 'object') {
      throw new Error('Resultado de leitura inválido.');
    }

    const postgraduate = normalizeWhitespace(pageResult.context?.postgraduate?.value);
    const track = normalizeWhitespace(pageResult.context?.track?.value);
    const subject = normalizeWhitespace(pageResult.context?.subject?.value);
    const lesson = normalizeWhitespace(pageResult.context?.lesson?.value);

    if (!postgraduate) throw new Error('Pós-graduação não identificada. Não é possível salvar a aula.');
    if (!track) throw new Error('Trilha não identificada. Não é possível salvar a aula.');
    if (!subject) throw new Error('Matéria não identificada. Não é possível salvar a aula.');
    if (!lesson) throw new Error('Nome da aula não identificado. Não é possível salvar a aula.');

    const segments = Array.isArray(pageResult.transcript?.segments)
      ? pageResult.transcript.segments
      : [];

    if (!segments.length) {
      throw new Error('Transcrição vazia ou não encontrada. Abra a aba de transcrição antes de capturar.');
    }

    if (pageResult.stability && !pageResult.stability.stable) {
      throw new Error('A transcrição ainda estava carregando. Aguarde estabilizar e tente novamente.');
    }

    const subjectKey = buildSubjectKey({ postgraduate, track, subject });
    const id = buildLessonId({ postgraduate, track, subject, lesson });

    const cleanSegments = segments.map((seg, idx) => ({
      index: idx + 1,
      timeRaw: String(seg.timeRaw ?? ''),
      seconds: Number(seg.seconds),
      wholeSeconds: Number(seg.wholeSeconds),
      timestamp: String(seg.timestamp),
      visualTimestamp: seg.visualTimestamp ?? null,
      text: normalizeWhitespace(seg.text),
    }));

    return {
      id,
      subjectKey,
      url: String(pageResult.url || ''),
      canonicalUrl: String(pageResult.canonicalUrl || pageResult.url || ''),
      postgraduate,
      track,
      subject,
      lesson,
      folderPath: `${toSafeFolderName(postgraduate)}/${toSafeFolderName(track)}`,
      markdownFilename: toMarkdownFilename(subject),
      segments: cleanSegments,
      transcriptText: toPlainText(cleanSegments),
      segmentCount: cleanSegments.length,
      lastTimestamp: cleanSegments[cleanSegments.length - 1].timestamp,
    };
  }

  /**
   * Calcula os identificadores (`id` e `subjectKey`) a partir de um resultado
   * de leitura da página, retornando `null` nos campos que ainda não puderem
   * ser determinados.
   *
   * @param {object} pageResult
   * @returns {{ lessonId: string|null, subjectKey: string|null }}
   */
  function resolveIdentifiers(pageResult) {
    const postgraduate = normalizeWhitespace(pageResult?.context?.postgraduate?.value);
    const track = normalizeWhitespace(pageResult?.context?.track?.value);
    const subject = normalizeWhitespace(pageResult?.context?.subject?.value);
    const lesson = normalizeWhitespace(pageResult?.context?.lesson?.value);

    let subjectKey = null;
    let lessonId = null;

    if (postgraduate && track && subject) {
      subjectKey = buildSubjectKey({ postgraduate, track, subject });
      if (lesson) {
        lessonId = buildLessonId({ postgraduate, track, subject, lesson });
      }
    }

    return { lessonId, subjectKey };
  }

  /**
   * Busca uma aula pelo seu ID único.
   *
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async function getLessonById(id) {
    if (!id) return null;
    const db = await openDatabase();
    const tx = db.transaction(LESSONS_STORE, 'readonly');
    const store = tx.objectStore(LESSONS_STORE);
    const record = await requestToPromise(store.get(id));
    return record || null;
  }

  /**
   * Lista todas as aulas capturadas de uma matéria, ordenadas de forma
   * consistente pela data/hora da primeira captura (`capturedAt`) e, em caso
   * de empate, pelo ID.
   *
   * @param {string} subjectKey
   * @returns {Promise<Array<object>>}
   */
  async function getLessonsBySubject(subjectKey) {
    if (!subjectKey) return [];
    const db = await openDatabase();
    const tx = db.transaction(LESSONS_STORE, 'readonly');
    const index = tx.objectStore(LESSONS_STORE).index('by_subjectKey');
    const records = (await requestToPromise(index.getAll(subjectKey))) || [];
    return sortLessonsConsistently(records);
  }

  /**
   * Ordena aulas de forma determinística: pela ordem em que foram capturadas
   * (`capturedAt` ascendente) e depois por `id`.
   *
   * @param {Array<object>} lessons
   * @returns {Array<object>}
   */
  function sortLessonsConsistently(lessons) {
    return [...lessons].sort((a, b) => {
      const timeCmp = String(a.capturedAt || '').localeCompare(String(b.capturedAt || ''));
      if (timeCmp !== 0) return timeCmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  /**
   * Salva ou atualiza uma aula a partir do resultado do courseParser.
   *
   * - Se a aula ainda não existir: cadastra com `capturedAt = now` e `updatedAt = now`.
   * - Se a aula já existir: preserva `capturedAt` original e atualiza a transcrição,
   *   a contagem de segmentos, a URL e `updatedAt = now`.
   *
   * @param {object} pageResult retorno de courseParser.readLessonPage
   * @returns {Promise<{ action: 'created'|'updated', record: object, subjectLessonCount: number }>}
   */
  async function saveLessonFromPageResult(pageResult) {
    const payload = extractLessonPayload(pageResult);
    const now = new Date().toISOString();

    const db = await openDatabase();
    const tx = db.transaction(LESSONS_STORE, 'readwrite');
    const store = tx.objectStore(LESSONS_STORE);

    const existing = await requestToPromise(store.get(payload.id));
    const action = existing ? 'updated' : 'created';

    const record = {
      ...payload,
      capturedAt: existing ? existing.capturedAt : now,
      updatedAt: now,
    };

    store.put(record);
    await transactionDone(tx);

    const subjectLessons = await getLessonsBySubject(payload.subjectKey);

    return {
      action,
      record,
      subjectLessonCount: subjectLessons.length,
    };
  }

  /**
   * Lista todas as aulas armazenadas no IndexedDB.
   *
   * @returns {Promise<Array<object>>}
   */
  async function getAllLessons() {
    const db = await openDatabase();
    const tx = db.transaction(LESSONS_STORE, 'readonly');
    const records = (await requestToPromise(tx.objectStore(LESSONS_STORE).getAll())) || [];
    return sortLessonsConsistently(records);
  }

  /**
   * Remove uma aula pelo ID.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function deleteLessonById(id) {
    if (!id) return;
    const db = await openDatabase();
    const tx = db.transaction(LESSONS_STORE, 'readwrite');
    tx.objectStore(LESSONS_STORE).delete(id);
    await transactionDone(tx);
  }

  /**
   * Retorna um resumo do estado de armazenamento para uma leitura de página
   * (usado pelo popup e pelo diagnóstico):
   * - se a aula atual já está capturada (e o registro salvo);
   * - quantas aulas estão capturadas na matéria atual;
   * - total geral de aulas no banco.
   *
   * @param {object} pageResult
   * @returns {Promise<{
   *   lessonId: string|null,
   *   subjectKey: string|null,
   *   existingLesson: object|null,
   *   subjectLessons: Array<object>,
   *   subjectLessonCount: number,
   *   totalLessonsCount: number
   * }>}
   */
  async function getPageStorageStatus(pageResult) {
    const { lessonId, subjectKey } = resolveIdentifiers(pageResult);
    const db = await openDatabase();
    const tx = db.transaction(LESSONS_STORE, 'readonly');
    const store = tx.objectStore(LESSONS_STORE);

    const [existingLesson, subjectRecords, totalLessonsCount] = await Promise.all([
      lessonId ? requestToPromise(store.get(lessonId)) : Promise.resolve(null),
      subjectKey
        ? requestToPromise(store.index('by_subjectKey').getAll(subjectKey))
        : Promise.resolve([]),
      requestToPromise(store.count()),
    ]);

    const subjectLessons = sortLessonsConsistently(subjectRecords || []);

    return {
      lessonId,
      subjectKey,
      existingLesson: existingLesson || null,
      subjectLessons,
      subjectLessonCount: subjectLessons.length,
      totalLessonsCount: Number(totalLessonsCount || 0),
    };
  }

  /**
   * Retorna estatísticas agregadas do acervo (total de aulas, matérias, trilhas,
   * pós-graduações e relação de matérias com suas aulas).
   *
   * @returns {Promise<{
   *   totalLessons: number,
   *   totalSubjects: number,
   *   totalTracks: number,
   *   totalPostgraduates: number,
   *   subjects: Array<object>
   * }>}
   */
  async function getArchiveSummary() {
    const lessons = await getAllLessons();
    const postgraduates = new Set();
    const tracks = new Set();
    const subjectsMap = new Map();

    for (const lesson of lessons) {
      postgraduates.add(lesson.postgraduate);
      tracks.add(`${lesson.postgraduate}::${lesson.track}`);

      let entry = subjectsMap.get(lesson.subjectKey);
      if (!entry) {
        entry = {
          subjectKey: lesson.subjectKey,
          postgraduate: lesson.postgraduate,
          track: lesson.track,
          subject: lesson.subject,
          folderPath: lesson.folderPath,
          markdownFilename: lesson.markdownFilename,
          lessons: [],
          lastUpdatedAt: lesson.updatedAt,
        };
        subjectsMap.set(lesson.subjectKey, entry);
      }
      entry.lessons.push(lesson);
      if (String(lesson.updatedAt) > String(entry.lastUpdatedAt)) {
        entry.lastUpdatedAt = lesson.updatedAt;
      }
    }

    const subjects = Array.from(subjectsMap.values()).map((entry) => ({
      ...entry,
      lessonCount: entry.lessons.length,
    }));

    return {
      totalLessons: lessons.length,
      totalSubjects: subjects.length,
      totalTracks: tracks.size,
      totalPostgraduates: postgraduates.size,
      subjects,
    };
  }

  const DIRECTORY_HANDLE_KEY = 'archive-root-directory';

  /**
   * Salva o FileSystemDirectoryHandle da pasta de destino no IndexedDB.
   * (Handles do File System Access API são clonáveis via structured clone no
   * IndexedDB, mas não podem ser serializados em JSON no chrome.storage.)
   *
   * @param {FileSystemDirectoryHandle} handle
   * @returns {Promise<object>}
   */
  async function saveDirectoryHandle(handle) {
    if (!handle) {
      throw new Error('Identificador de pasta inválido.');
    }
    const db = await openDatabase();
    const tx = db.transaction(HANDLES_STORE, 'readwrite');
    const record = {
      key: DIRECTORY_HANDLE_KEY,
      name: handle.name || 'Pasta selecionada',
      handle,
      savedAt: new Date().toISOString(),
    };
    tx.objectStore(HANDLES_STORE).put(record);
    await transactionDone(tx);
    return record;
  }

  /**
   * Recupera o registro do FileSystemDirectoryHandle salvo no IndexedDB.
   *
   * @returns {Promise<{ key: string, name: string, handle: FileSystemDirectoryHandle, savedAt: string } | null>}
   */
  async function getDirectoryHandleRecord() {
    const db = await openDatabase();
    const tx = db.transaction(HANDLES_STORE, 'readonly');
    const record = await requestToPromise(tx.objectStore(HANDLES_STORE).get(DIRECTORY_HANDLE_KEY));
    return record || null;
  }

  /**
   * Remove o FileSystemDirectoryHandle salvo no IndexedDB.
   *
   * @returns {Promise<void>}
   */
  async function clearDirectoryHandle() {
    const db = await openDatabase();
    const tx = db.transaction(HANDLES_STORE, 'readwrite');
    tx.objectStore(HANDLES_STORE).delete(DIRECTORY_HANDLE_KEY);
    await transactionDone(tx);
  }

  const api = {
    DB_NAME,
    DB_VERSION,
    LESSONS_STORE,
    HANDLES_STORE,
    DIRECTORY_HANDLE_KEY,
    openDatabase,
    extractLessonPayload,
    resolveIdentifiers,
    getLessonById,
    getLessonsBySubject,
    saveLessonFromPageResult,
    getAllLessons,
    deleteLessonById,
    getPageStorageStatus,
    getArchiveSummary,
    sortLessonsConsistently,
    saveDirectoryHandle,
    getDirectoryHandleRecord,
    clearDirectoryHandle,
  };
  ns.database = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

