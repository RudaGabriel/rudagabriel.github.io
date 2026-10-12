/* =========================================================
   Intermediário do Cosmos (Bluesoft) — Cloudflare Workers
   ---------------------------------------------------------
   Guarda o token do Cosmos em segredo e libera a consulta só
   para o site do app. Dois usos:
     GET /?gtin=7891000100103   → produto pelo código de barras
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
		let alvo;
		if (/^\d{8,14}$/.test(gtin)) alvo = `https://api.cosmos.bluesoft.com.br/gtins/${gtin}.json`;
		else if (q.length >= 3 && q.length <= 80) alvo = `https://api.cosmos.bluesoft.com.br/products?query=${encodeURIComponent(q)}`;
		else return json(400, { erro: "use ?gtin= ou ?q=" });

		const cache = caches.default;
		const chave = new Request(alvo);
		let resposta = await cache.match(chave);
		if (!resposta) {
			const r = await fetch(alvo, {
				headers: { "X-Cosmos-Token": env.COSMOS_TOKEN, "User-Agent": "Cosmos-API-Request", "Content-Type": "application/json" }
			});
			if (r.status === 404) return json(404, { erro: "não encontrado" });
			if (!r.ok) return json(r.status === 429 ? 429 : 502, { erro: `cosmos ${r.status}` });
			resposta = new Response(await r.text(), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800" } });
			ctx.waitUntil(cache.put(chave, resposta.clone()));
		}
		const saida = new Response(resposta.body, resposta);
		for (const [k, v] of Object.entries(cors)) saida.headers.set(k, v);
		return saida;
	}
};
