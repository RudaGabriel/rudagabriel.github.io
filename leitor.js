/* =========================================================
   Leitor de código de barras
   ---------------------------------------------------------
   - Usa o detector nativo do aparelho (Android/Chrome) quando
     existe; senão, o ZXing-C++ em WebAssembly (iPhone, PC…).
   - Câmera traseira principal em alta resolução, com foco
     contínuo, flash (lanterna), zoom e troca de câmera.
   - Analisa a faixa central (onde fica a mira) em resolução
     cheia e, de vez em quando, a imagem inteira.
   - Confirma a leitura: EAN/UPC pelo dígito verificador;
     outros formatos precisam de duas leituras iguais.
   - Também lê códigos a partir de uma foto.
   ========================================================= */

const URL_ZXING = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/ponyfill.js";

const FORMATOS_DESEJADOS = [
	"ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93",
	"itf", "codabar", "qr_code", "data_matrix"
];
const FORMATOS_COM_DIGITO = new Set(["ean_13", "ean_8", "upc_a"]);
const INTERVALO_MIN_MS = { nativo: 60, zxing: 110 };
const CHAVE_CAMERA = "cv2:camera";

/* ---------- Utilitários ---------- */
let promessaZxing = null;
function carregarZxing() {
	if (window.BarcodeDetectionAPI?.BarcodeDetector) return Promise.resolve(window.BarcodeDetectionAPI);
	if (promessaZxing) return promessaZxing;
	promessaZxing = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = URL_ZXING;
		s.async = true;
		s.crossOrigin = "anonymous";
		s.onload = () => window.BarcodeDetectionAPI?.BarcodeDetector
			? resolve(window.BarcodeDetectionAPI)
			: reject(new Error("Leitor indisponível"));
		s.onerror = () => { s.remove(); reject(new Error("Falha ao carregar o leitor")); };
		document.head.appendChild(s);
	}).catch(e => { promessaZxing = null; throw e; });
	return promessaZxing;
}

/** Valida o dígito verificador de EAN-8, EAN-13, UPC-A (GTIN). */
export function digitoVerificadorValido(codigo) {
	if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(codigo)) return false;
	const digitos = codigo.split("").map(Number);
	const verificador = digitos.pop();
	let soma = 0;
	for (let i = digitos.length - 1, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += digitos[i] * peso;
	return (10 - (soma % 10)) % 10 === verificador;
}

/** Bipe curto de confirmação (sem arquivos de áudio). */
let audioCtx = null;
function bipar() {
	try {
		const Ctx = window.AudioContext || window.webkitAudioContext;
		if (!Ctx) return;
		audioCtx = audioCtx || new Ctx();
		if (audioCtx.state === "suspended") audioCtx.resume().catch(() => { });
		const osc = audioCtx.createOscillator();
		const ganho = audioCtx.createGain();
		osc.type = "sine";
		osc.frequency.value = 1320;
		ganho.gain.setValueAtTime(0.0001, audioCtx.currentTime);
		ganho.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
		ganho.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
		osc.connect(ganho).connect(audioCtx.destination);
		osc.start();
		osc.stop(audioCtx.currentTime + 0.13);
	} catch { /* sem som */ }
}

/** Escolhe a melhor câmera traseira para ler códigos de perto. */
function escolherCameraTraseira(cameras) {
	const traseiras = cameras.filter(c => /back|rear|traseira|environment|facing back/i.test(c.label));
	if (!traseiras.length) return null;
	// iPhone: câmeras virtuais (Triple/Dual Wide) trocam sozinhas para macro ao aproximar
	const prioridadeIos = [/triple/i, /dual wide/i, /dual/i];
	for (const re of prioridadeIos) {
		const achada = traseiras.find(c => re.test(c.label));
		if (achada) return achada;
	}
	// Android: "camera2 0, facing back" costuma ser a principal; evita ultra-wide/tele
	const normais = traseiras.filter(c => !/ultra|tele|wide angle|grande angular|depth|profundidade/i.test(c.label));
	const lista = normais.length ? normais : traseiras;
	const numero = c => { const m = c.label.match(/camera2?\s*(\d+)/i); return m ? Number(m[1]) : 99; };
	return [...lista].sort((a, b) => numero(a) - numero(b))[0];
}

