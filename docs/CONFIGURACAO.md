# Configuração técnica (dono do site)

> Este documento é só para quem mantém o site. Quem usa o app não precisa configurar nada — o guia de uso está no [README](../README.md).

Quando algo de configuração falha, o app mostra ao usuário uma mensagem simples e registra no **console do navegador** uma dica técnica começando com `[nuvem · dono do site]`.

## Nuvem

As opções ficam em [`config-nuvem.js`](../config-nuvem.js). Cada opção preenchida vira um botão no app; as que ficarem `null` não aparecem. Se nada for preenchido, o app continua funcionando, salvando só no aparelho.

> As chaves desse arquivo são **públicas** (feitas para ficar no site). A proteção dos dados vem das **regras de segurança** abaixo, do login de cada pessoa e do código aleatório de cada lista. **Nunca** coloque no site chaves secretas (Firebase *service account*, Supabase *secret/service_role*, Dropbox *App secret* ou *access token*).

### 1) Google — Firebase

Habilita **Entrar com Google**, **Entrar com e-mail (link)** e **listas por código**.

1. Em https://console.firebase.google.com abra (ou crie) o projeto.
2. **Firestore Database** → *Criar banco de dados* (local: `southamerica-east1`, modo produção) → aba **Regras** → apague tudo, cole as regras abaixo e clique em **Publicar**.

   Estas regras fazem o **servidor** garantir as permissões das listas compartilhadas: só o **dono** (a conta que criou a lista) e os **convidados com "pode editar"** gravam; quem entra só com o código da lista apenas **visualiza**; convidado "só visualizar" não consegue gravar nada, mesmo mexendo no navegador; convidado removido perde o acesso na hora. Listas antigas continuam funcionando e passam a ser protegidas quando o dono abre o app com a conta dona (ou entra com uma conta, se a lista ainda não tinha dono).

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function codigoOk(c) { return c.matches('^[A-HJ-NP-Z2-9]{16}$'); }
    function logado() { return request.auth != null; }
    function caminhoLista(c) { return /databases/$(database)/documents/listas/$(c); }
    function caminhoDono(c) { return /databases/$(database)/documents/listas/$(c)/donos/$(request.auth.uid); }
    function caminhoMembro(c) { return /databases/$(database)/documents/listas/$(c)/membros/$(request.auth.uid); }
    function caminhoConvite(c, g) { return /databases/$(database)/documents/listas/$(c)/convites/$(g); }
    // Dono: este aparelho/conta provou que tem a chave do dono
    function ehDono(c) { return logado() && exists(caminhoDono(c)); }
    // Convidado: tem um convite que o dono ainda não removeu
    function conviteDe(c) { return get(caminhoMembro(c)).data.convite; }
    function ehMembro(c) { return logado() && exists(caminhoMembro(c)) && exists(caminhoConvite(c, conviteDe(c))); }
    function membroEdita(c) { return ehMembro(c) && get(caminhoConvite(c, conviteDe(c))).data.editar == true; }
    function protegida(dados) { return dados.get('donoHash', null) != null; }
    function camposLista() {
      return request.resource.data.keys().hasOnly(['itens', 'versao', 'atualizadoEm', 'donoHash'])
        && request.resource.data.itens is map
        && request.resource.data.itens.size() <= 5000;
    }

    match /listas/{codigo} {
      // Ler: quem tem o código (com identidade no app) só VISUALIZA; gravar exige ser dono ou convidado com "pode editar"
      allow get: if codigoOk(codigo) && (resource == null || !protegida(resource.data) || logado());
      allow list, delete: if false;
      allow create: if codigoOk(codigo) && camposLista();
      allow update: if codigoOk(codigo) && camposLista() && (
        // Protegida: só o dono ou convidado com "pode editar"; ninguém troca a chave do dono
        (protegida(resource.data) && request.resource.data.donoHash == resource.data.donoHash
          && (ehDono(codigo) || membroEdita(codigo)))
        // Lista antiga (sem proteção): continua aberta até o dono protegê-la
        || !protegida(resource.data)
      );

      // Aparelhos/contas do dono: entram provando a chave do dono (só o resumo dela fica na lista)
      match /donos/{uid} {
        allow get: if logado() && request.auth.uid == uid;
        allow list, update, delete: if false;
        allow create: if logado() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['segredo', 'criadoEm'])
          && request.resource.data.segredo is string
          && request.resource.data.segredo.size() >= 12
          && hashing.sha256(request.resource.data.segredo).toHexString().lower() == getAfter(caminhoLista(codigo)).data.donoHash;
      }

      // Convites: um por convidado; só o dono cria, muda a permissão e remove
      match /convites/{convite} {
        allow get: if logado();
        allow list, delete: if ehDono(codigo);
        allow create, update: if ehDono(codigo)
          && convite.matches('^[A-HJ-NP-Z2-9]{10}$')
          && request.resource.data.keys().hasOnly(['nome', 'editar', 'criadoEm'])
          && request.resource.data.nome is string && request.resource.data.nome.size() <= 40
          && request.resource.data.editar is bool;
      }

      // Aparelhos dos convidados: o próprio aparelho se registra com um convite válido
      // (não escolhe a permissão: ela fica no convite, que só o dono altera)
      match /membros/{uid} {
        allow get: if logado() && (request.auth.uid == uid || ehDono(codigo));
        allow list: if ehDono(codigo);
        allow create: if logado() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['convite', 'nome', 'aparelho', 'visto'])
          && request.resource.data.convite is string
          && exists(caminhoConvite(codigo, request.resource.data.convite))
          && request.resource.data.nome is string && request.resource.data.nome.size() <= 40
          && request.resource.data.aparelho is string && request.resource.data.aparelho.size() <= 80;
        allow update: if logado() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['convite', 'nome', 'aparelho', 'visto'])
          && request.resource.data.convite == resource.data.convite
          && request.resource.data.nome is string && request.resource.data.nome.size() <= 40
          && request.resource.data.aparelho is string && request.resource.data.aparelho.size() <= 80;
        allow delete: if logado() && (request.auth.uid == uid || ehDono(codigo));
      }
      // Pedidos de acesso: quem só visualiza pede para editar; o dono aprova (cria um convite) ou recusa
      match /pedidos/{uid} {
        allow get: if logado() && (request.auth.uid == uid || ehDono(codigo));
        allow list: if ehDono(codigo);
        allow create: if logado() && request.auth.uid == uid
          && exists(caminhoLista(codigo))
          && request.resource.data.keys().hasOnly(['nome', 'telefone', 'aparelho', 'navegador', 'confirmacao', 'criadoEm', 'status'])
          && request.resource.data.status == 'pendente'
          && request.resource.data.nome is string && request.resource.data.nome.size() >= 2 && request.resource.data.nome.size() <= 40
          && request.resource.data.telefone is string && request.resource.data.telefone.size() <= 20
          && request.resource.data.aparelho is string && request.resource.data.aparelho.size() <= 80
          && request.resource.data.navegador is string && request.resource.data.navegador.size() <= 160
          && request.resource.data.confirmacao is string && request.resource.data.confirmacao.matches('^[0-9]{4}$');
        allow update: if ehDono(codigo)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'convite'])
          && request.resource.data.status in ['aprovado', 'recusado'];
        allow delete: if logado() && (request.auth.uid == uid || ehDono(codigo));
      }
    }

    match /contas/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

