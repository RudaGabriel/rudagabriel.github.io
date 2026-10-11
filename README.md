<div align="center">

<img src="icon.png" width="84" alt="Ícone do Controle de Vencimento">

# Controle de Vencimento

**Controle a validade dos seus produtos, receba alertas antes do vencimento e use a mesma lista em todos os seus aparelhos.**

[**▶ Abrir o app**](https://rudagabriel.github.io/) · [Privacidade](https://rudagabriel.github.io/privacidade.html) · [Reportar problema](https://github.com/RudaGabriel/rudagabriel.github.io/issues)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?logo=firebase&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![Dropbox](https://img.shields.io/badge/Dropbox-0061FF?logo=dropbox&logoColor=white)
![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

</div>

---

## Sumário

- [Visão geral](#visão-geral)
- [Capturas de tela](#capturas-de-tela)
- [Funcionalidades](#funcionalidades)
- [Como usar](#como-usar)
- [Nuvem e sincronização](#nuvem-e-sincronização)
- [Configuração da nuvem (dono do site)](#configuração-da-nuvem-dono-do-site)
- [Anúncios (Google AdSense)](#anúncios-google-adsense)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Compatibilidade](#compatibilidade)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Tecnologias](#tecnologias)
- [Desenvolvimento local](#desenvolvimento-local)
- [Solução de problemas](#solução-de-problemas)
- [Licença](#licença)

---

## Visão geral

O **Controle de Vencimento** é um aplicativo web gratuito, que funciona direto no navegador do celular ou do computador, sem instalação. Ele foi pensado para mercados, farmácias, padarias, depósitos e para uso doméstico: cadastre os produtos (inclusive lendo o código de barras com a câmera), acompanhe o que está **vencendo**, o que **já venceu** e o que vence **este mês**, e receba um alerta ao abrir o app.

Por padrão, tudo fica salvo **no próprio aparelho**. Se quiser, entre com **Google**, **e-mail** ou **Dropbox** para usar a mesma lista em vários aparelhos — ou compartilhe uma lista com a equipe por **link/QR Code**.

## Capturas de tela

| Computador (tema escuro) | Celular (tema claro) | Nuvem e login |
|:---:|:---:|:---:|
| <img src="docs/tela-desktop.png" alt="App no computador" width="420"> | <img src="docs/tela-celular.png" alt="App no celular" width="200"> | <img src="docs/tela-nuvem.png" alt="Opções de nuvem" width="200"> |

## Funcionalidades

### Cadastro e lista
- Cadastro com **código de barras** (opcional), **produto**, **quantidade** e **vencimento**.
- **Reconhecimento automático:** ao ler um código já cadastrado, o nome do produto é preenchido sozinho.
- **Produtos repetidos:** ao cadastrar o mesmo produto/vencimento, escolha **somar** ou **substituir** a quantidade.
- Edição, remoção com **Desfazer**, busca **sem acentos** e ordenação (prioridade, vencimento, nome, quantidade, mais recentes).
- **Situação clara** em cada item: "Vence amanhã", "Vence em 12 dias", "Venceu há 3 dias".

### Resumo e alertas
- Cartões de resumo que também funcionam como filtros: **Todos**, **Vencendo**, **Vencidos**, **Vencem este mês** e **Em dia**.
- Prazo de alerta configurável (em **dias** ou **meses**).
- **Alerta ao abrir o app** com os produtos perto do vencimento, com opção de silenciar por produto (ícone do sino).

### Leitor de código de barras
- Funciona em **iPhone, Android e computador**, com três motores de leitura em cascata (detector nativo do aparelho → ZXing em WebAssembly → ZXing em JavaScript).
- **Flash (lanterna)**, **zoom** e **troca de câmera** (quando o aparelho permite).
- Confirmação por **dígito verificador** (EAN/UPC) para evitar leituras erradas; bipe e vibração ao ler.
- **"Tirar foto do código"**: alternativa que usa a câmera nativa — funciona mesmo em navegadores que não liberam a câmera ao vivo.
- Compatível com leitores de código de barras **USB/Bluetooth** (que "digitam" o código).

### Dados
- **Backup e restauração** em `.json` (menu ⋮).
- **Exportação para planilha** (`.csv`, abre no Excel e no Google Planilhas).
- **Tema claro e escuro**, layout próprio para celular e atualização em tempo real entre abas.

## Como usar

1. Abra **https://rudagabriel.github.io/**.
2. Em **Novo produto**, toque no ícone de código de barras para ler com a câmera (ou digite), preencha produto, quantidade e vencimento e toque em **Adicionar**.
3. Use os cartões do topo para filtrar e a busca para encontrar produtos.
4. Ajuste **"Alertar com N dias de antecedência"** conforme sua rotina.
5. Para não perder nada, faça **backup** (menu ⋮ → *Fazer backup*) ou ative a **nuvem** (botão no topo).

> **Dica (celular):** no Safari, toque em *Compartilhar → Adicionar à Tela de Início*; no Chrome, *⋮ → Adicionar à tela inicial*. O app abre como um aplicativo.

## Nuvem e sincronização

Toque no botão de nuvem (topo, onde aparece **"Apenas neste aparelho"**) e escolha:

| Opção | Como a pessoa entra | Onde os dados ficam | Ideal para |
|---|---|---|---|
| **Entrar com Google** | 1 toque na conta Google | Firebase (Google) | quem usa Gmail/Android |
| **Entrar com e-mail** | link de acesso no e-mail, sem senha | Firebase (Supabase como alternativa) | qualquer pessoa |
| **Entrar com Dropbox** | 1 toque na conta Dropbox | arquivo no **Dropbox da própria pessoa** | quem já usa Dropbox |
| **Lista com código** | abrir link / ler QR Code / digitar código | Firebase ou Supabase | compartilhar com a equipe |

- **Com login**, a conta lembra a lista: entre com a **mesma conta** nos outros aparelhos e a mesma lista aparece.
- **Lista com código** tem dois tipos de link: **Pode editar** e **Só visualizar**.
- **Offline:** as alterações ficam guardadas e são enviadas quando a internet voltar.
- **Sem duplicar:** cada produto é salvo separadamente; edições em aparelhos diferentes não se sobrescrevem.
- Ao sair, você pode **guardar uma cópia** da lista da nuvem no aparelho.

## Configuração da nuvem (dono do site)

As opções ficam em [`config-nuvem.js`](config-nuvem.js). Cada opção preenchida vira um botão no app; as que ficarem `null` não aparecem. Se nada for preenchido, o app continua funcionando, salvando só no aparelho.

> As chaves desse arquivo são **públicas** (feitas para ficar no site). A proteção dos dados vem das **regras de segurança** abaixo, do login de cada pessoa e do código aleatório de cada lista. **Nunca** coloque no site chaves secretas (Firebase *service account*, Supabase *secret/service_role*, Dropbox *App secret* ou *access token*).

### 1) Google — Firebase

Habilita **Entrar com Google**, **Entrar com e-mail (link)** e **listas por código**.

1. Em https://console.firebase.google.com abra (ou crie) o projeto.
2. **Firestore Database** → *Criar banco de dados* (local: `southamerica-east1`, modo produção) → aba **Regras** → cole e clique em **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /listas/{codigo} {
      allow get: if codigo.matches('^[A-HJ-NP-Z2-9]{16}$');
      allow list, delete: if false;
      allow create, update: if codigo.matches('^[A-HJ-NP-Z2-9]{16}$')
        && request.resource.data.keys().hasOnly(['itens', 'versao', 'atualizadoEm'])
        && request.resource.data.itens is map
        && request.resource.data.itens.size() <= 5000;
    }
    match /contas/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

3. **Authentication** → *Vamos começar* → **Sign-in method**:
   - ative **Google** (escolha o e-mail de suporte);
   - ative **E-mail/senha** e ligue **Link do e-mail (login sem senha)**.
4. **Authentication → Configurações → Domínios autorizados** → adicione `rudagabriel.github.io`.
5. **⚙ Configurações do projeto → Seus apps → app Web (`</>`)** → copie o `firebaseConfig` para `firebase: { ... }`.

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

## Anúncios (Google AdSense)

O site já está preparado para o AdSense (editor `pub-2042570332495044`):

- [`ads.txt`](ads.txt) na raiz e script de verificação no `<head>` do `index.html`.
- **Anúncios automáticos:** em AdSense → **Anúncios → Por site** → `rudagabriel.github.io` → ative **Anúncios automáticos**. O Google posiciona os anúncios sozinho — não é preciso alterar o código.
- **Bloco fixo (opcional):** crie em AdSense → **Anúncios → Por bloco de anúncios → Anúncios de display** (responsivo) e coloque o número do `data-ad-slot` em [`config-anuncios.js`](config-anuncios.js) (`blocoRodape`). O espaço aparece no fim da página e **some sozinho** se não houver anúncio ou se houver bloqueador.
- A [Política de Privacidade](privacidade.html) (exigida pelo AdSense) explica o uso de cookies de anúncios.

> Os anúncios só aparecem depois que o site é **aprovado** pelo AdSense (*Sites → Status: Pronto*). Pode levar alguns dias.

## Privacidade e segurança

- **Local por padrão:** sem login, nada sai do aparelho.
- **Câmera:** usada só para ler códigos; as imagens são processadas no aparelho e não são enviadas.
- **Listas com código:** 16 caracteres aleatórios (≈ 80 bits) — impossível de adivinhar; as regras impedem listar as listas dos outros.
- **Contas:** cada conta só acessa os próprios dados (regras do Firestore e RLS do Supabase).
- Conteúdo digitado é sempre escapado antes de ser exibido (proteção contra XSS).
- Detalhes na [Política de Privacidade](https://rudagabriel.github.io/privacidade.html).

## Compatibilidade

| Recurso | iPhone (Safari) | Android (Chrome) | Computador |
|---|:---:|:---:|:---:|
| App e nuvem | ✅ | ✅ | ✅ |
| Leitor ao vivo | ✅ | ✅ | ✅ (webcam) |
| Leitura por foto | ✅ | ✅ | ✅ |
| Flash pela página | ➖ (use *Tirar foto*) | ✅ | ➖ |
| Zoom / troca de câmera | depende do aparelho | ✅ | depende da webcam |

> Navegadores dentro de outros apps (Instagram, WhatsApp etc.) podem bloquear a câmera ao vivo — use **Tirar foto do código** ou abra no Safari/Chrome.

## Estrutura do projeto

```
├── index.html            # Página do app
├── style.css             # Design (tema claro/escuro, responsivo)
├── app.js                # Lógica principal: lista, filtros, alertas, backup, nuvem
├── leitor.js             # Leitor de código de barras (3 motores, flash, zoom, foto)
├── nuvem/
│   ├── comum.js          # Códigos de lista, UUIDs, erros e fila offline
│   ├── firebase.js       # Google: Firestore, login Google e link no e-mail
│   ├── supabase.js       # E-mail (alternativo): funções SQL seguras
│   └── dropbox.js        # Dropbox: OAuth PKCE e arquivo na pasta do app
├── config-nuvem.js       # Chaves públicas da nuvem (dono do site)
├── anuncios.js           # Bloco de anúncio responsivo (AdSense)
├── config-anuncios.js    # ID de editor e bloco de anúncio
├── privacidade.html      # Política de Privacidade
├── ads.txt               # Autorização de vendedores do AdSense
├── docs/                 # Capturas de tela do README
└── icon.png              # Ícone
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

## Solução de problemas

| Problema | Solução |
|---|---|
| "Não foi possível iniciar a câmera" | Verifique a permissão da câmera do navegador (iPhone: *Ajustes → Safari → Câmera*). A mensagem mostra um detalhe técnico — use **Tirar foto do código** enquanto isso. |
| O leitor não lê | Afaste um pouco o celular, use o **zoom** ou o **flash**, mantenha o código reto na faixa. |
| "Este site não está autorizado no login do Firebase" | Adicione `rudagabriel.github.io` em *Authentication → Domínios autorizados*. |
| "O login com Google não está ativado" | Ative **Google** em *Authentication → Sign-in method*. |
| "A nuvem recusou o acesso" | Publique as **regras do Firestore** (ou rode o **script SQL** do Supabase). |
| "As tabelas da nuvem não foram criadas" | Rode o script SQL do Supabase. |
| O e-mail de login não chegou | Confira o spam; toque em **"Não chegou? Enviar por outro servidor"**. |
| Login do Dropbox volta com erro | Confira a *Redirect URI* `https://rudagabriel.github.io/` e as permissões no painel do Dropbox. |
| Anúncios não aparecem | O site precisa estar aprovado no AdSense e com *Anúncios automáticos* ligados; bloqueadores de anúncio impedem a exibição. |

### Comandos de compatibilidade

Digite no campo de busca:
- **`/ase`** (ou `autorizarsyncenviar`) — permite que este aparelho edite a lista da nuvem;
- **`/dse`** (ou `naoautorizarsyncenviar`) — deixa este aparelho como somente leitura.

## Licença

Distribuído sob a licença **MIT**. Veja [LICENSE](LICENSE).
