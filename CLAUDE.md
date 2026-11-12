# CLAUDE.md — regras do projeto Controle de Vencimento

Projeto de **Ruda Gabriel** ([@RudaGabriel](https://github.com/RudaGabriel)). PWA estático (GitHub Pages, sem etapa de build), módulos ES e bibliotecas por CDN. Intermediário opcional na Cloudflare em `docs/intermediario.js` (o dono publica manualmente no Worker).

## Idioma e textos

- Responder ao dono **sempre em português do Brasil**; código, comentários e mensagens de commit também em pt-BR.
- **Textos da interface** (avisos, diálogos, dicas, botões, títulos, página de privacidade): português do Brasil **formal**, claro e objetivo sobre o que a função faz. Evitar: "só" (usar "somente/apenas"), "de novo" ("novamente"), "na hora" ("imediatamente"), "sozinho" ("automaticamente"), "vai + verbo" (futuro simples), primeira pessoa ("Não encontrei" → "Não foi encontrado"), exclamações informais.
- **Sem emojis na interface**: usar ícones SVG do Lucide (`icone()` / `iconeTexto()` em `app.js`). Na página de privacidade, SVG embutido.
- **Revisão de texto obrigatória em toda mudança**: verificar **ortografia, acentuação, concordância, pontuação e formalidade** de todo texto novo ou alterado (interface, privacidade, README, documentação e mensagens de commit). O que não estiver formal deve ser **reescrito formalmente** antes de publicar. Atenção também a: espaços duplos, espaço antes de vírgula, palavras sem acento ("voce", "nao", "codigo"), primeira pessoa ("encontramos", "ativamos" → "foram encontradas", "foi ativado") e rótulos de botões que precisam ser idênticos entre o app e a documentação.

## A cada mudança — checklist obrigatório

1. **Procurar informações desatualizadas** relacionadas à mudança e corrigi-las no mesmo PR:
   - `README.md` (funcionamento, rótulos de botões citados, tabela de tecnologias e bases, perguntas comuns);
   - `docs/CONFIGURACAO.md` (configuração, intermediário, estrutura de arquivos, tecnologias, cache);
   - `privacidade.html` (dados coletados, serviços consultados) — **atualizar a data "Última atualização"** sempre que o conteúdo mudar;
   - textos do próprio app que descrevem a função alterada;
   - comentários de cabeçalho dos arquivos tocados.
   Um rótulo de botão citado na documentação deve existir no app **exatamente** com aquelas palavras.
2. **Atualizar o README** com a funcionalidade nova ou alterada (e bibliotecas novas, se houver).
2a. **Revisar ortografia e formalidade** de todos os textos tocados (ver "Idioma e textos"); corrigir no mesmo PR o que encontrar, mesmo em textos antigos próximos.
3. **Versão dos arquivos**: trocar `?v=AAAAMMDD-NN` em **todas** as ocorrências do `index.html` (importmap e tags) a cada publicação.
4. **Testar antes de publicar**: sintaxe (`node --check`), fluxo afetado no navegador (Playwright com o Chromium em `/opt/pw-browsers`), celular (390 px) e computador (1280 px), sem rolagem lateral. Mudanças no intermediário: testar com a rede real quando possível.
5. **Publicar**: commit → push na branch de trabalho → PR → marcar como pronto → **merge automático** (preferência do dono).
6. Mudou `docs/intermediario.js`? **Avisar o dono** que é preciso colar o código novo no Worker da Cloudflare. Mudou a regra de resultados? Trocar a versão da chave de cache (`produtoN/`, `buscaN/`).

## Segurança (nunca violar)

- **Nunca** pedir, aceitar, guardar ou fazer commit de tokens, chaves ou senhas. Em `config-nuvem.js` ficam **somente chaves públicas**.
- Chaves das bases (SI5, Kodebar, Cosmos, OSCBR, Brave) existem **somente** como Secrets do Worker na Cloudflare.
- O e-mail do dono é privado: não publicar nas páginas.
- Regras do Firestore: o texto oficial está em `REGRAS_FIREBASE` (`nuvem/firebase.js`) e em `docs/CONFIGURACAO.md` — os dois devem ser idênticos. Só o dono da lista muda o nome da loja; convidado nunca altera a própria permissão.

## Créditos

- Manter **explícitos** os créditos de **Ruda Gabriel** (link para https://github.com/RudaGabriel): topo, seção "Autor" e rodapé do README; rodapé do app (computador) e menu ⋮ (celular); seção "Responsável" da privacidade; `LICENSE`; `meta name="author"`.
- Nomes de serviços de terceiros permanecem onde são necessários (decisão do dono). A privacidade **precisa** citar os serviços que recebem dados (LGPD e AdSense) e a atribuição do Open Food Facts (ODbL).

## Comportamentos que não podem regredir

- Fotos automáticas **somente com código de barras válido**; busca pelo nome só quando a pessoa pede.
- Pesquisa na web e de imagens **pelo código**: só vale resultado que **cita o código**; foto com outro código no endereço, avatar ou logotipo é descartada.
- Sugestão de nome: nomes completos primeiro, abreviados só sem alternativa; o botão ✨ mostra todas as opções.
- Leitura da validade: os acertos da regressão de OCR não podem cair.
- Modo leve (aparelhos fracos): sem animações caras; os indicadores de carregamento continuam girando.
- Celular: "Novo produto" recolhe com o formulário vazio ao rolar para a lista ou após 6 s sem uso.