3. **Authentication** → *Vamos começar* → **Sign-in method**:
   - ative **Google** (escolha o e-mail de suporte);
   - ative **E-mail/senha** e ligue **Link do e-mail (login sem senha)**;
   - ative **Anônimo** — **obrigatório para a proteção das listas**: cada aparelho sem login ganha uma identidade própria (sem pedir nada à pessoa), e é ela que as regras usam para saber quem é dono e quem é convidado.
4. **Authentication → Configurações → Domínios autorizados** → adicione `rudagabriel.github.io`.
5. **⚙ Configurações do projeto → Seus apps → app Web (`</>`)** → copie o `firebaseConfig` para `firebase: { ... }`.

> **Atualizando de uma versão anterior:** publique as regras acima **e** ative o login **Anônimo**. Enquanto isso não for feito, o app continua funcionando como antes (sem a proteção do servidor) e avisa o dono no diálogo **Salvar e compartilhar**.

### 2) E-mail — Supabase (servidor alternativo)

Quando o Firebase também está configurado, o "Entrar com e-mail" usa o Firebase e o Supabase aparece como **"Não chegou? Enviar por outro servidor"** (link ou código de 6 dígitos). Também pode ser usado sozinho.

1. Crie um projeto em https://supabase.com/dashboard (região *South America (São Paulo)*).
2. **SQL Editor → New query** → cole e clique em **Run** (deve aparecer *"Success. No rows returned"*):