function traduzirErroCamera(erro) {
	const texto = `${erro?.name || ""} ${erro?.message || erro || ""}`;
	if (/NotAllowed|Permission|denied/i.test(texto)) return "Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador e tente de novo.";
	if (/NotFound|DevicesNotFound|Requested device not found/i.test(texto)) return "Nenhuma câmera foi encontrada neste aparelho.";
	if (/NotReadable|TrackStart|in use|Could not start/i.test(texto)) return "A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.";
	if (/Overconstrained/i.test(texto)) return "A câmera não aceitou as configurações. Tente trocar de câmera.";
	if (/carregar o leitor|indisponível/i.test(texto)) return "Não foi possível carregar o leitor. Verifique sua internet.";
	if (/secure|https/i.test(texto)) return "A câmera só funciona em páginas seguras (https).";
	return "Não foi possível iniciar a câmera.";
}

/* =========================================================
   Controlador do leitor
   ========================================================= */
/**
 * @param {object} op
 * @param {HTMLVideoElement} op.video
 * @param {HTMLElement} op.mira          elemento que marca a área de leitura
 * @param {(codigo: string, formato: string) => void} op.aoLer
 * @param {(texto: string) => void} op.aoStatus
 * @param {(cap: {flash: boolean, flashLigado: boolean, zoom: null|{min:number,max:number,passo:number,valor:number}, cameras: number}) => void} op.aoCapacidades
 */
