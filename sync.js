/* =========================================================
   Sincronização em nuvem (Firebase Firestore)
   ---------------------------------------------------------
   Modelo simples: cada lista compartilhada é UM documento com o
   campo "itens" (mapa id → produto):
   - Nuvem do app (modo fácil): "listas/<CÓDIGO>" — código aleatório
     de 16 caracteres, impossível de adivinhar.
   - Firebase próprio (avançado): "dados/lista-<nome>" — compatível
     com as regras antigas (match /dados/{document}).
   - Edições de produtos diferentes nunca se sobrescrevem.
   - Funciona offline: as alterações ficam na fila e são
     enviadas quando a conexão voltar.
   ========================================================= */

const VERSAO_FIREBASE = "12.19.0";
const URL_APP = `https://www.gstatic.com/firebasejs/${VERSAO_FIREBASE}/firebase-app.js`;
const URL_FIRESTORE = `https://www.gstatic.com/firebasejs/${VERSAO_FIREBASE}/firebase-firestore.js`;

const TEMPO_LIMITE_SERVIDOR_MS = 15000;

export const REGRAS_FIRESTORE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dados/{document} {
      allow read, write: if true;
    }
  }
}`;

/** Regras para o projeto Firebase da nuvem do app (modo fácil). */
export const REGRAS_NUVEM_FACIL = `rules_version = '2';
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
  }
}`;

/* ---------- Códigos de lista (modo fácil) ---------- */
// Sem I, O, 0 e 1 para evitar confusão ao digitar. 32 símbolos × 16 = 80 bits.
const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TAMANHO_CODIGO = 16;
const RE_CODIGO = /^[A-HJ-NP-Z2-9]{16}$/;

/** Gera um código de lista aleatório e seguro (16 caracteres). */
export function gerarCodigoLista() {
	const bytes = new Uint8Array(TAMANHO_CODIGO);
	if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
	else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	// 256 é múltiplo de 32: a distribuição continua uniforme
	return Array.from(bytes, b => ALFABETO_CODIGO[b & 31]).join("");
}

/** Limpa o que o usuário digitou/colou. Retorna o código (16 caracteres) ou null. */
export function normalizarCodigoLista(texto) {
	const bruto = String(texto ?? "").trim();
	// Aceita também um link de compartilhamento colado inteiro
	const doLink = bruto.match(/[#&?]lista=([A-Za-z0-9-]+)/);
	const limpo = (doLink ? doLink[1] : bruto).toUpperCase().replace(/[^A-Z0-9]/g, "");
	return RE_CODIGO.test(limpo) ? limpo : null;
}

/** "ABCDEFGHJKLMNPQR" → "ABCD-EFGH-JKLM-NPQR" */
export const formatarCodigoLista = codigo => String(codigo || "").match(/.{1,4}/g)?.join("-") || "";

const CHAVES_CONFIG = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];

/** Normaliza o nome da lista para um identificador seguro (a-z, 0-9, hífen). */
export function normalizarNomeLista(nome) {
	const limpo = String(nome ?? "")
		.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "");
	return limpo || "principal";
}

/**
 * Extrai a configuração do Firebase de qualquer texto colado:
 * JSON, objeto JS (`const firebaseConfig = {...}`) ou pares soltos.
 * Retorna { config, faltando } — "faltando" lista as chaves obrigatórias ausentes.
 */
export function extrairConfigFirebase(texto) {
	const config = {};
	const fonte = String(texto ?? "");
	for (const chave of CHAVES_CONFIG) {
		const re = new RegExp(`["']?\\b${chave}\\b["']?\\s*[:=]\\s*["'\`]([^"'\`\\s]+)["'\`]`);
		const achado = fonte.match(re);
		if (achado) config[chave] = achado[1].trim();
	}
	if (config.projectId && !config.authDomain) config.authDomain = `${config.projectId}.firebaseapp.com`;
	const faltando = ["apiKey", "projectId", "appId"].filter(c => !config[c]);
	return { config, faltando };
}