```sql
-- Controle de Vencimento: rode uma vez em Supabase → SQL Editor → Run
create table if not exists public.produtos (
  id uuid primary key,
  lista text not null check (lista ~ '^[A-HJ-NP-Z2-9]{16}$'),
  nome text not null,
  quantidade numeric not null default 0,
  vencimento date not null,
  codigo_barras text not null default '',
  criado_em bigint,
  atualizado_em bigint
);
create index if not exists produtos_lista_idx on public.produtos (lista);
alter table public.produtos enable row level security; -- sem políticas: acesso só pelas funções abaixo

create or replace function public.cv_listar(p_lista text)
returns setof public.produtos language sql stable security definer set search_path = public as $$
  select * from public.produtos where p_lista ~ '^[A-HJ-NP-Z2-9]{16}$' and lista = p_lista;
$$;

create or replace function public.cv_salvar(p_lista text, p_itens jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_lista !~ '^[A-HJ-NP-Z2-9]{16}$' or jsonb_array_length(p_itens) > 1000 then
    raise exception 'dados invalidos';
  end if;
  insert into public.produtos (id, lista, nome, quantidade, vencimento, codigo_barras, criado_em, atualizado_em)
  select (x->>'id')::uuid, p_lista, left(x->>'nome', 120), coalesce((x->>'quantidade')::numeric, 0),
         (x->>'vencimento')::date, left(coalesce(x->>'codigoBarras', ''), 64),
         (x->>'criadoEm')::bigint, (x->>'atualizadoEm')::bigint
  from jsonb_array_elements(p_itens) x
  on conflict (id) do update set
    nome = excluded.nome, quantidade = excluded.quantidade, vencimento = excluded.vencimento,
    codigo_barras = excluded.codigo_barras, atualizado_em = excluded.atualizado_em
  where public.produtos.lista = excluded.lista;
end $$;

create or replace function public.cv_remover(p_lista text, p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  delete from public.produtos where p_lista ~ '^[A-HJ-NP-Z2-9]{16}$' and lista = p_lista and id = any(p_ids);
$$;

grant execute on function public.cv_listar(text), public.cv_salvar(text, jsonb), public.cv_remover(text, uuid[]) to anon, authenticated;

create table if not exists public.contas (
  usuario uuid primary key references auth.users on delete cascade,
  lista text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.contas enable row level security;
drop policy if exists "dono da conta" on public.contas;
create policy "dono da conta" on public.contas for all to authenticated
  using (usuario = auth.uid()) with check (usuario = auth.uid());
```

3. **Authentication → URL Configuration**: *Site URL* = `https://rudagabriel.github.io/` e, em *Redirect URLs*, adicione `https://rudagabriel.github.io/**`.
4. *(Opcional)* **Authentication → Emails → Magic Link**: acrescente `Seu código: {{ .Token }}` para o e-mail trazer também um código.
5. **Project Settings → API Keys** → copie a *Project URL* e a chave **publishable** (`sb_publishable_…`) ou *anon public* para `supabase: { url, chave }`.

> O envio de e-mails gratuito do Supabase tem limite por hora. Para muitos usuários, configure um SMTP próprio em *Authentication → SMTP Settings*.

### 3) Dropbox

Habilita **Entrar com Dropbox**. Cada pessoa salva os produtos no próprio Dropbox (`Aplicativos/<nome do app>/vencimentos.json`).

1. Em https://www.dropbox.com/developers/apps → **Create app** → *Scoped access* → **App folder** → nome único.
2. Aba **Permissions**: marque `account_info.read`, `files.content.read` e `files.content.write` → **Submit**.
3. Aba **Settings**: em *OAuth 2 → Redirect URIs* adicione `https://rudagabriel.github.io/`; confirme *Allow public clients (PKCE)* = **Allow**.
4. Copie **somente o App key** para `dropbox: { appKey: "..." }`.

