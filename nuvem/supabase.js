/* =========================================================
   Provedor: Supabase
   - Login por e-mail sem senha (link ou código).
   - Lista por código: tabela "produtos", acessada somente por
     funções seguras (cv_listar / cv_salvar / cv_remover) que
     exigem o código da lista.
   - "contas" guarda o código da lista de cada usuário.
   - Atualização a cada poucos segundos e fila offline.
   ========================================================= */
import { explicarErro, normalizarCodigoLista, criarFila, criarEnviador, carregarScript, RE_CODIGO } from "./comum.js";

const URL_SUPABASE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js";
const INTERVALO_MS = 6000;
const LOTE = 200;

export const SQL_SUPABASE = `-- Controle de Vencimento: rode uma vez em Supabase → SQL Editor → Run
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
  using (usuario = auth.uid()) with check (usuario = auth.uid());`;

export function configSupabaseValida(c) {
	if (!c || typeof c !== "object") return null;
	const url = String(c.url || "").trim().replace(/\/+$/, "");
	const chave = String(c.chave || c.anonKey || "").trim();
	if (!/^https:\/\/[^\s/]+$/.test(url) || chave.length < 20) return null;
	return { url, chave };
}

const linhaParaItem = l => ({
	id: l.id,
	nome: l.nome,
	quantidade: Number(l.quantidade),
	vencimento: l.vencimento,
	codigoBarras: l.codigo_barras || "",
	criadoEm: Number(l.criado_em) || undefined,
	atualizadoEm: Number(l.atualizado_em) || undefined
});

