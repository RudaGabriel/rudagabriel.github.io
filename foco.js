/* =========================================================
   Foco da câmera (leitor de código de barras e leitor de validade)
   ---------------------------------------------------------
   Opções, conforme o aparelho permitir:
   - Automático: foco contínuo (padrão).
   - De perto / De longe: foco manual (Android com Chrome).
   - Ajuste fino: régua de distância do foco (quando há foco manual).
   - Tocar na imagem: foca naquele ponto (quando suportado).
   - iPhone: o navegador não deixa controlar o foco; "De perto" troca
     para a câmera múltipla (Dupla/Tripla), que muda sozinha para a
     lente macro quando o objeto está perto.
   ========================================================= */

/** Câmera traseira "múltipla" (troca de lente sozinha, inclusive macro), se existir. */
export function cameraMultipla(cameras) {
	const traseiras = (cameras || []).filter(c => c?.deviceId && /traseira|back|rear|environment/i.test(c.label || ""));
	const nota = c => (/tripla|triple/i.test(c.label) ? 3 : /dupla.*ampla|dual wide/i.test(c.label) ? 2 : /dupla|dual/i.test(c.label) ? 1 : 0);
	return traseiras.filter(c => nota(c) > 0).sort((a, b) => nota(b) - nota(a))[0] || null;
}

/**
 * Cria o controle de foco de uma câmera.
 * @param {{
 *   obterTrilha: () => MediaStreamTrack | null,
 *   listarCameras?: () => Promise<MediaDeviceInfo[]>,
 *   cameraAtual?: () => string | null,
 *   trocarPara?: (deviceId: string | null) => Promise<void>
 * }} opcoes
 */
