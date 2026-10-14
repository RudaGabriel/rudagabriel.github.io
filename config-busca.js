/* =========================================================
   Busca de nome e foto — intermediário opcional (dono do site)
   ---------------------------------------------------------
   Um Worker gratuito na Cloudflare (docs/intermediario.js) que
   consulta bases brasileiras de códigos de barras guardando as
   chaves em SEGREDO (SI5 Global, Kodebar, Cosmos; OSCBR só com
   CNPJ) e, depois delas, as abertas que o navegador não acessa
   direto (catálogos públicos de lojas e UPCitemdb). Também
   repassa as fotos para o app guardar uma cópia no aparelho.
   Passo a passo: docs/CONFIGURACAO.md (seção "Intermediário").

   Vazio: o app usa só as bases abertas (Open Food Facts etc.).
   ========================================================= */

export const BUSCA = {
	// Endereço do Worker publicado
	intermediario: "https://cosmos.rudag3.workers.dev"
};
