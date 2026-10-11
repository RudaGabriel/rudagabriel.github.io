/* =========================================================
   Provedor: Dropbox
   - "Entrar com Dropbox": login OAuth (PKCE, sem servidor).
   - Os produtos ficam no Dropbox da própria pessoa, no arquivo
     /vencimentos.json (pasta do app). Todos os aparelhos com a
     mesma conta Dropbox veem a mesma lista.
   - Atualização a cada poucos segundos e fila offline; as
     gravações usam a revisão do arquivo para não perder
     alterações feitas em outro aparelho ao mesmo tempo.
   ========================================================= */
import { explicarErro, criarFila, criarEnviador } from "./comum.js";

const API = "https://api.dropboxapi.com";
const CONTEUDO = "https://content.dropboxapi.com";
const ARQUIVO = "/vencimentos.json";
const CHAVE_TOKENS = "cv2:dropbox";
const CHAVE_PKCE = "cv2:dropbox:pkce";
const INTERVALO_MS = 8000;

export function configDropboxValida(c) {
	if (!c || typeof c !== "object") return null;
	const appKey = String(c.appKey || "").trim();
	return /^[a-z0-9]{8,32}$/i.test(appKey) ? { appKey } : null;
}

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function aleatorio(n) {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return base64url(b).slice(0, n);
}

async function desafioPkce(verificador) {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador));
	return base64url(new Uint8Array(hash));
}

const urlRetorno = () => location.origin + location.pathname;

function lerTokens() {
	try { return JSON.parse(localStorage.getItem(CHAVE_TOKENS) || "null"); } catch { return null; }
}
function gravarTokens(t) {
	try { t ? localStorage.setItem(CHAVE_TOKENS, JSON.stringify(t)) : localStorage.removeItem(CHAVE_TOKENS); } catch { /* ignora */ }
}