export function criarFoco({ obterTrilha, listarCameras, cameraAtual, trocarPara }) {
	let modo = "auto";
	let distancia = null;      // última distância manual usada

	const capacidades = () => {
		try { return obterTrilha()?.getCapabilities?.() || {}; } catch { return {}; }
	};
	const faixaDistancia = cap => {
		const f = cap.focusDistance;
		const manual = Array.isArray(cap.focusMode) && cap.focusMode.includes("manual");
		return manual && f && Number.isFinite(f.min) && Number.isFinite(f.max) && f.max > f.min ? f : null;
	};
	/** Distância para "perto"/"longe" — em metros quando a faixa parece ser em metros. */
	const distanciaPara = (faixa, alvo) => {
		const emMetros = faixa.max > 1;
		const valor = emMetros
			? (alvo === "perto" ? 0.12 : 0.6)
			: faixa.min + (faixa.max - faixa.min) * (alvo === "perto" ? 0.12 : 0.6);
		return Math.min(faixa.max, Math.max(faixa.min, valor));
	};

	async function aplicar(restricao) {
		const trilha = obterTrilha();
		if (!trilha?.applyConstraints) return false;
		try {
			await trilha.applyConstraints({ advanced: [restricao] });
			return true;
		} catch (e) {
			console.warn("[foco]", e?.message || e);
			return false;
		}
	}

	/**
	 * O que este aparelho permite.
	 * @returns {Promise<{ modos: {id: string, rotulo: string}[], distancia: {min: number, max: number, passo: number, valor: number} | null, toque: boolean, atual: string }>}
	 */
	async function opcoes() {
		const cap = capacidades();
		const faixa = faixaDistancia(cap);
		const modosFoco = Array.isArray(cap.focusMode) ? cap.focusMode : [];
		const modos = [{ id: "auto", rotulo: "Automático" }];
		let multipla = null;
		if (!faixa && listarCameras) {
			try { multipla = cameraMultipla(await listarCameras()); } catch { multipla = null; }
		}
		if (faixa || multipla) modos.push({ id: "perto", rotulo: "De perto" });
		if (faixa) modos.push({ id: "longe", rotulo: "De longe" });
		if (modosFoco.includes("single-shot")) modos.push({ id: "agora", rotulo: "Focar agora" });
		// Já está na câmera múltipla (escolhida antes): conta como "de perto"
		if (!faixa && multipla && cameraAtual?.() === multipla.deviceId && modo === "auto") modo = "perto";
		let ajuste = null;
		if (faixa) {
			let atual = distancia;
			try { atual ??= obterTrilha()?.getSettings?.().focusDistance; } catch { /* ignora */ }
			ajuste = { min: faixa.min, max: faixa.max, passo: faixa.step || (faixa.max - faixa.min) / 100, valor: Number.isFinite(atual) ? atual : faixa.min };
		}
		return { modos, distancia: ajuste, toque: "pointsOfInterest" in cap || modosFoco.includes("single-shot") || modosFoco.includes("continuous"), atual: modo };
	}

	/** Escolhe um modo: "auto", "perto", "longe" ou "agora" (foca uma vez e volta ao automático). */
	async function definir(id) {
		const cap = capacidades();
		const faixa = faixaDistancia(cap);
		const modosFoco = Array.isArray(cap.focusMode) ? cap.focusMode : [];
		if (id === "agora") {
			const ok = await aplicar({ focusMode: "single-shot" });
			if (ok && modo === "auto") setTimeout(() => { if (modo === "auto") aplicar({ focusMode: "continuous" }); }, 1500);
			return ok;
		}
		if ((id === "perto" || id === "longe") && faixa) {
			distancia = distanciaPara(faixa, id);
			const ok = await aplicar({ focusMode: "manual", focusDistance: distancia });
			if (ok) modo = id;
			return ok;
		}
		if (id === "perto" && !faixa && listarCameras && trocarPara) {
			const multipla = cameraMultipla(await listarCameras().catch(() => []));
			if (!multipla) return false;
			if (cameraAtual?.() !== multipla.deviceId) await trocarPara(multipla.deviceId);
			modo = "perto";
			return true;
		}
		if (id === "auto") {
			distancia = null;
			// Saindo da câmera múltipla: volta para a câmera traseira padrão
			const multipla = !faixa && listarCameras ? cameraMultipla(await listarCameras().catch(() => [])) : null;
			if (multipla && cameraAtual?.() === multipla.deviceId && trocarPara) await trocarPara(null);
			modo = "auto";
			if (modosFoco.includes("continuous")) return aplicar({ focusMode: "continuous" });
			return true;
		}
		return false;
	}

	/** Ajuste fino da distância do foco (só com foco manual). */
	async function definirDistancia(valor) {
		const faixa = faixaDistancia(capacidades());
		if (!faixa) return false;
		distancia = Math.min(faixa.max, Math.max(faixa.min, Number(valor)));
		const ok = await aplicar({ focusMode: "manual", focusDistance: distancia });
		if (ok) modo = "manual";
		return ok;
	}

	/** Foca num ponto da imagem (x, y de 0 a 1, no quadro do vídeo). */
	async function focarEm(x, y) {
		const cap = capacidades();
		const modosFoco = Array.isArray(cap.focusMode) ? cap.focusMode : [];
		const ponto = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
		const restricao = {};
		if ("pointsOfInterest" in cap) restricao.pointsOfInterest = [ponto];
		// Com foco manual escolhido, o toque só muda o ponto; senão, refaz o foco ali
		if (modo === "auto") {
			if (modosFoco.includes("single-shot")) restricao.focusMode = "single-shot";
			else if (modosFoco.includes("continuous")) restricao.focusMode = "continuous";
		}
		if (!Object.keys(restricao).length) return false;
		const ok = await aplicar(restricao);
		if (ok && restricao.focusMode === "single-shot") {
			setTimeout(() => { if (modo === "auto") aplicar({ focusMode: "continuous" }); }, 2000);
		}
		return ok;
	}

	/** Depois de reabrir a câmera: reaplica o foco manual escolhido. */
	async function reaplicar() {
		if ((modo === "perto" || modo === "longe" || modo === "manual") && distancia !== null) {
			await aplicar({ focusMode: "manual", focusDistance: distancia });
		}
	}

	/** Câmera fechada: o modo volta ao automático na próxima abertura (exceto a lente escolhida). */
	function reiniciar() {
		if (modo !== "perto" || faixaDistancia(capacidades())) modo = "auto";
		distancia = null;
	}

	return { opcoes, definir, definirDistancia, focarEm, reaplicar, reiniciar, get modo() { return modo; } };
}

/** Converte um toque na tela para coordenadas (0–1) do quadro do vídeo exibido com object-fit: cover. */
export function pontoNoVideo(video, clientX, clientY) {
	const vw = video.videoWidth, vh = video.videoHeight;
	const r = video.getBoundingClientRect();
	if (!vw || !vh || !r.width || !r.height) return null;
	const escala = Math.max(r.width / vw, r.height / vh);
	const sobraX = (vw * escala - r.width) / 2, sobraY = (vh * escala - r.height) / 2;
	return { x: (clientX - r.left + sobraX) / (vw * escala), y: (clientY - r.top + sobraY) / (vh * escala) };
}

/**
 * Liga a interface de foco: botão (abre o painel), painel com os modos e
 * régua de ajuste, e o toque na imagem para focar.
 * @param {{ area: HTMLElement, video: HTMLVideoElement, botao: HTMLButtonElement, painel: HTMLElement,
 *           obterFoco: () => ReturnType<typeof criarFoco> | null, podeTocar?: () => boolean,
 *           aviso?: (tipo: string, html: string) => void }} cfg
 */
