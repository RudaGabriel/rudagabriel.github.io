/* =========================================================
   Intermediário de produtos — Cloudflare Workers (grátis)
   ---------------------------------------------------------
   Consulta bases de códigos de barras guardando as chaves em
   SEGREDO (elas nunca aparecem no site) e só atende o site do app.

   Ordem: primeiro as bases com chave e limite diário (cada uma só
   é usada se a chave estiver em Settings → Variables and Secrets),
   depois as abertas, sem chave:

     SI5_TOKEN       (Secret) SI5 Global — 100 consultas/dia grátis
     KODEBAR_KEY     (Secret) Kodebar — 50 consultas/dia grátis
     OSCBR_USUARIO   (Secret) OSCBR API GTIN — só pessoa jurídica (CNPJ);
     OSCBR_SENHA     (Secret)   sem as chaves fica desligada
     COSMOS_TOKEN    (Secret) Cosmos (Bluesoft) — exige franquia
     ORIGEM          (Text)   ex.: https://rudagabriel.github.io

     Abertas: catálogos públicos de lojas (plataforma VTEX: Cobasi,
     Carrefour, drogarias…) e UPCitemdb (base internacional).

   Endereços:
     GET /produto?gtin=7891000100103
         → { gtin, nome, marca, foto, fonte, fonteFoto, fontes } (formato único)
     GET /busca?q=arroz tio joao
         → { produtos: [{ nome, marca, foto, fonte }] } (lojas + Open Food Facts)
     GET /imagem?url=https://...
         → a imagem com permissão para o app guardar uma cópia no aparelho
     GET /foto?gtin=...&fonte=oscbr
         → a foto (para bases que exigem a chave até na imagem)
     GET /?gtin=...  e  GET /?q=texto
         → Cosmos direto (compatibilidade)
     GET /status
         → quais bases estão configuradas (sem mostrar chaves)
     GET /lojas?gtin=...
         → diagnóstico: o que cada loja respondeu

   Respostas ficam no cache da Cloudflare (7 dias; "não achei",
   1 dia). Base que estourar a cota diária fica pausada até a
   meia-noite (horário de Brasília).
   ========================================================= */

const UM_DIA = 24 * 60 * 60;
const CACHE_ACHADO = 7 * UM_DIA;
const CACHE_NAO_ACHADO = UM_DIA;

// Segundos até a próxima meia-noite em Brasília (UTC-3)
function ateMeiaNoiteBrasilia() {
	const agora = Date.now();
	const brasilia = new Date(agora - 3 * 3600 * 1000);
	const proxima = Date.UTC(brasilia.getUTCFullYear(), brasilia.getUTCMonth(), brasilia.getUTCDate() + 1) + 3 * 3600 * 1000;
	return Math.max(60, Math.round((proxima - agora) / 1000));
}

const limpar = t => String(t ?? "").replace(/\s+/g, " ").trim();
const urlHttps = u => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : "");

// Memória de reserva (vale enquanto o Worker estiver "quente"), além do cache da Cloudflare
const memoria = new Map();

async function lerCache(chave) {
	const m = memoria.get(chave);
	if (m && m.ate > Date.now()) return new Response(m.corpo, { status: m.status, headers: m.cabecalhos });
	memoria.delete(chave);
	try {
		return await caches.default.match(new Request(`https://cache.intermediario/${chave}`));
	} catch {
		return undefined;
	}
}
async function gravarCache(ctx, chave, resposta, segundos) {
	const corpo = await resposta.arrayBuffer();
	const cabecalhos = Object.fromEntries(resposta.headers);
	// Memória do Worker é pequena (128 MB): só guarda respostas leves (JSON); imagens ficam só no cache da Cloudflare
	if (corpo.byteLength <= 64 * 1024) {
		if (memoria.size > 500) memoria.clear();
		memoria.set(chave, { corpo, status: resposta.status, cabecalhos, ate: Date.now() + segundos * 1000 });
	}
	const r = new Response(corpo, { status: resposta.status, headers: { ...cabecalhos, "Cache-Control": `public, max-age=${segundos}` } });
	try { ctx.waitUntil(caches.default.put(new Request(`https://cache.intermediario/${chave}`), r)); } catch { /* sem cache */ }
}
async function pausada(fonte) {
	return !!(await lerCache(`pausa/${fonte}`));
}
function pausar(ctx, fonte) {
	return gravarCache(ctx, `pausa/${fonte}`, new Response("1"), ateMeiaNoiteBrasilia());
}

/** Busca JSON com tempo limite; devolve { status, dados }. */
async function buscar(url, cabecalhos, limiteMs = 8000) {
	const controle = new AbortController();
	const tempo = setTimeout(() => controle.abort(), limiteMs);
	try {
		const r = await fetch(url, { headers: { Accept: "application/json", ...cabecalhos }, signal: controle.signal });
		const texto = await r.text().catch(() => "");
		let dados = null;
		try { dados = JSON.parse(texto); } catch { /* não é JSON */ }
		return { status: r.status, dados, texto: texto.slice(0, 300) };
	} catch (e) {
		return { status: 0, dados: null, texto: String(e?.message || e).slice(0, 200) };
	} finally {
		clearTimeout(tempo);
	}
}

