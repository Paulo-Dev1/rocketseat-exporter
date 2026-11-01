const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../src/utils/text.js');
const {
  toSlug,
  toMarkdownFilename,
  toSafeFolderName,
  buildSubjectKey,
  buildLessonId,
} = require('../../src/utils/slugify.js');

test('toSlug normaliza acentos, maiúsculas e caracteres especiais', () => {
  assert.equal(toSlug('Upload widget Server'), 'upload-widget-server');
  assert.equal(toSlug('Busca Semântica com IA!'), 'busca-semantica-com-ia');
  assert.equal(toSlug('  Pós-Graduação: Full-Stack & IA (2026) '), 'pos-graduacao-full-stack-ia-2026');
  assert.equal(toSlug(''), '');
  assert.equal(toSlug(null), '');
});

test('toMarkdownFilename gera o nome do arquivo .md da matéria', () => {
  assert.equal(toMarkdownFilename('Upload widget Server'), 'upload-widget-server.md');
  assert.equal(toMarkdownFilename('Busca Semântica'), 'busca-semantica.md');
  assert.equal(toMarkdownFilename('AI SDK'), 'ai-sdk.md');
  assert.equal(toMarkdownFilename(''), 'materia.md');
});

test('toSafeFolderName preserva acentos e espaços e remove barras/caracteres ilegais', () => {
  assert.equal(
    toSafeFolderName('Pós Graduação Full-Stack com IA'),
    'Pós Graduação Full-Stack com IA'
  );
  assert.equal(
    toSafeFolderName('Fundamentos: Técnicos / Estratégicos*'),
    'Fundamentos- Técnicos - Estratégicos-'
  );
});

test('buildSubjectKey e buildLessonId diferenciam aulas da mesma matéria e entre matérias', () => {
  const base = {
    postgraduate: 'Pós Graduação Full-Stack com IA',
    track: 'Estratégia e Inovação',
    subject: 'AI SDK',
  };

  assert.equal(
    buildSubjectKey(base),
    'pos-graduacao-full-stack-com-ia::estrategia-e-inovacao::ai-sdk'
  );

  const idAula1 = buildLessonId({ ...base, lesson: 'Exibindo UI com Resultado da Tool' });
  const idAula2 = buildLessonId({ ...base, lesson: 'Configurando build da aplicação' });
  const idOutraMateria = buildLessonId({
    ...base,
    subject: 'Outra Matéria',
    lesson: 'Exibindo UI com Resultado da Tool',
  });

  assert.notEqual(idAula1, idAula2);
  assert.notEqual(idAula1, idOutraMateria);
});

