/**
 * Leitura da página de aula da Rocketseat.
 *
 * Identifica, a partir do DOM:
 * - Nome da aula: primeiro <h1> válido.
 * - Pós-graduação: link cujo caminho contém "/jornada/" e termina em "/disciplinas".
 * - Trilha: link cujo caminho contém "/jornada/" e termina em "/conteudos".
 * - Matéria: último elemento textual do breadcrumb (container comum aos dois links).
 * - Transcrição: elementos com os atributos `time` e `text`.
 *
 * Não depende de classes CSS. Não faz requisições de rede.
 *
 * Depende de: utils/text.js, utils/timestamp.js.
 * Expõe as funções em globalThis.RocketseatExporter.courseParser.
 */
(function (root) {
  'use strict';

  const ns = (root.RocketseatExporter = root.RocketseatExporter || {});
  const hasRequire = typeof require === 'function';
  const textUtils = ns.text || (hasRequire ? require('../utils/text.js') : null);
  const timeUtils = ns.timestamp || (hasRequire ? require('../utils/timestamp.js') : null);

  if (!textUtils || !timeUtils) {
    throw new Error('course-parser.js: carregue utils/text.js e utils/timestamp.js antes.');
  }

  const { normalizeWhitespace, isSeparatorText, looselyEqual } = textUtils;
  const { parseSeconds, formatTimestamp, parseVisualTimestamp } = timeUtils;

  /** Limiares das verificações de completude (em segundos). */
  const DEFAULT_OPTIONS = Object.freeze({
    /** Primeiro segmento começando depois disso sugere transcrição cortada no início. */
    maxFirstSegmentStart: 30,
    /** Intervalo entre segmentos consecutivos acima disso é reportado como possível lacuna. */
    maxGapSeconds: 90,
    /** Diferença máxima aceitável entre o último segmento e a duração do <video>, se existir. */
    endToleranceSeconds: 90,
    /** Diferença aceitável entre o timestamp visual (<span>) e o atributo `time`. */
    visualToleranceSeconds: 1,
  });

  const SEGMENT_SELECTOR = '[time][text]';
  const SKIPPED_TEXT_PARENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG']);

  // ---------------------------------------------------------------------------
  // Utilitários de DOM
  // ---------------------------------------------------------------------------

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    if (element.getClientRects().length === 0) return false;
    const view = element.ownerDocument.defaultView;
    if (!view) return true;
    const style = view.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse';
  }

  /** Verifica se o nó está dentro de um elemento que não deve contribuir com texto. */
  function isInsideSkippedElement(node, boundary) {
    let current = node.nodeType === 1 ? node : node.parentElement;
    while (current && current !== boundary) {
      if (SKIPPED_TEXT_PARENTS.has(current.nodeName)) return true;
      if (current.namespaceURI === 'http://www.w3.org/2000/svg') return true;
      if (current.getAttribute('aria-hidden') === 'true') return true;
      if (current.hasAttribute('hidden')) return true;
      current = current.parentElement;
    }
    return false;
  }

  /** Lista os nós de texto legíveis dentro de um elemento, em ordem de documento. */
  function readableTextNodes(element) {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      if (normalizeWhitespace(node.nodeValue) && !isInsideSkippedElement(node, element)) {
        nodes.push(node);
      }
      node = walker.nextNode();
    }
    return nodes;
  }

  /** Texto legível de um elemento (ignora svg, script, aria-hidden etc.). */
  function readableText(element) {
    if (!element) return '';
    return normalizeWhitespace(
      readableTextNodes(element)
        .map((node) => node.nodeValue)
        .join(' ')
    );
  }

  function lowestCommonAncestor(nodes) {
    if (!nodes.length) return null;
    let ancestor = nodes[0].parentElement;
    for (const node of nodes) {
      while (ancestor && !ancestor.contains(node)) ancestor = ancestor.parentElement;
    }
    return ancestor;
  }

  function depthOf(node) {
    let depth = 0;
    for (let current = node; current.parentNode; current = current.parentNode) depth += 1;
    return depth;
  }

  function precedes(a, b) {
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    return Boolean(a.compareDocumentPosition(b) & 4);
  }

  function describeElement(element) {
    if (!element) return null;
    const parts = [element.nodeName.toLowerCase()];
    if (element.id) parts.push(`#${element.id}`);
    const role = element.getAttribute('role');
    if (role) parts.push(`[role="${role}"]`);
    const label = element.getAttribute('aria-label');
    if (label) parts.push(`[aria-label="${normalizeWhitespace(label)}"]`);
    return parts.join('');
  }

  function linkPathname(anchor) {
    const href = anchor.getAttribute('href');
    if (!href) return '';
    try {
      return new URL(href, anchor.ownerDocument.baseURI).pathname.replace(/\/+$/, '');
    } catch (_error) {
      return '';
    }
  }

  function absoluteHref(anchor) {
    try {
      return new URL(anchor.getAttribute('href'), anchor.ownerDocument.baseURI).href;
    } catch (_error) {
      return anchor.getAttribute('href') || '';
    }
  }

  // ---------------------------------------------------------------------------
  // Nome da aula
  // ---------------------------------------------------------------------------

  function findLessonTitle(doc, cachedLessonTitle = null) {
    const headings = Array.from(doc.querySelectorAll('h1'));
    const valid = headings
      .filter((heading) => heading.getAttribute('aria-hidden') !== 'true')
      .map((heading) => ({ element: heading, text: readableText(heading) }))
      .filter((entry) => entry.text);

    const visible = valid.find((entry) => isVisible(entry.element));
    const chosen = visible || valid[0] || null;

    if (chosen) {
      return {
        value: chosen.text,
        source: visible
          ? 'primeiro <h1> visível com texto'
          : 'primeiro <h1> com texto (não visível)',
        element: chosen.element,
        totalHeadings: headings.length,
        candidates: valid.map((entry) => entry.text),
      };
    }

    if (cachedLessonTitle && cachedLessonTitle.value) {
      return {
        value: cachedLessonTitle.value,
        source: cachedLessonTitle.source || '<h1> capturado na aba "Sobre a aula" (memória da sessão)',
        element: null,
        totalHeadings: headings.length,
        candidates: [cachedLessonTitle.value],
      };
    }

    return {
      value: null,
      source: null,
      element: null,
      totalHeadings: headings.length,
      candidates: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Breadcrumb: pós-graduação, trilha e matéria
  // ---------------------------------------------------------------------------

  function findJourneyLinks(doc, suffix) {
    return Array.from(doc.querySelectorAll('a[href*="/jornada/"]')).filter((anchor) => {
      const pathname = linkPathname(anchor);
      return pathname.includes('/jornada/') && pathname.endsWith(suffix) && readableText(anchor);
    });
  }

  /**
   * Escolhe o par (link da pós, link da trilha) que forma o breadcrumb.
   * Critérios, em ordem de peso:
   * 1. pós antes da trilha (obrigatório);
   * 2. ambos visíveis;
   * 3. existe um item textual depois da trilha (a matéria);
   * 4. menor distância entre os links (ancestral comum mais próximo).
   */
  function choosePair(postLinks, trackLinks) {
    let best = null;
    for (const post of postLinks) {
      for (const track of trackLinks) {
        if (!precedes(post, track)) continue;
        const container = lowestCommonAncestor([post, track]);
        if (!container) continue;
        const containerDepth = depthOf(container);
        const distance = depthOf(post) + depthOf(track) - 2 * containerDepth;
        const visibilityPenalty = (isVisible(post) ? 0 : 1000) + (isVisible(track) ? 0 : 1000);
        const items = collectBreadcrumbItems(container);
        const subjectPenalty = itemsAfter(items, track, container).length ? 0 : 500;
        const score = visibilityPenalty + subjectPenalty + distance;
        if (!best || score < best.score) best = { post, track, container, items, score };
      }
    }
    return best;
  }

  /** Itens do breadcrumb posicionados depois do link da trilha. */
  function itemsAfter(items, track, container) {
    const trackIndex = items.findIndex(
      (item) =>
        item.element === track ||
        track.contains(item.element) ||
        (item.element !== container && item.element.contains(track))
    );
    return trackIndex >= 0 ? items.slice(trackIndex + 1) : [];
  }

  /**
   * Divide o conteúdo textual do container do breadcrumb em itens.
   * - O texto de um link forma um único item.
   * - Textos aninhados no elemento do item anterior são agregados a ele.
   * - Separadores visuais ("/", ">", "›"...) encerram o item atual.
   */
  function collectBreadcrumbItems(container) {
    const containerVisible = isVisible(container);
    const items = [];
    let current = null;

    const doc = container.ownerDocument;
    const walker = doc.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = normalizeWhitespace(node.nodeValue);
      if (!text || isInsideSkippedElement(node, container)) continue;
      if (containerVisible && node.parentElement && !isVisible(node.parentElement)) continue;
      if (isSeparatorText(text)) {
        current = null;
        continue;
      }

      const anchor = node.parentElement && node.parentElement.closest('a');
      const anchorInside = anchor && container.contains(anchor) ? anchor : null;
      const itemElement =
        anchorInside ||
        (node.parentElement && node.parentElement.closest('li')) ||
        node.parentElement;

      const belongsToCurrent =
        current &&
        (current.element === itemElement ||
          (current.element !== container && current.element.contains(node)));

      if (belongsToCurrent) {
        current.text = normalizeWhitespace(`${current.text} ${text}`);
      } else {
        current = {
          text,
          element: itemElement && container.contains(itemElement) ? itemElement : container,
          href: anchorInside ? absoluteHref(anchorInside) : null,
        };
        items.push(current);
      }
    }
    return items;
  }

  function findBreadcrumb(doc, lessonTitle) {
    const postLinks = findJourneyLinks(doc, '/disciplinas');
    const trackLinks = findJourneyLinks(doc, '/conteudos');
    const warnings = [];

    const result = {
      found: false,
      postgraduate: null,
      track: null,
      subject: null,
      items: [],
      container: null,
      candidates: {
        postgraduate: postLinks.map((a) => readableText(a)),
        track: trackLinks.map((a) => readableText(a)),
      },
      warnings,
    };

    const pair = choosePair(postLinks, trackLinks);

    if (!pair) {
      // Sem par válido: ainda reporta o que foi possível encontrar isoladamente.
      const post = postLinks.find(isVisible) || postLinks[0];
      const track = trackLinks.find(isVisible) || trackLinks[0];
      if (post) {
        result.postgraduate = {
          value: readableText(post),
          href: absoluteHref(post),
          source: 'link /jornada/.../disciplinas (fora de um breadcrumb identificado)',
        };
      }
      if (track) {
        result.track = {
          value: readableText(track),
          href: absoluteHref(track),
          source: 'link /jornada/.../conteudos (fora de um breadcrumb identificado)',
        };
      }
      if (post && track) {
        warnings.push(
          'Os links da pós-graduação e da trilha foram encontrados, mas não na ordem esperada de um breadcrumb.'
        );
      }
      return result;
    }

    const { post, track, container, items } = pair;
    result.found = true;
    result.container = describeElement(container);
    result.items = items.map((item) => ({ text: item.text, href: item.href }));
    result.postgraduate = {
      value: readableText(post),
      href: absoluteHref(post),
      source: 'breadcrumb: link /jornada/.../disciplinas',
    };
    result.track = {
      value: readableText(track),
      href: absoluteHref(track),
      source: 'breadcrumb: link /jornada/.../conteudos',
    };

    if (container.querySelector(SEGMENT_SELECTOR) || container.querySelector('h1')) {
      warnings.push(
        'O container identificado como breadcrumb parece amplo demais (contém o título ou a transcrição). Confira a matéria.'
      );
    }

    // Itens textuais após o link da trilha; a matéria é o último deles.
    const afterTrack = itemsAfter(items, track, container);

    if (afterTrack.length) {
      let subjectItem = afterTrack[afterTrack.length - 1];
      let source = 'breadcrumb: último item textual';

      if (lessonTitle && looselyEqual(subjectItem.text, lessonTitle) && afterTrack.length > 1) {
        subjectItem = afterTrack[afterTrack.length - 2];
        source = 'breadcrumb: penúltimo item (o último é igual ao nome da aula)';
        warnings.push('O último item do breadcrumb é igual ao nome da aula; foi usado o item anterior como matéria.');
      } else if (lessonTitle && looselyEqual(subjectItem.text, lessonTitle)) {
        warnings.push('O nome da matéria é igual ao nome da aula. Confira se a identificação está correta.');
      }

      result.subject = { value: subjectItem.text, href: subjectItem.href, source };
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Transcrição
  // ---------------------------------------------------------------------------

  function countSegmentCandidates(doc) {
    return doc.querySelectorAll(SEGMENT_SELECTOR).length;
  }

  function readSegmentElement(element) {
    const timeRaw = element.getAttribute('time');
    const attributeText = normalizeWhitespace(element.getAttribute('text'));
    const span = element.querySelector('span');
    const paragraph = element.querySelector('p');
    const visualTimestamp = span ? normalizeWhitespace(span.textContent) : null;
    const paragraphText = paragraph ? normalizeWhitespace(paragraph.textContent) : null;
    const parsedTime = parseSeconds(timeRaw);

    let rejection = null;
    if (element.querySelector(SEGMENT_SELECTOR)) rejection = 'contém outros segmentos (é um agrupador)';
    else if (!parsedTime.valid) rejection = `atributo time inválido ("${timeRaw}")`;
    else if (!span && !paragraph) rejection = 'estrutura diferente do esperado (sem <span> e sem <p>)';
    else if (!attributeText && !paragraphText) rejection = 'texto vazio';

    return {
      element,
      rejection,
      timeRaw: parsedTime.raw,
      parsedTime,
      attributeText,
      paragraphText,
      visualTimestamp,
    };
  }

  function findTranscript(doc, options) {
    const candidates = Array.from(doc.querySelectorAll(SEGMENT_SELECTOR));
    const readings = candidates.map(readSegmentElement);
    const accepted = readings.filter((reading) => !reading.rejection);
    const rejected = readings.filter((reading) => reading.rejection);

    const segments = accepted.map((reading, index) => {
      const text = reading.attributeText || reading.paragraphText;
      const segment = {
        index: index + 1,
        timeRaw: reading.timeRaw,
        seconds: reading.parsedTime.seconds,
        wholeSeconds: reading.parsedTime.wholeSeconds,
        timestamp: formatTimestamp(reading.parsedTime.wholeSeconds),
        visualTimestamp: reading.visualTimestamp,
        text,
        textSource: reading.attributeText ? 'atributo text' : '<p>',
      };
      if (reading.paragraphText !== null && reading.paragraphText !== text) {
        segment.paragraphText = reading.paragraphText;
      }
      return segment;
    });

    const container = lowestCommonAncestor(accepted.map((reading) => reading.element));
    const directChildren = container
      ? accepted.filter((reading) => reading.element.parentElement === container).length
      : 0;

    return {
      found: segments.length > 0,
      totalCandidates: candidates.length,
      segments,
      rejected: rejected.map((reading) => ({
        timeRaw: reading.timeRaw,
        text: reading.attributeText || reading.paragraphText || '',
        reason: reading.rejection,
      })),
      container: container
        ? {
            description: describeElement(container),
            directSegmentChildren: directChildren,
            visible: isVisible(container),
          }
        : null,
      checks: runTranscriptChecks(doc, segments, options),
    };
  }

  function runTranscriptChecks(doc, segments, options) {
    const checks = {
      firstSegmentSeconds: null,
      lastSegmentSeconds: null,
      lastTimestamp: null,
      outOfOrder: [],
      gaps: [],
      visualMismatches: [],
      visualUnrecognized: 0,
      textMismatches: 0,
      adjacentDuplicates: 0,
      video: null,
    };
    if (!segments.length) return checks;

    checks.firstSegmentSeconds = segments[0].wholeSeconds;
    checks.lastSegmentSeconds = segments[segments.length - 1].wholeSeconds;
    checks.lastTimestamp = segments[segments.length - 1].timestamp;

    segments.forEach((segment, i) => {
      if (segment.paragraphText !== undefined) checks.textMismatches += 1;

      if (segment.visualTimestamp !== null) {
        const visualSeconds = parseVisualTimestamp(segment.visualTimestamp);
        if (visualSeconds === null) {
          checks.visualUnrecognized += 1;
        } else if (Math.abs(visualSeconds - segment.wholeSeconds) > options.visualToleranceSeconds) {
          checks.visualMismatches.push({
            index: segment.index,
            visual: segment.visualTimestamp,
            converted: segment.timestamp,
          });
        }
      }

      if (i === 0) return;
      const previous = segments[i - 1];
      if (segment.seconds < previous.seconds) {
        checks.outOfOrder.push({ index: segment.index, previous: previous.timestamp, current: segment.timestamp });
      }
      const gap = segment.wholeSeconds - previous.wholeSeconds;
      if (gap > options.maxGapSeconds) {
        checks.gaps.push({
          afterIndex: previous.index,
          from: previous.timestamp,
          to: segment.timestamp,
          seconds: gap,
        });
      }
      if (segment.timeRaw === previous.timeRaw && segment.text === previous.text) {
        checks.adjacentDuplicates += 1;
      }
    });

    // Verificação opcional: só ocorre se a página tiver um <video> com duração conhecida.
    const durations = Array.from(doc.querySelectorAll('video'))
      .map((video) => video.duration)
      .filter((duration) => Number.isFinite(duration) && duration > 0);
    if (durations.length) {
      const durationSeconds = Math.floor(Math.max(...durations));
      checks.video = {
        durationSeconds,
        duration: formatTimestamp(durationSeconds),
        remainingAfterLastSegment: durationSeconds - checks.lastSegmentSeconds,
      };
    }

    return checks;
  }

  // ---------------------------------------------------------------------------
  // Leitura completa
  // ---------------------------------------------------------------------------

  function buildIssues(result, breadcrumb, transcript, stability, options) {
    const issues = [];
    const add = (level, code, message) => issues.push({ level, code, message });

    const fieldLabels = {
      postgraduate: 'Pós-graduação',
      track: 'Trilha',
      subject: 'Matéria',
      lesson: 'Nome da aula',
    };
    for (const [key, label] of Object.entries(fieldLabels)) {
      if (!result.context[key]) add('error', `missing-${key}`, `${label} não identificado(a) na página.`);
    }
    breadcrumb.warnings.forEach((message) => add('warning', 'breadcrumb', message));

    if (stability && !stability.stable) {
      add(
        'error',
        'transcript-loading',
        'A quantidade de segmentos ainda estava mudando durante a leitura. Aguarde a transcrição terminar de carregar e leia novamente.'
      );
    }

    if (!transcript.totalCandidates) {
      add(
        'error',
        'transcript-not-found',
        'Transcrição não encontrada. Abra a aba de transcrição da aula, aguarde carregar e leia novamente.'
      );
      return issues;
    }
    if (!transcript.found) {
      add('error', 'transcript-invalid', 'Foram encontrados elementos de transcrição, mas nenhum segmento válido.');
      return issues;
    }

    const { checks } = transcript;
    if (transcript.rejected.length) {
      add(
        'warning',
        'segments-rejected',
        `${transcript.rejected.length} elemento(s) com atributos time/text foram ignorados (veja o diagnóstico completo).`
      );
    }
    if (checks.firstSegmentSeconds > options.maxFirstSegmentStart) {
      add(
        'warning',
        'late-start',
        `O primeiro segmento começa em ${formatTimestamp(checks.firstSegmentSeconds)}. A transcrição pode estar incompleta no início.`
      );
    }
    if (checks.outOfOrder.length) {
      add('warning', 'out-of-order', `${checks.outOfOrder.length} segmento(s) fora da ordem cronológica.`);
    }
    if (checks.gaps.length) {
      add(
        'warning',
        'gaps',
        `${checks.gaps.length} intervalo(s) maior(es) que ${options.maxGapSeconds}s entre segmentos consecutivos. Pode ser silêncio no vídeo ou falha de carregamento.`
      );
    }
    if (checks.visualMismatches.length) {
      add(
        'warning',
        'visual-mismatch',
        `${checks.visualMismatches.length} segmento(s) com timestamp visual diferente do atributo time.`
      );
    }
    if (checks.video && checks.video.remainingAfterLastSegment > options.endToleranceSeconds) {
      add(
        'warning',
        'early-end',
        `O último segmento (${checks.lastTimestamp}) está distante do fim do vídeo (${checks.video.duration}). A transcrição pode estar incompleta no final.`
      );
    }
    if (checks.textMismatches) {
      add(
        'info',
        'text-mismatch',
        `${checks.textMismatches} segmento(s) com diferença entre o atributo text e o texto exibido. Foi usado o atributo text.`
      );
    }
    if (checks.adjacentDuplicates) {
      add('info', 'duplicates', `${checks.adjacentDuplicates} segmento(s) repetido(s) em sequência (mantidos).`);
    }
    return issues;
  }

  function canonicalUrlOf(location) {
    try {
      const url = new URL(location.href);
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch (_error) {
      return location.href;
    }
  }

  /**
   * Lê todos os dados da aula a partir do documento.
   *
   * @param {Document} doc
   * @param {{ stability?: object, options?: object, cachedLessonTitle?: { value: string, source?: string } | null }} [params]
   * @returns {object} resultado serializável (sem referências a elementos)
   */
  function readLessonPage(doc, params = {}) {
    const options = { ...DEFAULT_OPTIONS, ...(params.options || {}) };
    const location = doc.defaultView ? doc.defaultView.location : { href: doc.URL };

    const lesson = findLessonTitle(doc, params.cachedLessonTitle || null);
    const breadcrumb = findBreadcrumb(doc, lesson.value);
    const transcript = findTranscript(doc, options);

    const result = {
      readAt: new Date().toISOString(),
      url: location.href,
      canonicalUrl: canonicalUrlOf(location),
      documentTitle: normalizeWhitespace(doc.title),
      context: {
        postgraduate: breadcrumb.postgraduate,
        track: breadcrumb.track,
        subject: breadcrumb.subject,
        lesson: lesson.value
          ? { value: lesson.value, href: null, source: lesson.source }
          : null,
      },
      lessonHeadings: { total: lesson.totalHeadings, candidates: lesson.candidates },
      breadcrumb: {
        found: breadcrumb.found,
        container: breadcrumb.container,
        items: breadcrumb.items,
        candidates: breadcrumb.candidates,
      },
      transcript,
      stability: params.stability || null,
      options,
    };

    result.issues = buildIssues(result, breadcrumb, transcript, params.stability, options);
    const hasError = result.issues.some((issue) => issue.level === 'error');
    const hasWarning = result.issues.some((issue) => issue.level === 'warning');
    result.status = hasError ? 'error' : hasWarning ? 'warning' : 'ok';
    result.readyToCapture = !hasError;
    return result;
  }

  const api = {
    DEFAULT_OPTIONS,
    SEGMENT_SELECTOR,
    countSegmentCandidates,
    readLessonPage,
    // Expostos para testes e diagnóstico:
    findLessonTitle,
    findBreadcrumb,
    findTranscript,
    readableText,
  };
  ns.courseParser = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
