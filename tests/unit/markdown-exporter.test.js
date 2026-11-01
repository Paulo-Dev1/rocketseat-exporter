const { test } = require('node:test');
const assert = require('node:assert/strict');

// Reutiliza um IndexedDB fake em memória
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
            objectStoreNames: { contains: (s) => stores.has(s) },
            createObjectStore(storeName, { keyPath }) {
              const records = new Map();
              const indexes = new Map();
              const storeMeta = {
                keyPath,
                records,
                indexes,
                createIndex(idxName, idxKeyPath) {
                  indexes.set(idxName, idxKeyPath);
                },
              };
              stores.set(storeName, storeMeta);
              return storeMeta;
            },
            transaction(storeName) {
              const storeMeta = stores.get(storeName);
              const tx = { oncomplete: null, onabort: null, onerror: null, error: null };
              let pending = 0;
              function checkDone() {
                queueMicrotask(() => {
                  if (pending === 0 && typeof tx.oncomplete === 'function') tx.oncomplete();
                });
              }
              function runOp(fn) {
                pending += 1;
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  try {
                    req.result = fn();
                    if (typeof req.onsuccess === 'function') req.onsuccess();
                  } catch (err) {
                    req.error = err;
                    if (typeof req.onerror === 'function') req.onerror();
                  } finally {
                    pending -= 1;
                    checkDone();
                  }
                });
                return req;
              }
              return Object.assign(tx, {
                objectStore() {
                  return {
                    get: (k) => runOp(() => storeMeta.records.get(k)),
                    getAll: () => runOp(() => Array.from(storeMeta.records.values())),
                    count: () => runOp(() => storeMeta.records.size),
                    put: (v) =>
                      runOp(() => {
                        const k = v[storeMeta.keyPath];
                        storeMeta.records.set(k, v);
                        return k;
                      }),
                    delete: (k) => runOp(() => storeMeta.records.delete(k)),
                    index(idxName) {
                      const prop = storeMeta.indexes.get(idxName);
                      return {
                        getAll: (val) =>
                          runOp(() => Array.from(storeMeta.records.values()).filter((i) => i[prop] === val)),
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

// Mock de FileSystemDirectoryHandle em memória para validar a árvore de pastas e arquivos .md
function createFakeDirectoryHandle(name, permissionState = 'granted') {
  const subdirs = new Map();
  const files = new Map();
  let currentPermission = permissionState;

  return {
    kind: 'directory',
    name,
    subdirs,
    files,
    setPermission(state) {
      currentPermission = state;
    },
    async queryPermission() {
      return currentPermission;
    },
    async requestPermission() {
      if (currentPermission === 'prompt') currentPermission = 'granted';
      return currentPermission;
    },
    async getDirectoryHandle(dirName, { create } = {}) {
      if (!subdirs.has(dirName)) {
        if (!create) throw new Error(`Pasta não encontrada: ${dirName}`);
        subdirs.set(dirName, createFakeDirectoryHandle(dirName, currentPermission));
      }
      return subdirs.get(dirName);
    },
    async getFileHandle(fileName, { create } = {}) {
      if (!files.has(fileName)) {
        if (!create) throw new Error(`Arquivo não encontrado: ${fileName}`);
        files.set(fileName, { content: '' });
      }
      const fileEntry = files.get(fileName);
      return {
        kind: 'file',
        name: fileName,
        async createWritable() {
          let buffer = '';
          return {
            async write(chunk) {
              buffer += String(chunk);
            },
            async close() {
              fileEntry.content = buffer;
            },
          };
        },
      };
    },
  };
}

globalThis.indexedDB = createFakeIndexedDB();

require('../../src/utils/text.js');
require('../../src/utils/timestamp.js');
require('../../src/utils/transcript.js');
require('../../src/utils/slugify.js');
const database = require('../../src/services/database.js');
require('../../src/services/storage.js');
const markdown = require('../../src/services/markdown.js');
const exporter = require('../../src/services/exporter.js');

test('generateSubjectMarkdown segue exatamente o formato da Seção 7', () => {
  const md = markdown.generateSubjectMarkdown({
    postgraduate: 'Pós Graduação Full-Stack com IA',
    track: 'Fundamentos Técnicos e Estratégicos',
    subject: 'Upload widget Server',
    updatedAt: '2026-10-31T12:00:00.000Z',
    lessons: [
      {
        id: 'pos::trilha::materia::aula-1',
        lesson: 'Configurando build da aplicação',
        url: 'https://ftr.rocketseat.com.br/jornada/fundamentos/sala/upload-widget-server',
        capturedAt: '2026-10-31T10:00:00.000Z',
        updatedAt: '2026-10-31T10:00:00.000Z',
        segments: [
          { timestamp: '00:00:00', text: 'Última coisa que a gente vai fazer.' },
          { timestamp: '00:00:08', text: 'Agora vamos configurar o projeto.' },
        ],
      },
      {
        id: 'pos::trilha::materia::aula-2',
        lesson: 'Próxima aula',
        url: 'https://ftr.rocketseat.com.br/jornada/fundamentos/sala/upload-widget-server',
        capturedAt: '2026-10-31T11:00:00.000Z',
        updatedAt: '2026-10-31T11:00:00.000Z',
        segments: [{ timestamp: '00:00:00', text: 'Conteúdo integral da aula.' }],
      },
    ],
  });

  const expected = [
    '# Upload widget Server',
    '',
    '**Pós-graduação:** Pós Graduação Full-Stack com IA',
    '',
    '**Trilha:** Fundamentos Técnicos e Estratégicos',
    '',
    '**Matéria:** Upload widget Server',
    '',
    '**Aulas capturadas:** 2',
    '',
    '**Última atualização:** 2026-10-31',
    '',
    '---',
    '',
    '## Aula 01 — Configurando build da aplicação',
    '',
    '**URL:** https://ftr.rocketseat.com.br/jornada/fundamentos/sala/upload-widget-server',
    '',
    '**Capturada em:** 2026-10-31',
    '',
    '### Transcrição',
    '',
    '[00:00:00] Última coisa que a gente vai fazer.',
    '',
    '[00:00:08] Agora vamos configurar o projeto.',
    '',
    '---',
    '',
    '## Aula 02 — Próxima aula',
    '',
    '**URL:** https://ftr.rocketseat.com.br/jornada/fundamentos/sala/upload-widget-server',
    '',
    '**Capturada em:** 2026-10-31',
    '',
    '### Transcrição',
    '',
    '[00:00:00] Conteúdo integral da aula.',
    '',
    '---',
    '',
  ].join('\n');

  assert.equal(md, expected);
});

test('exporter cria a árvore de pastas, atualiza o mesmo .md ao adicionar aulas e preserva outras matérias', async () => {
  const rootDir = createFakeDirectoryHandle('Rocketseat-Acervo', 'prompt');

  // Simula arquivo pré-existente em outra matéria para garantir que nunca é apagado
  const existingPost = await rootDir.getDirectoryHandle('Pós Graduação Full-Stack com IA', { create: true });
  const existingTrack = await existingPost.getDirectoryHandle('Fundamentos Técnicos e Estratégicos', { create: true });
  const otherFile = await existingTrack.getFileHandle('outra-materia.md', { create: true });
  const writable = await otherFile.createWritable();
  await writable.write('# Outra Matéria\n');
  await writable.close();

  // Seleciona a pasta (pede permissão automaticamente e muda de prompt -> granted)
  const selected = await exporter.selectArchiveDirectory(async () => rootDir);
  assert.equal(selected.name, 'Rocketseat-Acervo');
  assert.equal(selected.permission, 'granted');

  // Captura a 1ª aula de "Busca Semântica"
  const aula1 = {
    url: 'https://ftr.rocketseat.com.br/jornada/fundamentos/sala/busca-semantica',
    canonicalUrl: 'https://ftr.rocketseat.com.br/jornada/fundamentos/sala/busca-semantica',
    context: {
      postgraduate: { value: 'Pós Graduação Full-Stack com IA' },
      track: { value: 'Fundamentos Técnicos e Estratégicos' },
      subject: { value: 'Busca Semântica' },
      lesson: { value: 'Introdução a Vetores' },
    },
    transcript: {
      found: true,
      segments: [{ index: 1, timeRaw: '0', seconds: 0, wholeSeconds: 0, timestamp: '00:00:00', text: 'Fala da aula 1.' }],
    },
    stability: { stable: true, samples: [1, 1, 1], elapsedMs: 300 },
  };

  const saved1 = await database.saveLessonFromPageResult(aula1);
  const exp1 = await exporter.exportSubjectByKey(saved1.record.subjectKey);
  assert.equal(
    exp1.relativePath,
    'Pós Graduação Full-Stack com IA/Fundamentos Técnicos e Estratégicos/busca-semantica.md'
  );
  assert.equal(exp1.lessonCount, 1);

  const fileAfter1 = existingTrack.files.get('busca-semantica.md').content;
  assert.match(fileAfter1, /\*\*Aulas capturadas:\*\* 1/);
  assert.match(fileAfter1, /## Aula 01 — Introdução a Vetores/);

  // Captura a 2ª aula na mesma matéria -> deve atualizar busca-semantica.md com as 2 aulas
  await new Promise((r) => setTimeout(r, 10));
  const aula2 = {
    ...aula1,
    context: {
      ...aula1.context,
      lesson: { value: 'Consultas por Similaridade' },
    },
    transcript: {
      found: true,
      segments: [{ index: 1, timeRaw: '15', seconds: 15, wholeSeconds: 15, timestamp: '00:00:15', text: 'Fala da aula 2.' }],
    },
  };
  await database.saveLessonFromPageResult(aula2);

  const fullReport = await exporter.exportAllSubjects();
  assert.equal(fullReport.failures.length, 0);
  assert.equal(fullReport.totalSubjects, 1);
  assert.equal(fullReport.totalLessons, 2);

  const fileAfter2 = existingTrack.files.get('busca-semantica.md').content;
  assert.match(fileAfter2, /\*\*Aulas capturadas:\*\* 2/);
  assert.match(fileAfter2, /## Aula 01 — Introdução a Vetores/);
  assert.match(fileAfter2, /## Aula 02 — Consultas por Similaridade/);

  // Confirma que outra-materia.md permaneceu intacto
  assert.equal(existingTrack.files.get('outra-materia.md').content, '# Outra Matéria\n');
});

