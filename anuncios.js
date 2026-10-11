/* =========================================================
   Anúncios — exibe um bloco responsivo do AdSense, se configurado.
   Nunca quebra o app: com bloqueador de anúncios, sem internet
   ou sem anúncio disponível, o espaço simplesmente não aparece.
   ========================================================= */
import { ANUNCIOS } from "./config-anuncios.js";

const RE_CLIENTE = /^ca-pub-\d{10,20}$/;
const RE_BLOCO = /^\d{6,20}$/;

/** O script do AdSense (no <head>) carregou e não foi bloqueado? */
const adsenseCarregado = () => Array.isArray(window.adsbygoogle) || typeof window.adsbygoogle?.push === "function";

export function iniciarAnuncios(container) {
	try {
		const cliente = String(ANUNCIOS?.cliente || "").trim();
		const bloco = String(ANUNCIOS?.blocoRodape || "").trim();
		if (!container || !RE_CLIENTE.test(cliente) || !RE_BLOCO.test(bloco)) return;

		const ins = document.createElement("ins");
		ins.className = "adsbygoogle";
		ins.style.display = "block";
		ins.dataset.adClient = cliente;
		ins.dataset.adSlot = bloco;
		ins.dataset.adFormat = "auto";
		ins.dataset.fullWidthResponsive = "true";
		container.appendChild(ins);
		container.hidden = false;

		const esconder = () => { container.hidden = true; };

		// O AdSense marca data-ad-status="unfilled" quando não há anúncio: esconde o espaço vazio
		new MutationObserver(() => {
			if (ins.dataset.adStatus === "unfilled") esconder();
		}).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });

		const empurrar = () => {
			try {
				(window.adsbygoogle = window.adsbygoogle || []).push({});
			} catch (e) {
				console.warn("[anúncios]", e);
				esconder();
			}
		};

		if (adsenseCarregado()) empurrar();
		else window.addEventListener("load", () => (adsenseCarregado() ? empurrar() : esconder()), { once: true });

		// Bloqueador de anúncios ou sem resposta: depois de um tempo, sem anúncio carregado, esconde
		setTimeout(() => {
			const carregou = ins.dataset.adStatus === "filled" || ins.querySelector("iframe");
			if (!carregou) esconder();
		}, 8000);
	} catch (e) {
		console.warn("[anúncios]", e);
	}
}
