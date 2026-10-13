/* =========================================================
   Intermediário do Cosmos (Bluesoft) — Cloudflare Workers
   ---------------------------------------------------------
   Guarda o token do Cosmos em segredo e libera a consulta só
   para o site do app. Dois usos:
     GET /?gtin=7891000100103   → produto pelo código de barras
     (usa https://cosmos.bluesoft.com.br/api/gtins/{código} e, como reserva,
      o endereço antigo https://api.cosmos.bluesoft.com.br/gtins/{código}.json)
     GET /?q=leite integral     → produtos pelo nome
   Variáveis (Workers → Settings → Variables):
     COSMOS_TOKEN  (Secret) — token do Cosmos
     ORIGEM        (Text)   — ex.: https://rudagabriel.github.io
   Respostas ficam 7 dias no cache da Cloudflare (economiza a
   cota do Cosmos).
   ========================================================= */
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
		// Só o site do app pode usar (evita que outros gastem a sua cota)
		if (origem && origem !== origemPermitida) return json(403, { erro: "origem" });
		if (!env.COSMOS_TOKEN) return json(500, { erro: "token não configurado" });

		const url = new URL(pedido.url);
		const gtin = (url.searchParams.get("gtin") || "").replace(/\D/g, "");
		const q = (url.searchParams.get("q") || "").trim();
		// Endereço atual da API (documentação do Cosmos: /gtins/{código}) e o antigo
		// (/gtins/{código}.json), como reserva
		let caminhos;
		if (/^\d{8,14}$/.test(gtin)) caminhos = [`/gtins/${gtin}`, `/gtins/${gtin}.json`];
		else if (q.length >= 3 && q.length <= 80) caminhos = Array(2).fill(`/products?query=${encodeURIComponent(q)}`);
		else return json(400, { erro: "use ?gtin= ou ?q=" });
		const BASES = ["https://cosmos.bluesoft.com.br/api", "https://api.cosmos.bluesoft.com.br"];
		const enderecos = BASES.map((base, i) => ({ base, alvo: base + caminhos[i] }));
		const cache = caches.default;
		let resposta = null;
		for (const { alvo } of enderecos) {
			resposta = await cache.match(new Request(alvo));
			if (resposta) break;
		}
		if (!resposta) {
			const tentativas = [];
			for (const { base, alvo } of enderecos) {
				let r;
				try {
					r = await fetch(alvo, {
						headers: { "X-Cosmos-Token": env.COSMOS_TOKEN, "User-Agent": "Cosmos-API-Request", "Content-Type": "application/json", "Accept": "application/json" }
					});
				} catch (e) {
					tentativas.push({ erro: "falha de rede", base, detalhe: String(e?.message || e).slice(0, 200) });
					continue;
				}
				const tipo = r.headers.get("Content-Type") || "";
				const texto = await r.text().catch(() => "");
				if (r.ok && /json/i.test(tipo)) {
					resposta = new Response(texto, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800", "X-Cosmos-Base": base } });
					ctx.waitUntil(cache.put(new Request(alvo), resposta.clone()));
					break;
				}
				// 404 em JSON = produto não existe no Cosmos (não adianta tentar o outro endereço)
				if (r.status === 404 && /json/i.test(tipo)) return json(404, { erro: "não encontrado", base });
				// Outro erro: devolve o motivo do Cosmos e tenta o próximo endereço
				const limites = {};
				for (const [k, v] of r.headers) if (/rate|limit|retry/i.test(k)) limites[k] = v;
				tentativas.push({ erro: `cosmos ${r.status}`, base, detalhe: texto.slice(0, 400), limites, status: r.status });
			}
			if (!resposta) {
				// Mostra o que cada endereço respondeu (ajuda a descobrir token, limite ou caminho errado)
				const limite = tentativas.some(t => t.status === 429);
				return json(limite ? 429 : 502, { erro: tentativas[0]?.erro || "sem resposta", tentativas });
			}
		}
		const saida = new Response(resposta.body, resposta);
		for (const [k, v] of Object.entries(cors)) saida.headers.set(k, v);
		return saida;
	}
};
