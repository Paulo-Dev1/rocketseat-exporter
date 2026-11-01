const { test } = require('node:test');
const assert = require('node:assert/strict');

// Mock mínimo de IndexedDB em memória para testar toda a lógica de database.js no Node.
function createFakeIndexedDB() {
  const databases = new Map();

  return {
    open(name, version) {
      const request = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };

      queueMicrotask(() => {
        let dbEntry = databases.get(name);
        const isUpgrade = !dbEntry || dbEntry.version < version;

        if (!dbEntry) {
          const stores = new Map();
          const db = {
            name,
            version,
            onversionchange: null,
            objectStoreNames: {
              contains: (storeName) => stores.has(storeName),
            },
            createObjectStore(storeName, { keyPath }) {
              const records = new Map();
              const indexes = new Map();
              const storeMeta = {
                keyPath,
                records,
                indexes,
                createIndex(indexName, indexKeyPath) {
                  indexes.set(indexName, indexKeyPath);
                },
              };
              stores.set(storeName, storeMeta);
              return storeMeta;
            },
            transaction(storeName) {
              const storeMeta = stores.get(storeName);
              const tx = { oncomplete: null, onabort: null, onerror: null, error: null };
              let pendingOps = 0;

              function scheduleComplete() {
                queueMicrotask(() => {
                  if (pendingOps === 0 && typeof tx.oncomplete === 'function') {
                    tx.oncomplete();
                  }
                });
              }

              function runOp(fn) {
                pendingOps += 1;
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  try {
                    req.result = fn();
                    if (typeof req.onsuccess === 'function') req.onsuccess();
                  } catch (err) {
                    req.error = err;
                    if (typeof req.onerror === 'function') req.onerror();
                  } finally {
                    pendingOps -= 1;
                    scheduleComplete();
                  }
                });
                return req;
              }

              return Object.assign(tx, {
                objectStore() {
                  return {
                    get: (key) => runOp(() => storeMeta.records.get(key)),
                    getAll: () => runOp(() => Array.from(storeMeta.records.values())),
                    count: () => runOp(() => storeMeta.records.size),
                    put: (value) =>
                      runOp(() => {
                        const key = value[storeMeta.keyPath];
                        storeMeta.records.set(key, structuredClone(value));
                        return key;
                      }),
                    delete: (key) =>
                      runOp(() => {
                        storeMeta.records.delete(key);
                      }),
                    index(indexName) {
                      const prop = storeMeta.indexes.get(indexName);
                      return {
                        getAll: (val) =>
                          runOp(() =>
                            Array.from(storeMeta.records.values()).filter((item) => item[prop] === val)
                          ),
                      };
                    },
                  };
                },
              });
            },
            close() {},
          };
          dbEntry = { version, db };
          databases.set(name, dbEntry);
        }

        request.result = dbEntry.db;
        if (isUpgrade && typeof request.onupgradeneeded === 'function') {
          request.onupgradeneeded({ target: request });
        }
        if (typeof request.onsuccess === 'function') {
          request.onsuccess({ target: request });
        }
      });

      return request;
    },
  };
}

globalThis.indexedDB = createFakeIndexedDB();

require('../../src/utils/text.js');
require('../../src/utils/timestamp.js');
require('../../src/utils/transcript.js');
require('../../src/utils/slugify.js');
const database = require('../../src/services/database.js');

function makePageResult(overrides = {}) {
  return {
    url: 'https://ftr.rocketseat.com.br/jornada/f2-estrategia-e-inovacao/sala/i-a-uso-e-integracao-da-ai-sdk-da-vercel',
    canonicalUrl:
      'https://ftr.rocketseat.com.br/jornada/f2-estrategia-e-inovacao/sala/i-a-uso-e-integracao-da-ai-sdk-da-vercel',
    context: {
      postgraduate: { value: 'Pós Graduação Full-Stack com IA' },
      track: { value: 'Estratégia e Inovação' },
      subject: { value: 'AI SDK' },
      lesson: { value: 'Exibindo UI com Resultado da Tool' },
      ...(overrides.context || {}),
    },
    transcript: {
      found: true,
      segments: overrides.segments || [
        {
          index: 1,
          timeRaw: '0',
          seconds: 0,
          wholeSeconds: 0,
          timestamp: '00:00:00',
          visualTimestamp: '00:00',
          text: 'Antes da gente partir e criar aqui, colocar a interface com base no resultado da tool,',
        },
        {
          index: 2,
          timeRaw: '6.52',
          seconds: 6.52,
          wholeSeconds: 6,
          timestamp: '00:00:06',
          visualTimestamp: '00:6.52',
          text: 'uma outra coisa que eu gosto bastante fazer é o seguinte,',
        },
      ],
    },
    stability: { stable: true, samples: [2, 2, 2], elapsedMs: 600 },
    ...overrides,
  };
}