export function criarSupabase(configBruta, { aoReceber, aoStatus, aoErro, aoUsuario }) {
	const config = configSupabaseValida(configBruta);
	let cli = null;
	let preparando = null;
	let codigoAtual = null;
	let fila = null;
	let enviador = null;
	let temporizador = null;
	let geracao = 0;
	let ultimoRemoto = [];
	let erroAtual = null;
	let usuario = null;

	const seguro = (fn, ...a) => { try { fn?.(...a); } catch (e) { console.error(e); } };
	const emitirErro = erro => {
		const info = explicarErro(erro);
		console.warn("[supabase]", erro);
		if (info.tipo !== "rede") seguro(aoErro, info);
		return info;
	};
	const falhou = r => { if (r?.error) throw r.error; return r?.data; };

	function calcularStatus() {
		if (!codigoAtual) return;
		if (navigator.onLine === false) return seguro(aoStatus, "offline", fila?.vazia ? "Sem internet — usando a cópia salva no aparelho." : "Sem internet — as alterações serão enviadas depois.");
		if (erroAtual) return seguro(aoStatus, "erro", erroAtual);
		seguro(aoStatus, fila && !fila.vazia ? "salvando" : "sincronizado");
	}

	async function preparar() {
		if (!config) throw new Error("Configuração do Supabase ausente (config-nuvem.js).");
		if (cli) return;
		if (!preparando) {
			preparando = (async () => {
				await carregarScript(URL_SUPABASE, () => !!window.supabase?.createClient);
				cli = window.supabase.createClient(config.url, config.chave, {
					auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "cv-supabase-auth" }
				});
				cli.auth.onAuthStateChange((_evento, sessao) => {
					const u = sessao?.user;
					usuario = u ? { id: u.id, email: u.email || "" } : null;
					seguro(aoUsuario, usuario);
				});
				// Retorno do link mágico (#access_token=…) é processado pela própria biblioteca
				const { data } = await cli.auth.getSession();
				const u = data?.session?.user;
				usuario = u ? { id: u.id, email: u.email || "" } : null;
				seguro(aoUsuario, usuario);
			})().catch(e => { preparando = null; cli = null; throw e; });
		}
		return preparando;
	}

	async function buscar(minha) {
		if (minha !== geracao || !codigoAtual) return;
		if (document.hidden) return; // economiza dados com o app em segundo plano
		try {
			const linhas = falhou(await cli.rpc("cv_listar", { p_lista: codigoAtual }));
			if (minha !== geracao) return;
			ultimoRemoto = (linhas || []).map(linhaParaItem);
			erroAtual = null;
			seguro(aoReceber, fila.aplicar(ultimoRemoto), { doServidor: true });
		} catch (e) {
			const info = emitirErro(e);
			erroAtual = info.tipo === "rede" ? null : info.mensagem;
		}
		calcularStatus();
	}

	function agendarBusca(minha) {
		clearTimeout(temporizador);
		temporizador = setTimeout(async () => {
			await buscar(minha);
			if (minha === geracao) agendarBusca(minha);
		}, INTERVALO_MS);
	}

	const aoVoltar = () => { if (!document.hidden && codigoAtual) buscar(geracao); };

	async function conectar(codigo) {
		desligar();
		if (!RE_CODIGO.test(codigo)) throw new Error("Código de lista inválido");
		const minha = ++geracao;
		codigoAtual = codigo;
		erroAtual = null;
		seguro(aoStatus, "conectando");
		await preparar();
		if (minha !== geracao) return;
		fila = criarFila(`cv2:fila:supabase:${codigo}`);
		enviador = criarEnviador({
			fila,
			aoMudar: calcularStatus,
			enviar: async lote => {
				const salvar = lote.filter(o => o.t === "s").map(o => o.item);
				const remover = lote.filter(o => o.t === "r").map(o => o.id);
				for (let i = 0; i < salvar.length; i += LOTE) {
					falhou(await cli.rpc("cv_salvar", { p_lista: codigo, p_itens: salvar.slice(i, i + LOTE) }));
				}
				if (remover.length) falhou(await cli.rpc("cv_remover", { p_lista: codigo, p_ids: remover }));
			}
		});
		// Mostra na hora o que ainda está na fila (alterações feitas offline)
		if (!fila.vazia) seguro(aoReceber, fila.aplicar([]), { doServidor: false });
		document.addEventListener("visibilitychange", aoVoltar);
		window.addEventListener("online", aoVoltar);
		await buscar(minha);
		enviador.agendar();
		agendarBusca(minha);
	}

	function desligar() {
		geracao++;
		clearTimeout(temporizador);
		enviador?.parar();
		enviador = null;
		codigoAtual = null;
		document.removeEventListener("visibilitychange", aoVoltar);
		window.removeEventListener("online", aoVoltar);
	}

	function alterar(acao) {
		if (!fila || !codigoAtual) return Promise.reject(emitirErro(new Error("A nuvem não está conectada.")));
		acao();
		calcularStatus();
		const minha = geracao;
		return enviador.processar()
			.then(() => buscar(minha))
			.catch(e => { const info = emitirErro(e); if (info.tipo !== "rede") { erroAtual = info.mensagem; calcularStatus(); } });
	}

	const salvarVarios = itens => (itens.length ? alterar(() => fila.salvar(itens)) : Promise.resolve());
	const removerVarios = ids => (ids.length ? alterar(() => fila.remover(ids)) : Promise.resolve());

	/* ---------- Login por e-mail ---------- */
	async function enviarCodigo(email) {
		await preparar();
		falhou(await cli.auth.signInWithOtp({
			email,
			options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname }
		}));
	}

	async function confirmarCodigo(email, token) {
		await preparar();
		const data = falhou(await cli.auth.verifyOtp({ email, token, type: "email" }));
		const u = data?.user || data?.session?.user;
		if (u) usuario = { id: u.id, email: u.email || email };
		return usuario;
	}

	async function sair() {
		if (!cli) return;
		try { await cli.auth.signOut(); } catch (e) { console.warn(e); }
		usuario = null;
	}

	async function listaDaConta(uid) {
		await preparar();
		const data = falhou(await cli.from("contas").select("lista").eq("usuario", uid).maybeSingle());
		return normalizarCodigoLista(data?.lista) || null;
	}

	async function salvarListaNaConta(uid, codigo) {
		await preparar();
		falhou(await cli.from("contas").upsert({ usuario: uid, lista: codigo, atualizado_em: new Date().toISOString() }));
	}

	return {
		id: "supabase",
		nome: "e-mail",
		disponivel: !!config,
		recursos: { codigo: true, login: "email" },
		preparar,
		conectar,
		desligar,
		salvarVarios,
		removerVarios,
		enviarCodigo,
		confirmarCodigo,
		sair,
		listaDaConta,
		salvarListaNaConta,
		get usuario() { return usuario; }
	};
}