/* ---------- Bases ---------- */
const BASES = [
	{
		id: "si5", nome: "SI5 Global",
		ativa: env => !!env.SI5_TOKEN,
		async consultar(gtin, env) {
			const r = await buscar(`https://global.si5.com.br/api/produtos/${gtin}`, { Authorization: `Bearer ${env.SI5_TOKEN}` });
			const p = r.dados && (r.dados.produto !== undefined ? r.dados : r.dados.data || r.dados);
			return { status: r.status, nome: limpar(p?.produto || p?.nome), marca: limpar(p?.marca), foto: urlHttps(p?.imagem_url), texto: r.texto };
		}
	},
	{
		id: "kodebar", nome: "Kodebar",
		ativa: env => !!env.KODEBAR_KEY,
		async consultar(gtin, env) {
			const r = await buscar(`https://kodebar.korvensistemas.com.br/gtin/lookup?gtin=${gtin}`, { "X-API-Key": env.KODEBAR_KEY });
			const p = r.dados?.produto || r.dados?.data || r.dados;
			return { status: r.status, nome: limpar(p?.nome || p?.name), marca: limpar(p?.marca || p?.brand), foto: urlHttps(p?.thumbnail || p?.imagem || p?.image), texto: r.texto };
		}
	},
	{
		id: "oscbr", nome: "OSCBR (API GTIN)",
		ativa: env => !!(env.OSCBR_USUARIO && env.OSCBR_SENHA),
		async consultar(gtin, env, ctx, origemPedido) {
			const token = await tokenOscbr(env, ctx);
			if (!token) return { status: 401, texto: "não foi possível obter o token da OSCBR (usuário/senha?)" };
			const r = await buscar(`https://gtin.rscsistemas.com.br/api/gtin/infor/${gtin}`, { Authorization: `Bearer ${token}` });
			const p = r.dados;
			// A foto da OSCBR também exige o token: o app pega pelo próprio intermediário
			const foto = p?.link_foto ? `${origemPedido}/foto?gtin=${gtin}&fonte=oscbr` : "";
			return { status: r.status, nome: limpar(p?.nome), marca: limpar(p?.marca), foto, texto: r.texto };
		}
	},
	{
		id: "cosmos", nome: "Cosmos (Bluesoft)",
		ativa: env => !!env.COSMOS_TOKEN,
		async consultar(gtin, env) {
			const cab = { "X-Cosmos-Token": env.COSMOS_TOKEN, "User-Agent": "Cosmos-API-Request", "Content-Type": "application/json" };
			let r = await buscar(`https://cosmos.bluesoft.com.br/api/gtins/${gtin}.json`, cab);
			if (r.status !== 200 && r.status !== 404 && r.status !== 429) r = await buscar(`https://api.cosmos.bluesoft.com.br/gtins/${gtin}.json`, cab);
			const p = r.dados;
			return { status: r.status, nome: limpar(p?.description), marca: limpar(p?.brand?.name), foto: urlHttps(p?.thumbnail), texto: r.texto };
		}
	},
	// ----- Abertas (sem chave): só depois das bases acima -----
	{
		id: "lojas", nome: "Lojas (catálogo público)",
		ativa: () => true,
		async consultar(gtin) {
			const respostas = await consultarLojas(`?fq=alternateIds_Ean:${gtin}`, gtin);
			// Prefere a ordem da lista; nome de uma loja, foto da primeira que tiver
			const achados = respostas.flatMap(r => r.produtos);
			const comNome = achados.find(a => a.nome);
			if (!comNome) return { status: respostas.some(r => r.respondeu) ? 404 : 0, texto: "nenhuma loja tem este código" };
			const comFoto = achados.find(a => a.foto);
			return { status: 200, nome: comNome.nome, marca: comNome.marca, foto: comFoto?.foto || "", nomeFonte: comNome.fonte, nomeFonteFoto: comFoto?.fonte };
		}
	},
	{
		id: "upcitemdb", nome: "UPCitemdb",
		ativa: () => true,
		async consultar(gtin) {
			const r = await buscar(`https://api.upcitemdb.com/prod/trial/lookup?upc=${gtin}`, CABECALHO_LOJA);
			const item = Array.isArray(r.dados?.items) ? r.dados.items[0] : null;
			if (r.status === 200 && !item) return { status: 404 };
			const foto = (Array.isArray(item?.images) ? item.images : []).map(urlHttps).find(Boolean) || "";
			return { status: r.status, nome: limpar(item?.title), marca: limpar(item?.brand), foto, texto: r.texto };
		}
	},
	{
		id: "cosmos-site", nome: "Cosmos (página pública)",
		ativa: () => true,
		async consultar(gtin) {
			// A página do produto no site do Cosmos (não usa a cota da API)
			const r = await buscarPagina(`https://cosmos.bluesoft.com.br/produtos/${gtin}`);
			if (!r.html) return { status: r.status || 0 };
			const p = dadosDaPagina(r.html, gtin);
			if (!p.nome || /n[ãa]o encontrad|p[áa]gina n[ãa]o/i.test(p.nome)) return { status: 404 };
			return { status: 200, nome: limparTituloProduto(p.nome, gtin), marca: p.marca, foto: p.foto };
		}
	},
	{
		id: "web", nome: "Pesquisa na web",
		ativa: () => true,
		async consultar(gtin) {
			const achado = await pesquisarNaWeb(gtin);
			// Buscador fora do ar/bloqueado: não é "não encontrado" (não grava no cache)
			if (!achado) return { status: 0 };
			if (achado.vazio) return { status: 404 };
			return { status: 200, nome: achado.nome, marca: achado.marca || "", foto: achado.foto || "", nomeFonte: achado.fonte, nomeFonteFoto: achado.fonteFoto || achado.fonte };
		}
	}
];

/* ---------- Pesquisa na web (automática, sem a pessoa abrir o Google) ----------
   1) Bing (formato RSS) e, de reserva, DuckDuckGo: títulos e endereços dos resultados
      para o código de barras entre aspas.
   2) Abre as primeiras páginas de loja e lê os dados do produto (JSON-LD/og:image).
      Nome e foto confirmados só quando a página traz o MESMO código de barras.
   3) Sem confirmação, usa o nome que mais se repete nos títulos (consenso de 2+ sites). */
