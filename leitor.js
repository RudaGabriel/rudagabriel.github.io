/* =========================================================
   Leitor de código de barras
   ---------------------------------------------------------
   Funciona em qualquer aparelho, com 3 motores de leitura
   (usa o primeiro que funcionar):
     1. Detector nativo do aparelho (Android/Chrome).
     2. ZXing-C++ em WebAssembly (navegadores modernos).
     3. ZXing em JavaScript puro (iPhones/navegadores antigos).
   A câmera abre independente do motor, com várias tentativas
   de configuração. Se a câmera ao vivo não estiver disponível,
   "Tirar foto do código" sempre funciona.
   ========================================================= */

import { criarFoco } from "./foco.js";

const URL_ZXING_WASM = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/ponyfill.js";
const URL_ZXING_JS = "https://cdn.jsdelivr.net/npm/@zxing/library@0.23.0/umd/index.min.js";

const FORMATOS_DESEJADOS = [
	"ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93",
	"itf", "codabar", "qr_code", "data_matrix"
];
const FORMATOS_COM_DIGITO = new Set(["ean_13", "ean_8", "upc_a"]);
const INTERVALO_MIN_MS = { nativo: 60, wasm: 110, js: 180 };
const LIMITE_PIXELS = { nativo: 1600, wasm: 1600, js: 1000 };
const CHAVE_CAMERA = "cv2:camera";

export const ehIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent || "")
	|| (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const esperar = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Carregamento de scripts ---------- */
const scripts = new Map();
function carregarScript(url, verificar) {
	if (verificar()) return Promise.resolve();
	if (scripts.has(url)) return scripts.get(url);
	const p = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = url;
		s.async = true;
		s.crossOrigin = "anonymous";
		s.onload = () => (verificar() ? resolve() : reject(new Error("Falha ao carregar o leitor")));
		s.onerror = () => { s.remove(); reject(new Error("Falha ao carregar o leitor")); };
		document.head.appendChild(s);
	}).catch(e => { scripts.delete(url); throw e; });
	scripts.set(url, p);
	return p;
}

/** O ZXing em WebAssembly precisa de SIMD (Safari 16.4+, Chrome 91+). */
function suportaWasmSimd() {
	try {
		return typeof WebAssembly === "object" && WebAssembly.validate(new Uint8Array([
			0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
		]));
	} catch {
		return false;
	}
}

/* ---------- Motores de leitura ---------- */
async function criarMotorNativo() {
	if (!("BarcodeDetector" in window)) throw new Error("sem nativo");
	const suportados = await window.BarcodeDetector.getSupportedFormats();
	const formatos = FORMATOS_DESEJADOS.filter(f => suportados.includes(f));
	if (!formatos.includes("ean_13") || !formatos.includes("code_128")) throw new Error("nativo incompleto");
	const det = new window.BarcodeDetector({ formats: formatos });
	return { tipo: "nativo", detect: fonte => det.detect(fonte) };
}

async function criarMotorWasm() {
	if (!suportaWasmSimd()) throw new Error("sem wasm simd");
	await carregarScript(URL_ZXING_WASM, () => !!window.BarcodeDetectionAPI?.BarcodeDetector);
	const api = window.BarcodeDetectionAPI;
	await api.prepareZXingModule({ fireImmediately: true });
	const suportados = await api.BarcodeDetector.getSupportedFormats();
	const det = new api.BarcodeDetector({ formats: FORMATOS_DESEJADOS.filter(f => suportados.includes(f)) });
	return { tipo: "wasm", detect: fonte => det.detect(fonte) };
}

async function criarMotorJs() {
	await carregarScript(URL_ZXING_JS, () => !!window.ZXing?.MultiFormatReader);
	const ZX = window.ZXing;
	const F = ZX.BarcodeFormat;
	const dicas = new Map();
	dicas.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
		F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX
	]);
	dicas.set(ZX.DecodeHintType.TRY_HARDER, true);
	const leitor = new ZX.MultiFormatReader();
	leitor.setHints(dicas);
	return {
		tipo: "js",
		async detect(fonte) {
			try {
				const luz = new ZX.HTMLCanvasElementLuminanceSource(fonte);
				const r = leitor.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(luz)));
				const nome = String(F[r.getBarcodeFormat()] || "").toLowerCase();
				return [{ rawValue: r.getText(), format: nome }];
			} catch {
				return []; // nenhum código neste quadro
			} finally {
				try { leitor.reset(); } catch { /* ignora */ }
			}
		}
	};
}

