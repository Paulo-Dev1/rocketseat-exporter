/**
 * Testes do course-parser em um navegador real (Chrome headless), sem
 * dependências npm.
 *
 * Para cada fixture em tests/browser/fixtures, monta uma página temporária
 * com os scripts reais da extensão, executa readLessonPage(document) e
 * extrai o resultado via --dump-dom. Depois valida o resultado no Node.
 *
 * Binário do Chrome: variável CHROME_BIN, ou google-chrome / chromium no PATH,
 * ou o chrome-headless-shell em cache do Puppeteer (~/.cache/puppeteer).
 *
 * Uso: node tests/browser/run-parser-tests.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FIXTURES = join(HERE, 'fixtures');

const PARSER_SCRIPTS = [
  'src/utils/text.js',
  'src/utils/timestamp.js',
  'src/utils/transcript.js',
  'src/utils/slugify.js',
  'src/services/course-parser.js',
  'src/services/database.js',
].map((file) => pathToFileURL(join(ROOT, file)).href);

// ---------------------------------------------------------------------------
// Localização do Chrome
// ---------------------------------------------------------------------------

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      execFileSync(name, ['--version'], { stdio: 'pipe' });
      return name;
    } catch (_error) {
      // tenta o próximo
    }
  }

  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  if (existsSync(cache)) {
    for (const version of readdirSync(cache).sort().reverse()) {
      const binary = join(cache, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (existsSync(binary)) return binary;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Execução no navegador
// ---------------------------------------------------------------------------

function buildPage(bodyHtml) {
  const scripts = PARSER_SCRIPTS.map((src) => `<script src="${src}"></script>`).join('\n');
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Fixture</title></head>
<body>
${bodyHtml}
${scripts}
<script>
  (function () {
    var output;
    try {
      var parser = globalThis.RocketseatExporter.courseParser;
      var db = globalThis.RocketseatExporter.database;
      var result = parser.readLessonPage(document, {
        stability: { stable: true, samples: [1, 1, 1], elapsedMs: 600 }
      });
      var withCachedTitle = parser.readLessonPage(document, {
        stability: { stable: true, samples: [1, 1, 1], elapsedMs: 600 },
        cachedLessonTitle: {
          value: 'Exibindo UI com Resultado da Tool',
          source: '<h1> capturado automaticamente na aba "Sobre a aula" (MutationObserver)'
        }
      });
      var unstable = parser.readLessonPage(document, {
        stability: { stable: false, samples: [10, 20, 30], elapsedMs: 4000 }
      });
      var payload = result.readyToCapture ? db.extractLessonPayload(result) : null;
      output = { result, withCachedTitle, unstable, payload };
    } catch (error) {
      output = { error: String(error && error.stack || error) };
    }
    var holder = document.createElement('textarea');
    holder.id = '__rse_result__';
    holder.textContent = JSON.stringify(output);
    document.body.appendChild(holder);
  })();
</script>
</body>
</html>`;
}

function runInBrowser(chrome, workDir, name, bodyHtml) {
  const file = join(workDir, `${name}.html`);
  writeFileSync(file, buildPage(bodyHtml));
  const profile = mkdtempSync(join(workDir, 'profile-'));
  const dom = execFileSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--allow-file-access-from-files',
      '--window-size=1280,900',
      '--dump-dom',
      pathToFileURL(file).href,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }
  );
  const match = /<textarea id="__rse_result__">([\s\S]*?)<\/textarea>/.exec(dom);
  if (!match) throw new Error(`Resultado não encontrado no DOM de ${name}`);
  const json = match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&amp;/g, '&');
  const output = JSON.parse(json);
  if (output.error) throw new Error(`Erro no navegador (${name}):\n${output.error}`);
  return output;
}

// ---------------------------------------------------------------------------
// Casos de teste
// ---------------------------------------------------------------------------

const codes = (result) => result.issues.map((issue) => issue.code);

function independentTimestamp(totalSeconds) {
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function buildLargeTranscript(count) {
  const segments = [];
  for (let i = 0; i < count; i += 1) {
    // tempos decimais com passo 3.7s, como "0.0", "3.7", "7.4"...
    const time = ((i * 37) / 10).toFixed(1);
    const whole = Math.floor((i * 37) / 10);
    const visual = independentTimestamp(whole).replace(/^00:/, '');
    segments.push(
      `<div time="${time}" text=" Fala número ${i + 1}, com acentuação: ação, café, pôr. "><span>${visual}</span><p>Fala número ${i + 1}, com acentuação: ação, café, pôr.</p></div>`
    );
  }
  return `
    <div>
      <a href="/jornada/p/disciplinas">Pós Graduação Full-Stack com IA</a>
      <a href="/jornada/p/t/conteudos">Fundamentos Técnicos e Estratégicos</a>
      <span>Matéria longa</span>
    </div>
    <h1>Aula longa</h1>
    <div style="height: 400px; overflow-y: auto">${segments.join('\n')}</div>`;
}

const CASES = [
  {
    name: 'lesson-basic',
    check({ result, unstable, payload }) {
      const { context, transcript } = result;
      assert.equal(context.postgraduate.value, 'Pós Graduação Full-Stack com IA');
      assert.equal(context.track.value, 'Fundamentos Técnicos e Estratégicos');
      assert.equal(context.subject.value, 'Upload widget Server');
      assert.equal(context.lesson.value, 'Configurando build da aplicação');
      assert.match(context.postgraduate.href, /\/jornada\/pos-fullstack-ia\/disciplinas$/);

      assert.equal(transcript.totalCandidates, 5);
      assert.equal(transcript.segments.length, 5);
      assert.deepEqual(
        transcript.segments.map((s) => s.timestamp),
        ['00:00:00', '00:00:08', '00:01:05', '00:02:05', '01:01:01']
      );
      assert.deepEqual(
        transcript.segments.map((s) => s.text),
        [
          'Última coisa que a gente vai fazer',
          'Agora vamos configurar o projeto.',
          'Rodando `npm run build` — 100% & "ok"?',
          'Segmento com tempo decimal.',
          'Mais de uma hora de aula.',
        ]
      );
      assert.deepEqual(transcript.segments.map((s) => s.index), [1, 2, 3, 4, 5]);
      assert.equal(transcript.segments[3].timeRaw, '125.48');
      assert.equal(transcript.checks.visualMismatches.length, 0);
      assert.equal(transcript.checks.textMismatches, 0);
      assert.equal(transcript.checks.gaps.length, 1, 'lacuna entre 00:02:05 e 01:01:01');
      assert.deepEqual(codes(result), ['gaps']);
      assert.equal(result.status, 'warning');
      assert.equal(result.readyToCapture, true);

      assert.ok(payload, 'payload deve ser gerado');
      assert.equal(payload.markdownFilename, 'upload-widget-server.md');
      assert.equal(
        payload.folderPath,
        'Pós Graduação Full-Stack com IA/Fundamentos Técnicos e Estratégicos'
      );
      assert.equal(payload.segmentCount, 5);

      assert.equal(unstable.status, 'error');
      assert.ok(codes(unstable).includes('transcript-loading'));
      assert.equal(unstable.readyToCapture, false);
    },
  },
  {
    name: 'lesson-breadcrumb-list',
    check({ result }) {
      const { context, transcript, breadcrumb } = result;
      assert.equal(context.postgraduate.value, 'Pós Graduação Full-Stack com IA');
      assert.equal(context.track.value, 'Desenvolvimento Back-end');
      assert.equal(context.subject.value, 'Busca semântica com IA');
      assert.equal(context.lesson.value, 'Embeddings na prática');
      assert.deepEqual(
        breadcrumb.items.map((item) => item.text),
        ['Pós Graduação Full-Stack com IA', 'Desenvolvimento Back-end', 'Busca semântica com IA', 'Embeddings na prática']
      );
      assert.equal(transcript.segments.length, 3);
      assert.equal(transcript.segments[1].text, 'Texto só no parágrafo.');
      assert.equal(transcript.segments[1].textSource, '<p>');
      assert.equal(transcript.segments[2].text, 'Texto do atributo.');
      assert.equal(transcript.segments[2].paragraphText, 'Texto exibido diferente.');
      assert.deepEqual(codes(result).sort(), ['breadcrumb', 'text-mismatch']);
      assert.equal(result.status, 'warning');
    },
  },
  {
    name: 'lesson-no-transcript',
    check({ result }) {
      assert.equal(result.context.postgraduate.value, 'Pós Graduação Full-Stack com IA');
      assert.equal(result.context.track.value, 'Fundamentos Técnicos e Estratégicos');
      assert.equal(result.context.subject.value, 'Upload widget Server');
      assert.equal(result.context.lesson.value, 'Configurando build da aplicação');
      assert.equal(result.transcript.found, false);
      assert.deepEqual(codes(result), ['transcript-not-found']);
      assert.equal(result.status, 'error');
      assert.equal(result.readyToCapture, false);
    },
  },
  {
    name: 'lesson-missing-context',
    check({ result }) {
      const { context, transcript } = result;
      assert.equal(context.postgraduate, null);
      assert.equal(context.track, null);
      assert.equal(context.subject, null);
      assert.equal(context.lesson.value, 'Aula sem breadcrumb');

      assert.equal(transcript.totalCandidates, 7);
      assert.equal(transcript.segments.length, 5);
      assert.equal(transcript.rejected.length, 2);
      assert.deepEqual(
        transcript.segments.map((s) => s.timestamp),
        ['00:00:45', '00:00:50', '00:05:00', '00:04:50', '00:04:50'],
        'ordem original preservada (sem reordenar)'
      );
      assert.equal(transcript.checks.outOfOrder.length, 1);
      assert.equal(transcript.checks.gaps.length, 1);
      assert.equal(transcript.checks.visualMismatches.length, 1);
      assert.equal(transcript.checks.adjacentDuplicates, 1);

      const found = codes(result);
      for (const code of [
        'missing-postgraduate',
        'missing-track',
        'missing-subject',
        'segments-rejected',
        'late-start',
        'out-of-order',
        'gaps',
        'visual-mismatch',
        'duplicates',
      ]) {
        assert.ok(found.includes(code), `esperado issue ${code}; encontrados: ${found.join(', ')}`);
      }
      assert.equal(result.status, 'error');
    },
  },
  {
    name: 'lesson-large-generated',
    html: buildLargeTranscript(2500),
    check({ result }) {
      const { transcript } = result;
      assert.equal(transcript.totalCandidates, 2500);
      assert.equal(transcript.segments.length, 2500);
      transcript.segments.forEach((segment, i) => {
        assert.equal(segment.index, i + 1);
        assert.equal(segment.text, `Fala número ${i + 1}, com acentuação: ação, café, pôr.`);
        assert.equal(segment.timestamp, independentTimestamp(Math.floor((i * 37) / 10)));
      });
      assert.equal(transcript.checks.visualMismatches.length, 0);
      assert.equal(result.context.subject.value, 'Matéria longa');
      assert.equal(result.status, 'ok');
      assert.deepEqual(result.issues, []);
    },
  },
  {
    name: 'lesson-cached-title-when-h1-unmounted',
    html: `
      <div>
        <a href="/jornada/pos-graduacao-tech-developer-360/disciplinas">Pós Graduação Full-Stack com IA</a>
        <a href="/jornada/f2-estrategia-e-inovacao/conteudos">Estratégia e Inovação</a>
        <span>AI SDK</span>
      </div>
      <div class="transcript">
        <div time="0" text="Antes da gente partir e criar aqui, colocar a interface com base no resultado da tool,">
          <span>00:00</span>
          <p>Antes da gente partir e criar aqui, colocar a interface com base no resultado da tool,</p>
        </div>
        <div time="6.52" text="uma outra coisa que eu gosto bastante fazer é o seguinte,">
          <span>00:6.52</span>
          <p>uma outra coisa que eu gosto bastante fazer é o seguinte,</p>
        </div>
        <div time="10.06" text="aqui nas minhas tools elas fazem requisições assíncronas,">
          <span>00:10.06</span>
          <p>aqui nas minhas tools elas fazem requisições assíncronas,</p>
        </div>
      </div>`,
    check({ result, withCachedTitle }) {
      assert.equal(result.context.lesson, null);
      assert.equal(result.status, 'error');

      assert.equal(withCachedTitle.context.postgraduate.value, 'Pós Graduação Full-Stack com IA');
      assert.equal(withCachedTitle.context.track.value, 'Estratégia e Inovação');
      assert.equal(withCachedTitle.context.subject.value, 'AI SDK');
      assert.equal(withCachedTitle.context.lesson.value, 'Exibindo UI com Resultado da Tool');
      assert.match(withCachedTitle.context.lesson.source, /Sobre a aula/);
      assert.equal(withCachedTitle.transcript.checks.visualUnrecognized, 0);
      assert.equal(withCachedTitle.transcript.checks.visualMismatches.length, 0);
      assert.equal(withCachedTitle.status, 'ok');
      assert.deepEqual(withCachedTitle.issues, []);
    },
  },
];

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

const chrome = findChrome();
if (!chrome) {
  console.error(
    'Chrome não encontrado. Defina CHROME_BIN com o caminho do Chrome/Chromium para rodar os testes de navegador.'
  );
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'rse-parser-tests-'));
let failures = 0;
console.log(`Chrome: ${chrome}`);

try {
  for (const testCase of CASES) {
    const started = Date.now();
    try {
      const html = testCase.html ?? readFileSync(join(FIXTURES, `${testCase.name}.html`), 'utf8');
      const output = runInBrowser(chrome, workDir, testCase.name, html);
      testCase.check(output);
      console.log(`✔ ${testCase.name} (${Date.now() - started} ms)`);
    } catch (error) {
      failures += 1;
      console.error(`✖ ${testCase.name}\n${error.stack || error}`);
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n${CASES.length - failures}/${CASES.length} casos aprovados.`);
process.exit(failures ? 1 : 0);

