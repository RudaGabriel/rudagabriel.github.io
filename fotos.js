/* =========================================================
   Fotos dos produtos
   ---------------------------------------------------------
   Prioridade:
     1. Foto colocada pela pessoa (tirada ou escolhida) — sempre vence
     2. Foto encontrada pelo NOME informado (Open Food Facts), quando
        o produto encontrado tem um nome bem parecido
     3. Foto encontrada pelo código de barras (Open Food Facts e
        afins, UPCitemdb, Wikidata), se não achar pelo nome
   A foto é do PRODUTO (código de barras, ou o nome quando não há
   código): todos os lotes do mesmo produto mostram a mesma foto.
   Fica guardada neste aparelho (IndexedDB); em outro aparelho a
   busca automática encontra de novo a foto pelo código.
   ========================================================= */

import { intermediario, pausar } from "./produtos.js";

const BANCO = "cv2-fotos";
const LOJA = "fotos";
const TEMPO_LIMITE_MS = 7000;
const REPETIR_BUSCA_MS = 7 * 24 * 60 * 60 * 1000; // "não achei" vale 7 dias
const LADO_FOTO = 480;          // foto da pessoa: lado maior em px (pequena e nítida)
const QUALIDADE_FOTO = 0.82;

const semAcento = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const normalizarNome = t => semAcento(t).replace(/[^a-z0-9]+/g, " ").trim();

/** Chave da foto de um item: pelo código de barras; sem código, pelo nome. */
export function chaveFoto(item) {
	const codigo = String(item?.codigoBarras || "").replace(/\s+/g, "");
	if (codigo) return `c:${codigo}`;
	const nome = normalizarNome(item?.nome);
	return nome ? `n:${nome}` : "";
}

/* ---------- Armazenamento (IndexedDB, com memória como reserva) ---------- */
const memoria = new Map();
let bancoPromessa = null;

function abrirBanco() {
	if (bancoPromessa) return bancoPromessa;
	bancoPromessa = new Promise(resolver => {
		try {
			if (!("indexedDB" in window)) return resolver(null);
			const pedido = indexedDB.open(BANCO, 1);
			pedido.onupgradeneeded = () => { try { pedido.result.createObjectStore(LOJA); } catch { /* já existe */ } };
			pedido.onsuccess = () => resolver(pedido.result);
			pedido.onerror = () => resolver(null);
			pedido.onblocked = () => resolver(null);
		} catch {
			resolver(null);
		}
	});
	return bancoPromessa;
}

async function transacao(modo, fazer) {
	const banco = await abrirBanco();
	if (!banco) return null;
	return new Promise(resolver => {
		try {
			const tx = banco.transaction(LOJA, modo);
			const loja = tx.objectStore(LOJA);
			let resultado = null;
			fazer(loja, r => { resultado = r; });
			tx.oncomplete = () => resolver(resultado);
			tx.onerror = tx.onabort = () => resolver(null);
		} catch {
			resolver(null);
		}
	});
}

/** Todas as fotos guardadas: Map(chave → { src, origem, fonte, quando }). */
export async function carregarFotos() {
	const mapa = new Map(memoria);
	await transacao("readonly", (loja, devolver) => {
		const pedido = loja.openCursor();
		pedido.onsuccess = () => {
			const cursor = pedido.result;
			if (!cursor) return devolver(mapa);
			if (cursor.value && typeof cursor.value === "object") mapa.set(String(cursor.key), cursor.value);
			cursor.continue();
		};
	});
	for (const [k, v] of mapa) memoria.set(k, v);
	return mapa;
}

export async function guardarFoto(chave, registro) {
	if (!chave) return;
	const valor = { ...registro, quando: Date.now() };
	memoria.set(chave, valor);
	await transacao("readwrite", loja => loja.put(valor, chave));
}

export async function apagarFoto(chave) {
	if (!chave) return;
	memoria.delete(chave);
	await transacao("readwrite", loja => loja.delete(chave));
}

/** A busca automática deve tentar esta chave? (sem foto, ou "não achei" antigo) */
export function precisaBuscar(registro) {
	if (!registro) return true;
	if (registro.removidaPeloUsuario) return false; // a pessoa tirou a foto: não insiste
	if (registro.origem === "nenhuma") return Date.now() - (registro.quando || 0) > REPETIR_BUSCA_MS;
	return false;
}

