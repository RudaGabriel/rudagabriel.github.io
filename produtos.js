/* =========================================================
   Sugestão de nome do produto pelo código de barras
   ---------------------------------------------------------
   Consulta bases públicas e gratuitas, nesta ordem:
     1. Open Food Facts (alimentos) — versão Brasil, em português
     2. Open Products Facts (outros produtos)
     3. Open Beauty Facts (higiene e cosméticos)
     4. Open Pet Food Facts (produtos para animais)
     5. UPCitemdb (base internacional)
     6. Wikidata (base livre da Wikipédia)
   Se nenhuma conhecer o código, o app oferece pesquisar na web
   (Google e Cosmos/Bluesoft) — ver linksPesquisaCodigo().
   Só o número do código de barras é enviado. Os resultados
   ficam guardados no aparelho para não consultar de novo.
   ========================================================= */

import { BUSCA } from "./config-busca.js";

const CHAVE_CACHE = "cv2:nomesCodigo";
const VERSAO_CACHE = 3; // muda quando a montagem do nome ou as fontes melhoram (ignora resultados antigos)
const MAX_CACHE = 400;
const VALIDADE_NEGATIVO_MS = 24 * 60 * 60 * 1000; // "não encontrado" vale 1 dia
const TEMPO_LIMITE_MS = 6000;
const CAMPOS_OFF = [
	"product_name_pt", "abbreviated_product_name_pt", "generic_name_pt",
	"product_name", "abbreviated_product_name", "generic_name",
	"brands", "quantity", "lang"
].join(",");

const proxyCosmos = () => String(BUSCA?.proxyCosmos || "").trim().replace(/\/+$/, "");

/** Cosmos (Bluesoft): a maior base brasileira — só com o intermediário configurado (config-busca.js). */
function lerCosmos(dados) {
	const base = limpar(dados?.description);
	if (!base) return null;
	return montarNome({ base, marca: dados?.brand?.name });
}

const FONTES_BASE = [
	{ nome: "Open Food Facts", url: c => `https://br.openfoodfacts.org/api/v2/product/${c}.json?fields=${CAMPOS_OFF}&lc=pt&cc=br`, ler: lerOff },
	{ nome: "Open Products Facts", url: c => `https://world.openproductsfacts.org/api/v2/product/${c}.json?fields=${CAMPOS_OFF}&lc=pt`, ler: lerOff },
	{ nome: "Open Beauty Facts", url: c => `https://world.openbeautyfacts.org/api/v2/product/${c}.json?fields=${CAMPOS_OFF}&lc=pt`, ler: lerOff },
	{ nome: "Open Pet Food Facts", url: c => `https://world.openpetfoodfacts.org/api/v2/product/${c}.json?fields=${CAMPOS_OFF}&lc=pt`, ler: lerOff },
	{ nome: "UPCitemdb", url: c => `https://api.upcitemdb.com/prod/trial/lookup?upc=${c}`, ler: lerUpc },
	{ nome: "Wikidata", url: urlWikidata, ler: lerWikidata, aceitar: "application/sparql-results+json" }
];
// Com o Cosmos configurado, ele é consultado primeiro (melhor cobertura de produtos brasileiros)
const fontes = () => (proxyCosmos()
	? [{ nome: "Cosmos (Bluesoft)", url: c => `${proxyCosmos()}?gtin=${c}`, ler: lerCosmos }, ...FONTES_BASE]
	: FONTES_BASE);

/** Consulta SPARQL pelo GTIN (propriedade P3962), com e sem zeros à esquerda. */
function urlWikidata(codigo) {
	const variantes = [...new Set([codigo, codigo.replace(/^0+/, ""), codigo.padStart(13, "0"), codigo.padStart(14, "0")])]
		.filter(c => /^\d{8,14}$/.test(c)).map(c => `"${c}"`).join(" ");
	const consulta = `SELECT ?itemLabel ?marcaLabel WHERE { VALUES ?gtin { ${variantes} } ?item wdt:P3962 ?gtin . `
		+ `OPTIONAL { ?item wdt:P1716 ?marca } SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". } } LIMIT 1`;
	return `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(consulta)}`;
}

function lerWikidata(dados) {
	const linha = dados?.results?.bindings?.[0];
	const base = limpar(linha?.itemLabel?.value);
	if (!base || /^Q\d+$/.test(base)) return null; // sem nome legível
	const marca = limpar(linha?.marcaLabel?.value);
	return montarNome({ base, marca: /^Q\d+$/.test(marca) ? "" : marca });
}

