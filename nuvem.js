/* =========================================================
   Nuvem (InstantDB)
   ---------------------------------------------------------
   - Login sem senha: a pessoa digita o e-mail e recebe um
     código. Em qualquer aparelho, o mesmo e-mail abre a
     mesma lista.
   - Também dá para usar sem login: lista identificada por um
     código aleatório (link / QR Code / código).
   - Tempo real, funciona offline (as alterações vão para uma
     fila) e cada produto é salvo separadamente (edições em
     aparelhos diferentes não se sobrescrevem).
   Configuração: só o App ID (config-nuvem.js).
   ========================================================= */

const URL_INSTANT = "https://cdn.jsdelivr.net/npm/@instantdb/core@1.0.67/dist/standalone/index.js";
const TEMPO_LIMITE_MS = 15000;
const LOTE = 100;

/** Regras recomendadas (cole em instantdb.com/dash → Permissions). */
export const REGRAS_NUVEM = JSON.stringify({
	produtos: {
		bind: ["daLista", "ruleParams.lista != null && data.lista == ruleParams.lista"],
		allow: {
			view: "daLista",
			create: "daLista",
			update: "daLista && newData.lista == ruleParams.lista",
			delete: "daLista"
		}
	},
	contas: {
		bind: ["dono", "auth.id != null && data.usuario == auth.id"],
		allow: {
			view: "dono",
			create: "dono",
			update: "dono && newData.usuario == auth.id",
			delete: "dono"
		}
	}
}, null, 2);

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const appIdValido = id => typeof id === "string" && RE_UUID.test(id.trim());
export const ehUuid = id => typeof id === "string" && RE_UUID.test(id);

/* ---------- Códigos de lista ---------- */
// Sem I, O, 0 e 1 para evitar confusão ao digitar. 32 símbolos × 16 = 80 bits.
const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RE_CODIGO = /^[A-HJ-NP-Z2-9]{16}$/;

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
	hex[12] = "5";                                            // versão
	hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // variante
	const h = hex.join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Traduz erros para mensagens claras. */
export function explicarErro(erro) {
	const texto = String(erro?.message || erro?.body?.message || erro || "");
	const status = erro?.status || erro?.body?.status;
	if (/permission|not allowed|perms/i.test(texto) || status === 403) {
		return { tipo: "permissao", mensagem: "A nuvem recusou o acesso. Confira as regras (Permissions) do app no InstantDB." };
	}
	if (/app.?id|not a valid uuid|app not found|invalid app/i.test(texto)) {
		return { tipo: "config", mensagem: "O App ID da nuvem é inválido. Confira o valor em config-nuvem.js." };
	}
	if (/code|magic/i.test(texto) && /invalid|expired|wrong|incorrect/i.test(texto)) {
		return { tipo: "codigo", mensagem: "Código inválido ou expirado. Peça um novo código." };
	}
	if (/email/i.test(texto) && /invalid/i.test(texto)) {
		return { tipo: "email", mensagem: "E-mail inválido. Confira e tente de novo." };
	}
	if (/rate|too many/i.test(texto) || status === 429) {
		return { tipo: "limite", mensagem: "Muitas tentativas. Aguarde um minuto e tente de novo." };
	}
	if (/Failed to fetch|NetworkError|network|Load failed|dynamically imported module|Importing a module/i.test(texto)) {
		return { tipo: "rede", mensagem: "Sem conexão com a nuvem. Verifique sua internet." };
	}
	return { tipo: "desconhecido", mensagem: texto || "Erro desconhecido na nuvem." };
}

/**
 * Cria o controlador da nuvem.
 * @param {object} op
 * @param {string} op.appId
 * @param {(itens: object[], meta: {doServidor: boolean}) => void} op.aoReceber
 * @param {(estado: string, detalhe?: string) => void} op.aoStatus
 * @param {(info: {tipo: string, mensagem: string}) => void} op.aoErro
 * @param {(usuario: object|null) => void} op.aoUsuario
 */
