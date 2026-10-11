# Controle de Vencimento

Controle a validade dos seus produtos, receba alertas de vencimento e compartilhe a mesma lista entre vários aparelhos.

👉 **Acesse:** https://rudagabriel.github.io/

## Recursos

- Cadastro com código de barras (câmera com flash, zoom e troca de câmera, leitura por foto ou leitor USB), produto, quantidade e vencimento
- Resumo com filtros rápidos: **Vencendo**, **Vencidos**, **Vencem este mês** e **Em dia**
- Situação clara em cada item ("Vence em 5 dias", "Venceu há 3 dias")
- Alerta ao abrir o app, com opção de silenciar por produto
- Busca sem acentos, ordenação, edição, remoção com **Desfazer**
- Backup/restauração (`.json`) e exportação para planilha (`.csv`)
- Tema claro e escuro, layout próprio para celular
- Salvar na nuvem: entrar com Google, e-mail (sem senha) ou Dropbox, ou lista por código/QR — funcionando também offline

## Salvar na nuvem e compartilhar

Sem fazer nada, os produtos ficam salvos **apenas no aparelho**. Para usar a mesma lista em vários aparelhos, toque no botão de nuvem (topo) e escolha:

| Opção | Como a pessoa entra | Ideal para |
|---|---|---|
| **Entrar com Google** | 1 toque na conta Google | quem tem Gmail/Android |
| **Entrar com e-mail** | recebe um link no e-mail (sem senha) | qualquer pessoa |
| **Entrar com Dropbox** | 1 toque na conta Dropbox | quem já usa Dropbox (os dados ficam no Dropbox da pessoa) |
| **Lista com código** (sem login) | abre um link / lê um QR Code | compartilhar com a equipe |

Com login, basta entrar com a **mesma conta** nos outros aparelhos e a mesma lista aparece. A lista por código tem os modos **Pode editar** e **Só visualizar**. Tudo funciona offline: as alterações são enviadas quando a internet voltar.

### Para o dono do site: ativar as opções (uma vez)

Preencha em [`config-nuvem.js`](config-nuvem.js) **uma ou mais** opções. Cada opção preenchida vira um botão; as que ficarem `null` não aparecem. Se nada for preenchido, o app continua salvando só no aparelho.

#### 1) Google (Firebase) — "Entrar com Google" + listas por código
1. Em https://console.firebase.google.com/ abra (ou crie) seu projeto.
2. **Firestore Database** → *Criar banco de dados* → aba **Regras** → cole e publique:
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
3. **Authentication** → *Vamos começar* → **Sign-in method** → ative **Google**.
4. **Authentication → Settings → Authorized domains** → adicione `rudagabriel.github.io`.
5. **Configurações do projeto → Seus apps** → app Web (`</>`) → copie o `firebaseConfig` para `firebase: { ... }` em `config-nuvem.js`.

#### 2) E-mail (Supabase) — "Entrar com e-mail" + listas por código
1. Crie um projeto grátis em https://supabase.com/dashboard.
2. **SQL Editor** → cole e rode (Run) o script:
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
3. **Authentication → URL Configuration** → em *Site URL* coloque `https://rudagabriel.github.io/`.
4. (Opcional) **Authentication → Email Templates → Magic Link**: acrescente `{{ .Token }}` para o e-mail mostrar também um código de 6 dígitos.
5. **Project Settings → API** → copie *Project URL* e a chave *anon public* para `supabase: { url: "...", chave: "..." }`.

> O envio de e-mails grátis do Supabase tem limite por hora. Para muitos usuários, configure um SMTP próprio em *Authentication → SMTP Settings*.

#### 3) Dropbox — "Entrar com Dropbox"
1. Em https://www.dropbox.com/developers/apps clique em **Create app** → *Scoped access* → **App folder** → dê um nome.
2. Aba **Permissions**: marque `files.content.read`, `files.content.write` e `account_info.read` → **Submit**.
3. Aba **Settings** → *OAuth 2 → Redirect URIs*: adicione `https://rudagabriel.github.io/`.
4. Copie o **App key** para `dropbox: { appKey: "..." }`.

Cada pessoa salva os produtos no próprio Dropbox (arquivo `Aplicativos/<nome do app>/vencimentos.json`).

> Quem usava versões anteriores da nuvem não perde nada: a última cópia da nuvem fica guardada no aparelho. Basta entrar de novo por uma das opções.

### Comandos (compatibilidade)

Digite no campo de busca:

- **`autorizarsyncenviar`** ou **`/ase`** — permite que este aparelho edite a lista compartilhada
- **`naoautorizarsyncenviar`** ou **`/dse`** — deixa este aparelho como somente leitura

## Bibliotecas

[Firebase](https://firebase.google.com/) · [Supabase](https://supabase.com/) · [Dropbox API](https://www.dropbox.com/developers) · [SweetAlert2](https://sweetalert2.github.io/) · [Notyf](https://carlosroso.com/notyf/) · [Lucide](https://lucide.dev/) · [barcode-detector / ZXing-C++](https://github.com/Sec-ant/barcode-detector) · [ZXing JS](https://github.com/zxing-js/library) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) · [AutoAnimate](https://auto-animate.formkit.com/)
