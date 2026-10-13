/* =========================================================
   Busca de nome e foto — intermediário opcional (dono do site)
   ---------------------------------------------------------
   Um Worker gratuito na Cloudflare (docs/intermediario.js) que
   consulta bases brasileiras de códigos de barras guardando as
   chaves em SEGREDO: SI5 Global, Kodebar, OSCBR (API GTIN) e
   Cosmos. Cada base é opcional (só funciona com a chave dela).
   Passo a passo: docs/CONFIGURACAO.md (seção "Intermediário").

   Vazio: o app usa só as bases abertas (Open Food Facts etc.).
   ========================================================= */

export const BUSCA = {
	// Endereço do Worker publicado
	intermediario: "https://cosmos.rudag3.workers.dev"
};