/** Tenta os motores em ordem e devolve o primeiro que funcionar. */
async function criarMotor(pular = new Set()) {
	const tentativas = [["nativo", criarMotorNativo], ["wasm", criarMotorWasm], ["js", criarMotorJs]];
	let ultimoErro = null;
	for (const [tipo, criar] of tentativas) {
		if (pular.has(tipo)) continue;
		try {
			return await criar();
		} catch (e) {
			ultimoErro = e;
			if (!/sem nativo|sem wasm/.test(String(e?.message))) console.warn(`[leitor] motor ${tipo} indisponível:`, e);
		}
	}
	throw ultimoErro || new Error("Falha ao carregar o leitor");
}

/* ---------- Utilitários ---------- */
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

/** Escolhe a câmera traseira principal (Android). */
function escolherCameraTraseira(cameras) {
	const traseiras = cameras.filter(c => /back|rear|traseira|environment/i.test(c.label));
	if (!traseiras.length) return null;
	const normais = traseiras.filter(c => !/ultra|tele|wide angle|grande.?angular|depth|profundidade|macro/i.test(c.label));
	const lista = normais.length ? normais : traseiras;
	const numero = c => { const m = c.label.match(/camera2?\s*(\d+)/i); return m ? Number(m[1]) : 99; };
	return [...lista].sort((a, b) => numero(a) - numero(b))[0];
}

/** Mensagem amigável + detalhe técnico (ajuda a diagnosticar). */
export function traduzirErroCamera(erro) {
	const nome = erro?.name || "";
	const texto = `${nome} ${erro?.message || erro || ""}`;
	const detalhe = `${nome || "Erro"}: ${erro?.message || String(erro || "")}`.slice(0, 160);
	let mensagem = "Não foi possível iniciar a câmera.";
	if (/sem-camera-api/.test(texto)) mensagem = "Este navegador não libera a câmera ao vivo (comum em navegadores dentro de apps). Use “Tirar foto do código” ou abra o site no Safari/Chrome.";
	else if (/NotAllowed|Permission|denied/i.test(texto)) mensagem = ehIOS()
		? "Permissão da câmera negada. No iPhone: Ajustes → Safari → Câmera → Permitir (ou toque em “aA” na barra de endereço → Ajustes do Site → Câmera)."
		: "Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador e tente de novo.";
	else if (/NotFound|DevicesNotFound|Requested device not found/i.test(texto)) mensagem = "Nenhuma câmera foi encontrada neste aparelho.";
	else if (/NotReadable|TrackStart|in use|Could not start|AbortError|I\/O/i.test(texto)) mensagem = "A câmera está ocupada por outro app ou não respondeu. Feche outros apps que usam a câmera e tente de novo.";
	else if (/Overconstrained/i.test(texto)) mensagem = "A câmera não aceitou as configurações. Tente trocar de câmera.";
	else if (/secure|https/i.test(texto)) mensagem = "A câmera só funciona em páginas seguras (https).";
	return { mensagem, detalhe };
}