export function criarLeitor({ video, mira, aoLer, aoStatus, aoCapacidades }) {
	let stream = null;
	let trilha = null;
	let detector = null;
	let tipoDetector = "";
	let rodando = false;
	let ocupado = false;
	let quadro = 0;
	let ultimoTempo = 0;
	let flashLigado = false;
	let cameras = [];
	let cameraAtualId = null;
	let candidato = { codigo: "", vezes: 0, quando: 0 };
	let geracao = 0;
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d", { willReadFrequently: true });

	const status = t => { try { aoStatus?.(t); } catch { /* ignora */ } };

	let nativoFalhou = false;

	async function criarDetector() {
		if (detector) return detector;
		// 1) Detector nativo, se suportar os formatos principais
		if (!nativoFalhou && "BarcodeDetector" in window) {
			try {
				const suportados = await window.BarcodeDetector.getSupportedFormats();
				const formatos = FORMATOS_DESEJADOS.filter(f => suportados.includes(f));
				if (formatos.includes("ean_13") && formatos.includes("code_128")) {
					detector = new window.BarcodeDetector({ formats: formatos });
					tipoDetector = "nativo";
					return detector;
				}
			} catch (e) { console.warn("[leitor] detector nativo indisponível:", e); }
		}
		// 2) ZXing-C++ (WebAssembly)
		status("Preparando leitor…");
		const api = await carregarZxing();
		try { await api.prepareZXingModule?.({ fireImmediately: true }); } catch (e) { console.warn("[leitor] wasm:", e); }
		const suportados = await api.BarcodeDetector.getSupportedFormats();
		detector = new api.BarcodeDetector({ formats: FORMATOS_DESEJADOS.filter(f => suportados.includes(f)) });
		tipoDetector = "zxing";
		return detector;
	}

	function restricoes(deviceId) {
		const video = {
			width: { ideal: 1920 },
			height: { ideal: 1080 },
			frameRate: { ideal: 30 }
		};
		if (deviceId) video.deviceId = { exact: deviceId };
		else video.facingMode = { ideal: "environment" };
		return { audio: false, video };
	}

	async function abrirCamera(deviceId) {
		pararStream();
		stream = await navigator.mediaDevices.getUserMedia(restricoes(deviceId));
		trilha = stream.getVideoTracks()[0] || null;
		cameraAtualId = trilha?.getSettings?.().deviceId || deviceId || null;
		video.srcObject = stream;
		video.setAttribute("playsinline", "");
		video.muted = true;
		await video.play().catch(() => { /* alguns navegadores tocam sozinhos */ });
		if (!video.videoWidth) {
			await new Promise(r => {
				const fim = () => { video.removeEventListener("loadedmetadata", fim); r(); };
				video.addEventListener("loadedmetadata", fim);
				setTimeout(fim, 2500);
			});
		}
	}

	async function listarCameras() {
		try {
			const todos = await navigator.mediaDevices.enumerateDevices();
			cameras = todos.filter(d => d.kind === "videoinput");
		} catch { cameras = []; }
		return cameras;
	}

	/** Foco contínuo e capacidades (flash/zoom). Alguns aparelhos só informam após um instante. */
	async function configurarTrilha() {
		if (!trilha) return;
		const cap = trilha.getCapabilities?.() || {};
		const avancado = {};
		if (Array.isArray(cap.focusMode) && cap.focusMode.includes("continuous")) avancado.focusMode = "continuous";
		if (Array.isArray(cap.exposureMode) && cap.exposureMode.includes("continuous")) avancado.exposureMode = "continuous";
		if (Array.isArray(cap.whiteBalanceMode) && cap.whiteBalanceMode.includes("continuous")) avancado.whiteBalanceMode = "continuous";
		if (Object.keys(avancado).length) {
			try { await trilha.applyConstraints({ advanced: [avancado] }); } catch { /* ignora */ }
		}
		informarCapacidades();
	}

	function informarCapacidades() {
		const cap = trilha?.getCapabilities?.() || {};
		const ajustes = trilha?.getSettings?.() || {};
		let zoom = null;
		if (cap.zoom && Number.isFinite(cap.zoom.min) && Number.isFinite(cap.zoom.max) && cap.zoom.max > cap.zoom.min) {
			const max = Math.min(cap.zoom.max, Math.max(cap.zoom.min * 8, cap.zoom.min + 1));
			zoom = { min: cap.zoom.min, max, passo: cap.zoom.step || 0.1, valor: ajustes.zoom ?? cap.zoom.min };
		}
		try {
			aoCapacidades?.({
				flash: !!cap.torch || "torch" in ajustes,
				flashLigado,
				zoom,
				cameras: cameras.length
			});
		} catch { /* ignora */ }
	}

	/** Região da mira em coordenadas do vídeo (considerando object-fit: cover). */
	function regiaoMira() {
		const vw = video.videoWidth, vh = video.videoHeight;
		const caixaVideo = video.getBoundingClientRect();
		if (!vw || !vh || !caixaVideo.width || !caixaVideo.height || !mira) return { x: 0, y: 0, w: vw, h: vh };
		const escala = Math.max(caixaVideo.width / vw, caixaVideo.height / vh);
		const visivelW = caixaVideo.width / escala, visivelH = caixaVideo.height / escala;
		const origemX = (vw - visivelW) / 2, origemY = (vh - visivelH) / 2;
		const m = mira.getBoundingClientRect();
		// Margem extra de 25% na altura e 6% na largura para tolerar mão tremendo
		const margemY = m.height * 0.25, margemX = m.width * 0.06;
		let x = origemX + (m.left - margemX - caixaVideo.left) / escala;
		let y = origemY + (m.top - margemY - caixaVideo.top) / escala;
		let w = (m.width + 2 * margemX) / escala;
		let h = (m.height + 2 * margemY) / escala;
		x = Math.max(0, Math.min(vw - 1, x));
		y = Math.max(0, Math.min(vh - 1, y));
		w = Math.max(1, Math.min(vw - x, w));
		h = Math.max(1, Math.min(vh - y, h));
		return { x, y, w, h };
	}

	function desenhar(regiao, limite) {
		const escala = Math.min(1, limite / Math.max(regiao.w, regiao.h));
		const w = Math.max(1, Math.round(regiao.w * escala));
		const h = Math.max(1, Math.round(regiao.h * escala));
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		ctx.drawImage(video, regiao.x, regiao.y, regiao.w, regiao.h, 0, 0, w, h);
		return canvas;
	}

	/** Decide se a leitura é confiável o suficiente para aceitar. */
	function confirmar(codigo, formato) {
		const agora = performance.now();
		if (FORMATOS_COM_DIGITO.has(formato) && digitoVerificadorValido(codigo)) return true;
		if (formato === "qr_code" || formato === "data_matrix") return true; // possuem correção de erros
		if (candidato.codigo === codigo && agora - candidato.quando < 2500) {
			candidato.vezes++;
			candidato.quando = agora;
		} else {
			candidato = { codigo, vezes: 1, quando: agora };
		}
		return candidato.vezes >= 2;
	}

	async function analisarQuadro(minhaGeracao) {
		if (!rodando || minhaGeracao !== geracao || ocupado || video.readyState < 2) return;
		const agora = performance.now();
		if (agora - ultimoTempo < INTERVALO_MIN_MS[tipoDetector || "zxing"]) return;
		ultimoTempo = agora;
		ocupado = true;
		try {
			quadro++;
			// Na maior parte dos quadros, só a faixa da mira (mais rápido e preciso);
			// a cada 4 quadros, a imagem inteira (caso o código esteja fora da mira).
			const inteira = quadro % 4 === 0;
			const fonte = inteira
				? desenhar({ x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }, 1280)
				: desenhar(regiaoMira(), 1600);
			const resultados = await detector.detect(fonte);
			if (!rodando || minhaGeracao !== geracao) return;
			for (const r of resultados || []) {
				const codigo = String(r.rawValue || "").trim();
				if (!codigo) continue;
				if (confirmar(codigo, r.format)) {
					rodando = false;
					bipar();
					try { navigator.vibrate?.(80); } catch { /* ignora */ }
					aoLer?.(codigo, r.format);
					return;
				}
			}
		} catch (e) {
			// Detector nativo pode falhar em alguns aparelhos: troca para o ZXing
			if (tipoDetector === "nativo") {
				console.warn("[leitor] nativo falhou, usando ZXing:", e);
				detector = null;
				tipoDetector = "";
				nativoFalhou = true;
				try { await criarDetector(); } catch (erro) { console.error(erro); }
			} else {
				console.warn("[leitor]", e);
			}
		} finally {
			ocupado = false;
		}
	}

	function agendar(minhaGeracao) {
		if (!rodando || minhaGeracao !== geracao) return;
		const proximo = () => { analisarQuadro(minhaGeracao).finally(() => agendar(minhaGeracao)); };
		if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(proximo);
		else requestAnimationFrame(proximo);
	}

	async function iniciar() {
		const minhaGeracao = ++geracao;
		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			throw new Error("secure: a câmera exige https");
		}
		status("Iniciando câmera…");
		flashLigado = false;
		candidato = { codigo: "", vezes: 0, quando: 0 };

		// Carrega o detector e abre a câmera em paralelo
		const salvo = (() => { try { return localStorage.getItem(CHAVE_CAMERA); } catch { return null; } })();
		await Promise.all([
			criarDetector(),
			abrirCamera(salvo).catch(async e => {
				if (salvo && /Overconstrained|NotFound/i.test(e?.name || "")) {
					try { localStorage.removeItem(CHAVE_CAMERA); } catch { /* ignora */ }
					return abrirCamera(null);
				}
				throw e;
			})
		]);
		if (minhaGeracao !== geracao) return;

		// Com a permissão concedida, os nomes das câmeras ficam disponíveis:
		// troca para a melhor câmera traseira se a atual não for ela.
		await listarCameras();
		if (!salvo) {
			const melhor = escolherCameraTraseira(cameras);
			if (melhor && melhor.deviceId && melhor.deviceId !== cameraAtualId) {
				try { await abrirCamera(melhor.deviceId); } catch (e) { console.warn("[leitor] mantendo câmera padrão:", e); await abrirCamera(null); }
			}
		}
		if (minhaGeracao !== geracao) return pararStream();

		await configurarTrilha();
		setTimeout(() => { if (minhaGeracao === geracao) informarCapacidades(); }, 700);
		rodando = true;
		status("Procurando código…");
		agendar(minhaGeracao);
	}

	function pararStream() {
		try { stream?.getTracks().forEach(t => t.stop()); } catch { /* ignora */ }
		stream = null;
		trilha = null;
		try { video.srcObject = null; } catch { /* ignora */ }
	}

	function parar() {
		geracao++;
		rodando = false;
		flashLigado = false;
		pararStream();
	}

	async function alternarFlash() {
		if (!trilha) return false;
		const novo = !flashLigado;
		try {
			await trilha.applyConstraints({ advanced: [{ torch: novo }] });
		} catch (e) {
			console.warn("[leitor] flash:", e);
			throw new Error("flash");
		}
		// Restrições "advanced" não suportadas são ignoradas em silêncio: confere se ligou mesmo
		const ajustes = trilha.getSettings?.() || {};
		const cap = trilha.getCapabilities?.() || {};
		const confirmado = ajustes.torch !== undefined ? ajustes.torch === novo : !!cap.torch;
		if (!confirmado) throw new Error("flash");
		flashLigado = novo;
		informarCapacidades();
		return flashLigado;
	}

	async function definirZoom(valor) {
		if (!trilha) return;
		try { await trilha.applyConstraints({ advanced: [{ zoom: Number(valor) }] }); } catch (e) { console.warn("[leitor] zoom:", e); }
	}

	async function trocarCamera() {
		if (cameras.length < 2) await listarCameras();
		if (cameras.length < 2) return false;
		const i = cameras.findIndex(c => c.deviceId === cameraAtualId);
		const proxima = cameras[(i + 1) % cameras.length];
		const minhaGeracao = ++geracao;
		rodando = false;
		flashLigado = false;
		status("Trocando câmera…");
		await abrirCamera(proxima.deviceId);
		try { localStorage.setItem(CHAVE_CAMERA, proxima.deviceId); } catch { /* ignora */ }
		await configurarTrilha();
		rodando = true;
		status(proxima.label ? `Câmera: ${proxima.label}` : "Procurando código…");
		agendar(minhaGeracao);
		return true;
	}

	/** Lê o código de uma foto (útil quando a câmera ao vivo não foca bem). */
	async function lerFoto(arquivo) {
		await criarDetector();
		let bitmap;
		try {
			bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
		} catch {
			bitmap = await createImageBitmap(arquivo);
		}
		const tentativas = [0, 90];
		try {
			for (const graus of tentativas) {
				const limite = 2000;
				const escala = Math.min(1, limite / Math.max(bitmap.width, bitmap.height));
				const w = Math.round(bitmap.width * escala), h = Math.round(bitmap.height * escala);
				const c = document.createElement("canvas");
				const x = c.getContext("2d");
				if (graus === 90) {
					c.width = h; c.height = w;
					x.translate(h, 0);
					x.rotate(Math.PI / 2);
				} else {
					c.width = w; c.height = h;
				}
				x.drawImage(bitmap, 0, 0, w, h);
				const resultados = await detector.detect(c);
				const r = (resultados || []).find(r => String(r.rawValue || "").trim());
				if (r) return { codigo: String(r.rawValue).trim(), formato: r.format };
			}
		} finally {
			bitmap.close?.();
		}
		return null;
	}

	return {
		iniciar,
		parar,
		alternarFlash,
		definirZoom,
		trocarCamera,
		lerFoto,
		traduzirErro: traduzirErroCamera,
		get ativo() { return rodando; }
	};
}
