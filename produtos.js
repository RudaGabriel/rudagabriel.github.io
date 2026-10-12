/* =========================================================
   Sugestão de nome do produto pelo código de barras
   ---------------------------------------------------------
   Consulta bases públicas e gratuitas do projeto Open Food
   Facts (alimentos, cosméticos e outros produtos). Só o código
   de barras é enviado. Os resultados ficam guardados no
   aparelho para não consultar de novo.
   ========================================================= */

const CHAVE_CACHE = "cv2:nomesCodigo";
const MAX_CACHE = 400;
const VALIDADE_NEGATIVO_MS = 24 * 60 * 60 * 1000; // "não encontrado" vale 1 dia
const TEMPO_LIMITE_MS = 6000;
const CAMPOS = "product_name_pt,product_name,generic_name_pt,generic_name,brands,quantity";
const BASES = [
	"https://world.openfoodfacts.org",
	"https://world.openproductsfacts.org",
	"https://world.openbeautyfacts.org"
];

/** Só códigos numéricos de produto (EAN-8, UPC-A, EAN-13, GTIN-14). */
export const codigoConsultavel = codigo => /^\d{8,14}$/.test(String(codigo || ""));

function lerCache() {
	try {
		const dados = JSON.parse(localStorage.getItem(CHAVE_CACHE) || "{}");
		return dados && typeof dados === "object" && !Array.isArray(dados) ? dados : {};
	} catch {
		return {};
	}
}

function gravarCache(codigo, nome) {
	try {
		const dados = lerCache();
		dados[codigo] = { n: nome || null, t: Date.now() };
		const chaves = Object.keys(dados);
		if (chaves.length > MAX_CACHE) {
			chaves.sort((a, b) => (dados[a]?.t || 0) - (dados[b]?.t || 0))
				.slice(0, chaves.length - MAX_CACHE)
				.forEach(c => delete dados[c]);
		}
		localStorage.setItem(CHAVE_CACHE, JSON.stringify(dados));
	} catch { /* armazenamento cheio ou bloqueado: só não guarda */ }
}

const limpar = texto => String(texto ?? "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
const contem = (a, b) => a.toLocaleLowerCase("pt-BR").includes(b.toLocaleLowerCase("pt-BR"));

/** Monta um nome legível: "Leite Integral Piracanjuba 1 L". */
export function montarNome(produto) {
	if (!produto || typeof produto !== "object") return null;
	let nome = limpar(produto.product_name_pt) || limpar(produto.product_name) || limpar(produto.generic_name_pt) || limpar(produto.generic_name);
	if (!nome) return null;
	const marca = limpar(String(produto.brands || "").split(",")[0]);
	if (marca && !contem(nome, marca)) nome = `${nome} ${marca}`;
	const quantidade = limpar(produto.quantity);
	if (quantidade && quantidade.length <= 20 && !contem(nome, quantidade)) nome = `${nome} ${quantidade}`;
	return nome.slice(0, 120);
}

async function consultar(base, codigo, sinalExterno) {
	const controle = new AbortController();
	const cancelar = () => controle.abort();
	const tempo = setTimeout(cancelar, TEMPO_LIMITE_MS);
	sinalExterno?.addEventListener("abort", cancelar, { once: true });
	try {
		const r = await fetch(`${base}/api/v2/product/${codigo}.json?fields=${CAMPOS}`, { signal: controle.signal, headers: { Accept: "application/json" } });
		if (r.status === 404) return null;
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const dados = await r.json();
		return dados && (dados.status === 1 || dados.product) ? montarNome(dados.product) : null;
	} finally {
		clearTimeout(tempo);
		sinalExterno?.removeEventListener("abort", cancelar);
	}
}

/**
 * Procura o nome do produto pelo código de barras.
 * @returns {Promise<{nome: string, fonte: string} | null>} null se não encontrar ou estiver offline.
 */
export async function buscarNomeProduto(codigo, { sinal } = {}) {
	codigo = String(codigo || "").trim();
	if (!codigoConsultavel(codigo)) return null;

	const guardado = lerCache()[codigo];
	if (guardado) {
		if (guardado.n) return { nome: guardado.n, fonte: "cache" };
		if (Date.now() - (guardado.t || 0) < VALIDADE_NEGATIVO_MS) return null;
	}
	if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

	let algumaRespondeu = false;
	for (const base of BASES) {
		if (sinal?.aborted) return null;
		try {
			const nome = await consultar(base, codigo, sinal);
			algumaRespondeu = true;
			if (nome) {
				gravarCache(codigo, nome);
				return { nome, fonte: base };
			}
		} catch (e) {
			if (sinal?.aborted) return null;
			console.warn("[produtos] consulta falhou:", base, e?.message || e);
		}
	}
	// Só guarda "não encontrado" se alguma base respondeu (falha de rede não conta)
	if (algumaRespondeu) gravarCache(codigo, null);
	return null;
}