const SITES_IGNORADOS = /(google\.|bing\.|duckduckgo\.|youtube\.|scribd\.|slideshare\.|issuu\.|facebook\.|instagram\.|twitter\.|x\.com|tiktok\.|pinterest\.|wikipedia\.|reclameaqui\.|\.pdf($|\?))/i;
const PALAVRAS_LOJA = /\b(compre|comprar|oferta|ofertas|promo[cç][aã]o|pre[cç]o|menor pre[cç]o|frete gr[aá]tis|em at[eé]|parcelado|loja|site oficial|entrega|delivery|cupom)\b/i;

function decodificarHtml(t) {
	return String(t || "")
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
		.replace(/\s+/g, " ").trim();
}

/** "Leite Condensado Moça 395g | Nestlé - Carrefour" → "Leite Condensado Moça 395g" */
function limparTituloProduto(titulo, gtin) {
	let t = decodificarHtml(titulo);
	const semZeros = String(gtin || "").replace(/\D/g, "").replace(/^0+/, "");
	if (semZeros) t = t.replace(new RegExp(`\\b0*${semZeros}\\b`, "g"), " ");
	const partes = t.split(/\s+[|–—]\s+|\s+-\s+|\s+::\s+/).map(p => p.trim()).filter(Boolean);
	// Fica com o primeiro trecho que parece nome de produto (2+ palavras, sem jargão de loja)
	const bom = partes.find(p => p.split(/\s+/).length >= 2 && !PALAVRAS_LOJA.test(p) && !/^(ean|gtin|c[oó]digo)/i.test(p)) || partes[0] || "";
	return limpar(bom.replace(/^(ean|gtin|c[oó]digo( de barras)?)\s*[:\-]?\s*/i, "").replace(/[\s,;:–—-]+$/, "")).slice(0, 120);
}

