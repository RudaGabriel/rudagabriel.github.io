/* =========================================================
   Busca de nome e foto — configuração opcional (dono do site)
   ---------------------------------------------------------
   Cosmos (Bluesoft) é a maior base de códigos de barras do
   Brasil. Para usar, crie um token gratuito em
   https://cosmos.bluesoft.com.br e publique o intermediário
   docs/proxy-cosmos.js (Cloudflare Workers, grátis) — assim o
   token fica em segredo e não aparece no site.
   Passo a passo: docs/CONFIGURACAO.md (seção "Cosmos").

   Com proxyCosmos vazio, o app usa só as bases abertas.
   ========================================================= */

export const BUSCA = {
	// Endereço do intermediário publicado, ex.: "https://cosmos.seu-nome.workers.dev"
	proxyCosmos: "https://cosmos.rudag3.workers.dev"
};