/* ---------- Busca na internet ---------- */
/** Falha de consulta (rede, limite de uso, servidor): não significa "não existe". */
export class FalhaBusca extends Error { }

/** Consulta o intermediário; "sem cota" (429) pausa aquele uso por um tempo. */
async function buscarIntermediario(uso, caminho, sinal) {
	try {
		return await buscarJson(`${intermediario(uso)}${caminho}`, sinal);
	} catch (e) {
		if (/HTTP 429/.test(String(e?.message))) pausar(uso);
		throw e;
	}
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

// A busca por texto do Open Food Facts aceita ~10 consultas por minuto: uma a cada 6,5 s
const INTERVALO_BUSCA_TEXTO_MS = 6500;
let proximaBuscaTexto = 0;
async function aguardarVezBuscaTexto(sinal) {
	const agora = Date.now();
	const espera = Math.max(0, proximaBuscaTexto - agora);
	proximaBuscaTexto = Math.max(agora, proximaBuscaTexto) + INTERVALO_BUSCA_TEXTO_MS;
	if (espera) await esperar(espera);
	if (sinal?.aborted) throw new FalhaBusca("cancelada");
}

async function buscarJson(url, sinal, aceitar = "application/json") {
	const controle = new AbortController();
	const cancelar = () => controle.abort();
	const tempo = setTimeout(cancelar, TEMPO_LIMITE_MS);
	sinal?.addEventListener("abort", cancelar, { once: true });
	try {
		const r = await fetch(url, { signal: controle.signal, headers: { Accept: aceitar } });
		if (r.status === 404) return null;
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return await r.json();
	} finally {
		clearTimeout(tempo);
		sinal?.removeEventListener("abort", cancelar);
	}
}

const urlSegura = u => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : "");
const CAMPOS_IMAGEM = "product_name,product_name_pt,brands,image_front_small_url,image_front_url,image_small_url,image_url";
const imagemOff = p => urlSegura(p?.image_front_url) || urlSegura(p?.image_url) || urlSegura(p?.image_front_small_url) || urlSegura(p?.image_small_url);

const BASES_OFF = [
	{ nome: "Open Food Facts", url: "https://br.openfoodfacts.org", extra: "&cc=br" },
	{ nome: "Open Products Facts", url: "https://world.openproductsfacts.org", extra: "" },
	{ nome: "Open Beauty Facts", url: "https://world.openbeautyfacts.org", extra: "" },
	{ nome: "Open Pet Food Facts", url: "https://world.openpetfoodfacts.org", extra: "" }
];

/**
 * Fotos do produto pelo código de barras (da fonte mais confiável para a menos).
 * @returns {Promise<{ src: string, fonte: string }[]>}
 */
export async function fotosPorCodigo(codigo, { sinal } = {}) {
	codigo = String(codigo || "").replace(/\s+/g, "");
	if (!/^\d{8,14}$/.test(codigo)) return [];
	const achadas = [];
	let falhas = 0, total = 0;
	const contar = p => { total++; return p.catch(() => { falhas++; }); };
	const consultas = [];
	if (intermediario("produto")) {
		consultas.push(buscarIntermediario("produto", `/produto?gtin=${codigo}`, sinal).then(d => {
			const src = urlSegura(d?.foto);
			if (src) achadas.push({ src, fonte: String(d?.fonteFoto || d?.fonte || "Bases brasileiras"), ordem: -1 });
		}));
	}
	consultas.push(...BASES_OFF.map((base, ordem) =>
		buscarJson(`${base.url}/api/v2/product/${codigo}.json?fields=${CAMPOS_IMAGEM}&lc=pt${base.extra}`, sinal)
			.then(d => { const src = imagemOff(d?.product); if (src) achadas.push({ src, fonte: base.nome, ordem }); })
	));
	consultas.push(buscarJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${codigo}`, sinal)
		.then(d => {
			const imagens = Array.isArray(d?.items?.[0]?.images) ? d.items[0].images : [];
			const src = imagens.map(urlSegura).find(Boolean);
			if (src) achadas.push({ src, fonte: "UPCitemdb", ordem: 10 });
		}));
	const variantes = [...new Set([codigo, codigo.replace(/^0+/, ""), codigo.padStart(13, "0"), codigo.padStart(14, "0")])]
		.filter(c => /^\d{8,14}$/.test(c)).map(c => `"${c}"`).join(" ");
	const consulta = `SELECT ?imagem WHERE { VALUES ?gtin { ${variantes} } ?item wdt:P3962 ?gtin ; wdt:P18 ?imagem . } LIMIT 1`;
	consultas.push(buscarJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(consulta)}`, sinal, "application/sparql-results+json")
		.then(d => {
			const bruto = d?.results?.bindings?.[0]?.imagem?.value || "";
			const src = urlSegura(bruto.replace(/^http:\/\//, "https://"));
			if (src) achadas.push({ src: `${src}${src.includes("?") ? "&" : "?"}width=480`, fonte: "Wikidata", ordem: 20 });
		}));
	await Promise.all(consultas.map(contar));
	// Nada achado e alguma base não respondeu: pode existir — não conta como "não achei"
	if (!achadas.length && falhas) throw new FalhaBusca(`${falhas} de ${total} bases não responderam`);
	return achadas.sort((a, b) => a.ordem - b.ordem).map(({ src, fonte }) => ({ src, fonte }));
}

// Tamanhos e palavras que não ajudam a achar o produto ("5kg", "1 L", "de", "tipo"…)
const TAMANHOS = /\b\d+(?:[.,]\d+)?\s*(?:kg|kgs|g|gr|grs|gramas?|mg|ml|l|lt|lts|litros?|un|und|unid|unidades?|cx|pct|pc|pcs|x)\b/g;
const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "com", "sem", "para", "a", "o", "as", "os", "em", "no", "na", "tipo", "un", "und", "c", "s"]);
const singular = p => (p.length > 4 && /[^s]s$/.test(p) ? p.slice(0, -1) : p);