test('salva aula nova, evita duplicata ao atualizar e preserva capturedAt', async () => {
  const page1 = makePageResult();
  const statusBefore = await database.getPageStorageStatus(page1);
  assert.equal(statusBefore.existingLesson, null);
  assert.equal(statusBefore.subjectLessonCount, 0);

  const firstSave = await database.saveLessonFromPageResult(page1);
  assert.equal(firstSave.action, 'created');
  assert.equal(firstSave.subjectLessonCount, 1);
  assert.equal(firstSave.record.segmentCount, 2);
  assert.equal(firstSave.record.markdownFilename, 'ai-sdk.md');

  await new Promise((r) => setTimeout(r, 10));

  // Atualiza a mesma aula com 3 segmentos
  const page1Updated = makePageResult({
    segments: [
      ...page1.transcript.segments,
      {
        index: 3,
        timeRaw: '10.06',
        seconds: 10.06,
        wholeSeconds: 10,
        timestamp: '00:00:10',
        visualTimestamp: '00:10.06',
        text: 'aqui nas minhas tools elas fazem requisições assíncronas,',
      },
    ],
  });

  const secondSave = await database.saveLessonFromPageResult(page1Updated);
  assert.equal(secondSave.action, 'updated');
  assert.equal(secondSave.subjectLessonCount, 1, 'não deve duplicar a aula na matéria');
  assert.equal(secondSave.record.segmentCount, 3);
  assert.equal(secondSave.record.capturedAt, firstSave.record.capturedAt, 'capturedAt preservado');
  assert.ok(secondSave.record.updatedAt >= firstSave.record.updatedAt, 'updatedAt atualizado');

  // Salva uma segunda aula na mesma matéria (mesma URL da sala!)
  const page2 = makePageResult({
    context: {
      postgraduate: { value: 'Pós Graduação Full-Stack com IA' },
      track: { value: 'Estratégia e Inovação' },
      subject: { value: 'AI SDK' },
      lesson: { value: 'Configurando o projeto AI SDK' },
    },
  });
  const thirdSave = await database.saveLessonFromPageResult(page2);
  assert.equal(thirdSave.action, 'created');
  assert.equal(thirdSave.subjectLessonCount, 2);

  // Salva uma aula com o mesmo nome em outra matéria -> não deve colidir
  const pageOtherSubject = makePageResult({
    context: {
      postgraduate: { value: 'Pós Graduação Full-Stack com IA' },
      track: { value: 'Estratégia e Inovação' },
      subject: { value: 'Busca Semântica' },
      lesson: { value: 'Exibindo UI com Resultado da Tool' },
    },
  });
  const fourthSave = await database.saveLessonFromPageResult(pageOtherSubject);
  assert.equal(fourthSave.action, 'created');
  assert.equal(fourthSave.subjectLessonCount, 1);

  const summary = await database.getArchiveSummary();
  assert.equal(summary.totalLessons, 3);
  assert.equal(summary.totalSubjects, 2);
  assert.equal(summary.totalTracks, 1);
  assert.equal(summary.totalPostgraduates, 1);
});

test('rejeita captura vazia ou sem nome da aula', async () => {
  const withoutLesson = makePageResult({
    context: {
      postgraduate: { value: 'Pós Graduação Full-Stack com IA' },
      track: { value: 'Estratégia e Inovação' },
      subject: { value: 'AI SDK' },
      lesson: null,
    },
  });
  await assert.rejects(() => database.saveLessonFromPageResult(withoutLesson), /Nome da aula/);

  const withoutSegments = makePageResult({ segments: [] });
  await assert.rejects(() => database.saveLessonFromPageResult(withoutSegments), /Transcrição vazia/);
});