async function carregarImagem(arquivo) {
	try {
		return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
	} catch { /* tenta sem opções */ }
	try {
		return await createImageBitmap(arquivo);
	} catch { /* Safari antigo: usa <img> */ }
	const url = URL.createObjectURL(arquivo);
	try {
		const img = new Image();
		img.src = url;
		await (img.decode ? img.decode() : new Promise((ok, falha) => { img.onload = ok; img.onerror = falha; }));
		return img;
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}

/* =========================================================
   Controlador do leitor
   ========================================================= */
/**
 * @param {object} op
 * @param {HTMLVideoElement} op.video
 * @param {HTMLElement} op.mira
 * @param {(codigo: string, formato: string) => void} op.aoLer
 * @param {(texto: string) => void} op.aoStatus
 * @param {(cap: object) => void} op.aoCapacidades
 */
export function criarLeitor({ video, mira, aoLer, aoStatus, aoCapacidades }) {
	let stream = null;
	let trilha = null;
	let motor = null;
	let promessaMotor = null;
	const motoresFalhos = new Set();
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
	const foco = criarFoco({
		obterTrilha: () => trilha,
		listarCameras: () => listarCameras(),
		cameraAtual: () => cameraAtualId,
		trocarPara: deviceId => usarCamera(deviceId)
	});

	function obterMotor() {
		if (motor) return Promise.resolve(motor);
		if (!promessaMotor) {
			promessaMotor = criarMotor(motoresFalhos)
				.then(m => { motor = m; return m; })
				.finally(() => { promessaMotor = null; });
		}
		return promessaMotor;
	}

	function restricoesTentativas(deviceId) {
		const alvo = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } };
		return [
			{ audio: false, video: { ...alvo, width: { ideal: 1920 }, height: { ideal: 1080 } } },
			{ audio: false, video: { ...alvo } },
			{ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : true }
		];
	}

	/** Abre a câmera tentando configurações cada vez mais simples. */
	async function abrirCamera(deviceId) {
		const tinhaStream = !!stream;
		pararStream();
		if (tinhaStream) await esperar(ehIOS() ? 350 : 120); // o iPhone precisa de um tempo para liberar a câmera
		let ultimoErro = null;
		for (const restricoes of restricoesTentativas(deviceId)) {
			try {
				stream = await navigator.mediaDevices.getUserMedia(restricoes);
				break;
			} catch (e) {
				ultimoErro = e;
				// Permissão negada ou página insegura: não adianta insistir
				if (/NotAllowed|Security|Permission/i.test(`${e?.name} ${e?.message}`)) throw e;
				console.warn("[leitor] tentativa de câmera falhou:", e);
				await esperar(200);
			}
		}
		if (!stream) throw ultimoErro || new Error("Não foi possível abrir a câmera");
		trilha = stream.getVideoTracks()[0] || null;
		cameraAtualId = trilha?.getSettings?.().deviceId || deviceId || null;
		video.setAttribute("playsinline", "");
		video.setAttribute("muted", "");
		video.muted = true;
		video.srcObject = stream;
		try { await video.play(); } catch (e) { console.warn("[leitor] play:", e); }
		if (!video.videoWidth) {
			await new Promise(r => {
				const fim = () => { video.removeEventListener("loadedmetadata", fim); r(); };
				video.addEventListener("loadedmetadata", fim);
				setTimeout(fim, 3000);
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
		await foco.reaplicar();
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
			aoCapacidades?.({ flash: !!cap.torch || "torch" in ajustes, flashLigado, zoom, cameras: cameras.length });
		} catch { /* ignora */ }
	}

	/** Região da mira em coordenadas do vídeo (considerando object-fit: cover). */
	function regiaoMira() {
		const vw = video.videoWidth, vh = video.videoHeight;
		const caixa = video.getBoundingClientRect();
		if (!vw || !vh || !caixa.width || !caixa.height || !mira) return { x: 0, y: 0, w: vw, h: vh };
		const escala = Math.max(caixa.width / vw, caixa.height / vh);
		const origemX = (vw - caixa.width / escala) / 2, origemY = (vh - caixa.height / escala) / 2;
		const m = mira.getBoundingClientRect();
		const margemY = m.height * 0.25, margemX = m.width * 0.06;
		let x = origemX + (m.left - margemX - caixa.left) / escala;
		let y = origemY + (m.top - margemY - caixa.top) / escala;
		let w = (m.width + 2 * margemX) / escala;
		let h = (m.height + 2 * margemY) / escala;
		x = Math.max(0, Math.min(vw - 1, x));
		y = Math.max(0, Math.min(vh - 1, y));
		w = Math.max(1, Math.min(vw - x, w));
		h = Math.max(1, Math.min(vh - y, h));
		return { x, y, w, h };
	}

	function desenhar(fonte, regiao, limite) {
		const escala = Math.min(1, limite / Math.max(regiao.w, regiao.h));
		const w = Math.max(1, Math.round(regiao.w * escala));
		const h = Math.max(1, Math.round(regiao.h * escala));
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		ctx.drawImage(fonte, regiao.x, regiao.y, regiao.w, regiao.h, 0, 0, w, h);
		return canvas;
	}

	function confirmar(codigo, formato) {
		const agora = performance.now();
		if (FORMATOS_COM_DIGITO.has(formato) && digitoVerificadorValido(codigo)) return true;
		if (formato === "qr_code" || formato === "data_matrix") return true;
		if (candidato.codigo === codigo && agora - candidato.quando < 2500) {
			candidato.vezes++;
			candidato.quando = agora;
		} else {
			candidato = { codigo, vezes: 1, quando: agora };
		}
		return candidato.vezes >= 2;
	}

	async function analisarQuadro(minhaGeracao) {
		if (!rodando || minhaGeracao !== geracao || ocupado || !motor || video.readyState < 2 || !video.videoWidth) return;
		const agora = performance.now();
		if (agora - ultimoTempo < INTERVALO_MIN_MS[motor.tipo]) return;
		ultimoTempo = agora;
		ocupado = true;
		const motorAtual = motor;
		try {
			quadro++;
			const inteira = quadro % 4 === 0;
			const regiao = inteira ? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight } : regiaoMira();
			const fonte = desenhar(video, regiao, inteira ? Math.min(1280, LIMITE_PIXELS[motorAtual.tipo]) : LIMITE_PIXELS[motorAtual.tipo]);
			const resultados = await motorAtual.detect(fonte);
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
			// O motor falhou durante o uso: passa para o próximo da lista
			console.warn(`[leitor] motor ${motorAtual.tipo} falhou, trocando:`, e);
			motoresFalhos.add(motorAtual.tipo);
			if (motor === motorAtual) motor = null;
			obterMotor().catch(erro => {
				console.error(erro);
				if (minhaGeracao === geracao) status("Leitor indisponível — use “Tirar foto do código”");
			});
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
		if (!window.isSecureContext) throw Object.assign(new Error("A câmera exige https (secure)"), { name: "SecurityError" });
		if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("sem-camera-api"), { name: "NotSupportedError" });
		status("Iniciando câmera…");
		flashLigado = false;
		candidato = { codigo: "", vezes: 0, quando: 0 };

		// O motor de leitura carrega em segundo plano; a câmera não depende dele
		const motorPronto = obterMotor().catch(e => { console.error("[leitor] nenhum motor:", e); return null; });

		const salvo = (() => { try { return localStorage.getItem(CHAVE_CAMERA); } catch { return null; } })();
		try {
			await abrirCamera(salvo);
		} catch (e) {
			if (!salvo) throw e;
			try { localStorage.removeItem(CHAVE_CAMERA); } catch { /* ignora */ }
			await abrirCamera(null);
		}
		if (minhaGeracao !== geracao) return pararStream();

		// Android: com a permissão concedida, troca para a câmera traseira principal.
		// No iPhone isso não é feito (reabrir a câmera em seguida costuma falhar).
		await listarCameras();
		if (!salvo && !ehIOS()) {
			const melhor = escolherCameraTraseira(cameras);
			if (melhor?.deviceId && melhor.deviceId !== cameraAtualId) {
				try { await abrirCamera(melhor.deviceId); } catch (e) {
					console.warn("[leitor] mantendo câmera padrão:", e);
					if (!stream) await abrirCamera(null);
				}
			}
		}
		if (minhaGeracao !== geracao) return pararStream();

		await configurarTrilha();
		setTimeout(() => { if (minhaGeracao === geracao) informarCapacidades(); }, 700);

		rodando = true;
		status(motor ? "Procurando código…" : "Preparando leitor…");
		const m = await motorPronto;
		if (minhaGeracao !== geracao) return;
		if (!m) {
			status("Leitor indisponível — use “Tirar foto do código”");
			return;
		}
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
		foco.reiniciar();
		pararStream();
	}

	async function alternarFlash() {
		if (!trilha) throw new Error("flash");
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

	/** Reabre com outra câmera (null = a padrão) e volta a procurar o código. */
	async function usarCamera(deviceId) {
		const minhaGeracao = ++geracao;
		rodando = false;
		flashLigado = false;
		status("Trocando câmera…");
		try {
			await abrirCamera(deviceId);
		} catch (e) {
			console.warn("[leitor] troca de câmera falhou, voltando à padrão:", e);
			deviceId = null;
			await abrirCamera(null);
		}
		try {
			if (deviceId) localStorage.setItem(CHAVE_CAMERA, deviceId);
			else localStorage.removeItem(CHAVE_CAMERA);
		} catch { /* ignora */ }
		if (minhaGeracao !== geracao) return;
		await configurarTrilha();
		rodando = true;
		const info = cameras.find(c => c.deviceId === cameraAtualId);
		status(info?.label ? `Câmera: ${info.label}` : "Procurando código…");
		if (motor || await obterMotor().catch(() => null)) agendar(minhaGeracao);
	}

	async function trocarCamera() {
		if (cameras.length < 2) await listarCameras();
		if (cameras.length < 2) return false;
		const i = cameras.findIndex(c => c.deviceId === cameraAtualId);
		const proxima = cameras[(i + 1) % cameras.length];
		await usarCamera(proxima.deviceId);
		return true;
	}

	/** Lê o código de uma foto (funciona mesmo sem câmera ao vivo). */
	async function lerFoto(arquivo) {
		const m = await obterMotor();
		const imagem = await carregarImagem(arquivo);
		const largura = imagem.width || imagem.naturalWidth, altura = imagem.height || imagem.naturalHeight;
		try {
			for (const limite of [m.tipo === "js" ? 1200 : 2000, 800]) {
				for (const graus of [0, 90]) {
					const escala = Math.min(1, limite / Math.max(largura, altura));
					const w = Math.max(1, Math.round(largura * escala)), h = Math.max(1, Math.round(altura * escala));
					const c = document.createElement("canvas");
					const x = c.getContext("2d", { willReadFrequently: true });
					if (graus === 90) {
						c.width = h; c.height = w;
						x.translate(h, 0);
						x.rotate(Math.PI / 2);
					} else {
						c.width = w; c.height = h;
					}
					x.drawImage(imagem, 0, 0, w, h);
					const resultados = await m.detect(c);
					const r = (resultados || []).find(r => String(r.rawValue || "").trim());
					if (r) return { codigo: String(r.rawValue).trim(), formato: r.format };
				}
			}
		} finally {
			imagem.close?.();
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
		foco,
		get ativo() { return rodando; },
		get motor() { return motor?.tipo || ""; }
	};
}
