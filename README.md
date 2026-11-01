# Rocketseat Exporter

Extensão para Google Chrome (Manifest V3) desenvolvida em JavaScript puro (ES6+), HTML5 e CSS3 para capturar as transcrições completas das aulas da plataforma Rocketseat (`https://ftr.rocketseat.com.br/*`) e organizá-las automaticamente em arquivos Markdown (`.md`) para consulta e estudo no **NotebookLM**.

---

## Funcionalidades Completas (Etapas 1 a 6)

1. **Identificação Semântica no DOM (`course-parser.js` e `content.js`)**:
   - **Pós-graduação**: link no breadcrumb contendo `/jornada/` e terminando em `/disciplinas`.
   - **Trilha**: link no breadcrumb contendo `/jornada/` e terminando em `/conteudos`.
   - **Matéria**: último elemento textual do container do breadcrumb.
   - **Nome da aula**: primeiro `<h1>` válido na página, com memorização automática via `MutationObserver` quando o usuário alterna da aba **"Sobre a aula"** para a aba **"Transcrição"** (e fallback automático caso a página já inicie na aba de transcrição).
   - **Transcrição completa**: captura todos os segmentos `[time][text]`, aguarda a contagem estabilizar no DOM, preserva a ordem e o texto integral das falas e converte os segundos para `HH:MM:SS` (`0` → `00:00:00`, `65` → `00:01:05`, `3661` → `01:01:01`) sem imprecisões de ponto flutuante.
2. **Armazenamento Permanente no IndexedDB (`database.js`)**:
   - Banco `rocketseat-exporter-db` com stores para `lessons` e `handles`.
   - Chave única por aula (`pós::trilha::matéria::aula`), evitando duplicatas na mesma matéria e evitando colisões entre aulas de mesmo nome em matérias diferentes.
   - Permite atualizar uma aula já capturada preservando a data/hora original de captura (`capturedAt`) e atualizando `updatedAt`.
3. **Exportação Markdown por Matéria (`markdown.js` e `exporter.js`)**:
   - Escolha de pasta local via **File System Access API** (`showDirectoryPicker`) no Painel de Gerenciamento, com persistência do `FileSystemDirectoryHandle` no IndexedDB e verificação/renovação de permissão (`queryPermission` / `requestPermission`).
   - Criação automática da estrutura de diretórios:
     ```text
     <Pasta Escolhida>/
     └── Pós Graduação Full-Stack com IA/
         ├── Estratégia e Inovação/
         │   └── ai-sdk.md
         └── Fundamentos Técnicos e Estratégicos/
             ├── upload-widget-server.md
             └── busca-semantica.md
     ```
   - Um único arquivo `.md` por matéria contendo todas as aulas capturadas daquela matéria, numeradas de forma consistente (`## Aula 01 — ...`, `## Aula 02 — ...`), sem resumir nem remover falas, pronto para importação no **NotebookLM**.
   - Se a pasta já estiver configurada e com permissão ativa, capturar ou atualizar uma aula pelo Popup já atualiza automaticamente o arquivo `.md` correspondente no disco.
4. **Painel de Gerenciamento (`dashboard.html`) e Diagnóstico (`diagnostics.html`)**:
   - Estatísticas de total de aulas, matérias, trilhas e pós-graduações.
   - Seleção/alteração da pasta de destino e exportação geral ou individual por matéria.
   - Pré-visualização do Markdown e download avulso do `.md`.
   - Relatório de integridade do acervo.

---

## Como Instalar no Google Chrome (Modo Desenvolvedor)

1. Abra o Google Chrome e acesse `chrome://extensions/`.
2. Ative a chave **Modo do desenvolvedor** (*Developer mode*) no canto superior direito.
3. Clique em **Carregar sem compactação** (*Load unpacked*) e selecione a pasta do projeto:
   ```text
   /home/miguel/projetos/pessoais/rocketseat-exporter
   ```
4. Caso já estivesse carregada, clique no ícone de **Recarregar** (seta circular) no card da extensão.

---

## Fluxo de Uso

1. **Configurar a pasta do acervo (uma única vez)**:
   - Clique no ícone da extensão e depois em **Painel de gerenciamento**.
   - Clique em **Selecionar pasta** no topo direito e escolha a pasta local onde deseja manter seu acervo (ex.: `Rocketseat-Acervo`).