export function criarNuvem({ appId, aoReceber, aoStatus, aoErro, aoUsuario }) {
	let mod = null;
	let db = null;
	let preparando = null;
	let codigoAtual = null;
	let cancelarLista = null;
	let conexao = "connecting";
	let pendentes = 0;
	let temporizador = null;
	let geracao = 0;
	let conectadoAlgumaVez = false;
	let usuario = null;

	const seguro = (fn, ...a) => { try { fn?.(...a); } catch (e) { console.error(e); } };
	const emitirErro = erro => {
		const info = explicarErro(erro);
		console.warn("[nuvem]", erro);
		seguro(aoErro, info);
		return info;
	};

	function calcularStatus() {
		if (!codigoAtual) return;
		if (conexao === "errored") return seguro(aoStatus, "erro", "Não foi possível conectar à nuvem.");
		if (navigator.onLine === false || conexao === "closed") {
			return seguro(aoStatus, "offline", pendentes ? "Sem internet — as alterações serão enviadas depois." : "Sem internet — usando a cópia salva no aparelho.");
		}
		if (conexao !== "authenticated") return seguro(aoStatus, "conectando");
		seguro(aoStatus, pendentes ? "salvando" : "sincronizado");
	}

	async function preparar() {
		if (db) return db;
		if (!preparando) {
			preparando = (async () => {
				if (!appIdValido(appId)) throw new Error("App ID inválido");
				mod = await import(URL_INSTANT);
				db = mod.init({ appId: appId.trim(), devtool: false });
				db.subscribeConnectionStatus(st => {
					conexao = st;
					if (st === "authenticated") {
						conectadoAlgumaVez = true;
						clearTimeout(temporizador);
					}
					calcularStatus();
				});
				db.subscribeAuth(r => {
					usuario = r?.user && !r.user.isGuest ? r.user : null;
					seguro(aoUsuario, usuario);
				});
				return db;
			})().catch(e => { preparando = null; db = null; throw e; });
		}
		return preparando;
	}

	/** Começa a acompanhar uma lista (pelo código). */
	async function conectar(codigo) {
		desligarLista();
		const minhaGeracao = ++geracao;
		codigoAtual = codigo;
		seguro(aoStatus, "conectando");
		await preparar();
		if (minhaGeracao !== geracao) return;

		clearTimeout(temporizador);
		temporizador = setTimeout(() => {
			if (minhaGeracao !== geracao || conexao === "authenticated") return;
			if (navigator.onLine === false) seguro(aoStatus, "offline", "Sem internet — usando a cópia salva no aparelho.");
			else seguro(aoStatus, "erro", "A nuvem não respondeu. Verifique sua internet e tente de novo.");
		}, TEMPO_LIMITE_MS);

		cancelarLista = db.subscribeQuery(
			{ produtos: { $: { where: { lista: codigo } } } },
			resp => {
				if (minhaGeracao !== geracao) return;
				if (resp?.error) {
					const info = emitirErro(resp.error);
					seguro(aoStatus, "erro", info.mensagem);
					return;
				}
				const brutos = resp?.data?.produtos || [];
				const itens = brutos.filter(p => p && typeof p === "object").map(p => ({ ...p, id: p.id }));
				seguro(aoReceber, itens, { doServidor: conexao === "authenticated" });
				calcularStatus();
			},
			{ ruleParams: { lista: codigo } }
		);
		calcularStatus();
	}

	function desligarLista() {
		geracao++;
		clearTimeout(temporizador);
		try { cancelarLista?.(); } catch { /* ignora */ }
		cancelarLista = null;
		codigoAtual = null;
	}

	function camposDoItem(item) {
		return {
			lista: codigoAtual,
			nome: item.nome,
			quantidade: item.quantidade,
			vencimento: item.vencimento,
			codigoBarras: item.codigoBarras || "",
			criadoEm: item.criadoEm || Date.now(),
			atualizadoEm: item.atualizadoEm || Date.now()
		};
	}

	async function transacionar(montar) {
		if (!db || !codigoAtual) {
			const info = emitirErro(new Error("A nuvem não está conectada."));
			throw info;
		}
		const lista = codigoAtual;
		const chunks = montar(lista);
		for (let i = 0; i < chunks.length; i += LOTE) {
			pendentes++;
			calcularStatus();
			try {
				await db.transact(chunks.slice(i, i + LOTE));
			} catch (e) {
				emitirErro(e);
				throw e;
			} finally {
				pendentes--;
				calcularStatus();
			}
		}
	}

	function salvarVarios(itens) {
		if (!itens.length) return Promise.resolve();
		return transacionar(lista => itens.map(item =>
			db.tx.produtos[item.id].ruleParams({ lista }).update(camposDoItem(item))
		));
	}

	function removerVarios(ids) {
		if (!ids.length) return Promise.resolve();
		return transacionar(lista => ids.map(id => db.tx.produtos[id].ruleParams({ lista }).delete()));
	}

	/* ---------- Login por e-mail ---------- */
	async function enviarCodigo(email) {
		await preparar();
		return db.auth.sendMagicCode({ email });
	}

	async function entrarComCodigo(email, code) {
		await preparar();
		const r = await db.auth.signInWithMagicCode({ email, code });
		usuario = r?.user || usuario;
		return usuario;
	}

	async function sair() {
		if (!db) return;
		try { await db.auth.signOut(); } catch (e) { console.warn(e); }
		usuario = null;
	}

	/** Código da lista salvo na conta (ou null). */
	async function listaDaConta(usuarioId) {
		await preparar();
		const r = await db.queryOnce({ contas: { $: { where: { usuario: usuarioId } } } });
		const conta = r?.data?.contas?.[0];
		return normalizarCodigoLista(conta?.lista) || null;
	}

	async function salvarListaNaConta(usuarioId, codigo) {
		await preparar();
		await db.transact(db.tx.contas[usuarioId].update({ usuario: usuarioId, lista: codigo, atualizadoEm: Date.now() }));
	}

	return {
		preparar,
		conectar,
		desligar: desligarLista,
		salvar: item => salvarVarios([item]),
		salvarVarios,
		remover: id => removerVarios([id]),
		removerVarios,
		enviarCodigo,
		entrarComCodigo,
		sair,
		listaDaConta,
		salvarListaNaConta,
		get usuario() { return usuario; },
		get ativo() { return !!codigoAtual && !!db; },
		get conectadoAlgumaVez() { return conectadoAlgumaVez; }
	};
}