/**
 * Links para a pessoa pesquisar o código fora das bases públicas
 * (abrem em outra aba; nada é consultado sem ela tocar).
 */
export function linksPesquisaCodigo(codigo) {
	const c = encodeURIComponent(String(codigo || "").replace(/\D/g, ""));
	return [
		{ nome: "Pesquisar no Google", url: `https://www.google.com/search?q=${c}` },
		{ nome: "Ver no Cosmos (Bluesoft)", url: `https://cosmos.bluesoft.com.br/produtos/${c}` }
	];
}

/** Só códigos numéricos de produto (EAN-8, UPC-A, EAN-13, GTIN-14). */
export const codigoConsultavel = codigo => /^\d{8,14}$/.test(String(codigo || ""));

/* ---------- Cache no aparelho ---------- */
function lerCache() {
	try {
		const dados = JSON.parse(localStorage.getItem(CHAVE_CACHE) || "{}");
		return dados && typeof dados === "object" && !Array.isArray(dados) ? dados : {};
	} catch {
		return {};
	}
}

function gravarCache(codigo, resultado) {
	try {
		const dados = lerCache();
		dados[codigo] = { n: resultado?.nome || null, f: resultado?.fonte || null, v: VERSAO_CACHE, t: Date.now() };
		const chaves = Object.keys(dados);
		if (chaves.length > MAX_CACHE) {
			chaves.sort((a, b) => (dados[a]?.t || 0) - (dados[b]?.t || 0))
				.slice(0, chaves.length - MAX_CACHE)
				.forEach(c => delete dados[c]);
		}
		localStorage.setItem(CHAVE_CACHE, JSON.stringify(dados));
	} catch { /* armazenamento cheio ou bloqueado: só não guarda */ }
}

/* ---------- Montagem de um nome limpo ---------- */
const limpar = texto => String(texto ?? "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
const semAcento = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const contem = (a, b) => semAcento(a).includes(semAcento(b));
const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "com", "sem", "em", "para", "a", "o", "ao", "na", "no", "c/", "s/"]);
const SIGLAS = new Set(["uht", "pet", "fps", "led", "usb", "pvc", "abs", "tv", "dvd", "aaa", "aa", "xl", "xg", "gg", "pp"]);

/** "LEITE INTEGRAL PIRACANJUBA" → "Leite Integral Piracanjuba" (só se estiver quase tudo em maiúsculas). */
function capitalizar(texto) {
	const letras = texto.replace(/[^A-Za-zÀ-ÿ]/g, "");
	if (!letras || letras.replace(/[^A-ZÀ-Þ]/g, "").length / letras.length < 0.7) return texto;
	return texto.split(" ").map((original, i) => {
		// Sigla sem vogal ("SBP", "BRF") continua em maiúsculas
		if (/^[A-Z]{2,4}$/.test(original) && !/[AEIOU]/.test(original)) return original;
		const p = original.toLocaleLowerCase("pt-BR");
		if (SIGLAS.has(p)) return p.toLocaleUpperCase("pt-BR");
		if (i > 0 && MINUSCULAS.has(p)) return p;
		if (/^\d/.test(p)) return p; // "500g", "1l" ficam para a normalização de quantidade
		return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1);
	}).join(" ");
}

/** Padroniza tamanhos: "1000ml" → "1 L", "500GR" → "500 g", "2 LT" → "2 L". */
function normalizarQuantidade(texto) {
	return texto.replace(/(\d+(?:[.,]\d+)?)\s*(kg|kgs|g|gr|grs|gramas?|mg|ml|l|lt|lts|litros?|un|und|unid|unidades?)\b\.?/gi, (_, n, u) => {
		const unidade = u.toLowerCase();
		let valor = Number(n.replace(",", "."));
		if (/^(ml)$/.test(unidade) && valor >= 1000 && valor % 100 === 0) return `${String(valor / 1000).replace(".", ",")} L`;
		if (/^(g|gr|grs|gramas?)$/.test(unidade) && valor >= 1000 && valor % 100 === 0) return `${String(valor / 1000).replace(".", ",")} kg`;
		const mapa = { kg: "kg", kgs: "kg", g: "g", gr: "g", grs: "g", grama: "g", gramas: "g", mg: "mg", ml: "ml", l: "L", lt: "L", lts: "L", litro: "L", litros: "L", un: "un", und: "un", unid: "un", unidade: "un", unidades: "un" };
		return `${n} ${mapa[unidade] || unidade}`;
	});
}