/** Palavras que identificam o produto (sem tamanho, sem acento, no singular). */
export function termosNome(nome) {
	return normalizarNome(String(nome || "").toLowerCase().replace(TAMANHOS, " "))
		.split(" ")
		.filter(p => p.length > 1 && !PALAVRAS_VAZIAS.has(p) && !/^\d+$/.test(p))
		.map(singular);
}

/** Semelhança (0–1) entre dois nomes: palavras em comum (ignorando tamanho, acento e plural). */
export function semelhancaNomes(a, b) {
	const pa = new Set(termosNome(a)), pb = new Set(termosNome(b));
	if (!pa.size || !pb.size) return 0;
	let comuns = 0;
	for (const p of pa) if (pb.has(p)) comuns++;
	// Com 2+ palavras de cada lado, uma palavra só em comum ("integral") não basta
	if (comuns < 2 && Math.min(pa.size, pb.size) >= 2) return Math.min(0.5, comuns / Math.min(pa.size, pb.size));
	return comuns / Math.min(pa.size, pb.size);
}

/** A foto achada pelo nome é confiável o bastante para usar sozinha? */
export const NOME_CONFIAVEL = 0.67;

/**
 * Fotos de produtos com nome parecido, da mais parecida para a menos.
 * Busca no Cosmos (se configurado), no Open Food Facts do Brasil e no mundial.
 * @param {{ sinal?: AbortSignal, limite?: number, rapido?: boolean }} opcoes rapido: para a busca
 *   automática — para assim que achar um nome confiável
 * @returns {Promise<{ src: string, fonte: string, nome: string, semelhanca: number }[]>}
 */
