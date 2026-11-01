/**
 * Geração dos arquivos Markdown por matéria (Seção 7 da especificação).
 *
 * Regras atendidas:
 * - Um único documento Markdown por matéria, contendo todas as aulas capturadas.
 * - Não resume aulas, não remove falas e preserva todos os segmentos e timestamps.
 * - Ordena as aulas de maneira consistente (ordem de captura original, sem inventar ordem).
 * - Deduplica aulas pelo ID caso a lista recebida contenha repetições.
 *
 * Depende de: utils/text.js, utils/transcript.js.
 * Expõe as funções em globalThis.RocketseatExporter.markdown.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});
  const hasRequire = typeof require === 'function';
  const textUtils = ns.text || (hasRequire ? require('../utils/text.js') : null);
  const transcriptUtils = ns.transcript || (hasRequire ? require('../utils/transcript.js') : null);

  if (!textUtils || !transcriptUtils) {
    throw new Error('markdown.js: carregue utils/text.js e utils/transcript.js antes.');
  }

  const { normalizeWhitespace } = textUtils;
  const { formatSegmentLine } = transcriptUtils;

  /**
   * Formata uma data ISO (ou Date) como YYYY-MM-DD (no fuso local ou UTC se ISO pura).
   *
   * @param {string|Date|undefined|null} value
   * @returns {string}
   */
  function formatDateYMD(value) {
    if (!value) {
      return formatDateYMD(new Date().toISOString());
    }
    const text = String(value).trim();
    const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    if (isoMatch) return isoMatch[1];

    const date = value instanceof Date ? value : new Date(text);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Formata o número da aula com pelo menos 2 dígitos ("01", "02", ..., "63", "100").
   *
   * @param {number} number 1-based
   * @returns {string}
   */
  function formatLessonNumber(number) {
    return String(number).padStart(2, '0');
  }

  /**
   * Remove duplicatas mantendo a última versão de cada aula e ordena de forma
   * consistente por `capturedAt` ascendente e depois `id`.
   *
   * @param {Array<object>} lessons
   * @returns {Array<object>}
   */
  function normalizeAndSortLessons(lessons) {
    if (!Array.isArray(lessons)) return [];
    const byId = new Map();
    for (const lesson of lessons) {
      if (!lesson || typeof lesson !== 'object') continue;
      const key = lesson.id || `${lesson.subjectKey || ''}::${lesson.lesson || ''}`;
      byId.set(key, lesson);
    }
    return Array.from(byId.values()).sort((a, b) => {
      const timeCmp = String(a.capturedAt || '').localeCompare(String(b.capturedAt || ''));
      if (timeCmp !== 0) return timeCmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  /**
   * Gera o bloco Markdown de uma única aula.
   *
   * @param {object} lesson
   * @param {number} lessonNumber número sequencial 1-based
   * @returns {string}
   */
  function renderLessonSection(lesson, lessonNumber) {
    const numberLabel = formatLessonNumber(lessonNumber);
    const title = normalizeWhitespace(lesson.lesson) || `Aula ${numberLabel}`;
    const url = normalizeWhitespace(lesson.url || lesson.canonicalUrl) || '—';
    const capturedDate = formatDateYMD(lesson.capturedAt);

    const segments = Array.isArray(lesson.segments) ? lesson.segments : [];
    const transcriptLines = segments
      .map((seg) =>
        formatSegmentLine({
          timestamp: String(seg.timestamp || '00:00:00'),
          text: normalizeWhitespace(seg.text),
        })
      )
      .join('\n\n');

    return [
      `## Aula ${numberLabel} — ${title}`,
      '',
      `**URL:** ${url}`,
      '',
      `**Capturada em:** ${capturedDate}`,
      '',
      '### Transcrição',
      '',
      transcriptLines,
      '',
      '---',
    ].join('\n');
  }

  /**
   * Gera o conteúdo completo do arquivo Markdown de uma matéria.
   *
   * @param {{
   *   postgraduate?: string,
   *   track?: string,
   *   subject?: string,
   *   lessons: Array<object>,
   *   updatedAt?: string
   * }} input
   * @returns {string}
   */
  function generateSubjectMarkdown(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('Dados da matéria inválidos para gerar o Markdown.');
    }

    const orderedLessons = normalizeAndSortLessons(input.lessons);
    if (!orderedLessons.length) {
      throw new Error('Não há aulas capturadas nesta matéria para gerar o arquivo Markdown.');
    }

    const first = orderedLessons[0];
    const postgraduate = normalizeWhitespace(input.postgraduate || first.postgraduate);
    const track = normalizeWhitespace(input.track || first.track);
    const subject = normalizeWhitespace(input.subject || first.subject);

    const latestLessonUpdate = orderedLessons.reduce((latest, item) => {
      const candidate = item.updatedAt || item.capturedAt || '';
      return String(candidate) > String(latest) ? candidate : latest;
    }, '');

    const lastUpdatedDate = formatDateYMD(input.updatedAt || latestLessonUpdate || new Date().toISOString());

    const header = [
      `# ${subject}`,
      '',
      `**Pós-graduação:** ${postgraduate}`,
      '',
      `**Trilha:** ${track}`,
      '',
      `**Matéria:** ${subject}`,
      '',
      `**Aulas capturadas:** ${orderedLessons.length}`,
      '',
      `**Última atualização:** ${lastUpdatedDate}`,
      '',
      '---',
    ].join('\n');

    const sections = orderedLessons.map((lesson, idx) => renderLessonSection(lesson, idx + 1));

    return `${header}\n\n${sections.join('\n\n')}\n`;
  }

  const api = {
    formatDateYMD,
    formatLessonNumber,
    normalizeAndSortLessons,
    renderLessonSection,
    generateSubjectMarkdown,
  };
  ns.markdown = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