> Apps do Dropbox em modo *Development* aceitam até 500 usuários. Para mais, solicite *Production* no painel.

## E-mails de login

### Firebase (e-mail principal)
O Firebase não permite trocar o texto do e-mail de login por link, mas permite deixá-lo com a cara do app:

1. **⚙ Configurações do projeto → Geral → Nome exibido publicamente:** `Controle de Vencimento` (é o nome que aparece no assunto e no link do e-mail).
2. **Authentication → Modelos (Templates)** → no lápis ✏️ de qualquer modelo:
   - **Nome do remetente:** `Controle de Vencimento`;
   - **Responder para:** um e-mail seu (opcional).
3. **Authentication → Modelos → Idioma do modelo:** *Português (Brasil)*. O app também pede os e-mails em português automaticamente.
4. **Remetente `noreply@seudominio`** (opcional): em *Modelos → Personalizar domínio*, use um domínio próprio (ex.: `controledevencimento.com.br`) e siga a verificação de DNS. Sem domínio próprio, o remetente continua `noreply@<id-do-projeto>.firebaseapp.com`.

### Supabase (e-mail alternativo)
1. **Authentication → Emails → Magic Link → Assunto:** `Seu acesso ao Controle de Vencimento` (o corpo padrão do Supabase funciona; se quiser o código de 6 dígitos no e-mail, inclua `{{ .Token }}` no corpo).
2. **Remetente profissional** (recomendado): em *Authentication → SMTP Settings*, configure um SMTP (ex.: Brevo, Resend ou Amazon SES) com remetente `Controle de Vencimento <noreply@seudominio>` — também aumenta o limite de envios.

## Intermediário de produtos — nome e foto pelo código de barras (opcional)

As bases brasileiras de códigos de barras exigem uma **chave** que não pode ficar no site (qualquer pessoa veria). Por isso o app consulta essas bases por um **intermediário gratuito na Cloudflare** ([`docs/intermediario.js`](intermediario.js)), que guarda as chaves em segredo, só atende o site do app e guarda as respostas por 7 dias (economiza as cotas).

O intermediário tenta **primeiro as bases com chave e limite diário** (na ordem abaixo) e, **depois, as abertas** (sem chave). Junta nome e foto e para quando já tem os dois. Base que estourar a cota do dia fica pausada até a meia-noite.

**Com chave** (cada uma é opcional — ligue as que quiser):

| Base | Grátis | Onde criar a chave | Variável (tipo **Secret**) |
|---|---|---|---|
| SI5 Global | 100 consultas/dia | <https://global.si5.com.br/login> (entra com Google) → **Minha conta** → gerar token | `SI5_TOKEN` |
| Kodebar | 50 consultas/dia | <https://kodebar.korvensistemas.com.br> → cadastro → **Painel do Usuário** → chave | `KODEBAR_KEY` |
| Cosmos (Bluesoft) | depende do plano (conta gratuita veio com franquia 0) | <https://cosmos.bluesoft.com.br/api> → token | `COSMOS_TOKEN` |
| OSCBR – API GTIN | 20 consultas/minuto — **só para empresa (pede CNPJ)** | <https://gtin.rscsistemas.com.br/cadastro> | `OSCBR_USUARIO` e `OSCBR_SENHA` |

> Pessoa física: use SI5 e Kodebar e deixe a OSCBR de fora — sem as chaves ela fica desligada (`/status` mostra `sem chave`), e isso é normal.

**Abertas** (sem chave, já ligadas):