export async function fotosPorNome(nome, { sinal, limite = 8, rapido = false } = {}) {
	const termos = termosNome(nome);
	if (!termos.length || termos.join("").length < 3) return [];
	const consulta = encodeURIComponent(termos.join(" "));
	const lista = [];
	const vistas = new Set();
	let falhas = 0, tentativas = 0;
	const juntar = (src, fonte, nomeProduto) => {
		src = urlSegura(src);
		if (!src || vistas.has(src) || !nomeProduto) return;
		vistas.add(src);
		lista.push({ src, fonte, nome: nomeProduto, semelhanca: semelhancaNomes(nome, nomeProduto) });
	};
	const bastou = () => rapido && lista.some(f => f.semelhanca >= NOME_CONFIAVEL);
	const etapas = [];
	if (intermediario("busca")) {
		etapas.push(async () => {
			const d = await buscarIntermediario("busca", `/?q=${consulta}`, sinal);
			for (const p of Array.isArray(d?.products) ? d.products : []) {
				juntar(p?.thumbnail, "Cosmos (Bluesoft)", [p?.description, p?.brand?.name].filter(Boolean).join(" "));
			}
		});
	}
	const buscarOff = (base, extra) => async () => {
		await aguardarVezBuscaTexto(sinal);
		const d = await buscarJson(`${base}/cgi/search.pl?search_terms=${consulta}&search_simple=1&action=process&json=1&page_size=${Math.max(10, limite * 2)}&fields=code,${CAMPOS_IMAGEM}&lc=pt${extra}`, sinal);
		for (const p of Array.isArray(d?.products) ? d.products : []) {
			juntar(imagemOff(p), "Open Food Facts", [p?.product_name_pt || p?.product_name, String(p?.brands || "").split(",")[0]].filter(Boolean).join(" "));
		}
	};
	// Automática: primeiro os produtos vendidos no Brasil, depois a base mundial (muitos produtos
	// brasileiros não têm o país marcado). Manual: só a mundial (inclui a do Brasil e responde mais rápido).
	if (rapido) etapas.push(buscarOff("https://br.openfoodfacts.org", "&cc=br"));
	etapas.push(buscarOff("https://world.openfoodfacts.org", ""));
	for (const etapa of etapas) {
		if (bastou()) break;
		tentativas++;
		try { await etapa(); } catch (e) { if (sinal?.aborted) throw e; falhas++; }
	}
	if (!lista.length && falhas && falhas === tentativas) throw new FalhaBusca("busca por nome indisponível");
	return lista.sort((a, b) => b.semelhanca - a.semelhanca).slice(0, limite);
}

/**
 * Busca automática: primeiro pelo nome informado (só aceita nome bem parecido);
 * sem resultado, pelo código de barras.
 * @returns {Promise<{ src: string, origem: "codigo" | "nome", fonte: string } | null>}
 */
export async function buscarFotoAutomatica(item, { sinal } = {}) {
	let falhou = null;
	if (item?.nome) {
		try {
			const porNome = await fotosPorNome(item.nome, { sinal, limite: 4, rapido: true });
			const melhor = porNome[0];
			if (melhor && melhor.semelhanca >= NOME_CONFIAVEL) return { src: melhor.src, fonte: melhor.fonte, origem: "nome" };
		} catch (e) {
			if (sinal?.aborted) throw e;
			falhou = e;
		}
	}
	if (item?.codigoBarras) {
		try {
			const porCodigo = await fotosPorCodigo(item.codigoBarras, { sinal });
			if (porCodigo[0]) return { ...porCodigo[0], origem: "codigo" };
		} catch (e) {
			if (sinal?.aborted) throw e;
			falhou = e;
		}
	}
	// Alguma busca falhou (rede/limite): não afirma "não existe" — tenta de novo depois
	if (falhou) throw falhou instanceof FalhaBusca ? falhou : new FalhaBusca(String(falhou?.message || falhou));
	return null;
}

/* ---------- Foto da pessoa ---------- */
/** Reduz e comprime a foto escolhida/tirada (JPEG), já na orientação certa. */
export async function prepararFotoDaPessoa(arquivo) {
	if (!arquivo || !/^image\//.test(arquivo.type || "image/")) throw new Error("Escolha uma imagem.");
	let fonte = null;
	try {
		fonte = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
	} catch {
		fonte = await new Promise((resolver, rejeitar) => {
			const url = URL.createObjectURL(arquivo);
			const img = new Image();
			img.onload = () => { URL.revokeObjectURL(url); resolver(img); };
			img.onerror = () => { URL.revokeObjectURL(url); rejeitar(new Error("Não foi possível abrir a imagem.")); };
			img.src = url;
		});
	}
	const W = fonte.width || fonte.naturalWidth, H = fonte.height || fonte.naturalHeight;
	if (!W || !H) throw new Error("Imagem vazia.");
	const escala = Math.min(1, LADO_FOTO / Math.max(W, H));
	const c = document.createElement("canvas");
	c.width = Math.max(1, Math.round(W * escala));
	c.height = Math.max(1, Math.round(H * escala));
	const ctx = c.getContext("2d");
	ctx.fillStyle = "#fff"; // PNG transparente vira fundo branco no JPEG
	ctx.fillRect(0, 0, c.width, c.height);
	ctx.drawImage(fonte, 0, 0, c.width, c.height);
	try { fonte.close?.(); } catch { /* ignora */ }
	return c.toDataURL("image/jpeg", QUALIDADE_FOTO);
}
