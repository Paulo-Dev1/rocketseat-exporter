/**
 * Painel de Gerenciamento e Exportação (Seções 8 e 9 da especificação).
 *
 * Responsabilidades:
 * - Exibir estatísticas gerais (total de aulas capturadas, matérias, trilhas,
 *   pós-graduações).
 * - Selecionar ou alterar a pasta de destino via `showDirectoryPicker()`
 *   (sempre em resposta a clique explícito do usuário).
 * - Verificar e renovar permissões da pasta (`queryPermission` / `requestPermission`).
 * - Exportar ou atualizar todo o acervo Markdown (ou uma matéria individual).
 * - Permitir visualizar/baixar o Markdown gerado para cada matéria e gerenciar
 *   as aulas armazenadas no IndexedDB.
 * - Exibir relatório de integridade das aulas capturadas (ex.: possíveis lacunas
 *   de tempo ou transcrições curtas).
 */
(function () {
  'use strict';

  const { database, storage, markdown, exporter, ui } = globalThis.RocketseatExporter;
  const { h } = ui;

  const main = document.getElementById('main');
  const refreshButton = document.getElementById('refresh-button');
  const pickFolderButton = document.getElementById('pick-folder-button');
  const grantPermissionButton = document.getElementById('grant-permission-button');
  const exportAllButton = document.getElementById('export-all-button');

  const highlightedSubjectKey = new URL(location.href).searchParams.get('subjectKey');

  let currentSummary = null;
  let currentDirectoryStatus = null;
  let currentSettings = null;
  let activeBanner = null;

  function setBanner(type, message) {
    if (!message) {
      activeBanner = null;
      return;
    }
    activeBanner = h('div', { className: `banner banner--${type}`, text: message });
  }

  function updateHeaderButtons(summary, dirStatus) {
    pickFolderButton.textContent = dirStatus.configured ? 'Alterar pasta' : 'Selecionar pasta';
    grantPermissionButton.classList.toggle('hidden', !dirStatus.needsPermissionPrompt);
    exportAllButton.disabled = !summary || summary.totalLessons === 0;
  }

  function renderSummaryCards(summary, dirStatus) {
    const folderPill = !dirStatus.configured
      ? h('span', { className: 'pill pill--neutral', text: 'Não selecionada' })
      : dirStatus.canWriteNow
        ? h('span', { className: 'pill pill--ok', text: 'Pronta para gravar' })
        : h('span', { className: 'pill pill--warning', text: 'Requer permissão' });

    const items = [
      [String(summary.totalLessons), 'Total de aulas capturadas'],
      [String(summary.totalSubjects), 'Total de matérias'],
      [String(summary.totalTracks), 'Total de trilhas'],
      [String(summary.totalPostgraduates), 'Pós-graduações'],
      [folderPill, 'Pasta de destino'],
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

  function renderDirectorySection(dirStatus, settings) {
    let statusDescription;
    if (!dirStatus.configured) {
      statusDescription =
        'Nenhuma pasta local selecionada. Clique em "Selecionar pasta" para escolher onde a estrutura Pós / Trilha / materia.md será criada.';
    } else if (dirStatus.canWriteNow) {
      statusDescription = `Permissão de leitura e escrita ativa. Estrutura criada automaticamente dentro de "${dirStatus.name}/".`;
    } else {
      statusDescription = `A pasta "${dirStatus.name}" está configurada, mas a permissão de gravação expirou após reiniciar o navegador. Clique em "Conceder permissão" para reativar.`;
    }

    const lastExportText = settings.lastFullExportAt
      ? `Última exportação geral: ${ui.formatDateTime(settings.lastFullExportAt)}`
      : 'Nenhuma exportação geral realizada ainda.';

    const autoExportCheckbox = h('input', {
      type: 'checkbox',
      checked: settings.autoExportOnCapture !== false ? 'checked' : null,
    });
    autoExportCheckbox.checked = settings.autoExportOnCapture !== false;
    autoExportCheckbox.addEventListener('change', async () => {
      currentSettings = await storage.updateSettings({
        autoExportOnCapture: autoExportCheckbox.checked,
      });
    });

    return h(
      'section',
      { className: 'card folder-card' },
      h(
        'div',
        { className: 'folder-card__info' },
        h('h2', { className: 'card__title', text: 'Pasta de destino (File System Access API)' }),
        h('div', {
          className: 'folder-card__name',
          text: dirStatus.configured ? `📁 ${dirStatus.name}` : '📁 Pasta ainda não selecionada',
        }),
        h('div', { className: 'folder-card__meta', text: statusDescription }),
        h('div', { className: 'folder-card__meta', text: lastExportText })
      ),
      h(
        'div',
        { className: 'folder-card__controls' },
        h(
          'label',
          { className: 'toggle' },
          autoExportCheckbox,
          h('span', { text: 'Atualizar arquivo .md automaticamente ao capturar aula (se a permissão estiver ativa)' })
        )
      )
    );
  }

  function getSubjectExportStatus(subjectEntry, settings) {
    const exportInfo = settings.subjectExports && settings.subjectExports[subjectEntry.subjectKey];
    if (!exportInfo || !exportInfo.exportedAt) {
      return {
        pill: h('span', { className: 'pill pill--neutral', text: 'Não exportada' }),
        detail: 'Ainda não exportada para a pasta local.',
      };
    }

    const isOutdated =
      String(subjectEntry.lastUpdatedAt) > String(exportInfo.exportedAt) ||
      exportInfo.lessonCount !== subjectEntry.lessonCount;

    if (isOutdated) {
      return {
        pill: h('span', { className: 'pill pill--warning', text: 'Desatualizada no disco' }),
        detail: `Exportada em ${ui.formatDateTime(exportInfo.exportedAt)} (${exportInfo.lessonCount} aula(s) na época · ${subjectEntry.lessonCount} agora)`,
      };
    }

    return {
      pill: h('span', { className: 'pill pill--ok', text: 'Sincronizada' }),
      detail: `Exportada em ${ui.formatDateTime(exportInfo.exportedAt)}`,
    };
  }

  function downloadMarkdownBlob(filename, contentText) {
    const blob = new Blob([contentText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = h('a', { href: url, download: filename });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderSubjectCard(subjectEntry, settings) {
    const relativePath = `${subjectEntry.folderPath}/${subjectEntry.markdownFilename}`;
    const exportStatus = getSubjectExportStatus(subjectEntry, settings);
    const isHighlighted = highlightedSubjectKey && highlightedSubjectKey === subjectEntry.subjectKey;

    const exportOneButton = h(
      'button',
      {
        className: 'btn btn--primary btn--sm',
        type: 'button',
        onClick: () => handleExportSingleSubject(subjectEntry, exportOneButton),
      },
      'Exportar matéria (.md)'
    );

    const downloadOneButton = h(
      'button',
      {
        className: 'btn btn--ghost btn--sm',
        type: 'button',
        onClick: () => {
          const md = markdown.generateSubjectMarkdown(subjectEntry);
          downloadMarkdownBlob(subjectEntry.markdownFilename, md);
        },
      },
      'Baixar .md avulso'
    );

    const previewBox = h('pre', { className: 'markdown-preview hidden' });
    const togglePreviewButton = h(
      'button',
      {
        className: 'btn btn--ghost btn--sm',
        type: 'button',
        onClick: () => {
          const willShow = previewBox.classList.contains('hidden');
          if (willShow) {
            previewBox.textContent = markdown.generateSubjectMarkdown(subjectEntry);
            previewBox.classList.remove('hidden');
            togglePreviewButton.textContent = 'Ocultar prévia Markdown';
          } else {
            previewBox.classList.add('hidden');
            togglePreviewButton.textContent = 'Pré-visualizar Markdown';
          }
        },
      },
      'Pré-visualizar Markdown'
    );

    const lessonsTable = h(
      'table',
      { className: 'lessons-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ['#', 'Aula', 'Segmentos', 'Último trecho', 'Capturada em', 'Atualizada em', 'Ações'].map((label) =>
            h('th', { text: label })
          )
        )
      ),
      h(
        'tbody',
        {},
        subjectEntry.lessons.map((lesson, idx) =>
          h(
            'tr',
            {},
            h('td', { className: 'mono', text: String(idx + 1).padStart(2, '0') }),
            h('td', { text: lesson.lesson }),
            h('td', { text: String(lesson.segmentCount) }),
            h('td', { className: 'mono', text: lesson.lastTimestamp || '—' }),
            h('td', { text: ui.formatDateTime(lesson.capturedAt) }),
            h('td', { text: ui.formatDateTime(lesson.updatedAt) }),
            h(
              'td',
              {},
              h(
                'button',
                {
                  className: 'btn btn--danger btn--sm',
                  type: 'button',
                  onClick: () => handleDeleteLesson(lesson),
                },
                'Remover'
              )
            )
          )
        )
      )
    );

    return h(
      'article',
      {
        className: `subject-card${isHighlighted ? ' subject-card--highlighted' : ''}`,
      },
      h(
        'div',
        { className: 'subject-card__header' },
        h(
          'div',
          {},
          h('h3', { className: 'subject-card__title', text: subjectEntry.subject }),
          h('div', {
            className: 'subject-card__Hierarchy',
            text: `${subjectEntry.postgraduate} › ${subjectEntry.track}`,
          })
        ),
        h('div', { className: 'subject-card__actions' }, exportStatus.pill, exportOneButton, togglePreviewButton, downloadOneButton)
      ),
      h(
        'div',
        { className: 'subject-card__meta' },
        h('span', { text: `Aulas capturadas: ${subjectEntry.lessonCount}` }),
        h('span', { text: '·' }),
        h('span', { className: 'mono', text: relativePath }),
        h('span', { text: '·' }),
        h('span', { text: exportStatus.detail })
      ),
      previewBox,
      h(
        'details',
        { className: 'lessons-details', open: isHighlighted ? 'open' : null },
        h('summary', { text: `Ver aulas capturadas nesta matéria (${subjectEntry.lessonCount})` }),
        lessonsTable
      )
    );
  }

  function renderSubjectsSection(summary, settings) {
    if (!summary.subjects.length) {
      return h(
        'section',
        { className: 'card' },
        h('h2', { className: 'card__title', text: 'Matérias cadastradas' }),
        h(
          'p',
          {
            className: 'folder-card__meta',
            text: 'Nenhuma aula foi capturada ainda. Acesse uma aula em ftr.rocketseat.com.br, abra a aba de transcrição e clique em "Capturar aula" no popup da extensão.',
          }
        )
      );
    }

    return h(
      'section',
      { className: 'card' },
      h('h2', {
        className: 'card__title',
        text: `Matérias cadastradas (${summary.subjects.length})`,
      }),
      h(
        'div',
        { className: 'subjects-list' },
        summary.subjects.map((subjectEntry) => renderSubjectCard(subjectEntry, settings))
      )
    );
  }

  /**
   * Gera um relatório de integridade das aulas capturadas e possíveis lacunas
   * internas de transcrição (sem inventar total esperado de aulas).
   */
  function renderIntegrityReport(summary) {
    if (!summary.totalLessons) return null;

    const findings = [];
    for (const subjectEntry of summary.subjects) {
      for (const lesson of subjectEntry.lessons) {
        const segments = lesson.segments || [];
        if (segments.length < 3) {
          findings.push(
            `[${subjectEntry.subject}] "${lesson.lesson}" possui apenas ${segments.length} segmento(s) capturado(s).`
          );
        }
        if (segments.length > 0 && segments[0].wholeSeconds > 30) {
          findings.push(
            `[${subjectEntry.subject}] "${lesson.lesson}" inicia o primeiro segmento em ${segments[0].timestamp} (acima de 30s).`
          );
        }
        let largeGaps = 0;
        for (let i = 1; i < segments.length; i += 1) {
          if (segments[i].wholeSeconds - segments[i - 1].wholeSeconds > 90) {
            largeGaps += 1;
          }
        }
        if (largeGaps > 0) {
          findings.push(
            `[${subjectEntry.subject}] "${lesson.lesson}" possui ${largeGaps} intervalo(s) maior(es) que 90s entre falas.`
          );
        }
      }
    }

    return h(
      'section',
      { className: 'card' },
      h('h2', { className: 'card__title', text: 'Relatório de integridade do acervo' }),
      findings.length === 0
        ? h('p', {
            className: 'issues-empty',
            text: `Todas as ${summary.totalLessons} aula(s) capturadas em ${summary.totalSubjects} matéria(s) estão íntegras e completas.`,
          })
        : h(
            'ul',
            { className: 'report-list' },
            findings.map((item) => h('li', { text: item }))
          )
    );
  }

  function render() {
    const blocks = [];
    if (activeBanner) blocks.push(activeBanner);
    blocks.push(
      renderSummaryCards(currentSummary, currentDirectoryStatus),
      renderDirectorySection(currentDirectoryStatus, currentSettings),
      renderSubjectsSection(currentSummary, currentSettings),
      renderIntegrityReport(currentSummary)
    );
    main.replaceChildren(...blocks.filter(Boolean));
    updateHeaderButtons(currentSummary, currentDirectoryStatus);
  }

  async function loadAll() {
    refreshButton.disabled = true;
    try {
      const [summary, dirStatus, settings] = await Promise.all([
        database.getArchiveSummary(),
        exporter.getDirectoryStatus(),
        storage.getSettings(),
      ]);
      currentSummary = summary;
      currentDirectoryStatus = dirStatus;
      currentSettings = settings;
      render();
    } catch (error) {
      console.error('[Rocketseat Exporter] Erro ao carregar painel:', error);
      main.replaceChildren(
        h('div', { className: 'card state state--error', text: error.message || String(error) })
      );
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function handlePickFolder() {
    pickFolderButton.disabled = true;
    try {
      const chosen = await exporter.selectArchiveDirectory();
      setBanner(
        'success',
        `Pasta "${chosen.name}" selecionada e salva com sucesso! Agora você já pode exportar o acervo.`
      );
      await loadAll();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        // Usuário cancelou a janela de seleção de pasta
        return;
      }
      console.error('[Rocketseat Exporter] Erro ao selecionar pasta:', error);
      setBanner('error', error.message || String(error));
      render();
    } finally {
      pickFolderButton.disabled = false;
    }
  }

  async function handleGrantPermission() {
    grantPermissionButton.disabled = true;
    try {
      const res = await exporter.requestDirectoryPermission();
      if (res.granted) {
        setBanner('success', `Permissão de gravação concedida para a pasta "${res.name}".`);
      } else {
        setBanner('warning', 'A permissão não foi concedida. Tente novamente ou selecione a pasta outra vez.');
      }
      await loadAll();
    } catch (error) {
      setBanner('error', error.message || String(error));
      render();
    } finally {
      grantPermissionButton.disabled = false;
    }
  }

  async function handleExportSingleSubject(subjectEntry, buttonEl) {
    buttonEl.disabled = true;
    const originalText = buttonEl.textContent;
    buttonEl.textContent = 'Exportando…';
    try {
      if (!currentDirectoryStatus.configured) {
        await exporter.selectArchiveDirectory();
      }
      const res = await exporter.exportSubjectByKey(subjectEntry.subjectKey, {
        requestPermissionIfNeeded: true,
      });
      setBanner(
        'success',
        `Matéria "${subjectEntry.subject}" exportada com sucesso em "${res.relativePath}" (${res.lessonCount} aula(s)).`
      );
      await loadAll();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        buttonEl.textContent = originalText;
        buttonEl.disabled = false;
        return;
      }
      console.error('[Rocketseat Exporter] Erro ao exportar matéria:', error);
      setBanner('error', error.message || String(error));
      await loadAll();
    }
  }

  async function handleExportAll() {
    exportAllButton.disabled = true;
    const originalText = exportAllButton.textContent;
    exportAllButton.textContent = 'Exportando acervo…';
    try {
      if (!currentDirectoryStatus.configured) {
        await exporter.selectArchiveDirectory();
      }
      const report = await exporter.exportAllSubjects();
      if (report.failures.length === 0) {
        setBanner(
          'success',
          `Acervo exportado com sucesso! ${report.totalSubjects} arquivo(s) Markdown atualizado(s), totalizando ${report.totalLessons} aula(s).`
        );
      } else {
        setBanner(
          'warning',
          `Exportação concluída com avisos: ${report.totalSubjects} matéria(s) exportada(s) e ${report.failures.length} falha(s).`
        );
      }
      await loadAll();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        exportAllButton.textContent = originalText;
        exportAllButton.disabled = false;
        return;
      }
      console.error('[Rocketseat Exporter] Erro ao exportar acervo:', error);
      setBanner('error', error.message || String(error));
      await loadAll();
    } finally {
      exportAllButton.textContent = originalText;
    }
  }

  async function handleDeleteLesson(lesson) {
    const confirmed = window.confirm(
      `Deseja remover a aula "${lesson.lesson}" (${lesson.subject}) do armazenamento local?`
    );
    if (!confirmed) return;

    try {
      await database.deleteLessonById(lesson.id);
      setBanner('success', `Aula "${lesson.lesson}" removida do IndexedDB.`);
      await loadAll();
    } catch (error) {
      setBanner('error', error.message || String(error));
      render();
    }
  }

  refreshButton.addEventListener('click', () => {
    setBanner(null, null);
    loadAll();
  });
  pickFolderButton.addEventListener('click', handlePickFolder);
  grantPermissionButton.addEventListener('click', handleGrantPermission);
  exportAllButton.addEventListener('click', handleExportAll);

  loadAll();
})();