/** Valida e limpa uma configuração já em objeto (ex.: vinda de link ou backup). */
export function configValida(config) {
	if (!config || typeof config !== "object") return null;
	const limpa = {};
	for (const chave of CHAVES_CONFIG) {
		if (typeof config[chave] === "string" && config[chave].trim()) limpa[chave] = config[chave].trim();
	}
	if (!limpa.apiKey || !limpa.projectId || !limpa.appId) return null;
	if (!limpa.authDomain) limpa.authDomain = `${limpa.projectId}.firebaseapp.com`;
	return limpa;
}

/** Traduz erros do Firebase para mensagens claras. */
export function explicarErro(erro) {
	const codigo = erro?.code || "";
	const texto = String(erro?.message || erro || "");
	if (codigo === "permission-denied" || /permission/i.test(texto)) {
		return { tipo: "permissao", mensagem: "O Firebase recusou o acesso. Confira as regras do Firestore (veja “Como obter a configuração?”)." };
	}
	if (/api[- ]?key/i.test(texto) || codigo === "invalid-api-key" || codigo === "app/invalid-api-key") {
		return { tipo: "config", mensagem: "A chave (apiKey) parece inválida. Cole novamente a configuração do Firebase." };
	}
	if (codigo === "not-found" || /database .* does not exist|NOT_FOUND/i.test(texto)) {
		return { tipo: "config", mensagem: "Banco Firestore não encontrado. Crie o banco em “Firestore Database” no console do Firebase." };
	}
	if (codigo === "unavailable" || codigo === "deadline-exceeded") {
		return { tipo: "rede", mensagem: "Sem conexão com o servidor. As alterações serão enviadas quando a internet voltar." };
	}
	if (codigo === "resource-exhausted") {
		return { tipo: "cota", mensagem: "Limite gratuito do Firebase atingido por hoje. Tente novamente mais tarde." };
	}
	if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(texto)) {
		return { tipo: "rede", mensagem: "Não foi possível carregar o Firebase. Verifique sua conexão com a internet." };
	}
	return { tipo: "desconhecido", mensagem: texto || "Erro desconhecido ao sincronizar." };
}

/**
 * Cria o controlador de sincronização.
 * @param {object} eventos
 * @param {(itens: object[], meta: {doServidor: boolean, pendente: boolean}) => void} eventos.aoReceber
 * @param {(estado: string, detalhe?: string) => void} eventos.aoStatus
 * @param {(info: {tipo: string, mensagem: string}) => void} eventos.aoErro
 */