| Base | O que traz |
|---|---|
| Catálogos públicos de lojas (plataforma VTEX): Carrefour Mercado, Cobasi, Petz, Drogaria São Paulo, Drogarias Pacheco, Pague Menos, Época Cosméticos, Zona Sul, Sonda, Super Nosso, Atacadão, Drogaria Araujo, Ultrafarma, Drogaria Venancio, Mambo, Hirota | Nome e foto pelo código de barras (só aceita o item com o **mesmo** código) e busca de fotos pelo nome (`/busca`). |
| UPCitemdb | Base internacional (o navegador não consegue consultar direto; por isso passa pelo intermediário). |
| Cosmos (página pública) | A página do produto no site do Cosmos — não gasta a cota da API do Cosmos. |
| Pesquisa na web (Bing; reserva: DuckDuckGo) | Pesquisa o código de barras entre aspas, abre as 3 primeiras páginas de loja e lê os dados do produto (JSON-LD/`og:image`). Nome e foto só são aceitos quando a página traz o **mesmo** código; sem isso, usa o nome que se repete em 2+ resultados (sem foto). Também completa a busca de fotos **por nome** quando as lojas trazem pouco. |

As bases abertas só são consultadas quando as anteriores não trouxeram nome **e** foto, e ficam dentro do limite gratuito da Cloudflare (50 consultas externas por pedido). Lojas que bloquearem a consulta são simplesmente ignoradas. Para ver o que cada loja respondeu: `https://SEU-WORKER.workers.dev/lojas?gtin=7898019864316`.

As fotos encontradas são baixadas **uma única vez** e guardadas no aparelho (IndexedDB, como imagem própria). Quando o site da foto não permite isso, o app pega a imagem pelo intermediário (`/imagem`).

### Publicar o intermediário
1. Crie uma conta grátis em <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker** → nome (ex.: `cosmos`) → **Deploy**.
2. **Edit code** → apague tudo → cole o arquivo [`docs/intermediario.js`](intermediario.js) (no GitHub: **Raw** → Ctrl+A → Ctrl+C) → **Deploy**.
3. **Settings → Variables and Secrets**:
   - `ORIGEM` (tipo **Text**) = `https://rudagabriel.github.io`;
   - as chaves das bases que você criou (tipo **Secret**), com os nomes da tabela.
4. Coloque o endereço do Worker em `config-busca.js` (`intermediario: "https://…workers.dev"`).

### Testar (pela barra de endereço do navegador)
- `https://SEU-WORKER.workers.dev/status` → mostra cada base como `ativa`, `sem chave` ou `pausada até meia-noite` (nunca mostra as chaves).
- `https://SEU-WORKER.workers.dev/produto?gtin=7891000100103` → nome, marca, foto e qual base achou.
- `https://SEU-WORKER.workers.dev/busca?q=arroz tio joao` → produtos com foto encontrados pelo nome.
- `https://SEU-WORKER.workers.dev/lojas?gtin=7898019864316` → o que cada loja respondeu (diagnóstico).

> Depois de atualizar o código do Worker, as respostas antigas de "não encontrado" continuam guardadas por até 1 dia.

O painel de teste da própria Cloudflare (aba **HTTP**) responde `{"erro":"origem"}` — é a proteção (só o app e a barra de endereço são aceitos). Teste pela barra de endereço.

## Anúncios (Google AdSense)

O site já está preparado para o AdSense (editor `pub-2042570332495044`):

- [`ads.txt`](../ads.txt) na raiz e script de verificação no `<head>` do `index.html`.
- **Anúncios automáticos:** em AdSense → **Anúncios → Por site** → `rudagabriel.github.io` → ative **Anúncios automáticos**. O Google posiciona os anúncios sozinho — não é preciso alterar o código.
- **Bloco fixo (opcional):** crie em AdSense → **Anúncios → Por bloco de anúncios → Anúncios de display** (responsivo) e coloque o número do `data-ad-slot` em [`config-anuncios.js`](../config-anuncios.js) (`blocoRodape`). O espaço aparece no fim da página e **some sozinho** se não houver anúncio ou se houver bloqueador.
- A [Política de Privacidade](../privacidade.html) (exigida pelo AdSense) explica o uso de cookies de anúncios.

> Os anúncios só aparecem depois que o site é **aprovado** pelo AdSense (*Sites → Status: Pronto*). Pode levar alguns dias.

## Solução de problemas (configuração)

