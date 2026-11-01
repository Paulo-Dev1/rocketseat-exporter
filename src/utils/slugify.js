/**
 * Normalização segura para chaves de identificação, nomes de arquivos (.md)
 * e nomes de pastas.
 *
 * Depende de: utils/text.js.
 * Expõe as funções em globalThis.RocketseatExporter.slugify.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});
  const hasRequire = typeof require === 'function';
  const textUtils = ns.text || (hasRequire ? require('./text.js') : null);

  if (!textUtils) {
    throw new Error('slugify.js: carregue utils/text.js antes.');
  }

  const { normalizeWhitespace } = textUtils;

  /**
   * Converte um texto em slug ASCII minúsculo separado por hífens.
   * Ex.: "Busca Semântica com IA!" -> "busca-semantica-com-ia"
   *      "Upload widget Server"    -> "upload-widget-server"
   *
   * @param {unknown} value
   * @returns {string}
   */
  function toSlug(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return '';
    return normalized
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Gera o nome do arquivo Markdown de uma matéria.
   * Ex.: "Upload widget Server" -> "upload-widget-server.md"
   *
   * @param {string} subjectName
   * @returns {string}
   */
  function toMarkdownFilename(subjectName) {
    const slug = toSlug(subjectName) || 'materia';
    return `${slug}.md`;
  }

  /**
   * Sanitiza o nome de uma pasta (Pós-graduação ou Trilha), preservando
   * acentuação, maiúsculas e espaços, mas removendo caracteres proibidos
   * em sistemas de arquivos (/, \, :, *, ?, ", <, >, | e caracteres de controle).
   *
   * Ex.: "Pós Graduação Full-Stack com IA" -> "Pós Graduação Full-Stack com IA"
   *
   * @param {string} folderName
   * @returns {string}
   */
  function toSafeFolderName(folderName) {
    const cleaned = normalizeWhitespace(folderName)
      .replace(/[\/\\:*?"<>|\u0000-\u001F]+/g, '-')
      .replace(/\.+$/g, '')
      .trim();
    return cleaned || 'Sem Nome';
  }

  /**
   * Gera a chave única de uma matéria (Pós + Trilha + Matéria).
   *
   * @param {{ postgraduate: string, track: string, subject: string }} context
   * @returns {string}
   */
  function buildSubjectKey({ postgraduate, track, subject }) {
    const postSlug = toSlug(postgraduate);
    const trackSlug = toSlug(track);
    const subjectSlug = toSlug(subject);
    if (!postSlug || !trackSlug || !subjectSlug) {
      throw new Error('Contexto incompleto para gerar a chave da matéria (pós, trilha e matéria são obrigatórios).');
    }
    return `${postSlug}::${trackSlug}::${subjectSlug}`;
  }

  /**
   * Gera o identificador único de uma aula.
   *
   * Na plataforma ftr.rocketseat.com.br, todas as aulas de uma mesma matéria
   * compartilham a mesma URL de sala (/jornada/.../sala/...). Portanto, o ID
   * único combina a chave da matéria (pós + trilha + matéria) com o slug do
   * nome da aula, garantindo que:
   * - Aulas da mesma matéria tenham IDs distintos.
   * - Aulas com o mesmo nome em matérias diferentes não colidam.
   *
   * @param {{ postgraduate: string, track: string, subject: string, lesson: string }} context
   * @returns {string}
   */
  function buildLessonId({ postgraduate, track, subject, lesson }) {
    const subjectKey = buildSubjectKey({ postgraduate, track, subject });
    const lessonSlug = toSlug(lesson);
    if (!lessonSlug) {
      throw new Error('Nome da aula é obrigatório para gerar o identificador único.');
    }
    return `${subjectKey}::${lessonSlug}`;
  }

  const api = {
    toSlug,
    toMarkdownFilename,
    toSafeFolderName,
    buildSubjectKey,
    buildLessonId,
  };
  ns.slugify = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