/** Monta "Nome Marca Tamanho" sem repetir marca nem tamanho. */
export function montarNome({ base, marca, quantidade }) {
	let nome = normalizarQuantidade(capitalizar(limpar(base)));
	if (!nome) return null;
	marca = capitalizar(limpar(String(marca || "").split(",")[0]));
	if (marca && !contem(nome, marca)) nome = `${nome} ${marca}`;
	quantidade = normalizarQuantidade(limpar(quantidade));
	if (quantidade && quantidade.length <= 20 && !contem(nome.replace(/\s/g, ""), quantidade.replace(/\s/g, ""))) nome = `${nome} ${quantidade}`;
	return limpar(nome).slice(0, 120) || null;
}

function lerOff(dados) {
	if (!dados || !(dados.status === 1 || dados.product)) return null;
	const p = dados.product || {};
	// Prefere o nome em português; o nome "genérico" só se não houver outro
	const base = limpar(p.product_name_pt) || limpar(p.abbreviated_product_name_pt)
		|| (p.lang === "pt" ? limpar(p.product_name) : "")
		|| limpar(p.generic_name_pt) || limpar(p.product_name) || limpar(p.abbreviated_product_name) || limpar(p.generic_name);
	return montarNome({ base, marca: p.brands, quantidade: p.quantity });
}

function lerUpc(dados) {
	const item = Array.isArray(dados?.items) ? dados.items[0] : null;
	if (!item?.title) return null;
	return montarNome({ base: item.title, marca: item.brand, quantidade: item.size });
}