export function criarDropbox(configBruta, { aoReceber, aoStatus, aoErro, aoUsuario }) {
	const config = configDropboxValida(configBruta);
	let tokens = lerTokens();
	let usuario = tokens?.email ? { id: tokens.conta, email: tokens.email } : null;
	let fila = null;
	let enviador = null;
	let temporizador = null;
	let geracao = 0;
	let conectado = false;
	let revisao = null;
	let erroAtual = null;

	const seguro = (fn, ...a) => { try { fn?.(...a); } catch (e) { console.error(e); } };
	const emitirErro = erro => {
		const info = explicarErro(erro);
		console.warn("[dropbox]", erro);
		if (info.tipo !== "rede") seguro(aoErro, info);
		return info;
	};

	function calcularStatus() {
		if (!conectado) return;
		if (navigator.onLine === false) return seguro(aoStatus, "offline", fila?.vazia ? "Sem internet — usando a cópia salva no aparelho." : "Sem internet — as alterações serão enviadas depois.");
		if (erroAtual) return seguro(aoStatus, "erro", erroAtual);
		seguro(aoStatus, fila && !fila.vazia ? "salvando" : "sincronizado");
	}

	/* ---------- Tokens ---------- */
	async function pedirToken(parametros) {
		const r = await fetch(`${API}/oauth2/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ client_id: config.appKey, ...parametros })
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `Erro ${r.status}`), { status: r.status, code: j.error });
		return j;
	}

	async function tokenValido() {
		if (!tokens?.refresh) throw Object.assign(new Error("Faça login no Dropbox novamente."), { code: "sem-login" });
		if (tokens.acesso && Date.now() < tokens.expira - 60000) return tokens.acesso;
		const j = await pedirToken({ grant_type: "refresh_token", refresh_token: tokens.refresh });
		tokens = { ...tokens, acesso: j.access_token, expira: Date.now() + (Number(j.expires_in) || 14400) * 1000 };
		gravarTokens(tokens);
		return tokens.acesso;
	}

	async function chamar(url, { corpo, arg, binario } = {}) {
		const fazer = async () => {
			const headers = { Authorization: `Bearer ${await tokenValido()}` };
			if (arg) headers["Dropbox-API-Arg"] = JSON.stringify(arg).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
			if (binario !== undefined) headers["Content-Type"] = "application/octet-stream";
			else if (corpo !== undefined) headers["Content-Type"] = "application/json";
			return fetch(url, { method: "POST", headers, body: binario !== undefined ? binario : corpo !== undefined ? JSON.stringify(corpo) : undefined });
		};
		let r = await fazer();
		if (r.status === 401) { // token expirado: renova e tenta de novo
			tokens = { ...tokens, acesso: null };
			r = await fazer();
		}
		return r;
	}

	/* ---------- Login ---------- */
	async function entrarDropbox() {
		if (!config) throw new Error("Configuração do Dropbox ausente (config-nuvem.js).");
		const verificador = aleatorio(64);
		const estadoOauth = aleatorio(24);
		try { localStorage.setItem(CHAVE_PKCE, JSON.stringify({ verificador, estado: estadoOauth, quando: Date.now() })); } catch { /* ignora */ }
		const p = new URLSearchParams({
			client_id: config.appKey,
			response_type: "code",
			code_challenge: await desafioPkce(verificador),
			code_challenge_method: "S256",
			token_access_type: "offline",
			redirect_uri: urlRetorno(),
			state: estadoOauth
		});
		location.assign(`https://www.dropbox.com/oauth2/authorize?${p}`);
	}

	/** Conclui o login quando o Dropbox devolve para o site (?code=…&state=…). Retorna o usuário ou null. */
	async function processarRetorno() {
		const params = new URLSearchParams(location.search);
		const code = params.get("code"), estadoOauth = params.get("state"), erro = params.get("error");
		let pkce = null;
		try { pkce = JSON.parse(localStorage.getItem(CHAVE_PKCE) || "null"); } catch { pkce = null; }
		if (!pkce || (!code && !erro) || (estadoOauth && estadoOauth !== pkce.estado)) return null;
		// Limpa a URL e o PKCE em qualquer caso
		try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* ignora */ }
		try { localStorage.removeItem(CHAVE_PKCE); } catch { /* ignora */ }
		if (erro) throw Object.assign(new Error(params.get("error_description") || erro), { code: erro });
		if (!config) throw new Error("Configuração do Dropbox ausente (config-nuvem.js).");
		const j = await pedirToken({ grant_type: "authorization_code", code, code_verifier: pkce.verificador, redirect_uri: urlRetorno() });
		tokens = { acesso: j.access_token, refresh: j.refresh_token, expira: Date.now() + (Number(j.expires_in) || 14400) * 1000, conta: j.account_id || "" };
		gravarTokens(tokens);
		try {
			const r = await chamar(`${API}/2/users/get_current_account`, { corpo: null });
			const conta = await r.json();
			tokens.email = conta?.email || "";
			tokens.conta = conta?.account_id || tokens.conta;
			gravarTokens(tokens);
		} catch (e) { console.warn("[dropbox] conta:", e); }
		usuario = { id: tokens.conta, email: tokens.email || "conta Dropbox" };
		seguro(aoUsuario, usuario);
		return usuario;
	}

	async function sair() {
		const t = tokens;
		tokens = null;
		usuario = null;
		gravarTokens(null);
		seguro(aoUsuario, null);
		if (t?.acesso) {
			try { await fetch(`${API}/2/auth/token/revoke`, { method: "POST", headers: { Authorization: `Bearer ${t.acesso}` } }); } catch { /* ignora */ }
		}
	}

	/* ---------- Arquivo ---------- */
	async function baixar() {
		const r = await chamar(`${CONTEUDO}/2/files/download`, { arg: { path: ARQUIVO } });
		if (r.status === 409) { // arquivo ainda não existe
			const j = await r.json().catch(() => ({}));
			if (/not_found/.test(JSON.stringify(j))) return { itens: {}, rev: null };
			throw Object.assign(new Error(j.error_summary || "Erro no Dropbox"), { status: 409 });
		}
		if (!r.ok) throw Object.assign(new Error(`Erro ${r.status} no Dropbox`), { status: r.status });
		let meta = {};
		try { meta = JSON.parse(r.headers.get("Dropbox-API-Result") || "{}"); } catch { meta = {}; }
		let dados = {};
		try { dados = await r.json(); } catch { dados = {}; }
		const itens = dados && typeof dados.itens === "object" && dados.itens ? dados.itens : {};
		return { itens, rev: meta.rev || null };
	}

	async function enviarArquivo(itensMapa, rev) {
		const conteudo = JSON.stringify({ app: "controle-de-vencimento", versao: 1, atualizadoEm: new Date().toISOString(), itens: itensMapa });
		const modo = rev ? { ".tag": "update", update: rev } : { ".tag": "add" };
		const r = await chamar(`${CONTEUDO}/2/files/upload`, {
			arg: { path: ARQUIVO, mode: modo, autorename: false, mute: true, strict_conflict: true },
			binario: new Blob([conteudo], { type: "application/octet-stream" })
		});
		if (r.status === 409) throw Object.assign(new Error("O arquivo mudou em outro aparelho; tentando de novo."), { status: 409, code: "conflito" });
		if (!r.ok) throw Object.assign(new Error(`Erro ${r.status} ao salvar no Dropbox`), { status: r.status });
		const meta = await r.json().catch(() => ({}));
		return meta.rev || null;
	}

	const paraLista = mapa => Object.entries(mapa).filter(([, v]) => v && typeof v === "object").map(([id, v]) => ({ ...v, id }));

	async function buscar(minha) {
		if (minha !== geracao || !conectado || document.hidden) return;
		try {
			const { itens, rev } = await baixar();
			if (minha !== geracao) return;
			revisao = rev;
			erroAtual = null;
			seguro(aoReceber, fila.aplicar(paraLista(itens)), { doServidor: true });
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

	const aoVoltar = () => { if (!document.hidden && conectado) buscar(geracao); };

	async function preparar() {
		if (!config) throw new Error("Configuração do Dropbox ausente (config-nuvem.js).");
	}

	/** O Dropbox não usa código de lista: a lista é a da conta. */
	async function conectar() {
		desligar();
		await preparar();
		if (!tokens?.refresh) throw Object.assign(new Error("Faça login no Dropbox."), { code: "sem-login" });
		const minha = ++geracao;
		conectado = true;
		erroAtual = null;
		seguro(aoStatus, "conectando");
		fila = criarFila(`cv2:fila:dropbox:${tokens.conta || "conta"}`);
		enviador = criarEnviador({
			fila,
			aoMudar: calcularStatus,
			enviar: async lote => {
				// Lê a versão mais recente, aplica as alterações e grava com a revisão (sem sobrescrever outro aparelho)
				const { itens, rev } = await baixar();
				for (const o of lote) {
					if (o.t === "r") delete itens[o.id];
					else {
						const { id, ...resto } = o.item;
						itens[id] = resto;
					}
				}
				revisao = await enviarArquivo(itens, rev);
			}
		});
		if (!fila.vazia) seguro(aoReceber, fila.aplicar([]), { doServidor: false });
		document.addEventListener("visibilitychange", aoVoltar);
		window.addEventListener("online", aoVoltar);
		await buscar(minha);
		enviador.agendar();
		agendarBusca(minha);
	}

	function desligar() {
		geracao++;
		conectado = false;
		clearTimeout(temporizador);
		enviador?.parar();
		enviador = null;
		document.removeEventListener("visibilitychange", aoVoltar);
		window.removeEventListener("online", aoVoltar);
	}

	function alterar(acao) {
		if (!fila || !conectado) return Promise.reject(emitirErro(new Error("A nuvem não está conectada.")));
		acao();
		calcularStatus();
		const minha = geracao;
		return enviador.processar()
			.then(() => buscar(minha))
			.catch(e => {
				const info = emitirErro(e);
				if (info.tipo !== "rede" && e?.code !== "conflito") { erroAtual = info.mensagem; calcularStatus(); }
			});
	}

	return {
		id: "dropbox",
		nome: "Dropbox",
		disponivel: !!config,
		recursos: { codigo: false, login: "dropbox" },
		preparar,
		conectar,
		desligar,
		salvarVarios: itens => (itens.length ? alterar(() => fila.salvar(itens)) : Promise.resolve()),
		removerVarios: ids => (ids.length ? alterar(() => fila.remover(ids)) : Promise.resolve()),
		entrarDropbox,
		processarRetorno,
		sair,
		get logado() { return !!tokens?.refresh; },
		get usuario() { return usuario; }
	};
}