export function ligarInterfaceFoco({ area, video, botao, painel, obterFoco, podeTocar = () => true, aviso }) {
	const fecharPainel = () => {
		painel.hidden = true;
		botao.setAttribute("aria-expanded", "false");
	};

	async function montar() {
		const foco = obterFoco();
		if (!foco) return;
		const { modos, distancia, toque, atual } = await foco.opcoes();
		botao.setAttribute("aria-pressed", String(foco.modo !== "auto"));
		painel.replaceChildren();
		const titulo = document.createElement("p");
		titulo.className = "foco-titulo";
		titulo.textContent = "Foco";
		painel.append(titulo);
		const grupo = document.createElement("div");
		grupo.className = "foco-modos";
		grupo.setAttribute("role", "radiogroup");
		grupo.setAttribute("aria-label", "Modo de foco");
		for (const m of modos) {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "foco-modo";
			b.textContent = m.rotulo;
			const acao = m.id === "agora";
			b.setAttribute("role", acao ? "button" : "radio");
			if (!acao) b.setAttribute("aria-checked", String(m.id === atual));
			b.addEventListener("click", async () => {
				b.disabled = true;
				const ok = await foco.definir(m.id).catch(() => false);
				b.disabled = false;
				if (!ok) aviso?.("aviso", "Não foi possível mudar o foco nesta câmera.");
				await montar();
			});
			grupo.append(b);
		}
		painel.append(grupo);
		if (distancia) {
			const rotulo = document.createElement("label");
			rotulo.className = "foco-ajuste";
			rotulo.innerHTML = "<span>Perto</span>";
			// Faixa grande (ex.: 5 cm a 10 m): escala logarítmica, para o "perto" ter espaço na régua
			const log = distancia.min > 0 && distancia.max / distancia.min > 20;
			const paraRegua = d => (log ? Math.log(d / distancia.min) / Math.log(distancia.max / distancia.min) : (d - distancia.min) / (distancia.max - distancia.min)) * 1000;
			const daRegua = v => (log ? distancia.min * Math.pow(distancia.max / distancia.min, v / 1000) : distancia.min + (distancia.max - distancia.min) * v / 1000);
			const regua = document.createElement("input");
			regua.type = "range";
			regua.min = "0";
			regua.max = "1000";
			regua.step = "1";
			regua.value = String(Math.round(Math.min(1000, Math.max(0, paraRegua(distancia.valor)))));
			regua.setAttribute("aria-label", "Ajuste fino do foco");
			let pendente = null;
			regua.addEventListener("input", () => {
				clearTimeout(pendente);
				pendente = setTimeout(async () => {
					await foco.definirDistancia(daRegua(Number(regua.value)));
					grupo.querySelectorAll('[role="radio"]').forEach(x => x.setAttribute("aria-checked", "false"));
					botao.setAttribute("aria-pressed", "true");
				}, 60);
			});
			const longe = document.createElement("span");
			longe.textContent = "Longe";
			rotulo.append(regua, longe);
			painel.append(rotulo);
		}
		if (toque) {
			const dica = document.createElement("p");
			dica.className = "foco-dica";
			dica.textContent = "Dica: toque na imagem para focar naquele ponto.";
			painel.append(dica);
		}
	}

	/** Mostra o botão só se houver mais de uma opção (ou toque para focar). */
	async function atualizar() {
		const foco = obterFoco();
		if (!foco) { botao.hidden = true; fecharPainel(); return; }
		try {
			const { modos, distancia } = await foco.opcoes();
			botao.hidden = modos.length < 2 && !distancia;
			botao.setAttribute("aria-pressed", String(foco.modo !== "auto"));
			if (botao.hidden) fecharPainel();
			else if (!painel.hidden) await montar();
		} catch {
			botao.hidden = true;
			fecharPainel();
		}
	}

	botao.setAttribute("aria-expanded", "false");
	botao.addEventListener("click", async e => {
		e.stopPropagation();
		if (!painel.hidden) return fecharPainel();
		await montar();
		painel.hidden = false;
		botao.setAttribute("aria-expanded", "true");
	});
	painel.addEventListener("click", e => e.stopPropagation());
	painel.addEventListener("pointerup", e => e.stopPropagation());

	// Toque na imagem: foca no ponto e mostra um anel
	area.addEventListener("pointerup", async e => {
		if (e.target.closest("button, input, .foco-painel, .leitor-zoom, .leitor-controles")) return;
		if (!painel.hidden) { fecharPainel(); return; }
		if (!podeTocar() || video.hidden || !video.videoWidth) return;
		const foco = obterFoco();
		const ponto = pontoNoVideo(video, e.clientX, e.clientY);
		if (!foco || !ponto) return;
		const r = area.getBoundingClientRect();
		const anel = document.createElement("span");
		anel.className = "foco-anel";
		anel.style.left = `${e.clientX - r.left}px`;
		anel.style.top = `${e.clientY - r.top}px`;
		area.append(anel);
		setTimeout(() => anel.remove(), 900);
		const ok = await foco.focarEm(ponto.x, ponto.y);
		anel.classList.add(ok ? "ok" : "sem-suporte");
	});

	return { atualizar, fecharPainel };
}
