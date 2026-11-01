/**
 * Content script: executa somente em https://ftr.rocketseat.com.br/*.
 *
 * Responsabilidade:
 * 1. Observar continuamente o DOM (via MutationObserver) para memorizar o
 *    título da aula (<h1> da aba "Sobre a aula") sempre que ele estiver
 *    presente na página. Assim, quando o usuário alternar para a aba
 *    "Transcrição" (que desmonta o <h1> no React da plataforma), o nome da
 *    aula continua disponível.
 * 2. Caso a página já esteja na aba "Transcrição" sem ter passado por
 *    "Sobre a aula" (ex.: extensão recarregada), consultar rapidamente a aba
 *    "Sobre a aula" para capturar o <h1> e retornar para "Transcrição".
 * 3. Aguardar a quantidade de segmentos da transcrição se estabilizar antes
 *    de responder ao popup/diagnóstico.
 *
 * Depende de: utils/text.js, utils/timestamp.js, services/course-parser.js,
 * shared/messages.js (carregados antes, na mesma ordem do manifest).
 */
(function () {
  'use strict';

  const ns = globalThis.RocketseatExporter;
  if (!ns || !ns.courseParser || !ns.messages || !ns.text) {
    console.error('[Rocketseat Exporter] Dependências do content script não carregadas.');
    return;
  }

  // Evita registrar o listener e o observer duas vezes caso o script seja injetado novamente.
  if (ns.contentScriptReady) return;
  ns.contentScriptReady = true;

  const { normalizeWhitespace, looselyEqual } = ns.text;

  const STABILITY = Object.freeze({
    intervalMs: 300,
    requiredEqualSamples: 3,
    timeoutMs: 4000,
  });

  /**
   * Cache em memória do último <h1> válido visto na página atual.
   * @type {{ value: string, url: string, capturedAt: string, source: string } | null}
   */
  let cachedLessonTitle = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Verifica se há um <h1> válido no DOM neste instante e atualiza o cache.
   */
  function updateLessonTitleCache(customSource) {
    // Se mudou de rota (sala diferente), invalida o cache anterior.
    if (cachedLessonTitle && cachedLessonTitle.url !== location.href) {
      cachedLessonTitle = null;
    }

    const found = ns.courseParser.findLessonTitle(document, null);
    if (found && found.value) {
      cachedLessonTitle = {
        value: found.value,
        url: location.href,
        capturedAt: new Date().toISOString(),
        source:
          customSource ||
          '<h1> capturado automaticamente na aba "Sobre a aula" (MutationObserver)',
      };
    }
  }

  /**
   * Inicia o MutationObserver para capturar o <h1> assim que a aula abre
   * ou quando o usuário troca de aula na barra lateral.
   */
  function startLessonTitleObserver() {
    updateLessonTitleCache();

    const observer = new MutationObserver(() => {
      updateLessonTitleCache();
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  /**
   * Localiza um botão/aba da área da aula pelo seu texto visível
   * (ex.: "Sobre a aula", "Transcrição").
   */
  function findTabTrigger(labelText) {
    const candidates = document.querySelectorAll('button, [role="tab"], a');
    for (const el of candidates) {
      const text = normalizeWhitespace(el.textContent);
      if (looselyEqual(text, labelText)) {
        return el;
      }
    }
    return null;
  }

  /**
   * Caso o usuário tenha recarregado a extensão já dentro da aba "Transcrição"
   * (e portanto o observer ainda não tenha visto o <h1>), alterna rapidamente
   * para "Sobre a aula", lê o <h1> e volta para "Transcrição".
   */
  async function ensureLessonTitleCaptured() {
    updateLessonTitleCache();
    if (cachedLessonTitle && cachedLessonTitle.value) return;

    const aboutTab = findTabTrigger('Sobre a aula');
    const transcriptTab = findTabTrigger('Transcrição');
    if (!aboutTab || !transcriptTab) return;

    const hasTranscriptOpen = ns.courseParser.countSegmentCandidates(document) > 0;
    aboutTab.click();

    // Aguarda até 1.5s pelo <h1> aparecer na aba "Sobre a aula".
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1500) {
      updateLessonTitleCache('<h1> capturado ao consultar a aba "Sobre a aula"');
      if (cachedLessonTitle && cachedLessonTitle.value) break;
      await sleep(80);
    }

    // Se a aba de transcrição estava aberta, retorna para ela imediatamente.
    if (hasTranscriptOpen) {
      const transcriptTriggerAgain = findTabTrigger('Transcrição') || transcriptTab;
      transcriptTriggerAgain.click();
      // Aguarda os segmentos reaparecerem no DOM.
      const waitTranscriptStart = Date.now();
      while (
        Date.now() - waitTranscriptStart < 2000 &&
        ns.courseParser.countSegmentCandidates(document) === 0
      ) {
        await sleep(80);
      }
    }
  }

  /**
   * Amostra a quantidade de segmentos até que as últimas N amostras sejam
   * iguais (estável) ou até o tempo limite.
   */
  async function waitForStableSegmentCount() {
    const startedAt = Date.now();
    const samples = [ns.courseParser.countSegmentCandidates(document)];

    while (Date.now() - startedAt < STABILITY.timeoutMs) {
      const recent = samples.slice(-STABILITY.requiredEqualSamples);
      if (recent.length === STABILITY.requiredEqualSamples && recent.every((n) => n === recent[0])) {
        return { stable: true, samples, elapsedMs: Date.now() - startedAt };
      }
      await sleep(STABILITY.intervalMs);
      samples.push(ns.courseParser.countSegmentCandidates(document));
    }

    const recent = samples.slice(-STABILITY.requiredEqualSamples);
    const stable =
      recent.length === STABILITY.requiredEqualSamples && recent.every((n) => n === recent[0]);
    return { stable, samples, elapsedMs: Date.now() - startedAt };
  }

  async function readLessonPage() {
    await ensureLessonTitleCaptured();
    const stability = await waitForStableSegmentCount();
    updateLessonTitleCache();
    return ns.courseParser.readLessonPage(document, {
      stability,
      cachedLessonTitle,
    });
  }

  startLessonTitleObserver();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== ns.messages.READ_LESSON_PAGE) return false;

    readLessonPage()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        console.error('[Rocketseat Exporter] Falha ao ler a página:', error);
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      });

    return true; // resposta assíncrona
  });
})();
