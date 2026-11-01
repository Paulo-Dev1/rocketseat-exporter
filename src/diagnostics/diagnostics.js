/**
 * Página de diagnóstico completo da leitura de uma aula.
 *
 * Mostra todos os dados identificados, as verificações de completude e a
 * transcrição integral, permitindo copiar o texto e baixar um JSON para
 * conferência. Não armazena nada.
 */
(function () {
  'use strict';

  const { pageReader, ui, transcript: transcriptFormat, timestamp, database } =
    globalThis.RocketseatExporter;
  const { h } = ui;

  const main = document.getElementById('main');
  const tabSelect = document.getElementById('tab-select');
  const reloadButton = document.getElementById('reload-button');
  const captureButton = document.getElementById('capture-button');
  const copyButton = document.getElementById('copy-button');
  const downloadButton = document.getElementById('download-button');

  let currentTabId = null;
  let currentResult = null;
  let currentStorageStatus = null;

  // ---------------------------------------------------------------------------
  // Estados
  // ---------------------------------------------------------------------------

  function showLoading(message) {
    main.replaceChildren(
      h('div', { className: 'state' }, h('div', { className: 'spinner' }), h('span', { text: message }))
    );
  }

  function showMessage(message, isError) {
    main.replaceChildren(h('div', { className: `card state${isError ? ' state--error' : ''}`, text: message }));
  }

  function disableResultActions() {
    captureButton.disabled = true;
    copyButton.disabled = true;
    downloadButton.disabled = true;
  }

  function updateCaptureButton(result, storageStatus) {
    const isExisting = Boolean(storageStatus && storageStatus.existingLesson);
    captureButton.textContent = isExisting ? 'Atualizar aula' : 'Capturar aula';
    captureButton.disabled = !result || !result.readyToCapture;
  }

  // ---------------------------------------------------------------------------
  // Blocos de interface
  // ---------------------------------------------------------------------------

  function card(title, ...children) {
    return h('section', { className: 'card' }, h('h2', { className: 'card__title', text: title }), ...children);
  }

  function kvTable(rows) {
    return h(
      'table',
      { className: 'kv' },
      h(
        'tbody',
        {},
        rows.map(([label, value]) => h('tr', {}, h('th', { scope: 'row', text: label }), h('td', {}, value)))
      )
    );
  }

  function link(href) {
    if (!href) return null;
    return h('a', { href, target: '_blank', rel: 'noopener noreferrer', className: 'mono', text: href });
  }

  function renderSummary(result, storageStatus) {
    const { transcript } = result;
    const isCaptured = Boolean(storageStatus && storageStatus.existingLesson);
    const items = [
      [ui.statusPill(result.status), 'Status da leitura'],
      [
        h('span', {
          className: `pill ${isCaptured ? 'pill--ok' : 'pill--neutral'}`,
          text: isCaptured ? 'Já capturada' : 'Não capturada',
        }),
        'Status no IndexedDB',
      ],
      [String(transcript.segments.length), 'Segmentos na página'],
      [String(storageStatus ? storageStatus.subjectLessonCount : 0), 'Aulas salvas na matéria'],
      [String(storageStatus ? storageStatus.totalLessonsCount : 0), 'Total no acervo'],
      [transcript.checks.lastTimestamp || '—', 'Último segmento'],
    ];
    return h(
      'div',
      { className: 'summary' },
      items.map(([value, label]) =>
        h(
          'div',
          { className: 'summary__item' },
          h('span', { className: 'summary__value' }, value),
          h('span', { className: 'summary__label', text: label })
        )
      )
    );
  }

  function renderStorageCard(storageStatus) {
    if (!storageStatus) return null;
    const { existingLesson, subjectLessons, lessonId, subjectKey } = storageStatus;

    const rows = [
      ['ID único da aula', lessonId ? h('span', { className: 'mono', text: lessonId }) : '—'],
      ['Chave da matéria', subjectKey ? h('span', { className: 'mono', text: subjectKey }) : '—'],
      [
        'Estado da aula atual',
        existingLesson
          ? `Salva (${existingLesson.segmentCount} segmentos) · Capturada em ${ui.formatDateTime(existingLesson.capturedAt)} · Atualizada em ${ui.formatDateTime(existingLesson.updatedAt)}`
          : 'Ainda não capturada no IndexedDB',
      ],
      [
        `Aulas capturadas nesta matéria (${subjectLessons.length})`,
        subjectLessons.length
          ? h(
              'ol',
              { className: 'sublist' },
              subjectLessons.map((item) =>
                h('li', {
                  text: `${item.lesson} (${item.segmentCount} seg. · ${ui.formatDateTime(item.capturedAt)})`,
                })
              )
            )
          : h('span', { className: 'source', text: 'nenhuma aula capturada nesta matéria ainda' }),
      ],
    ];

    return card('Persistência no IndexedDB', kvTable(rows));
  }

  function renderContext(result) {
    const field = (data) =>
      h(
        'div',
        {},
        ui.contextValue(data),
        data && data.source ? h('span', { className: 'source', text: `Origem: ${data.source}` }) : null,
        data && data.href ? link(data.href) : null
      );

    const { context } = result;
    return card(
      'Contexto identificado',
      kvTable([
        ['Pós-graduação', field(context.postgraduate)],
        ['Trilha', field(context.track)],
        ['Matéria', field(context.subject)],
        ['Aula', field(context.lesson)],
        ['URL da aula', link(result.url)],
        ['URL normalizada', h('span', { className: 'mono', text: result.canonicalUrl })],
        ['Título do documento', result.documentTitle || '—'],
      ])
    );
  }

  function renderBreadcrumb(result) {
    const { breadcrumb, lessonHeadings } = result;
    const listOf = (values) =>
      values.length
        ? h('ul', { className: 'sublist' }, values.map((value) => h('li', { text: value })))
        : h('span', { className: 'source', text: 'nenhum' });

    return card(
      'Breadcrumb e títulos',
      kvTable([
        [
          'Itens do breadcrumb',
          breadcrumb.items.length
            ? h('ol', { className: 'crumbs' }, breadcrumb.items.map((item) => h('li', { text: item.text })))
            : h('span', { className: 'value--missing', text: 'Breadcrumb não identificado' }),
        ],
        ['Container', breadcrumb.container ? h('span', { className: 'mono', text: breadcrumb.container }) : '—'],
        [
          `Links de pós-graduação (${breadcrumb.candidates.postgraduate.length})`,
          listOf(breadcrumb.candidates.postgraduate),
        ],
        [`Links de trilha (${breadcrumb.candidates.track.length})`, listOf(breadcrumb.candidates.track)],
        [`<h1> com texto (${lessonHeadings.candidates.length} de ${lessonHeadings.total})`, listOf(lessonHeadings.candidates)],
      ])
    );
  }

  function renderChecks(result) {
    const { transcript, stability, options } = result;
    const { checks } = transcript;
    const fmt = (seconds) => (seconds === null ? '—' : timestamp.formatTimestamp(seconds));
    const listOrNone = (items, toText, limit = 20) => {
      if (!items.length) return h('span', { text: 'nenhum' });
      const visible = items.slice(0, limit);
      return h(
        'div',
        {},
        h('span', { text: String(items.length) }),
        h(
          'ul',
          { className: 'sublist' },
          visible.map((item) => h('li', { text: toText(item) })),
          items.length > limit ? h('li', { text: `… e mais ${items.length - limit}` }) : null
        )
      );
    };

    const rows = [
      ['Elementos [time][text] na página', String(transcript.totalCandidates)],
      ['Segmentos válidos', String(transcript.segments.length)],
      [
        'Elementos ignorados',
        listOrNone(transcript.rejected, (item) => `time="${item.timeRaw}" — ${item.reason}${item.text ? ` — "${item.text}"` : ''}`),
      ],
      [
        'Container da transcrição',
        transcript.container
          ? h(
              'span',
              {},
              h('span', { className: 'mono', text: transcript.container.description }),
              h('span', {
                className: 'source',
                text: `${transcript.container.directSegmentChildren} segmento(s) como filhos diretos · ${transcript.container.visible ? 'visível' : 'não visível'}`,
              })
            )
          : '—',
      ],
      [
        'Estabilidade do carregamento',
        stability
          ? `${stability.stable ? 'Estável' : 'Instável'} · contagens: ${stability.samples.join(' → ')} · ${stability.elapsedMs} ms`
          : '—',
      ],
      ['Primeiro segmento', fmt(checks.firstSegmentSeconds)],
      ['Último segmento', fmt(checks.lastSegmentSeconds)],
      [
        'Duração do vídeo',
        checks.video
          ? `${checks.video.duration} (restam ${checks.video.remainingAfterLastSegment}s após o último segmento)`
          : 'Não disponível (o player pode estar em um iframe) — verificação ignorada',
      ],
      ['Fora de ordem', listOrNone(checks.outOfOrder, (item) => `#${item.index}: ${item.previous} → ${item.current}`)],
      [
        `Intervalos maiores que ${options.maxGapSeconds}s`,
        listOrNone(checks.gaps, (item) => `após #${item.afterIndex}: ${item.from} → ${item.to} (${item.seconds}s)`),
      ],
      [
        'Timestamp visual divergente',
        listOrNone(checks.visualMismatches, (item) => `#${item.index}: visual ${item.visual} · convertido ${item.converted}`),
      ],
      ['Timestamp visual não reconhecido', String(checks.visualUnrecognized)],
      ['Atributo text ≠ texto exibido', String(checks.textMismatches)],
      ['Repetidos em sequência', String(checks.adjacentDuplicates)],
    ];

    return card('Verificações da transcrição', kvTable(rows));
  }

  function renderSegments(result) {
    const segments = result.transcript.segments;
    const mismatchIndexes = new Set(result.transcript.checks.visualMismatches.map((item) => item.index));

    const tbody = h(
      'tbody',
      {},
      segments.map((segment) =>
        h(
          'tr',
          {
            className: mismatchIndexes.has(segment.index) ? 'is-mismatch' : null,
            dataset: { search: `${segment.timestamp} ${segment.text}`.toLocaleLowerCase('pt-BR') },
          },
          h('td', { className: 'num', text: String(segment.index) }),
          h('td', { className: 'time', text: segment.timeRaw }),
          h('td', { className: 'time', text: segment.timestamp }),
          h('td', { className: 'time time--visual', text: segment.visualTimestamp || '—' }),
          h(
            'td',
            {},
            segment.text,
            segment.paragraphText !== undefined
              ? h('span', { className: 'alt-text', text: `Texto exibido (<p>): ${segment.paragraphText}` })
              : null
          )
        )
      )
    );

    const countLabel = h('span', { className: 'count-label', text: `${segments.length} segmento(s)` });
    const filter = h('input', {
      className: 'filter',
      type: 'search',
      placeholder: 'Filtrar por texto ou timestamp…',
      'aria-label': 'Filtrar segmentos',
    });
    filter.addEventListener('input', () => {
      const term = filter.value.trim().toLocaleLowerCase('pt-BR');
      let visible = 0;
      for (const row of tbody.rows) {
        const match = !term || row.dataset.search.includes(term);
        row.classList.toggle('hidden', !match);
        if (match) visible += 1;
      }
      countLabel.textContent = term
        ? `${visible} de ${segments.length} segmento(s)`
        : `${segments.length} segmento(s)`;
    });

    return h(
      'section',
      { className: 'card' },
      h(
        'div',
        { className: 'transcript-toolbar' },
        h('h2', { className: 'card__title', text: 'Transcrição capturada' }),
        h('div', { className: 'topbar__actions' }, countLabel, filter)
      ),
      segments.length
        ? h(
            'div',
            { className: 'table-wrap' },
            h(
              'table',
              { className: 'segments' },
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  ['#', 'time (bruto)', 'Convertido', 'Visual', 'Texto'].map((label) => h('th', { text: label }))
                )
              ),
              tbody
            )
          )
        : h('p', { className: 'value--missing', text: 'Nenhum segmento capturado.' })
    );
  }

  function render(result, storageStatus) {
    main.replaceChildren(
      renderSummary(result, storageStatus),
      card('Problemas e avisos', ui.renderIssues(result.issues)),
      renderStorageCard(storageStatus),
      h('div', { className: 'grid-2' }, renderContext(result), renderBreadcrumb(result)),
      renderChecks(result),
      renderSegments(result)
    );
    updateCaptureButton(result, storageStatus);
  }

  // ---------------------------------------------------------------------------
  // Seleção de aba e leitura
  // ---------------------------------------------------------------------------

  async function populateTabs() {
    const tabs = await pageReader.listPlatformTabs();
    tabSelect.replaceChildren(
      ...tabs.map((tab) => h('option', { value: String(tab.id), text: tab.title || tab.url }))
    );
    if (!tabs.length) {
      tabSelect.append(h('option', { value: '', text: 'Nenhuma aba da plataforma aberta' }));
    }
    return tabs;
  }

  async function read() {
    reloadButton.disabled = true;
    disableResultActions();
    currentResult = null;

    if (currentTabId === null) {
      showMessage('Abra uma aula em ftr.rocketseat.com.br e selecione a aba acima.', false);
      reloadButton.disabled = false;
      return;
    }

    showLoading('Lendo a página da aula…');
    try {
      currentResult = await pageReader.readLessonFromTab(currentTabId);
      currentStorageStatus = await database.getPageStorageStatus(currentResult);
      render(currentResult, currentStorageStatus);
      downloadButton.disabled = false;
      copyButton.disabled = !currentResult.transcript.found;
    } catch (error) {
      console.error('[Rocketseat Exporter]', error);
      showMessage(error.message || String(error), true);
    } finally {
      reloadButton.disabled = false;
    }
  }

  function selectTab(tabId) {
    currentTabId = tabId;
    const url = new URL(location.href);
    if (tabId === null) url.searchParams.delete('tabId');
    else url.searchParams.set('tabId', String(tabId));
    history.replaceState(null, '', url);
  }

  async function init() {
    const tabs = await populateTabs();
    const requested = Number(new URL(location.href).searchParams.get('tabId'));
    const initial = tabs.find((tab) => tab.id === requested) || tabs[0] || null;
    selectTab(initial ? initial.id : null);
    if (initial) tabSelect.value = String(initial.id);
    await read();
  }

  // ---------------------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------------------

  tabSelect.addEventListener('change', () => {
    selectTab(tabSelect.value ? Number(tabSelect.value) : null);
    read();
  });

  // Atualiza a lista de abas ao ganhar foco, sem trocar a aba selecionada.
  tabSelect.addEventListener('focus', async () => {
    const selected = tabSelect.value;
    const tabs = await populateTabs();
    if (tabs.some((tab) => String(tab.id) === selected)) tabSelect.value = selected;
  });

  reloadButton.addEventListener('click', read);

  captureButton.addEventListener('click', async () => {
    if (!currentResult || !currentResult.readyToCapture) return;
    captureButton.disabled = true;
    try {
      const { action } = await database.saveLessonFromPageResult(currentResult);
      currentStorageStatus = await database.getPageStorageStatus(currentResult);
      render(currentResult, currentStorageStatus);
      ui.flash(captureButton, action === 'created' ? 'Aula capturada!' : 'Aula atualizada!');
    } catch (error) {
      console.error('[Rocketseat Exporter]', error);
      ui.flash(captureButton, 'Erro ao salvar');
    }
  });

  copyButton.addEventListener('click', async () => {
    if (!currentResult) return;
    try {
      await navigator.clipboard.writeText(transcriptFormat.toPlainText(currentResult.transcript.segments));
      ui.flash(copyButton, 'Copiado!');
    } catch (error) {
      ui.flash(copyButton, 'Falha ao copiar');
      console.error('[Rocketseat Exporter]', error);
    }
  });

  downloadButton.addEventListener('click', () => {
    if (!currentResult) return;
    const json = JSON.stringify(currentResult, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = currentResult.readAt.replace(/[:.]/g, '-');
    const anchor = h('a', { href: url, download: `rocketseat-diagnostico-${stamp}.json` });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  init().catch((error) => {
    console.error('[Rocketseat Exporter]', error);
    showMessage(error.message || String(error), true);
  });
})();