export function criarSync({ aoReceber, aoStatus, aoErro }) {
	let fb = null;          // módulos do Firebase (carregados sob demanda)
	let app = null;
	let db = null;
	let ref = null;
	let cancelarEscuta = null;
	let temporizador = null;
	let geracao = 0;        // invalida callbacks de conexões antigas
	let recebeuDoServidor = false;

	async function carregarFirebase() {
		if (fb) return fb;
		const [modApp, modFs] = await Promise.all([import(URL_APP), import(URL_FIRESTORE)]);
		fb = { ...modApp, ...modFs };
		return fb;
	}

	function emitirStatus(estado, detalhe) {
		try { aoStatus?.(estado, detalhe); } catch (e) { console.error(e); }
	}

	function emitirErro(erro) {
		const info = explicarErro(erro);
		console.warn("[sync]", erro);
		try { aoErro?.(info, erro); } catch (e) { console.error(e); }
		return info;
	}

	/**
	 * Conecta a um documento de lista.
	 * @param {{config: object, colecao: string, documento: string}} destino
	 */
	async function conectar({ config, colecao, documento }) {
		await desconectar();
		const minhaGeracao = ++geracao;
		recebeuDoServidor = false;
		emitirStatus("conectando");

		const f = await carregarFirebase();
		if (minhaGeracao !== geracao) return;

		// Nome estável por projeto: mantém o cache offline entre recarregamentos
		const nomeApp = `cv-${config.projectId}`;
		try {
			app = f.initializeApp(config, nomeApp);
		} catch (e) {
			console.warn("[sync] instância anterior ainda ativa, criando outra:", e);
			app = f.initializeApp(config, `${nomeApp}-${Date.now()}`);
		}
		try {
			db = f.initializeFirestore(app, {
				localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() })
			});
		} catch (e) {
			console.warn("[sync] cache persistente indisponível, usando memória:", e);
			db = f.initializeFirestore(app, { localCache: f.memoryLocalCache() });
		}
		ref = f.doc(db, colecao, documento);

		// Se o servidor não responder, avisa (config errada ou sem internet)
		temporizador = setTimeout(() => {
			if (minhaGeracao !== geracao || recebeuDoServidor) return;
			if (navigator.onLine === false) emitirStatus("offline", "Sem internet — usando dados salvos no aparelho.");
			else emitirStatus("erro", "O servidor não respondeu. Verifique a configuração do Firebase e se o Firestore foi criado.");
		}, TEMPO_LIMITE_SERVIDOR_MS);

		cancelarEscuta = f.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
			if (minhaGeracao !== geracao) return;
			const doServidor = !snap.metadata.fromCache;
			const pendente = snap.metadata.hasPendingWrites;
			if (doServidor) {
				recebeuDoServidor = true;
				clearTimeout(temporizador);
			}
			const mapa = snap.exists() ? (snap.data()?.itens || {}) : {};
			const itens = Object.entries(mapa)
				.filter(([, v]) => v && typeof v === "object")
				.map(([id, v]) => ({ ...v, id }));
			try { aoReceber?.(itens, { doServidor, pendente }); } catch (e) { console.error(e); }

			if (pendente) emitirStatus("salvando");
			else if (doServidor) emitirStatus("sincronizado");
			else if (navigator.onLine === false) emitirStatus("offline", "Sem internet — as alterações serão enviadas depois.");
			else if (!recebeuDoServidor) emitirStatus("conectando");
		}, erro => {
			if (minhaGeracao !== geracao) return;
			clearTimeout(temporizador);
			const info = emitirErro(erro);
			emitirStatus("erro", info.mensagem);
		});
	}

	async function desconectar() {
		geracao++;
		clearTimeout(temporizador);
		try { cancelarEscuta?.(); } catch { /* ignora */ }
		cancelarEscuta = null;
		const f = fb, dbAntigo = db, appAntigo = app;
		db = null; app = null; ref = null;
		if (f && dbAntigo) { try { await f.terminate(dbAntigo); } catch (e) { console.warn(e); } }
		if (f && appAntigo) { try { await f.deleteApp(appAntigo); } catch (e) { console.warn(e); } }
	}

	/** Remove o "id" e garante apenas campos conhecidos no documento. */
	function paraDocumento(item) {
		return {
			nome: item.nome,
			quantidade: item.quantidade,
			vencimento: item.vencimento,
			codigoBarras: item.codigoBarras || "",
			criadoEm: item.criadoEm || Date.now(),
			atualizadoEm: item.atualizadoEm || Date.now()
		};
	}

	function escrever(dados) {
		if (!ref || !fb) {
			const info = emitirErro(new Error("Sincronização não está conectada."));
			return Promise.reject(info);
		}
		const f = fb;
		// Não aguardamos o servidor: o Firestore aplica localmente na hora e envia em segundo plano.
		return f.setDoc(ref, { ...dados, versao: 2, atualizadoEm: f.serverTimestamp() }, { merge: true })
			.catch(erro => { emitirErro(erro); throw erro; });
	}

	function salvarVarios(itens) {
		if (!itens.length) return Promise.resolve();
		const mapa = {};
		for (const item of itens) mapa[item.id] = paraDocumento(item);
		return escrever({ itens: mapa });
	}

	function removerVarios(ids) {
		if (!ids.length || !fb) return Promise.resolve();
		const mapa = {};
		for (const id of ids) mapa[id] = fb.deleteField();
		return escrever({ itens: mapa });
	}

	return {
		conectar,
		desconectar,
		salvar: item => salvarVarios([item]),
		salvarVarios,
		remover: id => removerVarios([id]),
		removerVarios,
		get ativo() { return !!ref; },
		get confirmadoPeloServidor() { return recebeuDoServidor; }
	};
}