/** Lê nome, marca, foto e códigos de uma página de produto (JSON-LD "Product", senão Open Graph). */
function dadosDaPagina(html, gtin) {
	const saida = { nome: "", marca: "", foto: "", gtins: [], confirmado: false };
	const blocos = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
	const produtos = [];
	const visitar = n => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach(visitar);
		const tipo = [].concat(n["@type"] || []).join(",");
		if (/Product/i.test(tipo)) produtos.push(n);
		if (n["@graph"]) visitar(n["@graph"]);
		if (n.mainEntity) visitar(n.mainEntity);
		if (n.itemListElement) visitar(n.itemListElement);
		if (n.item) visitar(n.item);
	};
	for (const b of blocos) { try { visitar(JSON.parse(b.trim())); } catch { /* JSON inválido: ignora */ } }
	const codigosDe = p => [p.gtin13, p.gtin14, p.gtin12, p.gtin8, p.gtin, p.sku, p.mpn, ...[].concat(p.offers || []).map(o => o?.gtin13 || o?.gtin)].map(x => String(x || "").replace(/\D/g, "")).filter(Boolean);
	const certo = produtos.find(p => codigosDe(p).some(c => mesmoGtin(c, gtin))) || (produtos.length === 1 ? produtos[0] : null);
	if (certo) {
		saida.nome = limpar(decodificarHtml(certo.name));
		const marca = certo.brand;
		saida.marca = limpar(decodificarHtml(typeof marca === "string" ? marca : marca?.name));
		const img = [].concat(certo.image || []).map(i => (typeof i === "string" ? i : i?.url || i?.contentUrl)).find(Boolean);
		saida.foto = urlHttps(String(img || "").replace(/^\/\//, "https://").replace(/^http:\/\//i, "https://"));
		saida.gtins = codigosDe(certo);
		saida.confirmado = saida.gtins.some(c => mesmoGtin(c, gtin));
	}
	const meta = nome => {
		const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]*content=["']([^"']+)["']`, "i"))
			|| html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${nome}["']`, "i"));
		return m ? decodificarHtml(m[1]) : "";
	};
	if (!saida.nome) saida.nome = meta("og:title") || decodificarHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
	if (!saida.foto) saida.foto = urlHttps(meta("og:image").replace(/^\/\//, "https://").replace(/^http:\/\//i, "https://"));
	// Sem JSON-LD com o código: confirma se a própria página mostra o código de barras
	if (!saida.confirmado && gtin) saida.confirmado = new RegExp(`\\b0*${String(gtin).replace(/^0+/, "")}\\b`).test(html.replace(/<script[\s\S]*?<\/script>/gi, " "));
	return saida;
}

const CABECALHO_NAVEGADOR = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
	"Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

/** Baixa uma página (HTML/XML) com tempo limite e tamanho máximo. */
async function buscarPagina(url, limiteMs = 7000) {
	const controle = new AbortController();
	const tempo = setTimeout(() => controle.abort(), limiteMs);
	try {
		const r = await fetch(url, { headers: CABECALHO_NAVEGADOR, signal: controle.signal, redirect: "follow" });
		if (!r.ok) return { status: r.status, html: "" };
		const tipo = r.headers.get("Content-Type") || "";
		if (!/html|xml|text/i.test(tipo)) return { status: 415, html: "" };
		const html = (await r.text()).slice(0, 1500000);
		return { status: r.status, html };
	} catch {
		return { status: 0, html: "" };
	} finally {
		clearTimeout(tempo);
	}
}

/** Resultados de busca: [{ titulo, link }] (Bing RSS; reserva: DuckDuckGo HTML). */
async function resultadosDaWeb(consulta) {
	const q = encodeURIComponent(consulta);
	const lista = [];
	let respondeu = false;
	const r = await buscarPagina(`https://www.bing.com/search?format=rss&setlang=pt-BR&cc=BR&q=${q}`);
	if (r.html) respondeu = true;
	for (const m of r.html.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
		const titulo = decodificarHtml((m[1].match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
		const link = decodificarHtml((m[1].match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
		if (titulo && /^https?:/i.test(link)) lista.push({ titulo, link });
	}
	if (lista.length < 3) {
		const d = await buscarPagina(`https://html.duckduckgo.com/html/?q=${q}&kl=br-pt`);
		if (d.html) respondeu = true;
		for (const m of d.html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
			let link = decodificarHtml(m[1]);
			const destino = link.match(/[?&]uddg=([^&]+)/);
			if (destino) link = decodeURIComponent(destino[1]);
			if (link.startsWith("//")) link = "https:" + link;
			const titulo = decodificarHtml(m[2]);
			if (titulo && /^https?:/i.test(link) && !lista.some(x => x.link === link)) lista.push({ titulo, link });
		}
	}
	return { respondeu, lista: lista.filter(x => !SITES_IGNORADOS.test(x.link)).slice(0, 10) };
}

/** Lê os itens de imagem do Bing (atributo m="{...}" com murl/t/purl). */
function lerImagensBing(html) {
	const lista = [];
	for (const m of String(html || "").matchAll(/\sm="(\{[^"]*\})"/g)) {
		try {
			const d = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
			const foto = urlHttps(String(d.murl || "").replace(/^http:\/\//i, "https://"));
			const titulo = decodificarHtml(String(d.t || "").replace(/[\ue000-\ue001]/g, ""));
			if (foto && titulo && !SITES_IGNORADOS.test(d.purl || "")) lista.push({ titulo, foto, pagina: String(d.purl || ""), fonte: "Bing Imagens" });
		} catch { /* item com JSON quebrado: ignora */ }
		if (lista.length >= 30) break;
	}
	return lista;
}

/** Imagens do DuckDuckGo (precisa do "vqd" da página de busca). */
async function imagensDuckDuckGo(consulta) {
	const q = encodeURIComponent(consulta);
	const pagina = await buscarPagina(`https://duckduckgo.com/?q=${q}&iax=images&ia=images&kl=br-pt`);
	const vqd = (pagina.html.match(/vqd=["']?([0-9a-z_-]+)["']?/i) || [])[1];
	if (!vqd) return { respondeu: false, lista: [] };
	const r = await buscar(`https://duckduckgo.com/i.js?l=br-pt&o=json&q=${q}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1`, { ...CABECALHO_NAVEGADOR, Accept: "application/json", Referer: "https://duckduckgo.com/" }, 7000);
	const resultados = Array.isArray(r.dados?.results) ? r.dados.results : [];
	const lista = resultados.slice(0, 30).map(x => ({
		titulo: decodificarHtml(x?.title || ""),
		foto: urlHttps(String(x?.image || "").replace(/^http:\/\//i, "https://")),
		pagina: String(x?.url || ""),
		fonte: "DuckDuckGo Imagens"
	})).filter(x => x.titulo && x.foto && !SITES_IGNORADOS.test(x.pagina));
	return { respondeu: r.status === 200, lista };
}

/** Fotos pelo nome em buscadores de imagem: Bing (rápido e completo); vazio → DuckDuckGo. */
async function imagensDaWeb(consulta) {
	const q = encodeURIComponent(consulta);
	let r = await buscarPagina(`https://www.bing.com/images/async?q=${q}&first=0&count=35&mmasync=1&setlang=pt-BR&cc=BR`);
	let lista = lerImagensBing(r.html);
	let respondeu = !!r.html;
	if (!lista.length) {
		const d = await imagensDuckDuckGo(consulta);
		lista = d.lista;
		respondeu = respondeu || d.respondeu;
	}
	return { respondeu, lista };
}

const palavrasDe = t => limpar(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(p => p.length > 2 && !/^\d+$/.test(p));

async function pesquisarNaWeb(gtin) {
	const { respondeu, lista: resultados } = await resultadosDaWeb(`"${gtin}"`);
	if (!respondeu) return null;
	if (!resultados.length) return { vazio: true };
	// Abre as 3 primeiras páginas e procura uma que confirme o código de barras
	const paginas = await Promise.all(resultados.slice(0, 3).map(async r => {
		const p = await buscarPagina(r.link, 6000);
		return p.html ? { ...dadosDaPagina(p.html, gtin), site: new URL(r.link).hostname.replace(/^www\./, "") } : null;
	}));
	const confirmada = paginas.find(p => p?.confirmado && p.nome);
	if (confirmada) {
		const fotoConfirmada = paginas.find(p => p?.confirmado && p.foto);
		return { nome: limparTituloProduto(confirmada.nome, gtin), marca: confirmada.marca, foto: fotoConfirmada?.foto || "", fonte: `Pesquisa na web (${confirmada.site})`, fonteFoto: fotoConfirmada ? `Pesquisa na web (${fotoConfirmada.site})` : "" };
	}
	// Consenso dos títulos: o nome cujas palavras mais aparecem nos outros resultados
	const titulos = resultados.map(r => limparTituloProduto(r.titulo, gtin)).filter(t => palavrasDe(t).length >= 2);
	let melhor = null;
	titulos.forEach((t, i) => {
		const pt = new Set(palavrasDe(t));
		// Títulos iguais de sites diferentes também contam como apoio
		const apoio = titulos.filter((o, j) => j !== i && palavrasDe(o).filter(p => pt.has(p)).length >= 2).length;
		if (apoio >= 1 && (!melhor || apoio > melhor.apoio || (apoio === melhor.apoio && t.length < melhor.nome.length))) melhor = { nome: t, apoio };

	});
	if (!melhor) return { vazio: true };
	return { nome: melhor.nome, marca: "", foto: "", fonte: "Pesquisa na web" };
}

/* ---------- Lojas com catálogo público (VTEX) ----------
   Lojas na plataforma VTEX publicam o catálogo em
   /api/catalog_system/pub/products/search (sem chave). A resposta só é
   aceita se o EAN do item for exatamente o pedido: uma loja que ignorar
   o filtro não consegue empurrar um produto errado. */
const LOJAS_VTEX = [
	{ nome: "Carrefour Mercado", host: "mercado.carrefour.com.br" },
	{ nome: "Cobasi", host: "www.cobasi.com.br" },
	{ nome: "Petz", host: "www.petz.com.br" },
	{ nome: "Drogaria São Paulo", host: "www.drogariasaopaulo.com.br" },
	{ nome: "Drogarias Pacheco", host: "www.drogariaspacheco.com.br" },
	{ nome: "Pague Menos", host: "www.paguemenos.com.br" },
	{ nome: "Época Cosméticos", host: "www.epocacosmeticos.com.br" },
	{ nome: "Zona Sul", host: "www.zonasul.com.br" },
	{ nome: "Sonda", host: "www.sondadelivery.com.br" },
	{ nome: "Super Nosso", host: "www.supernosso.com" },
	{ nome: "Atacadão", host: "www.atacadao.com.br" },
	{ nome: "Drogaria Araujo", host: "www.araujo.com.br" },
	{ nome: "Ultrafarma", host: "www.ultrafarma.com.br" },
	{ nome: "Drogaria Venancio", host: "www.drogariavenancio.com.br" },
	{ nome: "Mambo", host: "www.mambo.com.br" },
	{ nome: "Hirota", host: "www.hirotaemcasa.com.br" }
];
const CABECALHO_LOJA = { "User-Agent": "Mozilla/5.0 (compatible; ControleDeVencimento/1.0; +https://rudagabriel.github.io)" };
const mesmoGtin = (a, b) => {
	const x = String(a || "").replace(/\D/g, "").replace(/^0+/, "");
	return !!x && x === String(b || "").replace(/\D/g, "").replace(/^0+/, "");
};
/** Imagem da VTEX em tamanho menor (480 px): /arquivos/ids/123/ → /arquivos/ids/123-480-480/ */
const imagemVtex = u => urlHttps(String(u || "").replace(/^http:\/\//i, "https://").replace(/(\/arquivos\/ids\/\d+)\//, "$1-480-480/"));

/** Lê a lista de produtos da VTEX; com gtin, só aceita o item com aquele EAN. */
function lerVtex(lista, gtin, loja) {
	const saida = [];
	for (const p of Array.isArray(lista) ? lista : []) {
		for (const item of Array.isArray(p?.items) ? p.items : []) {
			if (gtin && !mesmoGtin(item?.ean, gtin)) continue;
			const nome = limpar(p?.productName || item?.nameComplete || item?.name);
			if (!nome) continue;
			const imagem = Array.isArray(item?.images) ? item.images[0]?.imageUrl : "";
			saida.push({ nome, marca: limpar(p?.brand), foto: imagemVtex(imagem), fonte: loja.nome });
			break; // um item por produto basta
		}
	}
	return saida;
}

async function consultarLojas(caminho, gtin, limiteMs = 6000) {
	const respostas = await Promise.all(LOJAS_VTEX.map(async loja => {
		const r = await buscar(`https://${loja.host}/api/catalog_system/pub/products/search${caminho}`, CABECALHO_LOJA, limiteMs);
		const respondeu = (r.status === 200 || r.status === 206) && Array.isArray(r.dados);
		return { loja: loja.nome, status: r.status, respondeu, produtos: respondeu ? lerVtex(r.dados, gtin, loja) : [] };
	}));
	return respostas;
}

async function tokenOscbr(env, ctx) {
	const guardado = await lerCache("token/oscbr");
	if (guardado) return (await guardado.text()) || "";
	const basico = btoa(`${env.OSCBR_USUARIO}:${env.OSCBR_SENHA}`);
	try {
		const r = await fetch("https://gtin.rscsistemas.com.br/oauth/token", { method: "POST", headers: { Authorization: `Basic ${basico}`, Accept: "application/json" } });
		if (!r.ok) return "";
		const { token } = await r.json();
		if (!token) return "";
		await gravarCache(ctx, "token/oscbr", new Response(token), 50 * 60); // vale 1 h; renova antes
		return token;
	} catch {
		return "";
	}
}

/* ---------- Rotas ---------- */
async function rotaProduto(gtin, env, ctx, origemPedido, json) {
	const emCache = await lerCache(`produto/${gtin}`);
	if (emCache) return json(emCache.status, await emCache.json());
	const resultado = { gtin, nome: "", marca: "", foto: "", fonte: "", fonteFoto: "", fontes: [] };
	const tentativas = [];
	let algumaRespondeu = false;
	for (const base of BASES) {
		if (!base.ativa(env)) continue;
		if (await pausada(base.id)) { tentativas.push({ fonte: base.id, status: "pausada até meia-noite" }); continue; }
		const r = await base.consultar(gtin, env, ctx, origemPedido);
		tentativas.push({ fonte: base.id, status: r.status });
		if (r.status === 429) { await pausar(ctx, base.id); continue; }
		if (r.status === 200 || r.status === 404 || r.status === 204) algumaRespondeu = true;
		if (r.status !== 200) continue;
		if (!resultado.nome && r.nome) { resultado.nome = r.nome; resultado.marca = r.marca; resultado.fonte = r.nomeFonte || base.nome; }
		if (!resultado.foto && r.foto) { resultado.foto = r.foto; resultado.fonteFoto = r.nomeFonteFoto || r.nomeFonte || base.nome; }
		if (r.nome || r.foto) resultado.fontes.push(r.nomeFonte || base.nome);
		if (resultado.nome && resultado.foto) break; // já tem tudo: não gasta cota das outras
	}
	if (resultado.nome || resultado.foto) {
		await gravarCache(ctx, `produto/${gtin}`, new Response(JSON.stringify(resultado), { status: 200, headers: { "Content-Type": "application/json" } }), CACHE_ACHADO);
		return json(200, resultado);
	}
	if (algumaRespondeu) {
		const corpo = { erro: "não encontrado", gtin, tentativas };
		await gravarCache(ctx, `produto/${gtin}`, new Response(JSON.stringify(corpo), { status: 404, headers: { "Content-Type": "application/json" } }), CACHE_NAO_ACHADO);
		return json(404, corpo);
	}
	// Nenhuma base respondeu (cotas, rede, chaves): o app tenta de novo mais tarde
	const semCota = tentativas.length && tentativas.every(t => t.status === 429 || t.status === "pausada até meia-noite");
	return json(semCota ? 429 : 502, { erro: tentativas.length ? "bases indisponíveis" : "nenhuma base configurada", tentativas });
}

async function rotaFoto(gtin, fonte, env, ctx, cors) {
	const base = BASES.find(b => b.id === fonte);
	if (fonte !== "oscbr" || !base?.ativa(env)) return new Response("fonte", { status: 400, headers: cors });
	const chave = `foto/${fonte}/${gtin}`;
	let foto = await lerCache(chave);
	if (!foto) {
		const token = await tokenOscbr(env, ctx);
		if (!token) return new Response("token", { status: 502, headers: cors });
		const r = await fetch(`https://gtin.rscsistemas.com.br/api/gtin/img/${gtin}`, { headers: { Authorization: `Bearer ${token}` } });
		if (r.status !== 200) return new Response("sem foto", { status: 404, headers: cors });
		const bytes = await r.arrayBuffer();
		const tipo = r.headers.get("Content-Type") || "image/png";
		await gravarCache(ctx, chave, new Response(bytes, { headers: { "Content-Type": tipo } }), 30 * UM_DIA);
		foto = new Response(bytes, { headers: { "Content-Type": tipo } });
	}
	const saida = new Response(foto.body, foto);
	for (const [k, v] of Object.entries(cors)) saida.headers.set(k, v);
	saida.headers.set("Cache-Control", "public, max-age=2592000");
	return saida;
}

/** Busca por nome: lojas (VTEX) + Open Food Facts mundial. */
/* Relevância de um nome achado para o nome procurado (mesma regra do app, em fotos.js):
   a 1ª palavra (tipo do produto) precisa aparecer; abreviações valem pelo começo da palavra. */
const VAZIAS_BUSCA = new Set(["de", "da", "do", "das", "dos", "e", "com", "sem", "para", "a", "o", "as", "os", "em", "no", "na", "tipo", "un", "und", "c", "s", "produto"]);
const termosBusca = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
	.replace(/\b\d+([.,]\d+)?\s*(ml|l|lt|g|gr|kg|mg|un|und|cm|m|mm|w|v)\b/g, " ")
	.split(/[^a-z0-9]+/).filter(p => p.length > 1 && !VAZIAS_BUSCA.has(p) && !/^\d+$/.test(p))
	.map(p => (p.length > 4 && /[^s]s$/.test(p) ? p.slice(0, -1) : p));
function relevancia(procurado, achado) {
	const pa = [...new Set(termosBusca(procurado))], pb = [...new Set(termosBusca(achado))];
	if (!pa.length || !pb.length) return 0;
	const casa = t => pb.some(w => w === t || (t.length >= 3 && w.length >= 3 && (w.startsWith(t) || t.startsWith(w))));
	const comuns = pa.filter(casa).length;
	// Nome achado com 1 palavra ("Álcool 96%") não vale nota cheia para uma busca com marca
	const base = comuns / Math.min(pa.length, Math.max(pb.length, 2));
	if (!casa(pa[0])) return Math.min(0.3, base);
	if (comuns < 2 && Math.min(pa.length, pb.length) >= 2) return Math.min(0.5, base);
	return Math.min(1, base);
}
const RELEVANTE = 0.6; // com 2+ palavras procuradas, só o tipo em comum (0,5) não basta: outra marca não conta
const casaTermo = (t, w) => w === t || (t.length >= 3 && w.length >= 3 && (w.startsWith(t) || t.startsWith(w)));
const QUALIFICADORES = new Set(["sem", "com", "c", "p", "para", "porta", "anti", "contra", "livre", "de", "do", "da", "dos", "das", "s", "zero"]); // "Vinagre de Álcool" não é álcool
/** Mesmo tipo de produto: a 1ª palavra procurada aparece como o produto, não como detalhe ("Enxaguante Sem Álcool"). */
function mesmoTipo(procurado, achado) {
	const pa = termosBusca(procurado);
	if (!pa.length) return false;
	const bruto = String(achado || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
	return bruto.some((w, i) => casaTermo(pa[0], w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w) && !QUALIFICADORES.has(bruto[i - 1] || ""));
}
/** Ordem: relevância; empate → tipo logo no começo, mesmos números ("96"), nome mais curto. */
function pontuacao(procurado, achado) {
	const numeros = t => new Set(String(t || "").match(/\d+/g) || []);
	const na = numeros(procurado), nb = numeros(achado);
	let mesmos = 0;
	for (const n of na) if (nb.has(n)) mesmos++;
	const pa = termosBusca(procurado), pb = termosBusca(achado);
	const noComeco = pa.length && pb.slice(0, 2).some(w => casaTermo(pa[0], w)) ? 1 : 0;
	return relevancia(procurado, achado) + noComeco * 0.08 + Math.min(mesmos, 2) * 0.05 - Math.min(pb.length, 12) * 0.002;
}

async function rotaBusca(q, ctx, json) {
	const chave = `busca7/${q.toLowerCase()}`; // muda o número quando a regra de relevância muda (ignora o cache antigo)
	const emCache = await lerCache(chave);
	if (emCache) return json(200, await emCache.json());
	const termos = encodeURIComponent(q);
	const [lojas, off] = await Promise.all([
		consultarLojas(`?ft=${termos}&_from=0&_to=9`, "", 7000),
		buscar(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${termos}&search_simple=1&action=process&json=1&page_size=12&fields=product_name,product_name_pt,brands,image_front_url,image_url&lc=pt`, CABECALHO_LOJA, 9000)
	]);
	let produtos = lojas.flatMap(r => r.produtos.slice(0, 5));
	for (const p of Array.isArray(off.dados?.products) ? off.dados.products : []) {
		const nome = limpar(p?.product_name_pt || p?.product_name);
		const foto = urlHttps(p?.image_front_url) || urlHttps(p?.image_url);
		if (nome && foto) produtos.push({ nome, marca: limpar(String(p?.brands || "").split(",")[0]), foto, fonte: "Open Food Facts" });
	}
	// Só conta o que tem a ver com o nome (as lojas devolvem qualquer item que divida uma palavra)
	const relevantes = () => produtos.filter(x => relevancia(q, `${x.nome} ${x.marca || ""}`) >= RELEVANTE);
	let webRespondeu = false, lojas2 = [], webLinks = 0, webPaginas = 0, imagensRespondeu = false, imagensAchadas = 0, amostra = [];
	if (relevantes().length < 6) {
		// Pouca coisa que preste: ao mesmo tempo, (1) as lojas de novo só pelo tipo do produto
		// ("álcool" em vez de "álcool santa cruz 96", que as lojas confundem com "sementes santa cruz")
		// e (2) a pesquisa na web com páginas de produto
		const termos = termosBusca(q);
		const tipo = termos[0] || "";
		const porTipo = termos.length >= 2 && tipo.length >= 3
			? consultarLojas(`?ft=${encodeURIComponent(tipo)}&_from=0&_to=19`, "", 7000)
			: Promise.resolve([]);
		const porWeb = (async () => {
			const { respondeu, lista } = await resultadosDaWeb(`${q} produto`);
			// Só abre links cujo título já tem a ver com o nome (o buscador às vezes devolve qualquer coisa)
			const uteis = lista.filter(r => mesmoTipo(q, r.titulo)).slice(0, 3);
			const paginas = await Promise.all(uteis.map(async r => {
				const pg = await buscarPagina(r.link, 6000);
				return pg.html ? { ...dadosDaPagina(pg.html, ""), site: new URL(r.link).hostname.replace(/^www\./, "") } : null;
			}));
			return { respondeu, paginas, links: lista.length };
		})();
		const [r1, r2, r3] = await Promise.all([porTipo, porWeb, imagensDaWeb(q)]);
		lojas2 = r1;
		for (const x of lojas2.flatMap(r => r.produtos)) if (!produtos.some(p => p.foto === x.foto)) produtos.push(x);
		webRespondeu = r2.respondeu;
		webLinks = r2.links;
		webPaginas = r2.paginas.filter(pg => pg?.foto).length;
		imagensRespondeu = r3.respondeu;
		imagensAchadas = r3.lista.length;
		amostra = [...r3.lista.slice(0, 4).map(i => `${i.fonte}: ${i.titulo}`), ...r2.paginas.filter(Boolean).map(pg => `página: ${pg.nome || "(sem nome)"}${pg.foto ? "" : " (sem foto)"}`)];
		for (const im of r3.lista) {
			if (produtos.some(x => x.foto === im.foto)) continue;
			let site = "";
			try { site = new URL(im.pagina).hostname.replace(/^www\./, ""); } catch { /* sem página */ }
			produtos.push({ nome: limparTituloProduto(im.titulo, ""), marca: "", foto: im.foto, fonte: `${im.fonte || "Imagens da web"}${site ? ` (${site})` : ""}` });
		}
		for (const pg of r2.paginas) {
			if (pg?.foto && pg.nome && !produtos.some(x => x.foto === pg.foto)) produtos.push({ nome: limparTituloProduto(pg.nome, ""), marca: pg.marca || "", foto: pg.foto, fonte: `Pesquisa na web (${pg.site})` });
		}
	}
	const algumaRespondeu = lojas.some(r => r.respondeu) || lojas2.some(r => r.respondeu) || off.status === 200 || webRespondeu || imagensRespondeu;
	if (!algumaRespondeu) return json(502, { erro: "busca indisponível" });
	// Só o mesmo tipo de produto, do mais parecido para o menos, um por nome (várias lojas vendem o mesmo)
	const vistos = new Set();
	produtos = produtos
		.filter(x => x.foto && mesmoTipo(q, x.nome))
		.map(x => ({ x, p: pontuacao(q, `${x.nome} ${x.marca || ""}`) }))
		.sort((a, b) => b.p - a.p)
		.map(({ x }) => x)
		.filter(x => { const k = termosBusca(x.nome).join(" "); if (vistos.has(k)) return false; vistos.add(k); return true; });
	// "consultas": só para conferir de onde veio cada coisa (o app ignora)
	const corpo = {
		produtos: produtos.slice(0, 40),
		consultas: { lojas: lojas.filter(r => r.respondeu).length, lojasPeloTipo: lojas2.filter(r => r.respondeu).length, web: webRespondeu ? `${webLinks} links, ${webPaginas} páginas com foto` : "não respondeu", imagens: imagensRespondeu ? `${imagensAchadas} imagens` : "não respondeu", openFoodFacts: off.status, amostra }
	};
	await gravarCache(ctx, chave, new Response(JSON.stringify(corpo), { headers: { "Content-Type": "application/json" } }), produtos.length ? CACHE_ACHADO : CACHE_NAO_ACHADO);
	return json(200, corpo);
}

/** Repassa uma imagem com permissão (CORS) para o app guardar a cópia no aparelho. */
const MAX_IMAGEM = 5 * 1024 * 1024;
async function rotaImagem(alvo, ctx, cors) {
	if (!urlHttps(alvo) || alvo.length > 1500) return new Response("url", { status: 400, headers: cors });
	const chave = `imagem/${alvo}`;
	let resposta = await lerCache(chave);
	if (!resposta) {
		const controle = new AbortController();
		const tempo = setTimeout(() => controle.abort(), 10000);
		try {
			const r = await fetch(alvo, { headers: { ...CABECALHO_LOJA, Accept: "image/*" }, signal: controle.signal, redirect: "follow" });
			const tipo = (r.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
			if (!r.ok || !/^image\/(jpeg|png|webp|gif|avif)$/.test(tipo)) return new Response("não é imagem", { status: 404, headers: cors });
			if (Number(r.headers.get("Content-Length") || 0) > MAX_IMAGEM) return new Response("grande demais", { status: 413, headers: cors });
			const bytes = await r.arrayBuffer();
			if (bytes.byteLength > MAX_IMAGEM) return new Response("grande demais", { status: 413, headers: cors });
			await gravarCache(ctx, chave, new Response(bytes, { headers: { "Content-Type": tipo } }), 30 * UM_DIA);
			resposta = new Response(bytes, { headers: { "Content-Type": tipo } });
		} catch {
			return new Response("falhou", { status: 502, headers: cors });
		} finally {
			clearTimeout(tempo);
		}
	}
	const saida = new Response(resposta.body, resposta);
	for (const [k, v] of Object.entries(cors)) saida.headers.set(k, v);
	saida.headers.set("Cache-Control", "public, max-age=2592000");
	return saida;
}

async function rotaCosmosDireto(url, env, ctx, json) {
	if (!env.COSMOS_TOKEN) return json(404, { erro: "cosmos não configurado" });
	if (await pausada("cosmos")) return json(429, { erro: "cosmos pausado até meia-noite" });
	const gtin = (url.searchParams.get("gtin") || "").replace(/\D/g, "");
	const q = (url.searchParams.get("q") || "").trim();
	let caminho;
	if (/^\d{8,14}$/.test(gtin)) caminho = `/gtins/${gtin}.json`;
	else if (q.length >= 3 && q.length <= 80) caminho = `/products?query=${encodeURIComponent(q)}`;
	else return json(400, { erro: "use /produto?gtin=, ?gtin= ou ?q=" });
	const chave = `cosmos${caminho}`;
	const emCache = await lerCache(chave);
	if (emCache) return json(200, await emCache.json());
	const cab = { "X-Cosmos-Token": env.COSMOS_TOKEN, "User-Agent": "Cosmos-API-Request", "Content-Type": "application/json" };
	let r = await buscar(`https://cosmos.bluesoft.com.br/api${caminho}`, cab);
	if (r.status !== 200 && r.status !== 404 && r.status !== 429) r = await buscar(`https://api.cosmos.bluesoft.com.br${caminho}`, cab);
	if (r.status === 200 && r.dados) {
		await gravarCache(ctx, chave, new Response(JSON.stringify(r.dados), { headers: { "Content-Type": "application/json" } }), CACHE_ACHADO);
		return json(200, r.dados);
	}
	if (r.status === 429) await pausar(ctx, "cosmos");
	return json(r.status === 404 ? 404 : r.status === 429 ? 429 : 502, { erro: `cosmos ${r.status}`, detalhe: r.texto });
}

export default {
	async fetch(pedido, env, ctx) {
		const origemPermitida = env.ORIGEM || "https://rudagabriel.github.io";
		const origem = pedido.headers.get("Origin") || "";
		const cors = {
			"Access-Control-Allow-Origin": origemPermitida,
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Accept",
			"Vary": "Origin"
		};
		const json = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
		if (pedido.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
		if (pedido.method !== "GET") return json(405, { erro: "método" });
		// Só o site do app pode usar (evita que outros gastem as suas cotas)
		if (origem && origem !== origemPermitida) return json(403, { erro: "origem" });

		const url = new URL(pedido.url);
		const origemPedido = `${url.protocol}//${url.host}`;
		const gtin = (url.searchParams.get("gtin") || "").replace(/\D/g, "");
		try {
			if (url.pathname === "/status") {
				const bases = {};
				for (const b of BASES) bases[b.id] = !b.ativa(env) ? "sem chave" : (await pausada(b.id)) ? "pausada até meia-noite" : "ativa";
				return json(200, { bases, origem: origemPermitida });
			}
			if (url.pathname === "/produto") {
				if (!/^\d{8,14}$/.test(gtin)) return json(400, { erro: "gtin inválido" });
				return await rotaProduto(gtin, env, ctx, origemPedido, json);
			}
			if (url.pathname === "/busca") {
				const q = limpar(url.searchParams.get("q")).slice(0, 80);
				if (q.length < 3) return json(400, { erro: "texto curto" });
				return await rotaBusca(q, ctx, json);
			}
			if (url.pathname === "/imagem") return await rotaImagem(url.searchParams.get("url") || "", ctx, cors);
			if (url.pathname === "/lojas") {
				if (!/^\d{8,14}$/.test(gtin)) return json(400, { erro: "gtin inválido" });
				const respostas = await consultarLojas(`?fq=alternateIds_Ean:${gtin}`, gtin);
				return json(200, { gtin, lojas: respostas.map(r => ({ loja: r.loja, status: r.status, respondeu: r.respondeu, achou: r.produtos[0] || null })) });
			}
			if (url.pathname === "/foto") {
				if (!/^\d{8,14}$/.test(gtin)) return json(400, { erro: "gtin inválido" });
				return await rotaFoto(gtin, url.searchParams.get("fonte") || "", env, ctx, cors);
			}
			return await rotaCosmosDireto(url, env, ctx, json);
		} catch (e) {
			return json(500, { erro: "falha interna", detalhe: String(e?.message || e).slice(0, 200) });
		}
	}
};