2. **Capturar aulas no dia a dia**:
   - Acesse uma aula em `https://ftr.rocketseat.com.br/`.
   - Abra a aba **Transcrição** da aula e aguarde carregar.
   - Clique no ícone do **Rocketseat Exporter** e clique em **Capturar aula** (ou **Atualizar aula** se já capturada).
   - A aula é salva no IndexedDB e, se a permissão da pasta estiver ativa, o arquivo `.md` da matéria já é criado/atualizado automaticamente na pasta escolhida!
3. **Exportar ou atualizar todo o acervo**:
   - No **Painel de gerenciamento**, clique em **Exportar / Atualizar acervo** a qualquer momento para sincronizar todas as matérias no disco.
   - Caso o navegador tenha sido fechado e reaberto, clique em **Conceder permissão** (ou diretamente em **Exportar / Atualizar acervo**) para confirmar a permissão de escrita na pasta.

---

## Testes Automatizados (Desenvolvimento)

```bash
# Verifica sintaxe JS, manifest.json e referências HTML
npm run check

# Executa testes unitários (timestamps, texto, slugs, IndexedDB, Markdown e Exporter)
npm run test:unit

# Executa testes de leitura de DOM em navegador headless com fixtures HTML
npm run test:browser

# Roda toda a suíte
npm test
```

---

## Arquitetura do Projeto

```text
rocketseat-exporter/
├── manifest.json
├── package.json
├── README.md
├── assets/
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
├── src/
│   ├── background/
│   │   └── service-worker.js     # Coordenação de abas e mensagens da extensão
│   ├── content/
│   │   └── content.js            # Content script (MutationObserver do <h1> e leitura do DOM)
│   ├── popup/
│   │   ├── popup.html            # Popup principal (captura/atualização rápida)
│   │   ├── popup.css
│   │   └── popup.js
│   ├── dashboard/
│   │   ├── dashboard.html        # Painel de gerenciamento e exportação Markdown
│   │   ├── dashboard.css
│   │   └── dashboard.js
│   ├── diagnostics/
│   │   ├── diagnostics.html      # Diagnóstico técnico detalhado da leitura
│   │   ├── diagnostics.css
│   │   └── diagnostics.js
│   ├── services/
│   │   ├── course-parser.js      # Identificação de pós, trilha, matéria, aula e transcrição
│   │   ├── database.js           # Persistência no IndexedDB (aulas e DirectoryHandle)
│   │   ├── storage.js            # Configurações pequenas em chrome.storage.local
│   │   ├── markdown.js           # Geração do arquivo Markdown consolidado por matéria
│   │   └── exporter.js           # Escrita de pastas e arquivos via File System Access API
│   ├── shared/
│   │   ├── messages.js
│   │   ├── page-reader.js
│   │   ├── theme.css
│   │   └── ui.js
│   └── utils/
│       ├── text.js
│       ├── timestamp.js
│       ├── transcript.js
│       └── slugify.js
├── tests/
│   ├── unit/
│   │   ├── text.test.js
│   │   ├── timestamp.test.js
│   │   ├── slugify.test.js
│   │   ├── database.test.js
│   │   └── markdown-exporter.test.js
│   └── browser/
│       ├── run-parser-tests.mjs
│       └── fixtures/
└── tools/
    ├── check-syntax.mjs
    └── generate-icons.mjs
```

---

## Aviso Legal e Uso Educacional

- **Projeto independente**: Esta extensão é um projeto de estudo pessoal e independente, sem vínculo oficial, patrocínio ou endosso da Rocketseat.
- **Respeito à plataforma e à autenticação**: A extensão não realiza requisições a APIs privadas, não faz automação de navegação (*scraping*), não armazena credenciais e não contorna controles de acesso. Ela atua exclusivamente organizando informações já visíveis no DOM para o aluno regularmente autenticado.
- **Direitos autorais**: Todo o conteúdo das aulas e transcrições pertence à Rocketseat. Os arquivos Markdown (`.md`) gerados localmente destinam-se **exclusivamente ao uso pessoal de estudo e pesquisa individual** do próprio aluno (como consulta em ferramentas de estudo pessoal, a exemplo do NotebookLM), não devendo ser redistribuídos ou publicados em repositórios públicos.

