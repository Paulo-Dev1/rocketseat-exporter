/**
 * Popup principal (Seção 9 da especificação):
 * - Exibe o contexto identificado (Pós-graduação, Trilha, Matéria, Aula).
 * - Exibe o estado da transcrição (encontrada, quantidade de segmentos, status).
 * - Botão principal "Capturar aula" (nova) / "Atualizar aula" (existente).
 * - Exibe a quantidade de aulas capturadas na matéria e o status da pasta de destino.
 * - Atualiza automaticamente o arquivo Markdown da matéria quando a pasta já
 *   estiver configurada e com permissão ativa (ou orienta a abrir o painel).
 * - Botão para abrir o Painel de Gerenciamento.
 */
(function () {
  'use strict';

  const { pageReader, ui, database, storage, exporter } = globalThis.RocketseatExporter;
  const { h } = ui;

  const content = document.getElementById('content');
  const captureButton = document.getElementById('capture-button');
  const dashboardButton = document.getElementById('dashboard-button');
  const reloadButton = document.getElementById('reload-button');
  const diagnosticsButton = document.getElementById('diagnostics-button');

  let activeTabId = null;
  let currentResult = null;
  let currentStorageStatus = null;
  let currentDirectoryStatus = null;
  let feedbackBanner = null;

  function showLoading() {
    content.replaceChildren(
      h('div', { className: 'state' }, h('div', { className: 'spinner' }), h('span', { text: 'Lendo a página…' }))
    );
  }

  function showMessage(message, isError) {
    content.replaceChildren(h('div', { className: `state${isError ? ' state--error' : ''}`, text: message }));
  }

  function updateCaptureButton(result, storageStatus) {
    const isExisting = Boolean(storageStatus && storageStatus.existingLesson);
    captureButton.textContent = isExisting ? 'Atualizar aula' : 'Capturar aula';
    captureButton.disabled = !result || !result.readyToCapture;
  }

  function renderContext(result) {
    const { context } = result;
    const rows = [
      ['Pós-graduação', context.postgraduate],
      ['Trilha', context.track],
      ['Matéria', context.subject],
      ['Aula', context.lesson],
    ];
    return h(
      'section',
      { className: 'card' },
      h('h2', { className: 'card__title', text: 'Contexto identificado' }),
      h(
        'dl',
        { className: 'fields' },
        rows.map(([label, field]) => [h('dt', { text: label }), h('dd', {}, ui.contextValue(field))])
      )
    );
  }

  function renderStorageAndFolderSection(storageStatus, dirStatus) {
    const existing = storageStatus.existingLesson;
    const isCaptured = Boolean(existing);

    const statusPill = h('span', {
      className: `pill ${isCaptured ? 'pill--ok' : 'pill--neutral'}`,
      text: isCaptured ? 'Aula já capturada' : 'Aula nova',
    });

    const stats = h(
      'div',
      { className: 'stats' },
      h(
        'div',
        { className: 'stat' },
        h('span', { className: 'stat__value', text: String(storageStatus.subjectLessonCount) }),
        h('span', { className: 'stat__label', text: 'na matéria' })
      ),
      h(
        'div',
        { className: 'stat' },
        h('span', { className: 'stat__value', text: String(storageStatus.totalLessonsCount) }),
        h('span', { className: 'stat__label', text: 'total no acervo' })
      ),
      h(
        'div',
        { className: 'stat' },
        h('span', {
          className: 'stat__value',
          text: isCaptured ? String(existing.segmentCount) : '—',
        }),
        h('span', { className: 'stat__label', text: 'seg. salvos' })
      )
    );

    let folderLineText;
    if (!dirStatus || !dirStatus.configured) {
      folderLineText = '📁 Pasta de destino: Não selecionada (configure no Painel)';
    } else if (dirStatus.canWriteNow) {
      folderLineText = `📁 Pasta de destino: ${dirStatus.name} (pronta para exportar)`;
    } else {
      folderLineText = `📁 Pasta de destino: ${dirStatus.name} (permissão pendente no Painel)`;
    }

    const section = h(
      'section',
      { className: 'card' },
      h(
        'div',
        { className: 'transcript-head' },
        h('h2', { className: 'card__title', text: 'Status da captura e acervo' }),
        statusPill
      ),
      stats,
      h('div', { className: 'capture-meta', text: folderLineText })
    );

    if (isCaptured) {
      const sameDate = existing.capturedAt === existing.updatedAt;
      const metaText = sameDate
        ? `Capturada em ${ui.formatDateTime(existing.capturedAt)}`
        : `Capturada em ${ui.formatDateTime(existing.capturedAt)} · Atualizada em ${ui.formatDateTime(existing.updatedAt)}`;
      section.append(h('div', { className: 'capture-meta', text: metaText }));
    }

    return section;
  }

  function renderTranscript(result) {
    const { transcript, stability } = result;
    const segments = transcript.segments;
    const found = transcript.found;

    const stats = h(
      'div',
      { className: 'stats' },
      h(
        'div',
        { className: 'stat' },
        h('span', { className: 'stat__value', text: String(segments.length) }),
        h('span', { className: 'stat__label', text: 'segmentos' })
      ),
      h(
        'div',
        { className: 'stat' },
        h('span', { className: 'stat__value', text: transcript.checks.lastTimestamp || '—' }),
        h('span', { className: 'stat__label', text: 'último trecho' })
      ),
      h(
        'div',
        { className: 'stat' },
        h('span', { className: 'stat__value', text: stability ? (stability.stable ? 'Estável' : 'Instável') : '—' }),
        h('span', { className: 'stat__label', text: 'carregamento' })
      )
    );

    const section = h(
      'section',
      { className: 'card' },
      h(
        'div',
        { className: 'transcript-head' },
        h('h2', { className: 'card__title', text: 'Estado da transcrição' }),
        h('span', {
          className: `pill ${found ? 'pill--ok' : 'pill--error'}`,
          text: found ? 'Encontrada' : 'Não encontrada',
        })
      ),
      stats
    );

    if (found) {
      const box = h('ol', { className: 'transcript-lines preview__box' });
      const details = h(
        'details',
        { className: 'preview' },
        h('summary', { text: `Ver transcrição (${segments.length} segmentos)` }),
        box
      );
      details.addEventListener('toggle', () => {
        if (!details.open || box.childElementCount) return;
        box.append(
          ...segments.map((segment) =>
            h('li', {}, h('span', { className: 'ts', text: `[${segment.timestamp}]` }), segment.text)
          )
        );
      });
      section.append(details);
    }
    return section;
  }

  function renderStatus(result) {
    return h(
      'section',
      { className: 'card' },
      h(
        'div',
        { className: 'transcript-head' },
        h('h2', { className: 'card__title', text: 'Diagnóstico da leitura' }),
        ui.statusPill(result.status)
      ),
      ui.renderIssues(result.issues)
    );
  }

  function render(result, storageStatus, dirStatus) {
    const blocks = [];
    if (feedbackBanner) blocks.push(feedbackBanner);
    blocks.push(
      renderContext(result),
      renderStorageAndFolderSection(storageStatus, dirStatus),
      renderTranscript(result),
      renderStatus(result)
    );
    content.replaceChildren(...blocks);
    updateCaptureButton(result, storageStatus);
  }

  async function read() {
    reloadButton.disabled = true;
    captureButton.disabled = true;
    feedbackBanner = null;
    showLoading();
    try {
      const tab = await pageReader.getActiveTab();
      if (!tab) {
        showMessage('Nenhuma aba ativa encontrada.', true);
        return;
      }
      activeTabId = tab.id;
      if (!pageReader.isPlatformUrl(tab.url)) {
        diagnosticsButton.disabled = true;
        showMessage(
          'Abra uma aula em ftr.rocketseat.com.br, abra a aba de transcrição e clique novamente no ícone da extensão. Você também pode abrir o Painel de Gerenciamento abaixo.',
          false
        );
        return;
      }
      const result = await pageReader.readLessonFromTab(tab.id);
      const [storageStatus, dirStatus] = await Promise.all([
        database.getPageStorageStatus(result),
        exporter.getDirectoryStatus(),
      ]);
      currentResult = result;
      currentStorageStatus = storageStatus;
      currentDirectoryStatus = dirStatus;
      diagnosticsButton.disabled = false;
      render(result, storageStatus, dirStatus);
    } catch (error) {
      console.error('[Rocketseat Exporter]', error);
      showMessage(error.message || String(error), true);
    } finally {
      reloadButton.disabled = false;
    }
  }

  async function handleCapture() {
    if (!currentResult || !currentResult.readyToCapture) return;
    captureButton.disabled = true;
    reloadButton.disabled = true;
    const previousText = captureButton.textContent;
    captureButton.textContent = 'Salvando…';

    try {
      const { action, record } = await database.saveLessonFromPageResult(currentResult);

      // Se a pasta já estiver configurada com permissão concedida e autoExport ativo,
      // atualiza imediatamente o arquivo .md da matéria!
      let exportedNote = '';
      const settings = await storage.getSettings();
      const dirStatus = await exporter.getDirectoryStatus();
      if (settings.autoExportOnCapture !== false && dirStatus.canWriteNow) {
        try {
          const exportRes = await exporter.exportSubjectByKey(record.subjectKey, {
            requestPermissionIfNeeded: false,
          });
          exportedNote = ` · Arquivo "${exportRes.filename}" atualizado (${exportRes.lessonCount} aula(s)).`;
        } catch (exportErr) {
          console.warn('[Rocketseat Exporter] Exportação automática ignorada:', exportErr);
        }
      }

      const [updatedStorage, updatedDir] = await Promise.all([
        database.getPageStorageStatus(currentResult),
        exporter.getDirectoryStatus(),
      ]);
      currentStorageStatus = updatedStorage;
      currentDirectoryStatus = updatedDir;

      feedbackBanner = h('div', {
        className: 'feedback feedback--success',
        text:
          (action === 'created'
            ? `Aula capturada (${record.segmentCount} segmentos)`
            : `Aula atualizada (${record.segmentCount} segmentos)`) + exportedNote,
      });
      render(currentResult, currentStorageStatus, currentDirectoryStatus);
    } catch (error) {
      console.error('[Rocketseat Exporter] Falha ao capturar aula:', error);
      feedbackBanner = h('div', {
        className: 'feedback feedback--error',
        text: error.message || String(error),
      });
      if (currentResult && currentStorageStatus) {
        render(currentResult, currentStorageStatus, currentDirectoryStatus);
      } else {
        captureButton.textContent = previousText;
        captureButton.disabled = false;
      }
    } finally {
      reloadButton.disabled = false;
    }
  }

  captureButton.addEventListener('click', handleCapture);
  reloadButton.addEventListener('click', read);

  dashboardButton.addEventListener('click', async () => {
    const subjectKey = currentStorageStatus && currentStorageStatus.subjectKey;
    const query = subjectKey ? `?subjectKey=${encodeURIComponent(subjectKey)}` : '';
    const url = chrome.runtime.getURL(`src/dashboard/dashboard.html${query}`);
    await chrome.tabs.create({ url });
    window.close();
  });

  diagnosticsButton.addEventListener('click', async () => {
    const query = activeTabId !== null ? `?tabId=${activeTabId}` : '';
    const url = chrome.runtime.getURL(`src/diagnostics/diagnostics.html${query}`);
    await chrome.tabs.create({ url });
    window.close();
  });

  read();
})();
