/* =========================================================
   Nuvem — utilitários comuns aos provedores
   (códigos de lista, UUIDs, mensagens de erro e fila offline)
   ========================================================= */

/* ---------- Códigos de lista ---------- */
// Sem I, O, 0 e 1 para evitar confusão ao digitar. 32 símbolos × 16 = 80 bits.
const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RE_CODIGO = /^[A-HJ-NP-Z2-9]{16}$/;

export function gerarCodigoLista() {
	const bytes = new Uint8Array(16);
	if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
	else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	return Array.from(bytes, b => ALFABETO_CODIGO[b & 31]).join("");
}

/** Limpa o que foi digitado/colado (aceita o link inteiro). Retorna o código ou null. */
export function normalizarCodigoLista(texto) {
	const bruto = String(texto ?? "").trim();
	const doLink = bruto.match(/[#&?]lista=([A-Za-z0-9-]+)/);
	const limpo = (doLink ? doLink[1] : bruto).toUpperCase().replace(/[^A-Z0-9]/g, "");
	return RE_CODIGO.test(limpo) ? limpo : null;
}

export const formatarCodigoLista = codigo => String(codigo || "").match(/.{1,4}/g)?.join("-") || "";

/* ---------- UUID ---------- */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = id => typeof id === "string" && RE_UUID.test(id);

export function uuidAleatorio() {
	if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
	const b = new Uint8Array(16);
	if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(b);
	else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** UUID determinístico a partir de um texto (o mesmo texto gera sempre o mesmo id). */
export function uuidDeTexto(texto) {
	const s = String(texto);
	const sementes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
	const partes = sementes.map(semente => {
		let h = semente >>> 0;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
			h ^= h >>> 13;
		}
		h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
		h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
		return (h ^ (h >>> 16)) >>> 0;
	});
	const hex = partes.map(p => p.toString(16).padStart(8, "0")).join("").split("");
	hex[12] = "5";
	hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
	const h = hex.join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- Erros ---------- */
/** Dica técnica só no console (para o dono do site); o usuário vê uma mensagem simples. */
const dicaDono = dica => { try { console.warn("[nuvem · dono do site]", dica, "— veja docs/CONFIGURACAO.md"); } catch { /* ignora */ } };

export function explicarErro(erro) {
	const codigo = String(erro?.code || erro?.status || "");
	const texto = String(erro?.message || erro?.error_description || erro?.error_summary || erro || "");
	if (/popup-closed-by-user|cancelled-popup-request|user-cancelled|access_denied/i.test(codigo + texto)) {
		return { tipo: "cancelado", mensagem: "Login cancelado." };
	}
	if (/popup-blocked/i.test(codigo + texto)) {
		return { tipo: "popup", mensagem: "O navegador bloqueou a janela de login. Permita pop-ups para este site e tente de novo." };
	}
	if (/unauthorized-domain/i.test(codigo + texto)) {
		dicaDono("Domínio não autorizado: Firebase → Authentication → Settings → Authorized domains.");
		return { tipo: "config", mensagem: "Este tipo de login está temporariamente indisponível. Tente outra opção de entrada." };
	}
	if (/operation-not-allowed/i.test(codigo + texto)) {
		dicaDono("Provedor de login desativado: Firebase → Authentication → Sign-in method.");
		return { tipo: "config", mensagem: "O login com Google está temporariamente indisponível. Tente outra opção de entrada." };
	}
	if (/permission|not allowed|row-level security|42501|PGRST301|insufficient/i.test(codigo + texto) || codigo === "403") {
		dicaDono("Acesso recusado: publique as regras do Firestore / rode o SQL do Supabase.");
		return { tipo: "permissao", mensagem: "A nuvem recusou o acesso. Tente de novo em instantes; se continuar, use outra opção de entrada." };
	}
	if (/api[- ]?key|invalid.*key|JWT|apikey|401/i.test(codigo + texto)) {
		dicaDono("Chave inválida em config-nuvem.js.");
		return { tipo: "config", mensagem: "A nuvem está temporariamente indisponível. Seus produtos continuam salvos neste aparelho." };
	}
	if (/relation .* does not exist|42P01|PGRST20[0-9]|schema cache/i.test(codigo + texto)) {
		dicaDono("Tabelas/funções ausentes: rode o script SQL no Supabase.");
		return { tipo: "config", mensagem: "Este servidor da nuvem está temporariamente indisponível. Tente outra opção de entrada." };
	}
	if (/expired|invalid.*(otp|token|code)|otp_expired|token has expired/i.test(codigo + texto)) {
		return { tipo: "codigo", mensagem: "Código inválido ou expirado. Peça um novo." };
	}
	if (/rate.?limit|too many|429|over_email_send_rate_limit/i.test(codigo + texto)) {
		return { tipo: "limite", mensagem: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
	}
	if (/resource-exhausted|quota/i.test(codigo + texto)) {
		return { tipo: "cota", mensagem: "Limite gratuito da nuvem atingido por hoje. Tente mais tarde." };
	}
	if (/unavailable|deadline-exceeded|Failed to fetch|NetworkError|network|Load failed|dynamically imported module|Importing a module|offline/i.test(codigo + texto)) {
		return { tipo: "rede", mensagem: "Sem conexão com a nuvem. As alterações serão enviadas quando a internet voltar." };
	}
	return { tipo: "desconhecido", mensagem: texto || "Erro desconhecido na nuvem." };
}

/* ---------- Carregamento de scripts ---------- */
const scripts = new Map();
export function carregarScript(url, verificar) {
	if (verificar()) return Promise.resolve();
	if (scripts.has(url)) return scripts.get(url);
	const p = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = url;
		s.async = true;
		s.crossOrigin = "anonymous";
		s.onload = () => (verificar() ? resolve() : reject(new Error("Falha ao carregar " + url)));
		s.onerror = () => { s.remove(); reject(new Error("Failed to fetch " + url)); };
		document.head.appendChild(s);
	}).catch(e => { scripts.delete(url); throw e; });
	scripts.set(url, p);
	return p;
}

/* ---------- Fila de alterações offline ----------
   Usada pelos provedores sem modo offline próprio (Supabase e Dropbox).
   Cada produto tem no máximo uma operação pendente (a mais recente vence). */
export function criarFila(chave) {
	let seq = 0;
	let ops = [];
	try {
		const salvo = JSON.parse(localStorage.getItem(chave) || "[]");
		if (Array.isArray(salvo)) ops = salvo.filter(o => o && o.id && (o.t === "s" || o.t === "r"));
		seq = ops.reduce((m, o) => Math.max(m, o.seq || 0), 0);
	} catch { ops = []; }

	const gravar = () => {
		try {
			if (ops.length) localStorage.setItem(chave, JSON.stringify(ops));
			else localStorage.removeItem(chave);
		} catch { /* armazenamento cheio: mantém em memória */ }
	};
	const colocar = op => {
		ops = ops.filter(o => o.id !== op.id);
		ops.push({ ...op, seq: ++seq });
	};
	return {
		salvar(itens) { itens.forEach(item => colocar({ t: "s", id: item.id, item })); gravar(); },
		remover(ids) { ids.forEach(id => colocar({ t: "r", id })); gravar(); },
		get pendentes() { return ops.slice(); },
		get vazia() { return ops.length === 0; },
		/** Remove as operações enviadas (as que não mudaram depois do envio). */
		confirmar(enviadas) {
			const feitas = new Map(enviadas.map(o => [o.id, o.seq]));
			ops = ops.filter(o => !(feitas.has(o.id) && o.seq <= feitas.get(o.id)));
			gravar();
		},
		/** Aplica as pendências sobre a lista recebida da nuvem (a tela não "volta atrás"). */
		aplicar(lista) {
			if (!ops.length) return lista;
			const mapa = new Map(lista.map(i => [i.id, i]));
			for (const o of ops) {
				if (o.t === "r") mapa.delete(o.id);
				else mapa.set(o.id, o.item);
			}
			return [...mapa.values()];
		},
		limpar() { ops = []; gravar(); }
	};
}

/** Executa o envio da fila com novas tentativas (2s, 4s, 8s… até 60s). */
export function criarEnviador({ fila, enviar, aoMudar }) {
	let enviando = false;
	let tentativa = 0;
	let temporizador = null;
	let ativo = true;

	async function processar() {
		if (!ativo || enviando || fila.vazia) return;
		if (navigator.onLine === false) return aoMudar?.();
		enviando = true;
		clearTimeout(temporizador);
		aoMudar?.();
		const lote = fila.pendentes;
		try {
			await enviar(lote);
			fila.confirmar(lote);
			tentativa = 0;
		} catch (e) {
			tentativa++;
			const espera = Math.min(60000, 2000 * 2 ** Math.min(tentativa - 1, 5));
			temporizador = setTimeout(processar, espera);
			throw e;
		} finally {
			enviando = false;
			aoMudar?.();
		}
		if (!fila.vazia) setTimeout(processar, 0);
	}

	const aoVoltarInternet = () => { tentativa = 0; processar().catch(() => { }); };
	window.addEventListener("online", aoVoltarInternet);

	return {
		agendar: () => processar().catch(() => { }),
		processar,
		get enviando() { return enviando; },
		parar() {
			ativo = false;
			clearTimeout(temporizador);
			window.removeEventListener("online", aoVoltarInternet);
		}
	};
}