| Mensagem no console | O que fazer |
|---|---|
| Domínio não autorizado | Adicione `rudagabriel.github.io` em *Firebase → Authentication → Settings → Authorized domains*. |
| Provedor de login desativado | Ative **Google** e **E-mail/link** em *Authentication → Sign-in method*. |
| Acesso recusado | Publique as **regras do Firestore** (acima) ou rode o **script SQL** do Supabase. |
| Ative o login Anônimo | *Firebase → Authentication → Sign-in method → Anônimo*. Sem ele as listas funcionam, mas sem a proteção do servidor. |
| Publique as regras novas do Firestore | Cole as regras da seção do Firebase (acima) e clique em **Publicar**. |
| Chave inválida | Confira os valores em `config-nuvem.js`. |
| Tabelas/funções ausentes | Rode o script SQL do Supabase. |
| Login do Dropbox volta com erro | Confira a *Redirect URI* `https://rudagabriel.github.io/` e as permissões no painel do Dropbox. |
| Anúncios não aparecem | O site precisa estar aprovado no AdSense, com *Anúncios automáticos* ligados. |

## Estrutura do projeto

```
├── index.html            # Página do app
├── style.css             # Design (tema claro/escuro, responsivo)
├── app.js                # Lógica principal: lista, filtros, alertas, backup, nuvem
├── leitor.js             # Leitor de código de barras (3 motores, flash, zoom, foto)
├── foco.js               # Foco da câmera (perto/longe, toque, lente macro no iPhone)
├── validade.js           # Leitura da data de validade (OCR no aparelho)
├── produtos.js           # Sugestão de nome pelo código de barras
├── fotos.js              # Foto do produto (busca automática e foto própria)
├── nuvem/
│   ├── comum.js          # Códigos de lista, UUIDs, erros e fila offline
│   ├── firebase.js       # Google: Firestore, login Google e link no e-mail
│   ├── supabase.js       # E-mail (alternativo): funções SQL seguras
│   └── dropbox.js        # Dropbox: OAuth PKCE e arquivo na pasta do app
├── config-nuvem.js       # Chaves públicas da nuvem (dono do site)
├── config-busca.js       # Endereço do intermediário de produtos (opcional)
├── anuncios.js           # Bloco de anúncio responsivo (AdSense)
├── config-anuncios.js    # ID de editor e bloco de anúncio
├── privacidade.html      # Política de Privacidade
├── ads.txt               # Autorização de vendedores do AdSense
├── docs/                 # Capturas de tela, CONFIGURACAO.md e intermediario.js (Cloudflare)
├── icones/               # Ícone do app (SVG original + PNGs) 
└── manifest.webmanifest  # Instalação na tela inicial (PWA)
```

## Tecnologias

Site estático (GitHub Pages), **sem etapa de build** — JavaScript moderno com módulos ES e bibliotecas carregadas de CDN, sob demanda:

| Biblioteca | Uso |
|---|---|
| [Firebase 12](https://firebase.google.com/) | Firestore (nuvem) e Authentication (Google e link no e-mail) |
| [Supabase JS](https://supabase.com/) | Login por e-mail alternativo e funções SQL |
| [Dropbox API](https://www.dropbox.com/developers) | Login OAuth PKCE e armazenamento do arquivo |
| [barcode-detector / ZXing-C++](https://github.com/Sec-ant/barcode-detector) · [ZXing JS](https://github.com/zxing-js/library) | Leitura de códigos de barras |
| [SweetAlert2](https://sweetalert2.github.io/) | Diálogos |
| [Notyf](https://carlosroso.com/notyf/) | Avisos rápidos |
| [Lucide](https://lucide.dev/) | Ícones |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | QR Code de compartilhamento |
| [AutoAnimate](https://auto-animate.formkit.com/) | Animações da lista |

## Desenvolvimento local

Não há dependências para instalar. Basta servir a pasta por HTTP:

```bash
git clone https://github.com/RudaGabriel/rudagabriel.github.io.git
cd rudagabriel.github.io
python3 -m http.server 8080
# abra http://localhost:8080
```

> A câmera exige **HTTPS** (ou `localhost`). O login com Google/Dropbox só funciona nos domínios autorizados nos painéis (adicione `localhost` se for testar localmente).

Publicação: todo merge na branch `main` é publicado automaticamente pelo GitHub Pages em 1–2 minutos.