async function consultar(fonte, codigo, sinalExterno) {
	const controle = new AbortController();
	const cancelar = () => controle.abort();
	const tempo = setTimeout(cancelar, TEMPO_LIMITE_MS);
	sinalExterno?.addEventListener("abort", cancelar, { once: true });
	try {
		const r = await fetch(fonte.url(codigo), { signal: controle.signal, headers: { Accept: fonte.aceitar || "application/json" } });
		if (r.status === 404) return null;
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return fonte.ler(await r.json());
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
	if (guardado && guardado.v === VERSAO_CACHE) {
		if (guardado.n) return { nome: guardado.n, fonte: guardado.f || "guardado no aparelho" };
		if (Date.now() - (guardado.t || 0) < VALIDADE_NEGATIVO_MS) return null;
	}
	if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

	let algumaRespondeu = false;
	for (const fonte of fontes()) {
		if (sinal?.aborted) return null;
		try {
			const nome = await consultar(fonte, codigo, sinal);
			algumaRespondeu = true;
			if (nome) {
				const resultado = { nome, fonte: fonte.nome };
				gravarCache(codigo, resultado);
				return resultado;
			}
		} catch (e) {
			if (sinal?.aborted) return null;
			console.warn("[produtos] consulta falhou:", fonte.nome, e?.message || e);
		}
	}
	// Só guarda "não encontrado" se alguma base respondeu (falha de rede não conta)
	if (algumaRespondeu) gravarCache(codigo, null);
	return null;
}

/* =========================================================
   Nomes parecidos (quando o código exato não está em nenhuma base)
   ---------------------------------------------------------
   Os fabricantes numeram os produtos em sequência: códigos
   vizinhos (mesmo prefixo da empresa, item ±1, ±2…) costumam ser
   o mesmo produto em outra versão (sabor, tamanho, fragrância).
   Consulta esses vizinhos nas bases e devolve os nomes, do código
   mais próximo para o mais distante.
   ========================================================= */
const RAIO_VIZINHOS = 30;
const parecidosGuardados = new Map(); // só nesta sessão

/** Dígito verificador GTIN (EAN-8/12/13/14). */
function digitoVerificador(corpo) {
	let soma = 0;
	for (let i = corpo.length - 1, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(corpo[i]) * peso;
	return String((10 - (soma % 10)) % 10);
}

/** Códigos vizinhos com o mesmo prefixo (mesmo fabricante), do mais perto para o mais longe. */
export function codigosVizinhos(codigo, raio = RAIO_VIZINHOS) {
	const c = String(codigo || "");
	if (!/^\d{12,13}$/.test(c)) return [];
	const ean = c.padStart(13, "0");
	const corpo = Number(ean.slice(0, 12));
	const prefixo = ean.slice(0, 8); // nunca sai do prefixo do fabricante (7 a 9 dígitos no Brasil)
	const lista = [];
	for (let d = 1; d <= raio; d++) {
		for (const sinal of [-1, 1]) {
			const novo = String(corpo + sinal * d).padStart(12, "0");
			if (novo.length !== 12 || !novo.startsWith(prefixo)) continue;
			lista.push({ codigo: novo + digitoVerificador(novo), distancia: d });
		}
	}
	return lista;
}

async function buscarJson(url, sinal, aceitar = "application/json") {
	const controle = new AbortController();
	const cancelar = () => controle.abort();
	const tempo = setTimeout(cancelar, TEMPO_LIMITE_MS + 2000);
	sinal?.addEventListener("abort", cancelar, { once: true });
	try {
		const r = await fetch(url, { signal: controle.signal, headers: { Accept: aceitar } });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return await r.json();
	} finally {
		clearTimeout(tempo);
		sinal?.removeEventListener("abort", cancelar);
	}
}

const BASES_OFF = [
	{ nome: "Open Food Facts", url: "https://br.openfoodfacts.org", extra: "&cc=br" },
	{ nome: "Open Products Facts", url: "https://world.openproductsfacts.org", extra: "" },
	{ nome: "Open Beauty Facts", url: "https://world.openbeautyfacts.org", extra: "" },
	{ nome: "Open Pet Food Facts", url: "https://world.openpetfoodfacts.org", extra: "" }
];

/**
 * Nomes de produtos do mesmo fabricante com código parecido.
 * @returns {Promise<{ nome: string, codigo: string, fonte: string, distancia: number }[]>} do mais plausível ao menos
 */
export async function buscarNomesParecidos(codigo, { sinal, limite = 8 } = {}) {
	codigo = String(codigo || "").trim();
	if (!codigoConsultavel(codigo)) return [];
	if (parecidosGuardados.has(codigo)) return parecidosGuardados.get(codigo).slice(0, limite);
	if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
	const vizinhos = codigosVizinhos(codigo);
	const distancia = new Map(vizinhos.map(v => [v.codigo, v.distancia]));
	const achados = [];
	const consultas = [];
	if (vizinhos.length) {
		const lista = vizinhos.map(v => v.codigo).join(",");
		for (const base of BASES_OFF) {
			consultas.push(buscarJson(`${base.url}/api/v2/search?code=${lista}&fields=code,${CAMPOS_OFF}&page_size=${vizinhos.length}&lc=pt${base.extra}`, sinal)
				.then(dados => {
					for (const p of Array.isArray(dados?.products) ? dados.products : []) {
						const cod = String(p?.code || "");
						const nome = lerOff({ status: 1, product: p });
						if (nome && distancia.has(cod)) achados.push({ nome, codigo: cod, fonte: base.nome, distancia: distancia.get(cod) });
					}
				}));
		}
	}
	// Wikidata: produtos com o mesmo prefixo (fabricante), qualquer distância
	const ean = codigo.padStart(13, "0");
	if (/^\d{13}$/.test(ean)) {
		const prefixo = ean.slice(0, 8); // mesmo critério dos vizinhos (prefixo do fabricante)
		const consulta = `SELECT ?gtin ?itemLabel ?marcaLabel WHERE { ?item wdt:P3962 ?gtin . FILTER(STRSTARTS(?gtin, "${prefixo}") || STRSTARTS(?gtin, "0${prefixo}")) `
			+ `OPTIONAL { ?item wdt:P1716 ?marca } SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". } } LIMIT 40`;
		consultas.push(buscarJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(consulta)}`, sinal, "application/sparql-results+json")
			.then(dados => {
				for (const linha of dados?.results?.bindings || []) {
					const cod = String(linha?.gtin?.value || "").replace(/^0+(?=\d{13}$)/, "");
					const nome = lerWikidata({ results: { bindings: [linha] } });
					if (!nome || !/^\d{8,14}$/.test(cod) || cod === codigo) continue;
					const d = Math.abs(Number(cod.padStart(13, "0").slice(0, 12)) - Number(ean.slice(0, 12)));
					achados.push({ nome, codigo: cod, fonte: "Wikidata", distancia: d });
				}
			}));
	}
	await Promise.allSettled(consultas);
	if (sinal?.aborted) return [];
	// Um nome por produto (o do código mais próximo), do mais plausível ao menos
	const porNome = new Map();
	for (const a of achados.sort((x, y) => x.distancia - y.distancia)) {
		const chave = semAcento(a.nome);
		if (!porNome.has(chave)) porNome.set(chave, a);
	}
	const resultado = [...porNome.values()];
	parecidosGuardados.set(codigo, resultado);
	return resultado.slice(0, limite);
}

