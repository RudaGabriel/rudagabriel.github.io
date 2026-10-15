/* =========================================================
   Controle de Vencimento — aplicação principal
   ========================================================= */
import {
	explicarErro, ehUuid, uuidAleatorio, uuidDeTexto, gerarCodigoLista, normalizarCodigoLista, formatarCodigoLista
} from "./nuvem/comum.js";
import { criarFirebase } from "./nuvem/firebase.js";
import { criarSupabase } from "./nuvem/supabase.js";
import { criarDropbox } from "./nuvem/dropbox.js";
import { NUVEM } from "./config-nuvem.js";
import { criarLeitor } from "./leitor.js";
import { buscarNomeProduto, buscarNomesParecidos, codigoConsultavel, linksPesquisaCodigo } from "./produtos.js";
import { lerDatas, criarCameraValidade } from "./validade.js";
import { ligarInterfaceFoco } from "./foco.js";
import { chaveFoto, carregarFotos, guardarFoto, apagarFoto, precisaBuscar, buscarFotoAutomatica, fotosPorCodigo, fotosPorNome, nomeAbreviado, prepararFotoDaPessoa, aoCopiarFoto, copiarFotosPendentes } from "./fotos.js";
import { iniciarAnuncios } from "./anuncios.js";

const URL_AUTO_ANIMATE = "https://cdn.jsdelivr.net/npm/@formkit/auto-animate@0.10.0/index.mjs";
const URL_FUSE = "https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.mjs";
const URL_QRCODE = "https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js";

const CHAVE = {
	itens: "cv2:itens",
	nomeAparelho: "cv2:nomeAparelho",
	silenciados: "cv2:silenciados",
	alerta: "cv2:alerta",
	ordenacao: "cv2:ordenacao",
	sync: "cv2:sync",
	cacheNuvem: "cv2:cacheNuvem",
	migrado: "cv2:migrado",
	tema: "cv2:tema",
	loja: "cv2:loja",
	lojaOrigem: "cv2:lojaOrigem",
	formRecolhido: "cv2:formRecolhido",
	sugestaoAuto: "cv2:sugestaoAuto",
	fotosAuto: "cv2:fotosAuto",
	loginPendente: "cv2:loginPendente"
};

/* =========================================================
   Utilitários
   ========================================================= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const armazenamento = {
	ler(chave, padrao) {
		try {
			const bruto = localStorage.getItem(chave);
			if (bruto === null || bruto === "") return padrao;
			const valor = JSON.parse(bruto);
			return valor ?? padrao;
		} catch {
			return padrao;
		}
	},
	gravar(chave, valor) {
		try {
			localStorage.setItem(chave, JSON.stringify(valor));
			return true;
		} catch (e) {
			console.error("Falha ao salvar no aparelho:", e);
			toast("erro", "Não foi possível salvar no aparelho (armazenamento cheio ou bloqueado).");
			return false;
		}
	},
	remover(chave) {
		try { localStorage.removeItem(chave); } catch { /* ignora */ }
	},
	lerTexto(chave) {
		try { return localStorage.getItem(chave); } catch { return null; }
	},
	gravarTexto(chave, valor) {
		try { localStorage.setItem(chave, valor); } catch { /* ignora */ }
	}
};

const MAPA_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => MAPA_ESCAPE[c]);

const normalizar = texto => String(texto ?? "")
	.normalize("NFD").replace(/[̀-ͯ]/g, "")
	.toLowerCase().replace(/\s+/g, " ").trim();

/** Ids são UUIDs (exigência da nuvem). */
const gerarId = () => uuidAleatorio();

/** Ids antigos (versões anteriores) viram UUIDs determinísticos: o mesmo id antigo gera sempre o mesmo UUID. */
const normalizarId = id => (ehUuid(id) ? id.toLowerCase() : typeof id === "string" && id ? uuidDeTexto(`id:${id}`) : null);

function debounce(fn, ms) {
	let t;
	return (...args) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...args), ms);
	};
}

const fmtNumero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const fmtRelativo = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/* ---------- Datas (sempre em dias de calendário, sem fuso) ---------- */
const DIA_MS = 86400000;
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

/** Converte "AAAA-MM-DD" ou "DD/MM/AAAA" em "AAAA-MM-DD" válido, ou null. */
function normalizarData(valor) {
	const texto = String(valor ?? "").trim();
	let a, m, d;
	let achado = texto.match(RE_ISO);
	if (achado) {
		[a, m, d] = [Number(achado[1]), Number(achado[2]), Number(achado[3])];
	} else if ((achado = texto.match(RE_BR))) {
		[d, m, a] = [Number(achado[1]), Number(achado[2]), Number(achado[3])];
		if (a < 100) a += 2000;
	} else {
		return null;
	}
	if (a < 1900 || a > 2200 || m < 1 || m > 12 || d < 1) return null;
	const data = new Date(Date.UTC(a, m - 1, d));
	if (data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return null;
	return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function diaUTC(iso) {
	const [a, m, d] = iso.split("-").map(Number);
	return Date.UTC(a, m - 1, d);
}

function hojeUTC() {
	const h = new Date();
	return Date.UTC(h.getFullYear(), h.getMonth(), h.getDate());
}

function hojeISO() {
	const h = new Date();
	return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}

const diasAte = iso => Math.round((diaUTC(iso) - hojeUTC()) / DIA_MS);
const formatarData = iso => iso.split("-").reverse().join("/");

/* =========================================================
   Bibliotecas (com alternativas caso a CDN falhe)
   ========================================================= */
const cacheIcones = new Map();
function icone(nome, classe = "") {
	const chave = nome + "|" + classe;
	if (cacheIcones.has(chave)) return cacheIcones.get(chave);
	const no = window.lucide?.icons?.[nome];
	if (!Array.isArray(no)) return "";
	const filhos = no.map(([tag, attrs]) =>
		`<${tag} ${Object.entries(attrs || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`
	).join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide ${classe}" aria-hidden="true">${filhos}</svg>`;
	cacheIcones.set(chave, svg);
	return svg;
}

const paraPascal = nome => nome.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("");

function aplicarIconesEstaticos(raiz = document) {
	raiz.querySelectorAll("i[data-lucide]").forEach(el => {
		const svg = icone(paraPascal(el.getAttribute("data-lucide")));
		if (svg) el.outerHTML = svg;
		else el.remove();
	});
}

/* ---------- Avisos rápidos (Notyf) ---------- */
let notyf = null;
function iniciarNotyf() {
	if (!window.Notyf) return;
	try {
		notyf = new window.Notyf({
			duration: 3800,
			position: { x: "right", y: "bottom" },
			dismissible: true,
			ripple: false,
			types: [
				{ type: "success", background: "#0f9a6c" },
				{ type: "error", background: "#dc3c3c", duration: 6000 },
				{ type: "info", background: "#3b6ef5", icon: false },
				{ type: "aviso", background: "#c27a06", icon: false }
			]
		});
	} catch (e) {
		console.warn("Notyf indisponível:", e);
	}
}

const TIPOS_TOAST = { sucesso: "success", erro: "error", info: "info", aviso: "aviso" };
/** Exibe um aviso. "html" deve vir já escapado quando contiver dados do usuário. */
/** Mensagens de alerta sempre por cima de tudo, inclusive dos diálogos abertos (camada superior do navegador). */
function alertasPorCima() {
	const caixa = document.querySelector(".notyf");
	if (!caixa) return;
	try {
		// Com um diálogo aberto (modal), o navegador bloqueia o toque em tudo que está fora dele —
		// inclusive no ✕ das mensagens. Por isso a caixa das mensagens vai para dentro do diálogo
		// aberto mais recente (e volta para a página quando ele fecha). Ali ela é um elemento comum,
		// fixo e com z-index máximo: fica por cima de tudo e o toque não atravessa para trás
		// (a "camada do topo"/popover fazia o toque atravessar no Safari do iPhone).
		if (caixa.hasAttribute("popover")) {
			try { if (caixa.matches(":popover-open")) caixa.hidePopover(); } catch { /* ignora */ }
			caixa.removeAttribute("popover");
		}
		const destino = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
		if (caixa.parentElement !== destino) destino.appendChild(caixa);
	} catch { /* ignora: o z-index máximo continua valendo */ }
}
// Diálogo fechou com mensagens na tela: a caixa volta para a página (senão some junto com ele)
document.addEventListener("close", e => {
	const caixa = document.querySelector(".notyf");
	if (e.target instanceof HTMLDialogElement && caixa && e.target.contains(caixa)) alertasPorCima();
}, true);

function toast(tipo, html, duracao) {
	if (notyf) {
		const opcoes = { type: TIPOS_TOAST[tipo] || "info", message: html };
		if (duracao) opcoes.duration = duracao;
		try {
			const t = notyf.open(opcoes);
			alertasPorCima();
			return t;
		} catch { /* cai no console */ }
	}
	console.log(`[${tipo}]`, String(html).replace(/<[^>]+>/g, ""));
	return null;
}

const errosJaAvisados = new Set();
function toastUnico(tipo, html) {
	if (errosJaAvisados.has(html)) return;
	errosJaAvisados.add(html);
	toast(tipo, html);
}

/* ---------- Diálogos (SweetAlert2) em fila ---------- */
let filaDialogos = Promise.resolve();
const textoPuro = html => String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
	.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * Abre um diálogo; retorna "confirmar" | "negar" | "cancelar" e o valor do input.
 */
function dialogo({ titulo, html, icone: tipoIcone, confirmar = "OK", negar, cancelar, perigo = false, checkbox, input, foco = "confirmar" }) {
	const executar = async () => {
		if (!window.Swal) {
			const mensagem = `${titulo ? titulo + "\n\n" : ""}${textoPuro(html)}`;
			if (input) { const v = window.prompt(mensagem); return { acao: v === null ? "cancelar" : "confirmar", valor: v || "" }; }
			if (!cancelar && !negar) { window.alert(mensagem); return { acao: "confirmar", valor: false }; }
			return { acao: window.confirm(mensagem) ? "confirmar" : (negar ? "negar" : "cancelar"), valor: false };
		}
		const dialogoAberto = document.querySelector("dialog[open]");
		// A caixa de seleção vale em qualquer botão (o SweetAlert só a devolve ao confirmar)
		let caixaMarcada = false;
		const r = await window.Swal.fire({
			title: titulo,
			html,
			icon: tipoIcone,
			showCancelButton: !!cancelar,
			showDenyButton: !!negar,
			confirmButtonText: confirmar,
			denyButtonText: negar,
			cancelButtonText: cancelar,
			reverseButtons: true,
			buttonsStyling: false,
			heightAuto: false,
			focusConfirm: foco === "confirmar",
			focusCancel: foco === "cancelar",
			target: dialogoAberto || "body",
			input: checkbox ? "checkbox" : input || undefined,
			inputValue: checkbox ? 0 : undefined,
			inputPlaceholder: checkbox || undefined,
			willClose: checkbox ? popup => { caixaMarcada = !!popup.querySelector(".swal2-checkbox input")?.checked; } : undefined,
			customClass: {
				popup: "sw-popup",
				confirmButton: perigo ? "btn btn-perigo" : "btn btn-primario",
				denyButton: "btn btn-secundario",
				cancelButton: "btn btn-fantasma",
				input: input ? "sw-input" : undefined
			}
		});
		const acao = r.isConfirmed ? "confirmar" : r.isDenied ? "negar" : "cancelar";
		return { acao, valor: checkbox ? (caixaMarcada || !!r.value) : r.value };
	};
	const promessa = filaDialogos.then(executar, executar);
	filaDialogos = promessa.catch(() => { });
	return promessa.catch(e => {
		console.error(e);
		return { acao: "cancelar", valor: false };
	});
}

const confirmar = async opcoes => (await dialogo({ cancelar: "Cancelar", ...opcoes })).acao === "confirmar";

/* ---------- Carregamento sob demanda ---------- */
const scriptsCarregados = new Map();
function carregarScript(url) {
	if (scriptsCarregados.has(url)) return scriptsCarregados.get(url);
	const p = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = url;
		s.async = true;
		s.crossOrigin = "anonymous";
		s.onload = () => resolve();
		s.onerror = () => {
			scriptsCarregados.delete(url);
			s.remove();
			reject(new Error("Falha ao carregar " + url));
		};
		document.head.appendChild(s);
	});
	scriptsCarregados.set(url, p);
	return p;
}

/* =========================================================
   Modelo de dados
   ========================================================= */
function sanitizarItem(bruto) {
	if (!bruto || typeof bruto !== "object") return null;
	const nome = String(bruto.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
	const vencimento = normalizarData(bruto.vencimento);
	if (!nome || !vencimento) return null;
	let quantidade = Number(String(bruto.quantidade ?? 0).replace(",", "."));
	if (!Number.isFinite(quantidade) || quantidade < 0) quantidade = 0;
	quantidade = Math.round(quantidade * 1000) / 1000;
	const id = (typeof bruto.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(bruto.id) && normalizarId(bruto.id)) || gerarId();
	const agora = Date.now();
	const criadoEm = Number.isFinite(Number(bruto.criadoEm)) && Number(bruto.criadoEm) > 0 ? Number(bruto.criadoEm) : agora;
	const atualizadoEm = Number.isFinite(Number(bruto.atualizadoEm)) && Number(bruto.atualizadoEm) > 0 ? Number(bruto.atualizadoEm) : criadoEm;
	return {
		id,
		nome,
		quantidade,
		vencimento,
		codigoBarras: String(bruto.codigoBarras ?? "").replace(/\s+/g, "").slice(0, 64),
		criadoEm,
		atualizadoEm
	};
}

const sanitizarLista = lista => {
	const vistos = new Set();
	const saida = [];
	for (const bruto of Array.isArray(lista) ? lista : []) {
		const item = sanitizarItem(bruto);
		if (!item) continue;
		if (vistos.has(item.id)) item.id = gerarId();
		vistos.add(item.id);
		saida.push(item);
	}
	return saida;
};

/** Identifica produtos iguais: mesmo nome, código e vencimento. */
const chaveItem = item => `${normalizar(item.nome)}|${item.codigoBarras || ""}|${item.vencimento}`;

/* =========================================================
   Estado
   ========================================================= */
const estado = {
	itensLocais: [],
	itensNuvem: [],
	silenciados: new Set(),
	loja: "",
	lojaVerificadaEm: null,
	sugestaoAuto: false, // preencher o nome sozinho ao ler um código novo (desligado por padrão)
	fotosAuto: true,     // buscar a foto dos produtos sozinho (ligado por padrão; desliga no menu)
	fotos: new Map(),    // chave do produto → { src, origem, fonte }
	convidados: [],      // convidados da lista na nuvem: { codigo, nome, podeEditar, id }
	pedidos: [],         // dono: pedidos de acesso pendentes
	meuPedido: null,     // quem só visualiza: o próprio pedido de acesso
	alerta: { valor: 60, unidade: "dias" },
	filtro: "todos",
	busca: "",
	ordenacao: "prioridade",
	editandoId: null,
	sync: null,              // { provedor, codigo, modo: "edicao"|"leitura", papel: "dono"|"convidado", reconciliar }
	usuarios: {},            // conta logada em cada provedor de nuvem
	statusSync: "local",
	detalheSync: "",
	ultimaSync: null,
	dadosProntos: false,
	alertaInicialFeito: false
};

const emNuvem = () => !!estado.sync;
const podeEditar = () => !emNuvem() || estado.sync.modo !== "leitura";
/** Dono: criou a lista, entrou com a conta dona dela ou digitou o código. Convidado: entrou por um link compartilhado. */
const ehDono = () => !emNuvem() || estado.sync.papel !== "convidado";
const itensAtuais = () => (emNuvem() ? estado.itensNuvem : estado.itensLocais);

function limiteAlertaDias() {
	const n = Math.max(0, Math.min(3650, Math.floor(Number(estado.alerta.valor) || 0)));
	if (estado.alerta.unidade !== "meses") return n;
	const h = new Date();
	const alvo = Date.UTC(h.getFullYear(), h.getMonth() + n, h.getDate());
	return Math.round((alvo - hojeUTC()) / DIA_MS);
}

function situacao(item, limite) {
	const dias = diasAte(item.vencimento);
	const est = dias < 0 ? "vencido" : dias <= limite ? "alerta" : "ok";
	let texto;
	const abs = Math.abs(dias);
	if (abs >= 60) {
		const meses = Math.round(dias / 30.44);
		texto = fmtRelativo.format(meses, "month");
	} else {
		texto = fmtRelativo.format(dias, "day");
	}
	texto = (dias < 0 ? "Venceu " : "Vence ") + texto;
	return { dias, estado: est, texto };
}

/* =========================================================
   Migração da versão anterior (dados antigos são preservados)
   ========================================================= */
function migrarVersaoAnterior() {
	if (armazenamento.lerTexto(CHAVE.migrado)) return;
	try {
		const antigos = armazenamento.ler("produtos", []);
		if (Array.isArray(antigos) && antigos.length && !armazenamento.lerTexto(CHAVE.itens)) {
			const itens = sanitizarLista(antigos.map(p => ({ ...p, id: undefined })));
			armazenamento.gravar(CHAVE.itens, itens);

			const ignorados = armazenamento.ler("ignorados", []);
			if (Array.isArray(ignorados) && ignorados.length) {
				const ids = itens.filter(i => ignorados.includes(`${i.vencimento}+${i.codigoBarras}`)).map(i => i.id); // já são UUIDs
				armazenamento.gravar(CHAVE.silenciados, ids);
			}
		}

		const configAntiga = armazenamento.ler("configAlerta", null);
		if (configAntiga && typeof configAntiga === "object" && !armazenamento.lerTexto(CHAVE.alerta)) {
			armazenamento.gravar(CHAVE.alerta, {
				valor: Number(configAntiga.alertarValor) || 60,
				unidade: configAntiga.unidade === "meses" ? "meses" : "dias"
			});
		}

	} catch (e) {
		console.error("Falha na migração:", e);
	}
	armazenamento.gravarTexto(CHAVE.migrado, "1");
}

/* =========================================================
   Elementos
   ========================================================= */
const el = {
	form: $("#formProduto"),
	cartaoForm: $("#formProduto")?.closest(".cartao"),
	tituloForm: $("#tituloFormTexto"),
	avisoLeitura: $("#avisoLeitura"),
	codigo: $("#codigoBarras"),
	nome: $("#produto"),
	quantidade: $("#quantidade"),
	vencimento: $("#vencimento"),
	btnLerValidade: $("#btnLerValidade"),
	btnSugerirNome: $("#btnSugerirNome"),
	arquivoValidade: $("#arquivoValidade"),
	dlgValidade: $("#dlgValidade"),
	validadeArea: $("#validadeArea"),
	validadeVideo: $("#validadeVideo"),
	validadeFoto: $("#validadeFoto"),
	validadeMira: $("#validadeMira"),
	validadeSelecao: $("#validadeSelecao"),
	validadeStatus: $("#validadeStatus"),
	validadeDica: $("#validadeDica"),
	btnCapturarValidade: $("#btnCapturarValidade"),
	btnFotoValidade: $("#btnFotoValidade"),
	btnFlashValidade: $("#btnFlashValidade"),
	btnSalvar: $("#btnSalvar"),
	btnCancelarEdicao: $("#btnCancelarEdicao"),
	btnEscanear: $("#btnEscanear"),
	sugestoes: $("#sugestoesNomes"),
	lista: $("#lista"),
	vazio: $("#vazio"),
	vazioTitulo: $("#vazioTitulo"),
	vazioTexto: $("#vazioTexto"),
	rodapeLista: $("#rodapeLista"),
	filtro: $("#filtro"),
	nAlertar: $("#nAlertar"),
	como: $("#como"),
	ordenacao: $("#ordenacao"),
	btnSync: $("#btnSync"),
	btnSyncTexto: $("#btnSyncTexto"),
	btnTema: $("#btnTema"),
	menu: $("#menuMais"),
	arquivo: $("#arquivoImportar"),
	dlgLeitor: $("#dlgLeitor"),
	leitorStatus: $("#leitorStatus"),
	leitorArea: $("#leitorArea"),
	btnFotoForm: $("#btnFotoForm"),
	arquivoFotoProduto: $("#arquivoFotoProduto"),
	btnFoco: $("#btnFoco"),
	painelFoco: $("#painelFoco"),
	btnFocoValidade: $("#btnFocoValidade"),
	painelFocoValidade: $("#painelFocoValidade"),
	leitorVideo: $("#leitorVideo"),
	leitorMira: $("#leitorMira"),
	btnFlash: $("#btnFlash"),
	btnTrocarCamera: $("#btnTrocarCamera"),
	leitorZoomCaixa: $("#leitorZoomCaixa"),
	leitorZoom: $("#leitorZoom"),
	btnFotoCodigo: $("#btnFotoCodigo"),
	arquivoFotoCodigo: $("#arquivoFotoCodigo"),
	dlgSync: $("#dlgSync"),
	syncDesconectado: $("#syncDesconectado"),
	syncConectado: $("#syncConectado"),
	syncIndisponivel: $("#syncIndisponivel"),
	syncOpcoes: $("#syncOpcoes"),
	btnLoginGoogle: $("#btnLoginGoogle"),
	btnLoginDropbox: $("#btnLoginDropbox"),
	btnLoginEmail: $("#btnLoginEmail"),
	blocoEmail: $("#blocoEmail"),
	caixaEmail: $("#caixaEmail"),
	separadorSemLogin: $("#separadorSemLogin"),
	blocoCodigo: $("#blocoCodigo"),
	caixaCodigo: $("#caixaCodigo"),
	blocoCompartilhar: $("#blocoCompartilhar"),
	loginEmail: $("#loginEmail"),
	emailEnviadoMsg: $("#emailEnviadoMsg"),
	emailEnviadoPara: $("#emailEnviadoPara"),
	btnEmailAlternativo: $("#btnEmailAlternativo"),
	btnEnviarCodigo: $("#btnEnviarCodigo"),
	loginCodigoCaixa: $("#loginCodigoCaixa"),
	loginEmailTexto: $("#loginEmailTexto"),
	loginCodigo: $("#loginCodigo"),
	btnEntrarLogin: $("#btnEntrarLogin"),
	btnTrocarEmail: $("#btnTrocarEmail"),
	btnCriarLista: $("#btnCriarLista"),
	syncContaLinha: $("#syncContaLinha"),
	syncContaEmail: $("#syncContaEmail"),
	syncCodigo: $("#syncCodigo"),
	btnEntrarCodigo: $("#btnEntrarCodigo"),
	codigoLista: $("#codigoLista"),
	btnCopiarCodigo: $("#btnCopiarCodigo"),
	avisoLink: $("#avisoLink"),
	syncPermissaoTitulo: $("#syncPermissaoTitulo"),
	listaConvidados: $("#listaConvidados"),
	btnSouDono: $("#btnSouDono"),
	blocoPedido: $("#blocoPedido"),
	btnPedirAcesso: $("#btnPedirAcesso"),
	statusPedido: $("#statusPedido"),
	blocoPedidos: $("#blocoPedidos"),
	listaPedidos: $("#listaPedidos"),
	contadorPedidos: $("#contadorPedidos"),
	btnRevelarCodigo: $("#btnRevelarCodigo"),
	ajudaCodigo: $("#ajudaCodigo"),
	avisoConvidados: $("#avisoConvidados"),
	blocoNomeConvidado: $("#blocoNomeConvidado"),
	nomeConvidado: $("#nomeConvidado"),
	btnSalvarNomeConvidado: $("#btnSalvarNomeConvidado"),
	meuCodigoConvidado: $("#meuCodigoConvidado"),
	btnNovoConvidado: $("#btnNovoConvidado"),
	gradeLinkConvidado: $("#gradeLinkConvidado"),
	textoLinkConvidado: $("#textoLinkConvidado"),
	syncPermissaoAjuda: $("#syncPermissaoAjuda"),
	btnDesconectar: $("#btnDesconectar"),
	syncPermitirEdicao: $("#syncPermitirEdicao"),
	syncStatusBox: $(".status-sync"),
	syncStatusTitulo: $("#syncStatusTitulo"),
	syncStatusDetalhe: $("#syncStatusDetalhe"),
	linkCompartilhar: $("#linkCompartilhar"),
	btnCopiarLink: $("#btnCopiarLink"),
	btnCompartilharNativo: $("#btnCompartilharNativo"),
	qr: $("#qrCompartilhar")
};

/* =========================================================
   Renderização
   ========================================================= */
function ordenar(lista, ordem) {
	const porNome = (a, b) => a.item.nome.localeCompare(b.item.nome, "pt-BR", { sensitivity: "base" });
	const peso = { alerta: 0, ok: 1, vencido: 2 };
	const copia = [...lista];
	switch (ordem) {
		case "venc-asc": return copia.sort((a, b) => a.sit.dias - b.sit.dias || porNome(a, b));
		case "venc-desc": return copia.sort((a, b) => b.sit.dias - a.sit.dias || porNome(a, b));
		case "nome": return copia.sort((a, b) => porNome(a, b) || a.sit.dias - b.sit.dias);
		case "qtd": return copia.sort((a, b) => b.item.quantidade - a.item.quantidade || porNome(a, b));
		case "recentes": return copia.sort((a, b) => b.item.criadoEm - a.item.criadoEm);
		default:
			return copia.sort((a, b) => {
				const p = peso[a.sit.estado] - peso[b.sit.estado];
				if (p) return p;
				if (a.sit.estado === "vencido") return b.sit.dias - a.sit.dias || porNome(a, b);
				return a.sit.dias - b.sit.dias || porNome(a, b);
			});
	}
}

function htmlLinha(item, sit, silenciado, editando, editavel) {
	const codigo = item.codigoBarras
		? `<td class="celula-codigo" data-copiar title="Clique para copiar">${esc(item.codigoBarras)}</td>`
		: `<td class="celula-codigo"><span class="sem-codigo">Sem código</span></td>`;
	const sino = (sit.estado === "alerta" || silenciado)
		? `<button type="button" class="acao ${silenciado ? "acao-ativa" : ""}" data-acao="silenciar" title="${silenciado ? "Voltar a alertar ao abrir" : "Não alertar ao abrir"}" aria-label="${silenciado ? "Voltar a alertar" : "Silenciar alerta"}">${icone(silenciado ? "BellOff" : "Bell")}</button>`
		: "";
	const editar = editavel
		? `<button type="button" class="acao" data-acao="editar" title="${editando ? "Cancelar edição" : "Editar"}" aria-label="Editar">${icone(editando ? "X" : "Pencil")}</button>
		   <button type="button" class="acao acao-remover" data-acao="remover" title="Remover" aria-label="Remover">${icone("Trash2")}</button>`
		: "";
	const foto = estado.fotos.get(chaveFoto(item));
	const src = foto?.origem !== "nenhuma" ? foto?.src : "";
	const miniatura = `<button type="button" class="miniatura${src ? "" : " sem-foto"}" data-acao="foto" title="Foto do produto" aria-label="Foto de ${esc(item.nome)}">`
		+ (src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : icone("Package"))
		+ `</button>`;
	return `
		<td class="celula-nome"><div class="nome-com-foto">${miniatura}<span class="nome-texto">${esc(item.nome)}${silenciado ? `<span class="selo-silenciado" title="Alerta silenciado">${icone("BellOff")}</span>` : ""}</span></div></td>
		${codigo}
		<td class="celula-qtd num">${fmtNumero.format(item.quantidade)}</td>
		<td class="celula-data">${formatarData(item.vencimento)}</td>
		<td class="celula-situacao"><span class="selo selo-${sit.estado}">${esc(sit.texto)}</span></td>
		<td class="celula-acoes"><div class="acoes-linha">${sino}${editar}</div></td>`;
}

let linhasPorId = new Map();

function render() {
	const itens = itensAtuais();
	const limite = limiteAlertaDias();
	const hoje = new Date();
	const mesAtual = hoje.getMonth() + 1, anoAtual = hoje.getFullYear();
	const editavel = podeEditar();

	const calculados = itens.map(item => ({ item, sit: situacao(item, limite) }));
	const contagem = { todos: calculados.length, alerta: 0, vencidos: 0, mes: 0, ok: 0 };
	for (const c of calculados) {
		if (c.sit.estado === "alerta") contagem.alerta++;
		else if (c.sit.estado === "vencido") contagem.vencidos++;
		else contagem.ok++;
		const [a, m] = c.item.vencimento.split("-").map(Number);
		if (a === anoAtual && m === mesAtual) contagem.mes++;
		c.esteMes = a === anoAtual && m === mesAtual;
	}
	definirTotal("#totTodos", contagem.todos);
	definirTotal("#totAlerta", contagem.alerta);
	definirTotal("#totVencidos", contagem.vencidos);
	definirTotal("#totMes", contagem.mes);
	definirTotal("#totOk", contagem.ok);
	$$(".cartao-resumo").forEach(b => {
		const ativo = b.dataset.filtro === estado.filtro;
		b.classList.toggle("ativo", ativo);
		b.setAttribute("aria-pressed", String(ativo));
	});

	const busca = normalizar(estado.busca);
	const parecidos = busca ? produtosParecidos(calculados.map(c => c.item), busca) : null;
	const visiveis = ordenar(calculados.filter(c => {
		switch (estado.filtro) {
			case "alerta": if (c.sit.estado !== "alerta") return false; break;
			case "vencidos": if (c.sit.estado !== "vencido") return false; break;
			case "ok": if (c.sit.estado !== "ok") return false; break;
			case "mes": if (!c.esteMes) return false; break;
		}
		if (!busca) return true;
		return combinaBusca(c.item, busca) || parecidos.has(c.item.id);
	}), estado.ordenacao);

	// Atualização por chave: só reescreve linhas que mudaram (anima bem e é rápido).
	// Posiciona cada linha logo após a anterior, sem depender de índices — a animação
	// pode manter temporariamente no DOM linhas que estão saindo.
	const novas = new Map();
	let anterior = null;
	visiveis.forEach(({ item, sit }) => {
		const silenciado = estado.silenciados.has(item.id);
		const editando = estado.editandoId === item.id;
		const foto = estado.fotos.get(chaveFoto(item));
		const assinatura = [item.nome, item.codigoBarras, item.quantidade, item.vencimento, sit.texto, sit.estado, silenciado, editando, editavel, foto?.origem === "nenhuma" ? "" : foto?.src || ""].join("\u0001");
		let tr = linhasPorId.get(item.id);
		if (!tr) {
			tr = document.createElement("tr");
			tr.dataset.id = item.id;
		}
		if (tr.dataset.assinatura !== assinatura) {
			tr.innerHTML = htmlLinha(item, sit, silenciado, editando, editavel);
			tr.dataset.assinatura = assinatura;
			tr.className = `estado-${sit.estado}${editando ? " em-edicao" : ""}`;
		}
		const posicaoEsperada = anterior ? anterior.nextElementSibling : el.lista.firstElementChild;
		if (posicaoEsperada !== tr) el.lista.insertBefore(tr, posicaoEsperada);
		anterior = tr;
		novas.set(item.id, tr);
	});
	for (const [id, tr] of linhasPorId) if (!novas.has(id)) tr.remove();
	linhasPorId = novas;

	// Estado vazio
	const vazio = visiveis.length === 0;
	el.vazio.hidden = !vazio;
	el.lista.closest("table").classList.toggle("sem-linhas", vazio);
	if (vazio) {
		if (!itens.length) {
			el.vazioTitulo.textContent = emNuvem() && !estado.dadosProntos && estado.statusSync === "conectando" ? "Carregando lista compartilhada…" : "Nenhum produto cadastrado";
			el.vazioTexto.textContent = editavel ? "Adicione o primeiro produto usando o formulário acima." : "A lista compartilhada ainda está vazia.";
		} else {
			el.vazioTitulo.textContent = "Nada encontrado";
			el.vazioTexto.textContent = estado.busca ? "Nenhum produto corresponde à busca." : "Nenhum produto neste filtro.";
		}
	}

	// Rodapé
	const unidades = visiveis.reduce((s, c) => s + c.item.quantidade, 0);
	const partes = [];
	if (itens.length) partes.push(`Mostrando ${visiveis.length} de ${itens.length} produto${itens.length === 1 ? "" : "s"} · ${fmtNumero.format(unidades)} unidade${unidades === 1 ? "" : "s"}`);
	if (emNuvem() && estado.ultimaSync) partes.push(`Sincronizado às ${fmtHora.format(estado.ultimaSync)}`);
	el.rodapeLista.textContent = partes.join(" · ");

	// Sugestões de nomes
	const nomes = [...new Set(itens.map(i => i.nome))].sort((a, b) => a.localeCompare(b, "pt-BR")).slice(0, 300);
	const htmlNomes = nomes.map(n => `<option value="${esc(n)}"></option>`).join("");
	if (el.sugestoes.dataset.cache !== htmlNomes) {
		el.sugestoes.innerHTML = htmlNomes;
		el.sugestoes.dataset.cache = htmlNomes;
	}

	// Se o item em edição sumiu (ex.: removido em outro aparelho), encerra a edição
	if (estado.editandoId && !itens.some(i => i.id === estado.editandoId)) {
		toast("aviso", "O produto em edição foi removido em outro aparelho.");
		sairDaEdicao(true);
	}

	atualizarEstadoFormulario();
	agendarLayout();
	agendarBuscaFotos();
}

/* =========================================================
   Layout: formulário recolhível, setas do resumo e voltar ao topo
   ========================================================= */
const mqCelular = window.matchMedia?.("(max-width: 760px)");
const ehCelular = () => !!mqCelular?.matches;
const semMovimento = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const comportamentoRolagem = () => (semMovimento() ? "auto" : "smooth");
const SUAVE = "cubic-bezier(.2, .8, .2, 1)";

/** Número do resumo: troca o valor com um "pulo" para a mudança ser notada. */
function definirTotal(seletor, valor) {
	const alvo = $(seletor);
	if (!alvo) return;
	const texto = String(valor);
	if (alvo.textContent === texto) return;
	const tinhaValor = alvo.dataset.pronto === "1";
	alvo.textContent = texto;
	alvo.dataset.pronto = "1";
	if (!tinhaValor || semMovimento() || !alvo.animate) return;
	try {
		const cor = getComputedStyle(alvo.closest(".cartao-resumo") || alvo).getPropertyValue("--tom").trim();
		const meio = { transform: "translateY(-3px) scale(1.22)" };
		if (cor) meio.color = cor;
		alvo.animate([{ transform: "translateY(0) scale(1)" }, meio, { transform: "translateY(0) scale(1)" }], { duration: 480, easing: SUAVE });
	} catch { /* ignora */ }
}

let animacaoForm = null; // { animacao, alvo }
function definirFormRecolhido(recolher, { lembrar = true, animar = false } = {}) {
	const cartao = el.cartaoForm;
	if (!cartao) return;
	recolher = !!recolher;
	$("#btnRecolherForm")?.setAttribute("aria-expanded", String(!recolher));
	if (lembrar) armazenamento.gravarTexto(CHAVE.formRecolhido, recolher ? "1" : "0");
	// Animação anterior em andamento: encerra já no estado que ela pretendia (o evento de
	// cancelamento é assíncrono e não pode sobrescrever o estado novo)
	if (animacaoForm) {
		const { animacao, alvo } = animacaoForm;
		animacao.onfinish = animacao.oncancel = null;
		try { animacao.cancel(); } catch { /* ignora */ }
		cartao.style.overflow = "";
		cartao.classList.toggle("recolhido", alvo);
		animacaoForm = null;
	}

	const aplicar = () => { cartao.classList.toggle("recolhido", recolher); agendarLayout(); };
	if (!animar || !ehCelular() || semMovimento() || !cartao.animate || cartao.classList.contains("recolhido") === recolher) return aplicar();

	// Mede a altura antes e depois e anima entre as duas (o conteúdo some só no fim ao recolher)
	const antes = cartao.getBoundingClientRect().height;
	cartao.classList.toggle("recolhido", recolher);
	const depois = cartao.getBoundingClientRect().height;
	if (recolher) cartao.classList.remove("recolhido");
	cartao.style.overflow = "hidden";
	const animacao = cartao.animate([{ height: `${antes}px` }, { height: `${depois}px` }], { duration: 360, easing: SUAVE });
	animacaoForm = { animacao, alvo: recolher };
	const concluir = () => { cartao.style.overflow = ""; animacaoForm = null; aplicar(); };
	animacao.onfinish = concluir;
	animacao.oncancel = concluir;
	if (!recolher) aplicar();
}

/** Mostra as setas do resumo só do lado em que ainda há cartões fora da tela. */
function atualizarSetasResumo() {
	const envoltorio = $(".resumo-envoltorio"), resumo = $(".resumo");
	if (!envoltorio || !resumo) return;
	const maximo = resumo.scrollWidth - resumo.clientWidth;
	envoltorio.classList.toggle("tem-esquerda", maximo > 2 && resumo.scrollLeft > 2);
	envoltorio.classList.toggle("tem-direita", maximo > 2 && resumo.scrollLeft < maximo - 2);
}

/** Quem rola a lista: o próprio cartão (tela com espaço) ou a página. */
function rolagemDaLista() {
	const envoltorio = $(".tabela-envoltorio");
	if (envoltorio && /auto|scroll/.test(getComputedStyle(envoltorio).overflowY) && envoltorio.scrollHeight > envoltorio.clientHeight + 1) return envoltorio;
	return null;
}

function atualizarBotaoTopo() {
	const botao = $("#btnTopoLista");
	if (!botao) return;
	const rolador = rolagemDaLista();
	const posicao = rolador ? rolador.scrollTop : (document.scrollingElement?.scrollTop || 0);
	const altura = rolador ? rolador.clientHeight : window.innerHeight;
	// Aparece cedo: depois de rolar cerca de meia tela da lista (mín. 90px, máx. 360px).
	// Some só um pouco antes do limite (evita piscar na fronteira).
	const limite = Math.max(90, Math.min(altura * 0.5, 360));
	const jaVisivel = botao.classList.contains("visivel");
	const mostrar = jaVisivel ? posicao > limite * 0.6 : posicao > limite;
	botao.classList.toggle("fixo", !rolador);
	botao.classList.toggle("visivel", mostrar);
	// O botão fica na barra "Mostrando…" (abaixo da lista): abre espaço para ele lá,
	// sem sobrar vão na lista e sem cobrir nenhum produto
	$(".cartao-lista")?.classList.toggle("topo-visivel", mostrar && !!rolador);
	botao.tabIndex = mostrar ? 0 : -1;
	botao.setAttribute("aria-hidden", String(!mostrar));
}

/** A lista tem sempre espaço para pelo menos 3 produtos (medidos de verdade). */
function atualizarAlturaMinimaLista() {
	const envoltorio = $(".tabela-envoltorio");
	if (!envoltorio) return;
	// Do topo da área da lista (com o cabeçalho da tabela, se houver) até o fim do
	// 3º produto — vale para tabela (computador) e cartões (celular/tablet em 2 colunas).
	// Só age quando faltaria espaço: com 3 ou mais visíveis, nada muda.
	let altura = 0;
	const linhas = [...envoltorio.querySelectorAll("tbody tr")].slice(0, 3);
	if (linhas.length) {
		const topo = envoltorio.getBoundingClientRect().top - envoltorio.scrollTop + envoltorio.clientTop;
		altura = Math.max(...linhas.map(tr => tr.getBoundingClientRect().bottom)) - topo;
	}
	const valor = altura > 0 ? `${Math.ceil(altura)}px` : "";
	if (envoltorio.style.getPropertyValue("--min-lista") !== valor) {
		if (valor) envoltorio.style.setProperty("--min-lista", valor);
		else envoltorio.style.removeProperty("--min-lista");
	}
}

/** Computador: leva o resumo para a barra do topo quando cabe inteiro; senão, deixa no lugar.
 *  O resumo real só muda de lugar quando a decisão muda (mover reinicia animações);
 *  quando ele está na página, a medição usa uma cópia invisível. */
const mqComputador = window.matchMedia?.("(min-width: 1000px)");
function posicionarResumo() {
	const envoltorio = $(".resumo-envoltorio"), slot = $("#slotResumoTopo"), pagina = $(".pagina"), topo = $(".topo-conteudo");
	if (!envoltorio || !slot || !pagina || !topo) return;
	const titulo = $(".marca h1");
	const nomeInteiro = () => !titulo || titulo.scrollWidth <= titulo.clientWidth + 1;
	const devolver = () => {
		if (envoltorio.parentElement !== pagina) pagina.prepend(envoltorio);
		topo.classList.remove("com-resumo");
	};
	if (!mqComputador?.matches) return devolver();

	const estaNoTopo = envoltorio.parentElement === slot;
	let cabe;
	if (estaNoTopo) {
		cabe = envoltorio.scrollWidth <= slot.clientWidth + 1 && nomeInteiro();
	} else {
		// Mede uma cópia invisível no topo, sem mexer no resumo real
		const tinhaClasse = topo.classList.contains("com-resumo");
		topo.classList.add("com-resumo");
		const copia = envoltorio.cloneNode(true);
		copia.querySelectorAll("[id]").forEach(e => e.removeAttribute("id"));
		copia.setAttribute("aria-hidden", "true");
		copia.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;animation:none";
		slot.style.position = "relative";
		slot.appendChild(copia);
		cabe = copia.scrollWidth <= slot.clientWidth + 1 && nomeInteiro();
		copia.remove();
		slot.style.position = "";
		if (!tinhaClasse) topo.classList.remove("com-resumo");
	}
	if (cabe) {
		if (!estaNoTopo) slot.appendChild(envoltorio);
		topo.classList.add("com-resumo");
	} else {
		devolver();
	}
}

let quadroLayout = 0;
function agendarLayout() {
	if (quadroLayout) return;
	quadroLayout = requestAnimationFrame(() => {
		quadroLayout = 0;
		posicionarResumo();
		atualizarAlturaMinimaLista();
		atualizarSetasResumo();
		atualizarBotaoTopo();
	});
}

function registrarEventosLayout() {
	// Formulário: toque no cabeçalho ou na seta recolhe/expande (só no celular)
	el.cartaoForm?.querySelector(".cartao-cabecalho")?.addEventListener("click", e => {
		if (!ehCelular() || e.target.closest("a, input, select, textarea")) return;
		const recolhidoAgora = $("#btnRecolherForm")?.getAttribute("aria-expanded") === "false";
		definirFormRecolhido(!recolhidoAgora, { animar: true });
	});

	// Setas do resumo
	const resumo = $(".resumo");
	resumo?.addEventListener("scroll", () => { $(".resumo-envoltorio")?.classList.add("ja-rolou"); agendarLayout(); }, { passive: true });
	$$(".resumo-seta").forEach(b => b.addEventListener("click", () => {
		if (!resumo) return;
		resumo.scrollBy({ left: Number(b.dataset.rolar) * resumo.clientWidth * 0.8, behavior: comportamentoRolagem() });
	}));

	// Voltar ao topo
	$(".tabela-envoltorio")?.addEventListener("scroll", agendarLayout, { passive: true });
	window.addEventListener("scroll", agendarLayout, { passive: true });
	window.addEventListener("resize", agendarLayout, { passive: true });
	mqCelular?.addEventListener?.("change", agendarLayout);
	mqComputador?.addEventListener?.("change", agendarLayout);
	// A largura do texto muda quando as fontes terminam de carregar
	document.fonts?.ready?.then(agendarLayout).catch(() => { });
	$("#btnTopoLista")?.addEventListener("click", () => {
		const rolador = rolagemDaLista();
		if (rolador) rolador.scrollTo({ top: 0, behavior: comportamentoRolagem() });
		else window.scrollTo({ top: 0, behavior: comportamentoRolagem() });
	});
	if ("ResizeObserver" in window) {
		try {
			const observador = new ResizeObserver(agendarLayout);
			observador.observe(document.body);
			if (el.lista) observador.observe(el.lista);
		} catch { /* ignora */ }
	}
}

function atualizarEstadoFormulario() {
	const editavel = podeEditar();
	el.avisoLeitura.hidden = editavel;
	[el.codigo, el.nome, el.quantidade, el.vencimento, el.btnSalvar, el.btnEscanear, el.btnLerValidade].forEach(c => { if (c) c.disabled = !editavel; });
	atualizarBotoesCampos();
	const editando = !!estado.editandoId;
	el.cartaoForm?.classList.toggle("editando", editando);
	el.tituloForm.textContent = editando ? "Editando produto" : "Novo produto";
	el.btnCancelarEdicao.hidden = !editando;
	el.btnSalvar.classList.toggle("modo-edicao", editando);
	el.btnSalvar.innerHTML = editando
		? `${icone("Save")}<span>Salvar alterações</span>`
		: `${icone("Plus")}<span>Adicionar</span>`;
}

/* =========================================================
   Persistência (local ou nuvem)
   ========================================================= */
/**
 * Aplica alterações no armazenamento ativo.
 * @param {{salvar?: object[], remover?: string[]}} alteracoes
 */
function aplicarAlteracoes({ salvar = [], remover = [] }) {
	if (!podeEditar()) {
		toast("aviso", "Este aparelho está no modo <b>somente leitura</b>.");
		return false;
	}
	const idsRemover = new Set(remover);
	const porId = new Map(salvar.map(i => [i.id, i]));
	const atual = itensAtuais();
	const nova = atual.filter(i => !idsRemover.has(i.id) && !porId.has(i.id)).concat(salvar);

	if (emNuvem()) {
		estado.itensNuvem = nova;   // atualização otimista
		const prov = provAtual();
		if (salvar.length) prov?.salvarVarios(salvar).catch(() => { });
		if (remover.length) prov?.removerVarios(remover).catch(() => { });
	} else {
		estado.itensLocais = nova;
		armazenamento.gravar(CHAVE.itens, nova);
	}
	if (remover.length) {
		let mudou = false;
		for (const id of remover) if (estado.silenciados.delete(id)) mudou = true;
		if (mudou) salvarSilenciados();
	}
	render();
	return true;
}

const salvarSilenciados = () => armazenamento.gravar(CHAVE.silenciados, [...estado.silenciados]);

/* =========================================================
   Formulário
   ========================================================= */
function lerFormulario() {
	const dados = {
		codigoBarras: el.codigo.value.replace(/\s+/g, ""),
		nome: el.nome.value.replace(/\s+/g, " ").trim(),
		quantidadeTexto: el.quantidade.value.trim(),
		vencimento: normalizarData(el.vencimento.value)
	};
	const erros = [];
	[el.nome, el.quantidade, el.vencimento].forEach(c => c.removeAttribute("aria-invalid"));
	if (!dados.nome) erros.push(el.nome);
	const qtd = Number(dados.quantidadeTexto.replace(",", "."));
	if (dados.quantidadeTexto === "" || !Number.isFinite(qtd) || qtd < 0) erros.push(el.quantidade);
	if (!dados.vencimento) erros.push(el.vencimento);
	erros.forEach(c => c.setAttribute("aria-invalid", "true"));
	dados.quantidade = Math.round(qtd * 1000) / 1000;
	return { dados, erros };
}

function limparFormulario() {
	el.form.reset();
	definirFotoPendente(null); // também atualiza os botões ✨ e foto
	[el.nome, el.quantidade, el.vencimento].forEach(c => c.removeAttribute("aria-invalid"));
	// Formulário limpo: nenhum campo continua verde
	[el.codigo, el.nome, el.vencimento].forEach(c => temposRealce.get(c)?.limpar() ?? c.classList.remove("sugerido", "sugerido-saindo"));
}

function sairDaEdicao(silencioso = false) {
	estado.editandoId = null;
	limparFormulario();
	if (!silencioso) render();
	else atualizarEstadoFormulario();
}

async function enviarFormulario(evento) {
	evento.preventDefault();
	if (!podeEditar()) return toast("aviso", "Este aparelho está no modo <b>somente leitura</b>.");

	const { dados, erros } = lerFormulario();
	if (erros.length) {
		erros[0].focus();
		const nomes = erros.map(c => c === el.nome ? "produto" : c === el.quantidade ? "quantidade" : "vencimento");
		return toast("erro", `Preencha corretamente: <b>${nomes.join(", ")}</b>.`);
	}

	const agora = Date.now();
	const itens = itensAtuais();
	const novo = { nome: dados.nome, quantidade: dados.quantidade, vencimento: dados.vencimento, codigoBarras: dados.codigoBarras };
	const chaveNova = chaveItem(novo);

	if (estado.editandoId) {
		const original = itens.find(i => i.id === estado.editandoId);
		if (!original) {
			sairDaEdicao();
			return toast("aviso", "Este produto não existe mais.");
		}
		const duplicado = itens.find(i => i.id !== original.id && chaveItem(i) === chaveNova);
		if (duplicado) {
			const total = duplicado.quantidade + novo.quantidade;
			const ok = await confirmar({
				titulo: "Produto repetido",
				html: `Já existe <b>${esc(duplicado.nome)}</b> com o mesmo código e vencimento (<b>${formatarData(duplicado.vencimento)}</b>).<br><br>Deseja juntar os dois? A quantidade ficará <b>${fmtNumero.format(total)}</b>.`,
				confirmar: "Juntar",
				icone: "question"
			});
			if (!ok) return;
			aplicarAlteracoes({ salvar: [{ ...duplicado, quantidade: total, atualizadoEm: agora }], remover: [original.id] });
		} else {
			aplicarAlteracoes({ salvar: [{ ...original, ...novo, atualizadoEm: agora }] });
		}
		await aplicarFotoPendente(novo);
		toast("sucesso", `Alterações salvas em <b>${esc(novo.nome)}</b>.`);
		sairDaEdicao();
		el.codigo.focus();
		return;
	}

	const existente = itens.find(i => chaveItem(i) === chaveNova);
	if (existente) {
		if (existente.quantidade === novo.quantidade) {
			limparFormulario();
			return toast("info", `<b>${esc(novo.nome)}</b> já está na lista com essa quantidade.`);
		}
		const soma = existente.quantidade + novo.quantidade;
		const { acao } = await dialogo({
			titulo: "Produto já cadastrado",
			html: `<b>${esc(existente.nome)}</b> com vencimento em <b>${formatarData(existente.vencimento)}</b> já está na lista.<br><br>Quantidade atual: <b>${fmtNumero.format(existente.quantidade)}</b> · Informada agora: <b>${fmtNumero.format(novo.quantidade)}</b>`,
			icone: "question",
			confirmar: `Somar (${fmtNumero.format(soma)})`,
			negar: `Substituir por ${fmtNumero.format(novo.quantidade)}`,
			cancelar: "Cancelar"
		});
		if (acao === "cancelar") return;
		const quantidade = acao === "confirmar" ? soma : novo.quantidade;
		await aplicarFotoPendente(existente);
		aplicarAlteracoes({ salvar: [{ ...existente, quantidade, atualizadoEm: agora }] });
		toast("sucesso", `Quantidade de <b>${esc(existente.nome)}</b> atualizada para <b>${fmtNumero.format(quantidade)}</b>.`);
	} else {
		const item = sanitizarItem({ ...novo, id: gerarId(), criadoEm: agora, atualizadoEm: agora });
		if (!item) return toast("erro", "Dados inválidos.");
		await aplicarFotoPendente(item);
		aplicarAlteracoes({ salvar: [item] });
		const dias = diasAte(item.vencimento);
		if (dias < 0) toast("aviso", `<b>${esc(item.nome)}</b> foi adicionado, mas <b>já está vencido</b>.`);
		else toast("sucesso", `<b>${esc(item.nome)}</b> adicionado.`);
	}
	limparFormulario();
	if (estado.filtro !== "todos") {
		estado.filtro = "todos";
		render();
	}
	el.codigo.focus();
}

function iniciarEdicao(id) {
	if (!podeEditar()) return;
	if (estado.editandoId === id) return sairDaEdicao();
	const item = itensAtuais().find(i => i.id === id);
	if (!item) return;
	estado.editandoId = id;
	definirFormRecolhido(false, { lembrar: false, animar: true });
	el.codigo.value = item.codigoBarras;
	el.nome.value = item.nome;
	el.quantidade.value = item.quantidade;
	el.vencimento.value = item.vencimento;
	[el.nome, el.quantidade, el.vencimento].forEach(c => c.removeAttribute("aria-invalid"));
	render();
	el.cartaoForm?.scrollIntoView({ behavior: "smooth", block: "start" });
	setTimeout(() => el.nome.focus({ preventScroll: true }), 250);
}

let ultimoRemovido = null;
async function removerItem(id) {
	if (!podeEditar()) return;
	const item = itensAtuais().find(i => i.id === id);
	if (!item) return;
	const ok = await confirmar({
		titulo: "Remover produto?",
		html: `<b>${esc(item.nome)}</b><br>Vencimento: <b>${formatarData(item.vencimento)}</b> · Quantidade: <b>${fmtNumero.format(item.quantidade)}</b>`,
		confirmar: "Remover",
		perigo: true,
		icone: "warning",
		foco: "cancelar"
	});
	if (!ok) return;
	if (estado.editandoId === id) sairDaEdicao(true);
	ultimoRemovido = { ...item, silenciado: estado.silenciados.has(id) };
	if (aplicarAlteracoes({ remover: [id] })) {
		toast("info", `<b>${esc(item.nome)}</b> removido. <button type="button" class="toast-desfazer" data-desfazer="${esc(id)}">Desfazer</button>`, 6000);
	}
}

function desfazerRemocao(id) {
	if (!ultimoRemovido || ultimoRemovido.id !== id) return;
	const { silenciado, ...item } = ultimoRemovido;
	ultimoRemovido = null;
	if (itensAtuais().some(i => i.id === id)) return;
	if (aplicarAlteracoes({ salvar: [{ ...item, atualizadoEm: Date.now() }] })) {
		if (silenciado) { estado.silenciados.add(id); salvarSilenciados(); render(); }
		toast("sucesso", `<b>${esc(item.nome)}</b> restaurado.`);
	}
}

function alternarSilencio(id) {
	if (estado.silenciados.has(id)) {
		estado.silenciados.delete(id);
		toast("info", "Este produto voltará a ser alertado ao abrir o app.");
	} else {
		estado.silenciados.add(id);
		toast("info", "Alerta silenciado para este produto neste aparelho.");
	}
	salvarSilenciados();
	render();
}

async function copiarTexto(texto) {
	try {
		await navigator.clipboard.writeText(texto);
		return true;
	} catch {
		const ta = document.createElement("textarea");
		ta.value = texto;
		ta.setAttribute("readonly", "");
		ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
		(document.querySelector("dialog[open]") || document.body).appendChild(ta);
		ta.select();
		let ok = false;
		try { ok = document.execCommand("copy"); } catch { ok = false; }
		ta.remove();
		return ok;
	}
}

/** Preenche o nome automaticamente quando o código já existe na lista. */
function autoPreencherPorCodigo() {
	const codigo = el.codigo.value.replace(/\s+/g, "");
	if (!codigo || el.nome.value.trim() || estado.editandoId) return false;
	const conhecido = itensAtuais().slice().sort((a, b) => b.atualizadoEm - a.atualizadoEm).find(i => i.codigoBarras === codigo);
	if (!conhecido) {
		// Não está na lista: com a sugestão automática ligada, tenta a base pública de produtos
		if (estado.sugestaoAuto) sugerirNomeOnline(codigo);
		return false;
	}
	el.nome.value = conhecido.nome;
	el.nome.removeAttribute("aria-invalid");
	atualizarBotoesCampos();
	toast("info", `Produto reconhecido: <b>${esc(conhecido.nome)}</b>`, 2500);
	return true;
}

/** Realça um campo preenchido automaticamente: pisca em verde (deu certo) e some sozinho em ~5 s. */
const temposRealce = new WeakMap();
const DURACAO_REALCE_MS = 5000;
function marcarSugerido(campo) {
	if (!campo) return;
	const anterior = temposRealce.get(campo);
	if (anterior) { clearTimeout(anterior.saida); clearTimeout(anterior.fim); campo.removeEventListener("input", anterior.limpar); }
	campo.classList.remove("sugerido", "sugerido-saindo");
	void campo.offsetWidth; // reinicia a animação do realce
	campo.classList.add("sugerido");
	const limpar = () => {
		const t = temposRealce.get(campo);
		if (t) { clearTimeout(t.saida); clearTimeout(t.fim); }
		temposRealce.delete(campo);
		campo.classList.remove("sugerido", "sugerido-saindo");
		campo.removeEventListener("input", limpar);
	};
	const saida = setTimeout(() => campo.classList.add("sugerido-saindo"), DURACAO_REALCE_MS);
	const fim = setTimeout(limpar, DURACAO_REALCE_MS + 700);
	temposRealce.set(campo, { saida, fim, limpar });
	campo.addEventListener("input", limpar);
}

/* ---------- Nome sugerido pelo código de barras (Open Food Facts) ---------- */
const PLACEHOLDER_NOME = el.nome?.placeholder || "";
let buscaNome = null;
async function sugerirNomeOnline(codigo) {
	if (!codigoConsultavel(codigo) || !podeEditar() || estado.editandoId) return;
	buscaNome?.abort();
	const controle = new AbortController();
	buscaNome = controle;
	el.nome.placeholder = "Buscando o nome do produto…";
	try {
		const resultado = await buscarNomeProduto(codigo, { sinal: controle.signal });
		if (controle.signal.aborted) return;
		if (!resultado) {
			// Não achou o código exato: oferece os nomes mais plausíveis (mesmo fabricante); sem nada, fica quieto
			const parecidos = await nomesParecidos(codigo, controle.signal);
			const aindaVale = () => !controle.signal.aborted && !el.nome.value.trim() && el.codigo.value.replace(/\s+/g, "") === codigo && !estado.editandoId;
			if (!parecidos.length || !aindaVale()) return;
			const nome = await escolherNomeParecido(codigo, parecidos);
			if (nome && aindaVale()) aplicarNomeSugerido(nome);
			return;
		}
		// Só preenche se a pessoa não digitou nada e o código continua o mesmo
		if (el.nome.value.trim() || el.codigo.value.replace(/\s+/g, "") !== codigo || estado.editandoId) return;
		el.nome.value = resultado.nome;
		el.nome.removeAttribute("aria-invalid");
		marcarSugerido(el.nome);
		atualizarBotoesCampos();
		toast("info", `Nome sugerido: <b>${esc(resultado.nome)}</b>. Confira e ajuste se precisar <small>(função experimental)</small>.`, 5000);
	} catch (e) {
		console.warn("[nome sugerido]", e);
	} finally {
		if (buscaNome === controle) {
			buscaNome = null;
			el.nome.placeholder = PLACEHOLDER_NOME;
		}
	}
}

/** Aviso das funções experimentais (nome sugerido, foto e leitura da validade). */
const avisoExperimental = (texto = "pode não ser totalmente precisa. Confira sempre.") =>
	`<p class="aviso-experimental">${icone("FlaskConical")}<span><b>Função experimental:</b> ${texto}</span></p>`;

/** Preenche o campo Produto com um nome sugerido (realçado para conferir). */
function aplicarNomeSugerido(nome) {
	el.nome.value = nome;
	el.nome.removeAttribute("aria-invalid");
	marcarSugerido(el.nome);
	atualizarBotoesCampos();
}

/**
 * Nomes mais plausíveis para um código que não está nas bases: produtos da sua
 * lista e das bases públicas com o mesmo prefixo (fabricante) e código mais próximo.
 */
async function nomesParecidos(codigo, sinal) {
	const ean = codigo.padStart(13, "0");
	const daLista = [];
	if (/^\d{13}$/.test(ean)) {
		const vistos = new Set();
		for (const item of itensAtuais().slice().sort((a, b) => b.atualizadoEm - a.atualizadoEm)) {
			const outro = String(item.codigoBarras || "").padStart(13, "0");
			if (!/^\d{13}$/.test(outro) || outro === ean || outro.slice(0, 9) !== ean.slice(0, 9) || !item.nome) continue;
			const chave = item.nome.trim().toLowerCase();
			if (vistos.has(chave)) continue;
			vistos.add(chave);
			daLista.push({ nome: item.nome, codigo: item.codigoBarras, fonte: "sua lista", distancia: Math.abs(Number(outro.slice(0, 12)) - Number(ean.slice(0, 12))) });
		}
	}
	let publicos = [];
	try { publicos = await buscarNomesParecidos(codigo, { sinal, limite: 8 }); } catch (e) { console.warn("[nomes parecidos]", e); }
	const todos = [...daLista, ...publicos].sort((a, b) => a.distancia - b.distancia);
	const unicos = [];
	const nomes = new Set();
	for (const t of todos) {
		const chave = t.nome.trim().toLowerCase();
		if (!nomes.has(chave)) { nomes.add(chave); unicos.push(t); }
	}
	return unicos.slice(0, 8); // os mais plausíveis (até 8)
}

/**
 * Mostra os nomes parecidos para a pessoa escolher.
 * @returns {Promise<string|null>} o nome escolhido ou null
 */
async function escolherNomeParecido(codigo, opcoes) {
	if (!window.Swal) {
		return window.confirm(`Código ${codigo} não encontrado. Usar o nome parecido “${opcoes[0].nome}”?`) ? opcoes[0].nome : null;
	}
	let escolhido = opcoes[0].nome;
	const html = avisoExperimental("os nomes são palpites e podem não ser deste produto.") + `<p>O código <b>${esc(codigo)}</b> não está nas bases. Estes são do <b>mesmo fabricante</b>, com código parecido — escolha o mais próximo e ajuste depois se precisar:</p>`
		+ `<div class="opcoes-data opcoes-nome" role="radiogroup" aria-label="Nomes parecidos">${opcoes.map((o, i) =>
			`<button type="button" class="opcao-data opcao-nome" role="radio" data-i="${i}" aria-checked="${i === 0}">`
			+ `<b>${esc(o.nome)}</b><small>${esc(o.fonte)} · ${esc(o.codigo)}</small></button>`).join("")}</div>`
		+ `<p class="ajuda links-web">Não é nenhum? Pesquise na web: ${htmlLinksPesquisa(codigo, true)}</p>`;
	const executar = async () => {
		const r = await window.Swal.fire({
			title: "Escolha o nome do produto",
			html,
			showCancelButton: true,
			confirmButtonText: "Usar este nome",
			cancelButtonText: "Nenhum destes",
			reverseButtons: true,
			buttonsStyling: false,
			heightAuto: false,
			target: document.querySelector("dialog[open]") || "body",
			customClass: { popup: "sw-popup", confirmButton: "btn btn-primario", cancelButton: "btn btn-fantasma" },
			didOpen: popup => {
				popup.querySelectorAll(".opcao-nome").forEach(b => b.addEventListener("click", () => {
					escolhido = opcoes[Number(b.dataset.i)]?.nome || escolhido;
					popup.querySelectorAll(".opcao-nome").forEach(o => o.setAttribute("aria-checked", String(o === b)));
				}));
			}
		});
		return r.isConfirmed ? escolhido : null;
	};
	// Na fila dos diálogos, para não atropelar outro aberto
	const promessa = filaDialogos.then(executar, executar);
	filaDialogos = promessa.catch(() => { });
	return promessa.catch(e => { console.error(e); return null; });
}

/** Links "Pesquisar no Google" / "Ver no Cosmos" para o código (abrem em outra aba). */
function htmlLinksPesquisa(codigo, compacto = false) {
	return linksPesquisaCodigo(codigo).map(l =>
		`<a class="${compacto ? "link-toast" : "btn btn-secundario btn-bloco"}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.nome)}</a>`
	).join(compacto ? " · " : "");
}

/* ---------- Sugestão sob demanda (botão ✨ no campo Produto) ---------- */
let sugerindoManual = false;
async function sugerirNomeManual() {
	if (sugerindoManual) return;
	if (!podeEditar()) return toast("aviso", "Este aparelho está no modo <b>somente leitura</b>.");
	const codigo = el.codigo.value.replace(/\s+/g, "");
	if (!codigo) {
		toast("info", "Leia ou digite o <b>código de barras</b> primeiro; depois toque aqui para sugerir o nome.");
		el.codigo.focus();
		return;
	}
	if (!codigoConsultavel(codigo)) return toast("aviso", "Esse código não é de um produto comum (EAN/UPC). Digite o nome.");
	sugerindoManual = true;
	el.btnSugerirNome?.classList.add("carregando");
	el.btnSugerirNome?.setAttribute("aria-busy", "true");
	try {
		const naLista = itensAtuais().slice().sort((a, b) => b.atualizadoEm - a.atualizadoEm).find(i => i.codigoBarras === codigo);
		const resultado = naLista ? { nome: naLista.nome, fonte: "sua lista de produtos" } : await buscarNomeProduto(codigo);
		if (!resultado) {
			if (navigator.onLine === false) return toast("aviso", "Sem internet para buscar o nome agora.", 5000);
			// Código exato fora das bases: mostra os nomes mais plausíveis para escolher
			const parecidos = await nomesParecidos(codigo);
			if (parecidos.length) {
				const nome = await escolherNomeParecido(codigo, parecidos);
				if (nome && el.codigo.value.replace(/\s+/g, "") === codigo) {
					aplicarNomeSugerido(nome);
					el.quantidade.focus();
				}
				return;
			}
			// Nada parecido: oferece pesquisar o código na web (abre em outra aba)
			const { acao } = await dialogo({
				titulo: "Produto não encontrado",
				html: `<p>O código <b>${esc(codigo)}</b> não está nas bases públicas consultadas.</p>`
					+ `<p>Pesquise o código na web e depois <b>digite o nome</b>:</p>`
					+ `<div class="links-pesquisa">${htmlLinksPesquisa(codigo)}</div>`,
				confirmar: "Digitar o nome",
				cancelar: "Fechar"
			});
			if (acao === "confirmar") el.nome.focus();
			return;
		}
		const atual = el.nome.value.trim();
		if (atual === resultado.nome) return toast("info", "O nome já está igual à sugestão.");
		const { acao } = await dialogo({
			titulo: "Nome sugerido",
			html: avisoExperimental("o nome pode não ser totalmente preciso. Confira com a embalagem.") + `<p>Para o código <b>${esc(codigo)}</b> encontramos:</p>`
				+ `<p class="nome-sugerido">${esc(resultado.nome)}</p>`
				+ `<p class="ajuda">Fonte: ${esc(resultado.fonte)}${atual ? ` · vai substituir “${esc(atual)}”` : ""}. Você pode ajustar depois.</p>`,
			confirmar: "Usar este nome",
			cancelar: "Cancelar"
		});
		if (acao !== "confirmar") return;
		// O código pode ter mudado enquanto o diálogo estava aberto
		if (el.codigo.value.replace(/\s+/g, "") !== codigo) return;
		el.nome.value = resultado.nome;
		el.nome.removeAttribute("aria-invalid");
		marcarSugerido(el.nome);
		atualizarBotoesCampos();
		el.quantidade.focus();
	} catch (e) {
		console.warn("[sugerir nome]", e);
		toast("erro", "Não foi possível buscar o nome agora. Tente de novo.");
	} finally {
		sugerindoManual = false;
		el.btnSugerirNome?.classList.remove("carregando");
		el.btnSugerirNome?.removeAttribute("aria-busy");
		atualizarBotoesCampos();
	}
}

/* =========================================================
   Fotos dos produtos (ver fotos.js)
   ========================================================= */
let fotoPendente = null; // foto escolhida no formulário antes de adicionar o produto
let filaFotos = [];
let buscandoFotos = false;
const tentadasNestaSessao = new Set();
const falhasFoto = new Map(); // chave → buscas que falharam nesta sessão
const MAX_FALHAS_FOTO = 3;

function definirFotoPendente(registro) {
	fotoPendente = registro;
	const b = el.btnFotoForm;
	if (!b) return;
	b.classList.toggle("com-foto", !!registro);
	b.innerHTML = registro ? `<img src="${esc(registro.src)}" alt="" referrerpolicy="no-referrer">` : icone("ImagePlus");
	atualizarBotoesCampos();
}

/** ✨ e foto do formulário só ficam clicáveis quando há algo para procurar (código e/ou nome). */
function atualizarBotoesCampos() {
	const editavel = podeEditar();
	const codigo = (el.codigo?.value || "").replace(/\s+/g, "");
	const nome = (el.nome?.value || "").trim();
	if (el.btnSugerirNome && !el.btnSugerirNome.classList.contains("carregando")) {
		el.btnSugerirNome.disabled = !editavel || !codigo;
		el.btnSugerirNome.title = !editavel ? "Somente leitura" : codigo ? "Sugerir o nome pelo código de barras" : "Leia ou digite o código de barras primeiro";
	}
	const b = el.btnFotoForm;
	if (b) {
		// Com foto já escolhida ou editando um produto, sempre dá para abrir (trocar/remover)
		const temReferencia = !!codigo || !!nome || !!fotoPendente || !!estado.editandoId;
		b.disabled = !editavel || !temReferencia;
		b.title = !editavel ? "Somente leitura" : fotoPendente ? "Foto escolhida (toque para trocar)" : temReferencia ? "Foto do produto" : "Digite o código de barras ou o nome do produto primeiro";
	}
}

async function aplicarFotoPendente(item) {
	const chave = chaveFoto(item);
	// Produto só com nome: a foto não é buscada sozinha — avisa uma vez como buscar
	if (!fotoPendente && estado.fotosAuto && !gtinValido(item?.codigoBarras) && !estado.fotos.get(chave)?.src && !armazenamento.lerTexto("cv2:avisoFotoNome")) {
		armazenamento.gravarTexto("cv2:avisoFotoNome", "1");
		toast("info", "📷 A foto automática só é buscada com <b>código de barras válido</b> (digitado ou lido pelo leitor). Produto só com nome: toque na <b>miniatura</b> dele para buscar a foto.", 9000);
	}
	if (!fotoPendente) {
		// Produto adicionado/salvo agora: um "não achei" antigo não impede uma busca nova
		const atual = chave && estado.fotos.get(chave);
		if (atual && atual.origem === "nenhuma" && !atual.removidaPeloUsuario) {
			estado.fotos.delete(chave);
			tentadasNestaSessao.delete(chave);
			falhasFoto.delete(chave);
			await apagarFoto(chave);
		} else if (chave && !atual) {
			tentadasNestaSessao.delete(chave);
		}
		agendarBuscaFotos();
		return;
	}
	if (chave) {
		await guardarFoto(chave, fotoPendente);
		estado.fotos.set(chave, { ...fotoPendente });
	}
	fotoPendente = null;
}

/* ---------- Busca da lista: exata (todas as palavras, em qualquer ordem) + tolerante a erros (Fuse.js) ---------- */
let Fuse = null, carregandoFuse = null;
function carregarFuse() {
	if (Fuse || carregandoFuse) return;
	carregandoFuse = import(URL_FUSE)
		.then(m => { Fuse = m.default || m.Fuse || null; if (Fuse && estado.busca) render(); })
		.catch(e => console.warn("[busca] Fuse.js indisponível (segue a busca exata):", e))
		.finally(() => { carregandoFuse = null; });
}

/** "moça leite" acha "Leite Condensado Moça": todas as palavras, em qualquer ordem; código pelo começo/meio. */
function combinaBusca(item, busca) {
	const nome = normalizar(item.nome);
	const codigo = String(item.codigoBarras || "").toLowerCase();
	if (nome.includes(busca) || codigo.includes(busca.replace(/\s+/g, ""))) return true;
	const palavras = busca.split(/\s+/).filter(Boolean);
	return palavras.length > 1 && palavras.every(p => nome.includes(p));
}

/** Ids dos produtos com nome parecido ("alcol" → "Álcool", "detergnte" → "Detergente"). */
let indiceFuse = { chave: "", fuse: null };
function produtosParecidos(itens, busca) {
	const vazio = new Set();
	if (busca.replace(/\d/g, "").trim().length < 3) return vazio; // códigos e buscas curtas: só exata
	if (!Fuse) { carregarFuse(); return vazio; }
	try {
		const chave = itens.map(i => `${i.id}\u0001${i.nome}`).join("\u0002");
		if (indiceFuse.chave !== chave) {
			indiceFuse = {
				chave,
				fuse: new Fuse(itens, { keys: [{ name: "nome", getFn: i => normalizar(i.nome) }], threshold: 0.34, ignoreLocation: true, minMatchCharLength: 3, includeScore: false })
			};
		}
		return new Set(indiceFuse.fuse.search(busca).map(r => r.item.id));
	} catch (e) {
		console.warn("[busca] Fuse.js:", e);
		return vazio;
	}
}

/** Fila da busca automática: um produto por vez, com folga entre as consultas. */
/** Código de barras válido (EAN-8, UPC-A, EAN-13, GTIN-14, com dígito verificador certo). */
function gtinValido(codigo) {
	const c = String(codigo || "").replace(/\s+/g, "");
	if (!/^(\d{8}|\d{12,14})$/.test(c)) return false;
	let soma = 0;
	for (let i = c.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(c[i]) * peso;
	return (10 - (soma % 10)) % 10 === Number(c[c.length - 1]);
}

/* Foto automática no FORMULÁRIO: com código de barras válido (digitado ou lido pelo leitor),
   busca a foto e já mostra no botão de foto. Só com o nome, a busca é manual (botão de foto). */
let buscaFotoForm = 0;
async function fotoAutomaticaDoFormulario() {
	if (!estado.fotosAuto || fotoPendente || estado.editandoId || navigator.onLine === false) return;
	const codigo = el.codigo.value.replace(/\s+/g, "");
	if (!gtinValido(codigo)) return;
	const minha = ++buscaFotoForm;
	const chave = chaveFoto({ codigoBarras: codigo });
	const guardada = estado.fotos.get(chave);
	const aplicar = registro => {
		if (minha !== buscaFotoForm || fotoPendente || el.codigo.value.replace(/\s+/g, "") !== codigo) return;
		definirFotoPendente(registro);
	};
	// Já tem foto deste produto no aparelho: mostra na hora
	if (guardada?.src) return aplicar({ src: guardada.src, origem: guardada.origem, fonte: guardada.fonte, original: guardada.original });
	if (guardada?.removidaPeloUsuario) return;
	el.btnFotoForm?.classList.add("carregando");
	try {
		const achada = await buscarFotoAutomatica({ nome: el.nome.value.trim(), codigoBarras: codigo });
		if (achada) aplicar({ src: achada.src, origem: achada.origem, fonte: achada.fonte });
	} catch (e) {
		console.warn("[fotos] formulário:", e?.message || e);
	} finally {
		if (minha === buscaFotoForm) el.btnFotoForm?.classList.remove("carregando");
	}
}

const agendarBuscaFotos = debounce(() => {
	if (!estado.fotosAuto || navigator.onLine === false) return;
	const vistos = new Set(filaFotos.map(f => f.chave));
	for (const item of itensAtuais()) {
		const chave = chaveFoto(item);
		if (!chave || vistos.has(chave) || tentadasNestaSessao.has(chave) || !precisaBuscar(estado.fotos.get(chave))) continue;
		if (!gtinValido(item.codigoBarras)) continue; // só com o nome: busca manual (toque na miniatura)
		vistos.add(chave);
		filaFotos.push({ chave, item: { nome: item.nome, codigoBarras: item.codigoBarras } });
	}
	processarFilaFotos();
}, 600);

async function processarFilaFotos() {
	if (buscandoFotos) return;
	buscandoFotos = true;
	try {
		while (filaFotos.length && estado.fotosAuto && navigator.onLine !== false) {
			const { chave, item } = filaFotos.shift();
			if (!precisaBuscar(estado.fotos.get(chave))) continue;
			tentadasNestaSessao.add(chave);
			let achada = null;
			try {
				achada = await buscarFotoAutomatica(item);
			} catch (e) {
				// Base fora do ar ou limite de consultas: não grava "sem foto"; tenta de novo em alguns minutos
				const falhas = (falhasFoto.get(chave) || 0) + 1;
				falhasFoto.set(chave, falhas);
				// Depois de algumas falhas seguidas, só tenta de novo na próxima vez que o app abrir
				if (falhas < MAX_FALHAS_FOTO) {
					console.warn("[fotos] busca falhou, tentando depois:", e?.message || e);
					setTimeout(() => { tentadasNestaSessao.delete(chave); agendarBuscaFotos(); }, 5 * 60 * 1000 * falhas);
				}
				continue;
			}
			// A pessoa pode ter colocado uma foto enquanto buscava: a dela vence
			if (!precisaBuscar(estado.fotos.get(chave))) continue;
			const registro = achada ? { src: achada.src, origem: achada.origem, fonte: achada.fonte } : { src: "", origem: "nenhuma" };
			estado.fotos.set(chave, registro);
			await guardarFoto(chave, registro);
			if (achada) render();
			await new Promise(r => setTimeout(r, 700)); // educado com as bases públicas
		}
	} finally {
		buscandoFotos = false;
	}
}

function alternarFotosAuto() {
	estado.fotosAuto = !estado.fotosAuto;
	armazenamento.gravarTexto(CHAVE.fotosAuto, estado.fotosAuto ? "1" : "0");
	$("#itemFotosAuto")?.setAttribute("aria-checked", String(estado.fotosAuto));
	toast("info", estado.fotosAuto
		? "Busca automática de fotos <b>ligada</b>: acontece quando o <b>código de barras é válido</b> (digitado ou lido pelo leitor). Produto só com nome: toque no botão de foto para buscar."
		: "Busca automática de fotos <b>desligada</b>. Você ainda pode colocar a foto tocando na miniatura do produto.", 5000);
	if (estado.fotosAuto) agendarBuscaFotos();
}

const ROTULO_ORIGEM = { usuario: "Foto colocada por você", codigo: "Encontrada pelo código de barras", nome: "Encontrada pelo nome (confira)" };

/** Escolhe uma imagem do aparelho (tirar foto ou galeria/arquivos). */
function escolherArquivoFoto() {
	return new Promise(resolver => {
		const input = el.arquivoFotoProduto;
		if (!input) return resolver(null);
		let resolvido = false;
		const terminar = arquivo => { if (resolvido) return; resolvido = true; input.value = ""; resolver(arquivo); };
		input.onchange = () => terminar(input.files?.[0] || null);
		// Se a pessoa cancelar a escolha, a janela volta a ter foco sem "change"
		window.addEventListener("focus", () => setTimeout(() => terminar(input.files?.[0] || null), 800), { once: true });
		input.click();
	});
}

/**
 * Diálogo da foto de um produto: ver, tirar/escolher, buscar na internet ou remover.
 * @param {{ nome: string, codigoBarras: string }} produto
 * @param {{ pendente?: boolean }} opcoes pendente: foto do formulário (o produto ainda não existe)
 * @returns {Promise<object|null|undefined>} o registro escolhido, null se removeu, undefined se nada mudou
 */
/* ---------- Foto ampliada ao passar o mouse (só no computador) ---------- */
const temMouse = () => !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
let ampliada = null; // { el, dono }

function fecharAmpliada() {
	if (!ampliada) return;
	const { el } = ampliada;
	ampliada = null;
	el.classList.remove("visivel");
	setTimeout(() => el.remove(), 160);
}

function abrirAmpliada(botao, legenda = botao.title || "") {
	const img = botao.querySelector("img");
	if (!img?.src || img.naturalWidth === 0) return;
	if (ampliada?.dono === botao) return;
	fecharAmpliada();
	const el = document.createElement("div");
	el.className = "foto-ampliada";
	el.setAttribute("aria-hidden", "true");
	el.innerHTML = `<img src="${esc(img.currentSrc || img.src)}" alt="" referrerpolicy="no-referrer"><small>${esc(legenda)}</small>`;
	// Fica fora do alerta (que tem animação/transform) para a posição "fixed" valer na tela toda
	document.body.appendChild(el);
	ampliada = { el, dono: botao };
	const r = botao.getBoundingClientRect();
	const vw = document.documentElement.clientWidth, vh = window.innerHeight, margem = 12;
	const lado = Math.min(320, vw - margem * 2, vh - margem * 2 - 40);
	el.style.width = `${lado}px`;
	// À direita da miniatura; sem espaço, à esquerda; sempre dentro da tela
	let x = r.right + margem;
	if (x + lado > vw - margem) x = r.left - margem - lado;
	x = Math.max(margem, Math.min(x, vw - margem - lado));
	const alto = lado + 40;
	let y = r.top + r.height / 2 - alto / 2;
	y = Math.max(margem, Math.min(y, vh - margem - alto));
	el.style.left = `${Math.round(x)}px`;
	el.style.top = `${Math.round(y)}px`;
	requestAnimationFrame(() => el.classList.add("visivel"));
}

async function dialogoFoto(produto, { pendente = false } = {}) {
	const chave = chaveFoto(produto);
	const atual = pendente ? fotoPendente : estado.fotos.get(chave);
	const temFoto = !!atual?.src && atual.origem !== "nenhuma";
	const editavel = podeEditar();
	if (!window.Swal) return undefined;
	let resultado;
	const html = `<div class="foto-dialogo${editavel ? "" : " so-ver"}">${editavel ? avisoExperimental("a foto encontrada na internet pode não ser exatamente deste produto.") : ""}
		<figure class="foto-figura">
			<div class="foto-grande">${temFoto ? `<img src="${esc(atual.src)}" alt="Foto de ${esc(produto.nome || "produto")}" referrerpolicy="no-referrer">` : `<span class="foto-vazia">${icone("Package")}<small>Sem foto</small></span>`}</div>
			${temFoto ? `<figcaption class="ajuda">${esc(ROTULO_ORIGEM[atual.origem] || "")}${atual.fonte ? ` · ${esc(atual.fonte)}` : ""}</figcaption>` : ""}
		</figure>
		${editavel ? `<div class="foto-acoes">
			<button type="button" class="btn btn-primario btn-bloco" data-f="arquivo">${icone("Camera")}Tirar ou escolher foto</button>
			${produto.codigoBarras || produto.nome ? `<button type="button" class="btn btn-secundario btn-bloco" data-f="buscar">${icone("Search")}Buscar na internet</button>` : ""}
			${temFoto ? `<button type="button" class="btn btn-fantasma btn-bloco" data-f="remover">${icone("Trash2")}Remover foto</button>` : ""}
		</div>
		<div class="foto-resultados" hidden></div>` : ""}
	</div>`;
	const executar = () => window.Swal.fire({
		willClose: () => fecharAmpliada(),
		title: produto.nome || "Foto do produto",
		html,
		showConfirmButton: false,
		showCancelButton: true,
		cancelButtonText: "Fechar",
		buttonsStyling: false,
		heightAuto: false,
		target: document.querySelector("dialog[open]") || "body",
		customClass: { popup: "sw-popup sw-foto", cancelButton: "btn btn-fantasma" },
		didOpen: popup => {
			const resultados = popup.querySelector(".foto-resultados");
			popup.querySelector('[data-f="arquivo"]')?.addEventListener("click", async () => {
				const arquivo = await escolherArquivoFoto();
				if (!arquivo) return;
				try {
					resultado = { src: await prepararFotoDaPessoa(arquivo), origem: "usuario", fonte: "" };
					window.Swal.close();
				} catch (e) {
					toast("erro", esc(e?.message || "Não foi possível usar essa imagem."));
				}
			});
			popup.querySelector('[data-f="remover"]')?.addEventListener("click", () => {
				resultado = null;
				window.Swal.close();
			});
			popup.querySelector('[data-f="buscar"]')?.addEventListener("click", async e => {
				const botao = e.currentTarget;
				const textoBotao = botao.innerHTML;
				botao.disabled = true;
				botao.classList.add("buscando");
				botao.innerHTML = `${icone("LoaderCircle")}Procurando fotos…`;
				resultados.hidden = false;
				// Aviso bem visível: a busca consulta várias lojas e sites e pode demorar
				resultados.innerHTML = `<div class="aviso-buscando" role="status" aria-live="polite">
					<span class="aviso-buscando-icone">${icone("LoaderCircle")}</span>
					<span><b>Procurando fotos na internet…</b><br>Aguarde, não feche esta janela. Isso pode levar até 30 segundos. <span class="aviso-buscando-tempo"></span></span>
				</div>`;
				const inicioBusca = Date.now();
				const relogio = setInterval(() => {
					const t = resultados.querySelector(".aviso-buscando-tempo");
					if (!t || !popup.isConnected) return clearInterval(relogio);
					t.textContent = `(${Math.round((Date.now() - inicioBusca) / 1000)} s)`;
				}, 1000);
				// Leva a área dos resultados para a vista (no computador ela ficava abaixo da dobra)
				const mostrarResultados = () => { try { resultados.scrollIntoView({ behavior: semMovimento() ? "auto" : "smooth", block: "nearest" }); } catch { /* ignora */ } };
				mostrarResultados();
				let opcoes = [];
				let falhou = false;
				try {
					// Nome abreviado ("Des Bom Ar Aer…"): o código de barras manda; o nome só se o código não achar nada
					const codigoPrimeiro = !!produto.codigoBarras && nomeAbreviado(produto.nome);
					let rCodigo, rNome;
					if (codigoPrimeiro) {
						[rCodigo] = await Promise.allSettled([fotosPorCodigo(produto.codigoBarras)]);
						const achouPeloCodigo = rCodigo.status === "fulfilled" && rCodigo.value.length > 0;
						[rNome] = await Promise.allSettled([!achouPeloCodigo && produto.nome ? fotosPorNome(produto.nome, { limite: 8 }) : []]);
					} else {
						// Cada busca vale sozinha: se uma base falhar, mostra o que as outras acharam
						[rCodigo, rNome] = await Promise.allSettled([
							produto.codigoBarras ? fotosPorCodigo(produto.codigoBarras) : [],
							produto.nome ? fotosPorNome(produto.nome, { limite: 8 }) : []
						]);
					}
					falhou = rCodigo.status === "rejected" || rNome.status === "rejected";
					const porCodigo = rCodigo.status === "fulfilled" ? rCodigo.value : [];
					const porNome = rNome.status === "fulfilled" ? rNome.value : [];
					const vistas = new Set();
					// As fotos achadas pelo código de barras vêm sempre primeiro (são do produto exato)
					const doNome = porNome.map(f => ({ ...f, origem: "nome" })), doCodigo = porCodigo.map(f => ({ ...f, origem: "codigo" }));
					for (const f of [...doCodigo, ...doNome]) {
						if (vistas.has(f.src)) continue;
						vistas.add(f.src);
						opcoes.push(f);
					}
				} catch (erro) {
					console.warn("[fotos] busca manual:", erro);
				}
				clearInterval(relogio);
				botao.disabled = false;
				botao.classList.remove("buscando");
				botao.innerHTML = textoBotao;
				if (!popup.isConnected) return;
				if (!opcoes.length) {
					resultados.innerHTML = `<p class="ajuda">${navigator.onLine === false ? "Sem internet agora." : falhou ? "As bases de fotos não responderam agora. Tente de novo em alguns minutos, ou tire/escolha uma foto." : (produto.nome ? "Nenhuma foto de produto com nome parecido. Confira o nome ou tire/escolha uma foto." : "Nenhuma foto encontrada. Tire ou escolha uma foto.")}</p>`;
					mostrarResultados();
					return;
				}
				opcoes = opcoes.slice(0, 9);
				// Com fotos para escolher: a foto atual encolhe e o "Buscar" sai, para tudo caber na tela
				popup.classList.add("com-resultados");
				botao.hidden = true;
				resultados.innerHTML = `<p class="ajuda">Toque na foto do produto <small>(confira se é o mesmo)</small>:</p><div class="grade-fotos">${opcoes.map((f, i) =>
					`<button type="button" class="opcao-foto" data-i="${i}" title="${esc(f.nome || f.fonte)}"><img src="${esc(f.src)}" alt="${esc(f.nome || "Foto encontrada")}" loading="lazy" referrerpolicy="no-referrer"><small>${f.origem === "codigo" ? "pelo código" : esc(f.nome || "pelo nome")}</small></button>`).join("")}</div>`;
				// Rola até as fotos assim que a primeira carregar (a altura da grade muda com as imagens)
				let rolou = false;
				const rolarUmaVez = () => { if (!rolou) { rolou = true; mostrarResultados(); } };
				mostrarResultados();
				// Rolou a grade: a ampliada ficaria fora do lugar
				resultados.querySelector(".grade-fotos")?.addEventListener("scroll", fecharAmpliada, { passive: true });
				resultados.querySelectorAll(".opcao-foto").forEach(b => {
					b.querySelector("img").addEventListener("load", rolarUmaVez, { once: true });
					b.querySelector("img").addEventListener("error", () => { if (ampliada?.dono === b) fecharAmpliada(); b.remove(); }, { once: true });
					// Computador: passar o mouse amplia a foto ao lado; tirar o mouse volta ao normal
					if (temMouse()) {
						b.addEventListener("mouseenter", () => abrirAmpliada(b));
						b.addEventListener("mouseleave", fecharAmpliada);
						b.addEventListener("focus", () => { if (b.matches(":focus-visible")) abrirAmpliada(b); });
						b.addEventListener("blur", fecharAmpliada);
					}
					b.addEventListener("click", () => {
						fecharAmpliada();
						const f = opcoes[Number(b.dataset.i)];
						resultado = { src: f.src, origem: f.origem, fonte: f.fonte };
						window.Swal.close();
					});
				});
			});
		}
	});
	const promessa = filaDialogos.then(executar, executar);
	filaDialogos = promessa.catch(() => { });
	await promessa.catch(e => console.error(e));
	return resultado;
}

/** Toque na miniatura de um produto da lista. */
async function abrirFotoDoItem(id) {
	const item = itensAtuais().find(i => i.id === id);
	if (!item) return;
	const chave = chaveFoto(item);
	const escolha = await dialogoFoto(item);
	if (escolha === undefined || !chave) return;
	if (escolha === null) {
		// Removida: não busca de novo automaticamente (fica "sem foto" até a pessoa escolher)
		const registro = { src: "", origem: "nenhuma", removidaPeloUsuario: true };
		estado.fotos.set(chave, registro);
		await guardarFoto(chave, { ...registro });
		toast("info", "Foto removida.");
	} else {
		estado.fotos.set(chave, escolha);
		await guardarFoto(chave, escolha);
		toast("sucesso", "Foto do produto atualizada.", 2500);
	}
	render();
}

/** Botão de foto no formulário (produto ainda não adicionado). */
async function fotoDoFormulario() {
	if (!podeEditar()) return toast("aviso", "Este aparelho está no modo <b>somente leitura</b>.");
	const produto = { nome: el.nome.value.trim(), codigoBarras: el.codigo.value.replace(/\s+/g, "") };
	// Editando um produto: a foto já vale direto para ele
	if (estado.editandoId) {
		const item = itensAtuais().find(i => i.id === estado.editandoId);
		if (item) return abrirFotoDoItem(item.id);
	}
	const escolha = await dialogoFoto(produto, { pendente: true });
	if (escolha === undefined) return;
	definirFotoPendente(escolha);
}

/** Liga/desliga a sugestão automática de nome (menu ⋮). */
function aplicarSugestaoAuto() {
	$("#itemSugestaoAuto")?.setAttribute("aria-checked", String(estado.sugestaoAuto));
}

function alternarSugestaoAuto() {
	estado.sugestaoAuto = !estado.sugestaoAuto;
	armazenamento.gravarTexto(CHAVE.sugestaoAuto, estado.sugestaoAuto ? "1" : "0");
	aplicarSugestaoAuto();
	toast("info", estado.sugestaoAuto
		? "Sugestão automática <b>ligada</b>: ao ler um código novo, o nome é preenchido sozinho (confira sempre)."
		: "Sugestão automática <b>desligada</b>. Use o botão ✨ no campo Produto quando quiser uma sugestão.", 5000);
	// Ligou com um código já digitado e sem nome: sugere agora
	if (estado.sugestaoAuto && el.codigo.value.trim() && !el.nome.value.trim()) autoPreencherPorCodigo();
}

/* ---------- Leitor da data de validade (câmera com moldura + confirmação) ---------- */
const DICA_CAMERA_VALIDADE = "Enquadre <strong>só a data de validade</strong> na moldura, bem de perto e reta. Se estiver escuro, ligue o flash.";
const DICA_FOTO_VALIDADE = "<strong>Arraste o dedo sobre a data</strong> para marcar a área e toque em <strong>Ler data</strong>.";
let cameraValidade = null;
let sessaoValidade = 0;          // invalida leituras e câmeras de aberturas anteriores
let lendoValidade = false;
let selecaoFoto = null;          // { x, y, w, h } em coordenadas da área (modo foto)

const statusValidade = texto => { if (el.validadeStatus) el.validadeStatus.textContent = texto; };

function modoCameraValidade() {
	el.validadeArea.classList.remove("modo-foto");
	el.validadeVideo.hidden = false;
	el.validadeFoto.hidden = true;
	el.validadeFoto.removeAttribute("src");
	el.validadeSelecao.hidden = true;
	selecaoFoto = null;
	el.validadeDica.innerHTML = DICA_CAMERA_VALIDADE;
}

async function abrirLeitorValidade() {
	if (!podeEditar()) return toast("aviso", "Este aparelho está no modo <b>somente leitura</b>.");
	cameraValidade ||= criarCameraValidade(el.validadeVideo);
	modoCameraValidade();
	el.btnCapturarValidade.disabled = true;
	el.btnFlashValidade.hidden = true;
	el.btnFlashValidade.setAttribute("aria-pressed", "false");
	esconderFoco(el.btnFocoValidade, uiFocoValidade);
	if (!el.dlgValidade.open) el.dlgValidade.showModal();
	await iniciarCameraValidade();
}

async function iniciarCameraValidade() {
	const minha = ++sessaoValidade;
	statusValidade("Iniciando câmera…");
	try {
		const { flash } = await cameraValidade.iniciar();
		if (minha !== sessaoValidade || !el.dlgValidade.open) { cameraValidade.parar(); return; }
		el.btnFlashValidade.hidden = !flash;
		el.btnCapturarValidade.disabled = false;
		statusValidade("Enquadre a data na moldura");
		uiFocoValidade?.atualizar();
	} catch (e) {
		if (minha !== sessaoValidade) return;
		console.warn("[validade] câmera:", e);
		statusValidade("Câmera indisponível — use uma foto");
		el.btnFotoValidade.classList.add("destaque");
	}
}

function fecharLeitorValidade() {
	sessaoValidade++;
	cameraValidade?.parar();
	esconderFoco(el.btnFocoValidade, uiFocoValidade);
	el.btnFotoValidade.classList.remove("destaque");
	el.validadeArea.classList.remove("lendo");
}

/* Modo foto: a pessoa marca a área da data arrastando o dedo */
function carregarFotoValidade(arquivo) {
	if (!arquivo || !/^image\//.test(arquivo.type || "image/")) return toast("aviso", "Escolha uma foto (imagem).");
	sessaoValidade++;
	cameraValidade?.parar();
	esconderFoco(el.btnFocoValidade, uiFocoValidade);
	const url = URL.createObjectURL(arquivo);
	el.validadeFoto.onload = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
	el.validadeFoto.src = url;
	el.validadeFoto.hidden = false;
	el.validadeVideo.hidden = true;
	el.validadeArea.classList.add("modo-foto");
	el.validadeSelecao.hidden = true;
	selecaoFoto = null;
	el.btnFlashValidade.hidden = true;
	el.btnCapturarValidade.disabled = false;
	el.validadeDica.innerHTML = DICA_FOTO_VALIDADE;
	statusValidade("Marque a área da data");
}

function registrarSelecaoFoto() {
	let inicio = null;
	const ponto = e => {
		const r = el.validadeArea.getBoundingClientRect();
		return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
	};
	const desenhar = () => {
		if (!selecaoFoto) { el.validadeSelecao.hidden = true; return; }
		Object.assign(el.validadeSelecao.style, { left: `${selecaoFoto.x}px`, top: `${selecaoFoto.y}px`, width: `${selecaoFoto.w}px`, height: `${selecaoFoto.h}px` });
		el.validadeSelecao.hidden = false;
	};
	el.validadeArea.addEventListener("pointerdown", e => {
		if (!el.validadeArea.classList.contains("modo-foto") || e.target.closest("button")) return;
		inicio = ponto(e);
		try { el.validadeArea.setPointerCapture(e.pointerId); } catch { /* ignora */ }
		e.preventDefault();
	});
	el.validadeArea.addEventListener("pointermove", e => {
		if (!inicio) return;
		const p = ponto(e);
		selecaoFoto = { x: Math.min(inicio.x, p.x), y: Math.min(inicio.y, p.y), w: Math.abs(p.x - inicio.x), h: Math.abs(p.y - inicio.y) };
		desenhar();
	});
	const terminar = () => {
		if (!inicio) return;
		inicio = null;
		if (selecaoFoto && (selecaoFoto.w < 16 || selecaoFoto.h < 6)) selecaoFoto = null; // toque sem arrastar (linha fina vale: a área é ampliada na leitura)
		desenhar();
		if (selecaoFoto) statusValidade("Área marcada — toque em Ler data");
	};
	el.validadeArea.addEventListener("pointerup", terminar);
	el.validadeArea.addEventListener("pointercancel", terminar);
}

/** Recorta da foto a área marcada (a imagem é exibida com object-fit: contain). */
function recorteDaFoto() {
	const img = el.validadeFoto;
	if (!img.naturalWidth || !selecaoFoto) return null;
	const r = el.validadeArea.getBoundingClientRect();
	const escala = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
	const sobraX = (r.width - img.naturalWidth * escala) / 2, sobraY = (r.height - img.naturalHeight * escala) / 2;
	let x = (selecaoFoto.x - sobraX) / escala, y = (selecaoFoto.y - sobraY) / escala;
	let w = selecaoFoto.w / escala, h = selecaoFoto.h / escala;
	// Amplia um pouco a área marcada: com o dedo é comum cortar o topo/base das letras.
	// Faixa fina (uma linha) ganha mais margem; área já folgada, pouca.
	const margemY = h * (h / Math.max(1, w) < 0.2 ? 0.6 : 0.15), margemX = w * 0.04;
	x -= margemX; y -= margemY; w += 2 * margemX; h += 2 * margemY;
	const x0 = Math.max(0, x), y0 = Math.max(0, y);
	w = Math.min(img.naturalWidth - x0, w - (x0 - x)); h = Math.min(img.naturalHeight - y0, h - (y0 - y));
	x = Math.min(img.naturalWidth - 1, x0); y = Math.min(img.naturalHeight - 1, y0);
	if (w < 8 || h < 8) return null;
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(w); canvas.height = Math.round(h);
	canvas.getContext("2d").drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
	return canvas;
}

/** Miniatura do recorte para a pessoa conferir a data com a imagem. */
function previaRecorte(canvas) {
	try {
		const escala = Math.min(1, 640 / canvas.width);
		const c = document.createElement("canvas");
		c.width = Math.max(1, Math.round(canvas.width * escala)); c.height = Math.max(1, Math.round(canvas.height * escala));
		c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
		return c.toDataURL("image/jpeg", 0.85);
	} catch { return ""; }
}

/**
 * Mostra as datas lidas para a pessoa confirmar.
 * @returns {Promise<string|"repetir"|null>} a data escolhida, "repetir" ou null (cancelou)
 */
async function escolherDataLida(candidatas, previa) {
	const opcoes = candidatas.slice(0, 4);
	const principal = opcoes[0]; // já vem como a validade mais provável
	// Incerta: poucas leituras concordaram, ou outra data (não fabricação) chegou perto
	const rival = opcoes.find(c => c !== principal && !c.fabricacao);
	const incerta = (principal.votos || 0) < 2 || (!!rival && (rival.peso || 0) >= (principal.peso || 0) * 0.7 && !principal.conferida);
	if (!window.Swal) {
		return window.confirm(`Validade lida: ${formatarData(principal.data)}. Usar esta data?`) ? principal.data : null;
	}
	const rotulo = c => c.fabricacao ? "provável fabricação" : c === principal ? "validade mais provável" : "outra leitura";
	const html = `${previa ? `<img class="previa-validade" src="${previa}" alt="Área lida">` : ""}`
		+ (incerta ? `<p class="aviso-incerta">Leitura incerta — confira com a embalagem.</p>` : "")
		+ avisoExperimental("a leitura pode não ser totalmente precisa. Confira com a embalagem.")
		+ `<p>Toque na <b>data de validade</b> correta:</p>`
		+ `<div class="opcoes-data" role="radiogroup" aria-label="Datas encontradas">${opcoes.map(c =>
			`<button type="button" class="opcao-data" role="radio" data-data="${esc(c.data)}" aria-checked="${c === principal}">`
			+ `<b>${formatarData(c.data)}</b><small>${rotulo(c)}</small></button>`).join("")}</div>`;
	let escolhida = principal.data;
	const r = await window.Swal.fire({
		title: "Confira a validade",
		html,
		showCancelButton: true,
		showDenyButton: true,
		confirmButtonText: "Usar esta data",
		denyButtonText: "Ler de novo",
		cancelButtonText: "Cancelar",
		reverseButtons: true,
		buttonsStyling: false,
		heightAuto: false,
		target: el.dlgValidade.open ? el.dlgValidade : "body",
		customClass: { popup: "sw-popup", confirmButton: "btn btn-primario", denyButton: "btn btn-secundario", cancelButton: "btn btn-fantasma" },
		didOpen: popup => {
			const atualizarBotao = () => {
				const confirmar = popup.querySelector(".swal2-confirm");
				if (confirmar) confirmar.textContent = `Usar ${formatarData(escolhida)}`;
			};
			popup.querySelectorAll(".opcao-data").forEach(b => b.addEventListener("click", () => {
				escolhida = b.dataset.data;
				popup.querySelectorAll(".opcao-data").forEach(o => o.setAttribute("aria-checked", String(o === b)));
				atualizarBotao();
			}));
			atualizarBotao();
		}
	});
	if (r.isConfirmed) return escolhida;
	if (r.isDenied) return "repetir";
	return null;
}

async function lerDataDaArea() {
	if (lendoValidade) return;
	const modoFoto = el.validadeArea.classList.contains("modo-foto");
	const recorte = modoFoto ? recorteDaFoto() : cameraValidade?.recortar(el.validadeMira);
	if (!recorte) {
		toast("info", modoFoto ? "Arraste o dedo sobre a data para marcar a área." : "A câmera ainda não está pronta.");
		return;
	}
	const minha = sessaoValidade;
	lendoValidade = true;
	el.validadeArea.classList.add("lendo");
	el.btnCapturarValidade.disabled = true;
	try {
		// Câmera: mais 2 quadros em seguida — cada um tem ruído diferente, e a votação fica mais segura
		const quadros = [recorte];
		if (!modoFoto) {
			for (let i = 0; i < 2; i++) {
				await new Promise(r => setTimeout(r, 140));
				if (minha !== sessaoValidade) return;
				const extra = cameraValidade?.recortar(el.validadeMira);
				if (extra) quadros.push(extra);
			}
		}
		const { candidatas } = await lerDatas(quadros, {
			recorte: true,
			aoProgresso: ({ etapa, atual, total }) => {
				if (minha !== sessaoValidade) return;
				statusValidade(etapa === "baixando" ? "Preparando o leitor (só na 1ª vez)…" : `Lendo a data… ${atual || 1}/${total || 1}`);
			}
		});
		if (minha !== sessaoValidade || !el.dlgValidade.open) return;
		if (!candidatas.length) {
			statusValidade("Não consegui ler — aproxime e tente de novo");
			toast("aviso", "Não encontrei a data. Deixe <b>só a data</b> na moldura, bem de perto, com luz, e toque em <b>Ler data</b> de novo. Data <b>em relevo</b> (sem tinta)? Ilumine de lado para criar sombra nas letras, ou digite a data.", 8000);
			return;
		}
		const escolha = await escolherDataLida(candidatas, previaRecorte(recorte));
		if (minha !== sessaoValidade || !el.dlgValidade.open) return;
		if (!escolha || escolha === "repetir") {
			statusValidade(modoFoto ? "Marque a área da data" : "Enquadre a data na moldura");
			return;
		}
		el.vencimento.value = escolha;
		el.vencimento.removeAttribute("aria-invalid");
		el.vencimento.dispatchEvent(new Event("input", { bubbles: true }));
		marcarSugerido(el.vencimento);
		el.dlgValidade.close();
		const vencido = escolha < hojeISO() ? " (já vencido)" : "";
		toast("sucesso", `Validade: <b>${formatarData(escolha)}</b>${vencido}. Confira com a embalagem.`, 4500);
	} catch (e) {
		console.error("[ler validade]", e);
		toast("erro", navigator.onLine === false
			? "Sem internet para preparar o leitor de datas (necessário só na primeira vez)."
			: "Não foi possível ler agora. Tente de novo ou digite a data.", 6500);
	} finally {
		lendoValidade = false;
		el.validadeArea.classList.remove("lendo");
		if (minha === sessaoValidade && el.dlgValidade.open) el.btnCapturarValidade.disabled = false;
	}
}

/* =========================================================
   Alerta ao abrir o app
   ========================================================= */
async function alertaInicial() {
	if (estado.alertaInicialFeito) return;
	estado.alertaInicialFeito = true;
	const limite = limiteAlertaDias();
	const proximos = itensAtuais()
		.map(item => ({ item, sit: situacao(item, limite) }))
		.filter(c => c.sit.estado === "alerta" && !estado.silenciados.has(c.item.id))
		.sort((a, b) => a.sit.dias - b.sit.dias);
	if (!proximos.length) return;

	const MAX = 25;
	const linhas = proximos.slice(0, MAX).map(({ item, sit }) =>
		`<li data-id="${esc(item.id)}"><span>${esc(item.nome)} <small>· ${fmtNumero.format(item.quantidade)} un.</small></span><span class="selo selo-alerta">${esc(sit.texto)}</span>` +
		`<button type="button" class="acao alerta-silenciar" data-silenciar-alerta="${esc(item.id)}" aria-pressed="false" title="Não alertar sobre este produto" aria-label="Não alertar sobre ${esc(item.nome)}">${icone("BellOff")}</button></li>`
	).join("");
	const extra = proximos.length > MAX ? `<p style="margin-top:8px">…e mais ${proximos.length - MAX}.</p>` : "";

	// Silenciar item a item, direto no alerta (vale na hora; tocar de novo desfaz)
	const silenciadosAgora = new Set();
	const aoClicar = e => {
		const botao = e.target.closest?.("[data-silenciar-alerta]");
		if (!botao) return;
		e.preventDefault();
		const id = botao.dataset.silenciarAlerta;
		const silenciar = !estado.silenciados.has(id);
		if (silenciar) { estado.silenciados.add(id); silenciadosAgora.add(id); }
		else { estado.silenciados.delete(id); silenciadosAgora.delete(id); }
		salvarSilenciados();
		botao.setAttribute("aria-pressed", String(silenciar));
		botao.classList.toggle("acao-ativa", silenciar);
		botao.title = silenciar ? "Voltar a alertar sobre este produto" : "Não alertar sobre este produto";
		botao.closest("li")?.classList.toggle("silenciado", silenciar);
	};
	document.addEventListener("click", aoClicar, true);

	let resposta;
	try {
		resposta = await dialogo({
			titulo: `${proximos.length} produto${proximos.length > 1 ? "s" : ""} perto do vencimento`,
			html: `<p class="dica-alerta">Toque no sino de um produto para não ser avisado sobre ele.</p><ul class="lista-alerta">${linhas}</ul>${extra}`,
			icone: "warning",
			confirmar: "Ver produtos",
			cancelar: "Fechar",
			checkbox: "Não alertar novamente sobre nenhum destes produtos"
		});
	} finally {
		document.removeEventListener("click", aoClicar, true);
	}
	const { acao, valor } = resposta;
	if (valor) {
		proximos.forEach(c => estado.silenciados.add(c.item.id));
		salvarSilenciados();
		toast("info", "Pronto! Você pode reativar o alerta pelo ícone do sino.");
	} else if (silenciadosAgora.size) {
		toast("info", `${silenciadosAgora.size} produto${silenciadosAgora.size > 1 ? "s" : ""} não ${silenciadosAgora.size > 1 ? "serão mais alertados" : "será mais alertado"}. Reative pelo ícone do sino na lista.`);
	}
	if (acao === "confirmar") {
		estado.filtro = "alerta";
		$(".cartao-lista")?.scrollIntoView({ behavior: "smooth", block: "start" });
	}
	render();
}

/* =========================================================
   Importar / exportar
   ========================================================= */
function baixarArquivo(conteudo, nome, tipo) {
	const blob = new Blob([conteudo], { type: tipo });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = nome;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* =========================================================
   Nome da loja (personaliza o cabeçalho e o título da aba)
   ========================================================= */
const NOME_APP = "Controle de Vencimento";
const LIMITE_NOME_LOJA = 60;

/** Limpa o nome digitado: sem caracteres de controle, espaços repetidos ou excesso de tamanho. */
function limparNomeLoja(valor) {
	return Array.from(String(valor ?? "")
		.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, "")
		.replace(/\s+/g, " ")
		.trim())
		.slice(0, LIMITE_NOME_LOJA)
		.join("")
		.trim();
}

/** "Nome da loja - Controle de Vencimento" (ou só o nome do app, sem loja definida). */
const tituloCompleto = loja => loja ? `${loja} - ${NOME_APP}` : NOME_APP;

function aplicarNomeLoja() {
	const loja = estado.loja;
	const titulo = $(".marca h1");
	if (titulo) {
		// textContent: o nome digitado nunca vira HTML
		titulo.textContent = tituloCompleto(loja);
		titulo.title = tituloCompleto(loja);
	}
	document.title = tituloCompleto(loja);
	$('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", loja || "Vencimentos");
	// Nome maior ou menor muda o espaço do resumo no topo
	if (typeof agendarLayout === "function") agendarLayout();
}

/**
 * @param {string} valor
 * @param {{salvar?: boolean, origem?: "local"|"nuvem"}} opcoes
 *   origem "nuvem": o nome veio de uma lista compartilhada (não é reenviado para outras listas).
 */
function definirNomeLoja(valor, { salvar = true, origem = "local" } = {}) {
	estado.loja = limparNomeLoja(valor);
	if (salvar) {
		if (estado.loja) armazenamento.gravarTexto(CHAVE.loja, estado.loja);
		else armazenamento.remover(CHAVE.loja);
		armazenamento.gravarTexto(CHAVE.lojaOrigem, origem);
	}
	aplicarNomeLoja();
}

/* ---------- Nome da loja na nuvem ----------
   Vai como um item reservado e invisível dentro da própria lista, então
   funciona em todos os provedores sem mudar regras ou tabelas. Nome vazio
   também é enviado (assim a remoção chega aos outros aparelhos). */
const ID_CONFIG_LOJA = "c5e0c0de-0000-4000-8000-00000000a001";
const MARCA_CONFIG_LOJA = "CVCONFIGLOJA";
const ehConfigLoja = item => !!item && typeof item === "object" && String(item.id).toLowerCase() === ID_CONFIG_LOJA;

/* ---------- Convidados (código único por convidado) ----------
   Cada convidado é um item reservado e invisível na própria lista:
     codigoBarras "CVCONVIDADO:<código>", nome = apelido, quantidade 1 = pode editar / 0 = só visualizar.
   Funciona em todos os provedores sem mudar regras ou tabelas. O aparelho do
   convidado lê o próprio item e aplica a permissão na hora (e avisa a pessoa). */
const MARCA_CONVIDADO = "CVCONVIDADO:";
const RE_CONVIDADO = /^[A-HJ-NP-Z2-9]{10}$/;
const LIMITE_NOME_CONVIDADO = 40;
const MARCA_APARELHO = "CVAPARELHO:";
const ehItemConvidado = item => !!item && typeof item === "object" && String(item.codigoBarras || "").startsWith(MARCA_CONVIDADO);
const ehItemAparelho = item => !!item && typeof item === "object" && String(item.codigoBarras || "").startsWith(MARCA_APARELHO);
/** Itens reservados (convidados e aparelhos): nunca aparecem como produto. */
const ehItemReservado = item => ehItemConvidado(item) || ehItemAparelho(item);
const limparNomeConvidado = t => String(t ?? "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, LIMITE_NOME_CONVIDADO);
const formatarCodigoConvidado = c => `${c.slice(0, 5)}-${c.slice(5)}`;

/** Nome do aparelho: o que a pessoa escolheu, senão marca/modelo detectados, senão "" (o dono vê o nome padrão). */
async function nomeDoAparelho() {
	const escolhido = limparNomeConvidado(armazenamento.lerTexto(CHAVE.nomeAparelho));
	if (escolhido) return escolhido;
	return limparNomeConvidado(await detectarAparelho());
}

/** "Samsung SM-A515F · Chrome", "iPhone · Safari", "Windows · Edge"… (sem dados pessoais). */
async function detectarAparelho() {
	const ua = String(navigator.userAgent || "");
	let modelo = "";
	try {
		const d = await navigator.userAgentData?.getHighEntropyValues?.(["model", "platform"]);
		if (d?.model) modelo = d.model;
	} catch { /* sem dados extras */ }
	let sistema = "";
	if (/iPhone/.test(ua)) sistema = "iPhone";
	else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) sistema = "iPad";
	else if (/Android/.test(ua)) {
		const m = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/);
		const bruto = modelo || (m && !/^(K|wv|Linux|U)$/i.test(m[1].trim()) ? m[1].trim() : "");
		const marca = /^SM-|^GT-|Galaxy/i.test(bruto) ? "Samsung " : /^moto|^XT\d/i.test(bruto) ? "Motorola " : /^(Redmi|POCO|Mi )|^M\d{4}/i.test(bruto) ? "Xiaomi " : "";
		sistema = bruto ? `${marca}${bruto}` : "Android";
		modelo = "";
	}
	else if (/Windows/.test(ua)) sistema = "Windows";
	else if (/Macintosh|Mac OS X/.test(ua)) sistema = "Mac";
	else if (/CrOS/.test(ua)) sistema = "Chromebook";
	else if (/Linux/.test(ua)) sistema = "Linux";
	const navegador = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
		: /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
	return [modelo && !sistema.includes(modelo) ? `${sistema} ${modelo}` : sistema, navegador].filter(Boolean).join(" · ");
}

let convidadoSelecionado = null;

/* ---------- Permissões no servidor (Firebase) ----------
   Dono: aparelho/conta com a "chave do dono" (12 caracteres, guardada no aparelho e na conta).
   Convidado: aparelho registrado com um convite; a permissão (editar ou não) fica no convite,
   que só o dono altera. As regras do Firestore conferem tudo isso — não só o app. */
const RE_CHAVE_DONO = /^[A-HJ-NP-Z2-9]{12}$/;
const gerarChaveDono = () => gerarCodigoLista().slice(0, 12);
/** Código de convite: lista (16) + convidado (10) = 26 caracteres. */
const codigoDeConvite = (lista, convite) => `${formatarCodigoLista(lista)}-${formatarCodigoConvidado(convite)}`;
function lerCodigoConvite(texto) {
	const limpo = String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
	if (limpo.length !== 26) return null;
	const codigo = normalizarCodigoLista(limpo.slice(0, 16)), convidado = limpo.slice(16);
	return codigo && RE_CONVIDADO.test(convidado) ? { codigo, convidado } : null;
}

/** Código digitado: aceita o da lista (16) ou um antigo de 28 (usa só os 16 primeiros). Sempre só visualizar. */
function lerCodigoDigitado(texto) {
	const limpo = String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
	return limpo.length === 28 ? normalizarCodigoLista(limpo.slice(0, 16)) : normalizarCodigoLista(limpo);
}
const temConvidadosNoServidor = () => !!provAtual()?.recursos?.convidados;

/** O que este aparelho apresenta ao servidor para acessar a lista. */
async function acessoDe(s) {
	if (s.papel === "dono" && s.segredo) return { segredo: s.segredo };
	if (s.papel === "convidado" && s.convidado) {
		return { convite: s.convidado, nome: limparNomeConvidado(armazenamento.lerTexto(CHAVE.nomeAparelho)), aparelho: limparNomeConvidado(await detectarAparelho().catch(() => "")) };
	}
	return {};
}

let pararConvidados = null;
let pararMeuConvite = null;
let pararPedidos = null;
let pararMeuPedido = null;
function pararOuvintesConvidados() {
	for (const parar of [pararConvidados, pararMeuConvite, pararPedidos, pararMeuPedido]) { try { parar?.(); } catch { /* ignora */ } }
	pararConvidados = pararMeuConvite = pararPedidos = pararMeuPedido = null;
	estado.pedidos = [];
	estado.meuPedido = null;
	atualizarSeloPedidos();
}

/** Depois de conectar: o dono acompanha os convidados; o convidado, o próprio convite. */
function iniciarOuvintesConvidados() {
	pararOuvintesConvidados();
	const s = estado.sync, prov = provAtual();
	if (!s || !prov?.recursos?.convidados || s.protecao !== "protegida") return;
	if (s.papel === "dono") {
		pararConvidados = prov.ouvirConvidados(s.codigo, ({ convites, membros }) => {
			if (estado.sync !== s && idSync(estado.sync || {}) !== idSync(s)) return;
			estado.convidados = convites
				.filter(c => RE_CONVIDADO.test(c.codigo))
				.map(c => {
					const aparelhos = membros.filter(m => m.convite === c.codigo);
					return {
						codigo: c.codigo,
						nome: limparNomeConvidado(c.nome) || "Convidado",
						podeEditar: c.editar === true,
						criadoEm: Number(c.criadoEm) || 0,
						aparelhos,
						visto: Math.max(0, ...aparelhos.map(m => Number(m.visto) || 0))
					};
				})
				.sort((a, b) => a.criadoEm - b.criadoEm);
			if (el.dlgSync.open) atualizarCompartilhamento();
		});
		// Pedidos de acesso: avisa quando chega um novo
		let vistos = null;
		pararPedidos = prov.ouvirPedidos(s.codigo, pedidos => {
			if (estado.sync !== s && idSync(estado.sync || {}) !== idSync(s)) return;
			estado.pedidosAprovados = pedidos.filter(p => p.status === "aprovado" && p.convite);
			estado.pedidos = pedidos.filter(p => p.status === "pendente").sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
			const novos = vistos ? estado.pedidos.filter(p => !vistos.has(p.uid)) : [];
			if (!vistos && estado.pedidos.length) toast("info", `🔔 Você tem <b>${estado.pedidos.length}</b> pedido(s) de acesso pendente(s). Veja em <b>Salvar e compartilhar</b>.`, 8000);
			vistos = new Set(estado.pedidos.map(p => p.uid));
			for (const p of novos) toast("info", `🔔 <b>${esc(limparNomeConvidado(p.nome))}</b> pediu acesso para editar a lista. Veja em <b>Salvar e compartilhar</b>.`, 8000);
			atualizarSeloPedidos();
			if (el.dlgSync.open) atualizarCompartilhamento();
		});
	} else if (s.papel === "convidado" && s.convidado) {
		pararMeuConvite = prov.ouvirMeuConvite(s.codigo, s.convidado, info => aplicarPermissaoConvidado(info));
	} else if (s.papel === "convidado" && s.donoPendente) {
		// Só visualizando: acompanha o próprio pedido de acesso (se houver)
		pararMeuPedido = prov.ouvirMeuPedido(s.codigo, pedido => receberMeuPedido(s, pedido));
	}
}

/* ---------- Pedidos de acesso ----------
   Quem entrou só com o código pede para editar: nome, telefone (opcional) e dados
   básicos do aparelho/navegador. Os dois veem o mesmo código de confirmação.
   O dono aprova (vira convidado com "pode editar") ou recusa. */
function atualizarSeloPedidos() {
	const n = estado.pedidos?.length || 0;
	if (el.btnSync) el.btnSync.dataset.pedidos = n ? String(Math.min(n, 9)) : "";
}

function infoNavegador() {
	let fuso = "";
	try { fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* ignora */ }
	const tela = typeof screen !== "undefined" ? `tela ${screen.width}×${screen.height}` : "";
	return [navigator.language || "", tela, fuso].filter(Boolean).join(" · ").slice(0, 160);
}

async function pedirAcesso() {
	const s = estado.sync, prov = provAtual();
	if (!s?.donoPendente || !prov?.enviarPedido) return;
	if (s.protecao !== "protegida") return toast("aviso", "Esta lista ainda não é protegida no servidor: peça ao dono para abrir o app e criar um convite para você.");
	const nomeSalvo = limparNomeConvidado(armazenamento.lerTexto(CHAVE.nomeAparelho));
	let nome = "", telefone = "";
	if (window.Swal) {
		const r = await window.Swal.fire({
			title: "Pedir acesso para editar",
			html: `<p class="sw-texto">O dono da lista recebe seu pedido com o seu nome, telefone e o tipo de aparelho/navegador.</p>
				<input id="pedidoNome" class="swal2-input sw-input" maxlength="40" placeholder="Seu nome" autocomplete="name" value="${esc(nomeSalvo)}">
				<input id="pedidoTelefone" class="swal2-input sw-input" maxlength="20" placeholder="Telefone (opcional)" inputmode="tel" autocomplete="tel">`,
			showCancelButton: true,
			confirmButtonText: "Enviar pedido",
			cancelButtonText: "Cancelar",
			reverseButtons: true,
			buttonsStyling: false,
			heightAuto: false,
			focusConfirm: false,
			target: document.querySelector("dialog[open]") || "body",
			customClass: { popup: "sw-popup", confirmButton: "btn btn-primario", cancelButton: "btn btn-fantasma" },
			preConfirm: () => {
				const n = limparNomeConvidado(document.getElementById("pedidoNome")?.value);
				const t = String(document.getElementById("pedidoTelefone")?.value || "").replace(/[^\d+()\- ]/g, "").trim().slice(0, 20);
				if (n.length < 2) { window.Swal.showValidationMessage("Digite seu nome."); return false; }
				return { nome: n, telefone: t };
			}
		});
		if (!r.isConfirmed || !r.value) return;
		({ nome, telefone } = r.value);
	} else {
		nome = limparNomeConvidado(window.prompt("Seu nome:", nomeSalvo) || "");
		if (nome.length < 2) return;
		telefone = String(window.prompt("Telefone (opcional):") || "").replace(/[^\d+()\- ]/g, "").slice(0, 20);
	}
	armazenamento.gravarTexto(CHAVE.nomeAparelho, nome);
	const confirmacao = String(Math.floor(1000 + Math.random() * 9000));
	try {
		await prov.enviarPedido(s.codigo, { nome, telefone, confirmacao, aparelho: limparNomeConvidado(await detectarAparelho().catch(() => "")) || "Aparelho", navegador: infoNavegador() });
		if (!pararMeuPedido) pararMeuPedido = prov.ouvirMeuPedido(s.codigo, pedido => receberMeuPedido(s, pedido));
		dialogo({
			titulo: "Pedido enviado",
			html: `O dono da lista vai ver seu pedido.<br><br>Código de confirmação:<br><b class="codigo-confirmacao">${confirmacao}</b><br><br><small>O dono vê o mesmo código — confirmem entre vocês (ligação ou mensagem) antes da aprovação.</small>`,
			icone: "success"
		});
	} catch (e) {
		console.warn("[pedido]", e);
		const codigoErro = String(e?.code || "");
		if (codigoErro === "sem-identidade") {
			dialogo({ titulo: "Não foi possível enviar o pedido", icone: "warning", html: "O servidor não conseguiu identificar este aparelho.<br><br><small>Dono da lista: no Firebase, ative <b>Authentication → Método de login → Anônimo</b>.</small>" });
		} else if (/permission-denied|insufficient permissions/i.test(codigoErro + " " + (e?.message || ""))) {
			// Regras antigas no Firebase (sem a parte dos pedidos): o servidor recusa a gravação
			dialogo({ titulo: "O servidor recusou o pedido", icone: "warning", html: "As regras de segurança da nuvem estão desatualizadas e ainda não aceitam pedidos de acesso.<br><br><small>Dono da lista: publique de novo as regras no Firebase (<b>Firestore → Regras</b>) com o texto atual do arquivo <b>docs/CONFIGURACAO.md</b>. Depois disso, o pedido funciona na hora.</small>" });
		} else {
			toast("erro", explicarErro(e).tipo === "rede" ? "Sem conexão: tente de novo quando a internet voltar." : "Não foi possível enviar o pedido agora. Tente de novo.");
		}
	}
}

/** Quem pediu: acompanha a resposta do dono. */
async function receberMeuPedido(s, pedido) {
	if (!estado.sync || idSync(estado.sync) !== idSync(s)) return;
	estado.meuPedido = pedido?.existe ? pedido : null;
	atualizarDialogoSync();
	if (!pedido?.existe) return;
	const prov = provAtual();
	if (pedido.status === "aprovado" && RE_CONVIDADO.test(String(pedido.convite || ""))) {
		// Vira convidado com o convite criado pelo dono (a permissão segue o convite)
		const novo = { provedor: s.provedor, codigo: s.codigo, papel: "convidado", convidado: pedido.convite, modo: "leitura", confirmado: false };
		if (await conectarNuvem(novo)) {
			prov.cancelarPedido?.(s.codigo).catch(() => { });
			toast("sucesso", "✅ O dono <b>aprovou</b> seu pedido: agora você pode editar a lista.", 8000);
		}
	} else if (pedido.status === "recusado") {
		await prov.cancelarPedido?.(s.codigo).catch(() => { });
		estado.meuPedido = null;
		atualizarDialogoSync();
		toast("aviso", "O dono <b>recusou</b> o pedido de acesso. Você continua só visualizando.", 8000);
	}
}

/** Dono: lista de solicitações pendentes. */
function desenharPedidos() {
	const lista = estado.pedidos || [];
	el.blocoPedidos.hidden = !lista.length || !ehDono();
	el.contadorPedidos.textContent = lista.length ? String(lista.length) : "";
	el.listaPedidos.innerHTML = lista.map(p => {
		const tel = String(p.telefone || "").replace(/[^\d+]/g, "");
		return `
		<li class="convidado pedido" data-pedido="${esc(p.uid)}">
			<div class="convidado-info">
				<strong>${esc(limparNomeConvidado(p.nome) || "Sem nome")}</strong>
				<small>${tel ? `📞 <a href="tel:${esc(tel)}">${esc(p.telefone)}</a> · ` : ""}${esc(p.aparelho || "Aparelho")} · pediu ${esc(fmtRelativoCurto(Number(p.criadoEm) || Date.now()))}</small>
				<small>${esc(p.navegador || "")}</small>
				<small>Código de confirmação <b class="codigo-convidado">${esc(p.confirmacao || "—")}</b></small>
			</div>
			<div class="pedido-acoes">
				<button type="button" class="btn btn-primario" data-p="aprovar">Aprovar</button>
				<button type="button" class="btn btn-fantasma" data-p="recusar">Recusar</button>
			</div>
		</li>`;
	}).join("");
}

async function acaoPedido(evento) {
	const botao = evento.target.closest("[data-p]");
	const linha = evento.target.closest("[data-pedido]");
	if (!botao || !linha || !emNuvem() || !ehDono()) return;
	const p = (estado.pedidos || []).find(x => x.uid === linha.dataset.pedido);
	if (!p) return;
	const aprovar = botao.dataset.p === "aprovar";
	const nome = limparNomeConvidado(p.nome) || "Convidado";
	const ok = await confirmar({
		titulo: aprovar ? "Aprovar acesso?" : "Recusar pedido?",
		html: aprovar
			? `<b>${esc(nome)}</b> vai poder <b>editar</b> a lista (você pode mudar ou remover depois em Convidados).<br><br>Confira com a pessoa o código de confirmação: <b class="codigo-confirmacao">${esc(p.confirmacao || "—")}</b>`
			: `<b>${esc(nome)}</b> continua só visualizando.`,
		confirmar: aprovar ? "Aprovar" : "Recusar",
		icone: "question",
		perigo: !aprovar
	});
	if (!ok || !emNuvem()) return;
	botao.disabled = true;
	try {
		await provAtual().responderPedido(estado.sync.codigo, p.uid, aprovar ? { aprovar: true, convite: gerarCodigoConvidado(), nome } : { aprovar: false });
		toast(aprovar ? "sucesso" : "info", aprovar ? `Acesso aprovado para <b>${esc(nome)}</b>. O aparelho dele é liberado na hora.` : "Pedido recusado.");
	} catch (e) {
		botao.disabled = false;
		erroConvite(e);
	}
}

/**
 * Liga o provedor à lista com a credencial deste aparelho. Lista antiga do dono
 * (sem chave) ganha uma chave e passa a ser protegida.
 * @returns {Promise<boolean>}
 */
async function ligarLista(s) {
	const prov = provedores[s.provedor];
	// Conta logada (Google/e-mail): espera o login ser restaurado antes de decidir a chave
	const contaLogada = async () => {
		if (prov.recursos?.convidados) { try { await prov.preparar(); } catch { /* sem nuvem: o conectar avisa */ } }
		return prov.usuario || estado.usuarios[s.provedor] || null;
	};
	const chaveDaConta = async () => {
		const u = await contaLogada();
		if (!u?.id || !prov.listaDaConta) return "";
		try { const conta = await prov.listaDaConta(u.id); return conta?.codigo === s.codigo ? conta.segredo || "" : ""; }
		catch (e) { console.warn(e); return ""; }
	};
	const gravarSeAtual = novo => { if (estado.sync && idSync(estado.sync) === idSync(novo)) { estado.sync = novo; armazenamento.gravar(CHAVE.sync, novo); } };
	if (prov.recursos?.convidados && !s.segredo && (s.papel === "dono" || (s.papel === "convidado" && !s.convidado))) {
		// Dono de verdade = conta que criou a lista (logada). Sem isso, o código da lista só dá visualização.
		const u = await contaLogada();
		let contaDona = false, chave = "", semResposta = false;
		if (u?.id && prov.listaDaConta) {
			try { const conta = await prov.listaDaConta(u.id); contaDona = conta?.codigo === s.codigo; chave = contaDona ? conta.segredo || "" : ""; }
			catch (e) { console.warn(e); semResposta = true; } // sem internet: não muda o papel agora
		}
		if (semResposta) { /* mantém como está; confere de novo na próxima conexão */ }
		else if (contaDona) {
			const eraVisualizacao = s.papel !== "dono";
			s = { ...s, papel: "dono", modo: "edicao", segredo: chave || gerarChaveDono() };
			delete s.donoPendente;
			gravarSeAtual(s);
			if (eraVisualizacao) toast("sucesso", "Conta dona da lista confirmada: você tem <b>acesso completo</b>.", 6000);
		} else if (s.papel === "dono" || s.modo !== "leitura" || !s.donoPendente) {
			// Sem a conta dona: só visualiza (aparelho antigo marcado como dono, código digitado ou link antigo)
			s = { ...s, papel: "convidado", modo: "leitura", donoPendente: true };
			gravarSeAtual(s);
		}
	}
	let resultado;
	try {
		resultado = await prov.conectar(s.codigo, await acessoDe(s));
	} catch (erro) {
		if (erro?.code === "chave-dono") {
			// Outro aparelho da mesma conta protegeu a lista primeiro: a chave certa está na conta
			const daConta = await chaveDaConta();
			if (daConta && daConta !== s.segredo) {
				s = { ...s, segredo: daConta };
				if (estado.sync && idSync(estado.sync) === idSync(s)) { estado.sync = s; armazenamento.gravar(CHAVE.sync, s); }
				return ligarLista(s);
			}
			toast("aviso", "Este aparelho não tem a prova de dono desta lista: entrando <b>só para visualizar</b>. Entre com a conta que criou a lista para ter acesso completo.", 8000);
			return virarVisualizacao(s);
		}
		if (erro?.code === "convite-invalido") { acessoRemovido("convite"); return false; }
		throw erro;
	}
	if (!estado.sync || idSync(estado.sync) !== idSync(s)) return false;
	estado.sync = { ...estado.sync, ...(s.segredo ? { segredo: s.segredo } : {}), protecao: resultado?.protecao || "sem-protecao" };
	armazenamento.gravar(CHAVE.sync, estado.sync);
	// Conta do dono guarda o código e a chave (outros aparelhos da mesma conta entram como dono)
	const u = prov.usuario || estado.usuarios[s.provedor];
	if (estado.sync.papel === "dono" && u?.id && prov.salvarListaNaConta) prov.salvarListaNaConta(u.id, s.codigo, estado.sync.segredo || "").catch(e => console.warn(e));
	iniciarOuvintesConvidados();
	atualizarDialogoSync();
	return true;
}

/** A lista já é protegida e este aparelho não tem a chave: pede o código do dono. */
/**
 * Este aparelho só visualiza a lista. O acesso completo é liberado quando a pessoa
 * entra com a CONTA que criou a lista (o servidor confere pela chave guardada na conta).
 */
async function pedirLoginDono(s) {
	const google = provedores.firebase.disponivel;
	const { acao } = await dialogo({
		titulo: "Acesso completo",
		html: "Você está <b>só visualizando</b> esta lista.<br><br>Se você é o dono, entre com a <b>conta que criou a lista</b> (Google ou e-mail): o acesso completo é liberado na hora.",
		icone: "info",
		confirmar: google ? "Entrar com Google" : "Entrar com e-mail",
		negar: google ? "Entrar com e-mail" : undefined,
		cancelar: "Continuar só visualizando"
	});
	if (acao === "confirmar" && google) return loginGoogle();
	if (acao === "confirmar" || acao === "negar") {
		const { acao: a2, valor } = await dialogo({ titulo: "Entrar com e-mail", html: "Digite o e-mail da conta que criou a lista. Você vai receber um link para entrar.", confirmar: "Receber link", cancelar: "Cancelar", input: "email" });
		const email = String(valor || "").trim().toLowerCase();
		if (a2 !== "confirmar" || !RE_EMAIL.test(email)) return false;
		const prov = provedorEmail(false);
		if (!prov) return false;
		try {
			armazenamento.gravarTexto(CHAVE.loginPendente, prov.id);
			if (prov.id === "firebase") await prov.enviarLinkEmail(email);
			else await prov.enviarCodigo(email);
			toast("sucesso", `Link enviado para <b>${esc(email)}</b>. Abra o e-mail neste aparelho para liberar o acesso completo.`, 9000);
		} catch (e) {
			armazenamento.remover(CHAVE.loginPendente);
			toast("erro", esc(explicarErro(e).mensagem), 8000);
		}
	}
	return false;
}

/** Sem a conta dona (ou com uma chave que não confere): fica na lista, só visualizando. */
function virarVisualizacao(s) {
	return conectarNuvem({ provedor: s.provedor, codigo: s.codigo, modo: "leitura", papel: "convidado", donoPendente: true });
}

/** Lista de convidados no diálogo do dono. */
function desenharConvidados() {
	if (!el.listaConvidados) return;
	const lista = estado.convidados;
	if (!lista.length) {
		el.listaConvidados.innerHTML = `<li class="convidado-vazio">Nenhum convidado ainda. Toque em <b>Novo convidado</b> para gerar um link.</li>`;
		return;
	}
	el.listaConvidados.innerHTML = lista.map(c => {
		const aparelhos = (c.aparelhos || []).map(m => limparNomeConvidado(m.nome) || limparNomeConvidado(m.aparelho)).filter(Boolean);
		const titulo = aparelhos.length ? `${c.nome} · ${aparelhos.join(", ")}` : c.nome;
		return `
		<li class="convidado${c.codigo === convidadoSelecionado ? " selecionado" : ""}" data-convidado="${esc(c.codigo)}">
			<div class="convidado-info" data-c="detalhes" role="button" tabindex="0" title="Ver detalhes e renomear" aria-label="Detalhes de ${esc(c.nome)}">
				<strong title="${esc(titulo)}">${esc(titulo)} <span class="convidado-mais">${icone("ChevronRight")}</span></strong>
				<small class="convite-completo">Código de convite: <b class="codigo-convidado">${esc(estado.sync?.codigo ? codigoDeConvite(estado.sync.codigo, c.codigo) : formatarCodigoConvidado(c.codigo))}</b></small>
				<small>${c.podeEditar ? "pode editar" : "só visualizar"} · ${c.visto ? `visto ${esc(fmtRelativoCurto(c.visto))}` : "ainda não entrou"}</small>
			</div>
			<label class="mini-interruptor" title="Pode editar">
				<input type="checkbox" data-c="permissao" ${c.podeEditar ? "checked" : ""} aria-label="${esc(c.nome)} pode editar">
				<span class="interruptor-trilho"><span></span></span>
			</label>
			<button type="button" class="btn-icone" data-c="copiar" title="Copiar código de convite (o convidado digita em “Já tem um código?”)" aria-label="Copiar código de convite de ${esc(c.nome)}">${icone("Copy")}</button>
			<button type="button" class="btn-icone" data-c="link" title="Link e QR Code" aria-label="Link de ${esc(c.nome)}">${icone("QrCode")}</button>
			<button type="button" class="btn-icone" data-c="remover" title="Remover convidado" aria-label="Remover ${esc(c.nome)}">${icone("UserX")}</button>
		</li>`;
	}).join("");
}

function fmtRelativoCurto(quando) {
	const min = Math.round((Date.now() - quando) / 60000);
	if (min < 2) return "agora";
	if (min < 60) return `há ${min} min`;
	const h = Math.round(min / 60);
	if (h < 48) return `há ${h} h`;
	return `há ${Math.round(h / 24)} dias`;
}

function gerarCodigoConvidado() {
	const usados = new Set(estado.convidados.map(c => c.codigo));
	for (let i = 0; i < 20; i++) {
		const codigo = gerarCodigoLista().slice(0, 10);
		if (RE_CONVIDADO.test(codigo) && !usados.has(codigo)) return codigo;
	}
	throw new Error("Não foi possível gerar o código do convidado.");
}

const erroConvite = e => {
	console.warn("[convidados]", e);
	const info = explicarErro(e);
	toast("erro", info.tipo === "rede" ? "Sem conexão: tente de novo quando a internet voltar." : "Não foi possível salvar no servidor. Tente de novo.");
};

async function novoConvidado() {
	if (!emNuvem() || !ehDono()) return toast("aviso", "Só o <b>dono da lista</b> pode convidar.");
	if (!temConvidadosNoServidor()) return toast("aviso", "Convidados ficam disponíveis nas listas do Google ou com código.");
	if (estado.sync.protecao !== "protegida") return toast("aviso", "A proteção da lista ainda não está ativa no servidor. Tente de novo em instantes.");
	if (estado.convidados.length >= 50) return toast("aviso", "Limite de 50 convidados. Remova algum para convidar outro.");
	const padrao = `Convidado ${estado.convidados.length + 1}`;
	let nome = padrao, podeEditarConv = true;
	if (window.Swal) {
		const r = await window.Swal.fire({
			title: "Novo convidado",
			html: "Dê um nome para reconhecer o convidado (ex.: <b>Caixa 1</b>, <b>Maria</b>) e escolha a permissão. Você pode mudar depois. O convidado também pode informar o próprio nome.",
			input: "text",
			inputValue: padrao,
			inputAttributes: { maxlength: String(LIMITE_NOME_CONVIDADO), autocapitalize: "words", spellcheck: "false" },
			showDenyButton: true,
			showCancelButton: true,
			confirmButtonText: "Pode editar",
			denyButtonText: "Só visualizar",
			cancelButtonText: "Cancelar",
			reverseButtons: true,
			buttonsStyling: false,
			heightAuto: false,
			target: document.querySelector("dialog[open]") || "body",
			customClass: { popup: "sw-popup", confirmButton: "btn btn-primario", denyButton: "btn btn-secundario", cancelButton: "btn btn-fantasma", input: "sw-input" },
			returnInputValueOnDeny: true
		});
		if (r.isDismissed) return;
		podeEditarConv = r.isConfirmed;
		nome = typeof r.value === "string" ? r.value : padrao;
	} else {
		const v = window.prompt("Nome do convidado:", padrao);
		if (v === null) return;
		nome = v;
		podeEditarConv = window.confirm("Este convidado pode editar a lista? (Cancelar = só visualizar)");
	}
	nome = limparNomeConvidado(nome) || padrao;
	let codigo;
	try { codigo = gerarCodigoConvidado(); } catch (e) { return toast("erro", esc(e.message)); }
	const c = { codigo, nome, podeEditar: podeEditarConv, criadoEm: Date.now(), aparelhos: [], visto: 0 };
	estado.convidados = [...estado.convidados, c]; // aparece na hora (o servidor confirma depois)
	convidadoSelecionado = codigo;
	atualizarCompartilhamento();
	try {
		await provAtual().salvarConvite(estado.sync.codigo, codigo, { nome, editar: podeEditarConv, criadoEm: c.criadoEm });
		toast("sucesso", `Convidado <b>${esc(nome)}</b> criado. Envie o link (ou mostre o QR Code) só para ele.`, 5000);
	} catch (e) {
		estado.convidados = estado.convidados.filter(x => x.codigo !== codigo);
		if (convidadoSelecionado === codigo) convidadoSelecionado = null;
		atualizarCompartilhamento();
		erroConvite(e);
	}
}

/** Detalhes do convidado (quem é, aparelho, quando entrou/foi visto) e opção de renomear. */
async function detalhesConvidado(c) {
	if (!window.Swal) return;
	const quando = t => (t ? new Date(Number(t)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + ` (${fmtRelativoCurto(Number(t))})` : "—");
	const pedido = (estado.pedidosAprovados || []).find(p => p.convite === c.codigo);
	const linha = (rotulo, valor) => `<div class="det-linha"><span>${rotulo}</span><b>${valor}</b></div>`;
	const aparelhos = (c.aparelhos || []).slice().sort((a, b) => (Number(b.visto) || 0) - (Number(a.visto) || 0));
	const blocosAparelhos = aparelhos.length
		? aparelhos.map((m, i) => `<div class="det-bloco"><div class="det-titulo">${aparelhos.length > 1 ? `Aparelho ${i + 1}` : "Aparelho conectado"}</div>
			${linha("Nome que ele informou", esc(limparNomeConvidado(m.nome) || "—"))}
			${linha("Aparelho", esc(limparNomeConvidado(m.aparelho) || "—"))}
			${linha("Visto por último", esc(quando(m.visto)))}</div>`).join("")
		: `<p class="ajuda">Este convidado <b>ainda não entrou</b>. Os dados do aparelho aparecem aqui assim que ele conectar.</p>`;
	const blocoPedido = pedido ? `<div class="det-bloco"><div class="det-titulo">Pedido de acesso</div>
		${linha("Telefone", esc(pedido.telefone || "—"))}
		${linha("Navegador", esc(pedido.navegador || "—"))}
		${linha("Pedido em", esc(quando(pedido.criadoEm)))}</div>` : "";
	const html = `<div class="det-convidado">
		<div class="det-bloco">
			${linha("Nome que você deu", esc(c.nome))}
			${linha("Permissão", c.podeEditar ? "pode editar" : "só visualizar")}
			${linha("Código de convite", `<span class="codigo-convidado">${esc(codigoDeConvite(estado.sync.codigo, c.codigo))}</span>`)}
			${linha("Criado em", esc(quando(c.criadoEm)))}
		</div>
		${blocosAparelhos}${blocoPedido}
	</div>`;
	const abrir = () => window.Swal.fire({
		title: "Detalhes do convidado",
		html,
		showConfirmButton: true,
		confirmButtonText: "Renomear",
		showCancelButton: true,
		cancelButtonText: "Fechar",
		buttonsStyling: false,
		heightAuto: false,
		target: document.querySelector("dialog[open]") || "body",
		customClass: { popup: "sw-popup", confirmButton: "btn btn-secundario", cancelButton: "btn btn-fantasma" }
	});
	const promessa = filaDialogos.then(abrir, abrir);
	filaDialogos = promessa.catch(() => { });
	const r = await promessa;
	if (r?.isConfirmed) renomearConvidado(c);
}

/** Dono muda o nome que ele mesmo deu ao convidado (o nome que o convidado escolheu não muda). */
async function renomearConvidado(c) {
	if (!window.Swal || !ehDono() || !emNuvem()) return;
	const abrir = () => window.Swal.fire({
		title: "Renomear convidado",
		html: `<p>Este é o nome que <b>você</b> vê na lista de convidados. O nome que o convidado escolheu para ele continua aparecendo ao lado.</p>`,
		input: "text",
		inputValue: c.nome,
		inputAttributes: { maxlength: "40", autocapitalize: "words", enterkeyhint: "done" },
		showCancelButton: true,
		confirmButtonText: "Salvar",
		cancelButtonText: "Cancelar",
		buttonsStyling: false,
		heightAuto: false,
		target: document.querySelector("dialog[open]") || "body",
		customClass: { popup: "sw-popup", input: "sw-input", confirmButton: "btn btn-primario", cancelButton: "btn btn-fantasma" },
		preConfirm: valor => {
			const nome = limparNomeConvidado(valor);
			if (nome.length < 2) { window.Swal.showValidationMessage("Digite um nome (pelo menos 2 letras)."); return false; }
			return nome;
		}
	});
	const promessa = filaDialogos.then(abrir, abrir);
	filaDialogos = promessa.catch(() => { });
	const r = await promessa;
	const nome = limparNomeConvidado(r?.value);
	if (!r?.isConfirmed || nome.length < 2 || nome === c.nome) return;
	const antes = c.nome;
	c.nome = nome;
	desenharConvidados();
	try {
		await provAtual().salvarConvite(estado.sync.codigo, c.codigo, { nome, editar: c.podeEditar, criadoEm: c.criadoEm });
		toast("sucesso", `Convidado renomeado para <b>${esc(nome)}</b>.`, 3000);
	} catch (e) {
		c.nome = antes;
		desenharConvidados();
		erroConvite(e);
	}
}

async function acaoConvidado(evento) {
	const alvo = evento.target.closest("[data-c]");
	const linha = evento.target.closest("[data-convidado]");
	if (!alvo || !linha || !ehDono() || !emNuvem()) return;
	const tipo = alvo.dataset.c;
	if ((evento.type === "change") !== (tipo === "permissao")) return;
	const c = estado.convidados.find(x => x.codigo === linha.dataset.convidado);
	if (!c) return;
	const codigoLista = estado.sync.codigo;
	if (tipo === "permissao") {
		const antes = c.podeEditar;
		c.podeEditar = alvo.checked;
		desenharConvidados();
		try {
			await provAtual().salvarConvite(codigoLista, c.codigo, { nome: c.nome, editar: c.podeEditar, criadoEm: c.criadoEm });
			toast("info", `<b>${esc(c.nome)}</b> agora ${c.podeEditar ? "<b>pode editar</b>" : "<b>só pode visualizar</b>"}. O servidor já aplica; o aparelho dele é avisado assim que estiver online.`, 5000);
		} catch (e) {
			c.podeEditar = antes;
			desenharConvidados();
			erroConvite(e);
		}
	} else if (tipo === "detalhes") {
		detalhesConvidado(c);
	} else if (tipo === "copiar") {
		// Código de convite = código da lista + código do convidado (dá para digitar em vez de abrir o link)
		const codigoConvite = codigoDeConvite(estado.sync.codigo, c.codigo);
		const ok = await copiarTexto(codigoConvite);
		feedbackBotao(alvo, ok);
		toast(ok ? "sucesso" : "erro", ok
			? `Código de convite de <b>${esc(c.nome)}</b> copiado:<br><b class="codigo-convidado">${esc(codigoConvite)}</b><br><small>No aparelho dele: Salvar e compartilhar → “Já tem um código?”.</small>`
			: "Não foi possível copiar. Use o link ou o QR Code.", 6000);
	} else if (tipo === "link") {
		convidadoSelecionado = convidadoSelecionado === c.codigo ? null : c.codigo;
		atualizarCompartilhamento();
	} else if (tipo === "remover") {
		const ok = await confirmar({
			titulo: "Remover convidado?",
			html: `<b>${esc(c.nome)}</b> perde o acesso à lista na hora (o servidor bloqueia). O link dele para de funcionar.`,
			confirmar: "Remover",
			icone: "warning",
			perigo: true
		});
		if (!ok || !emNuvem() || estado.sync.codigo !== codigoLista) return;
		try {
			await provAtual().removerConvite(codigoLista, c.codigo, (c.aparelhos || []).map(m => m.uid).filter(Boolean));
			estado.convidados = estado.convidados.filter(x => x.codigo !== c.codigo);
			if (convidadoSelecionado === c.codigo) convidadoSelecionado = null;
			atualizarCompartilhamento();
			toast("info", `Convidado <b>${esc(c.nome)}</b> removido.`);
		} catch (e) {
			erroConvite(e);
		}
	}
}

/** No aparelho do convidado: aplica a permissão definida pelo dono (lida do servidor) e avisa quando muda. */
function aplicarPermissaoConvidado(info = {}) {
	const s = estado.sync;
	if (!s || s.papel !== "convidado" || !s.convidado) return;
	if (info.negado) { avisarAcessoRecusado(provAtual()); return; } // não dá para ler o convite: não afirma "removido"
	if (info.existe === false && info.doServidor) {
		if (estado.dadosProntos || s.confirmado) acessoRemovido("dono");
		return;
	}
	if (!info.existe) return;
	exigirNomeConvidado();
	const modo = info.editar ? "edicao" : "leitura";
	const primeiraVez = !s.confirmado;
	if (modo === s.modo && !primeiraVez) return;
	const mudou = modo !== s.modo;
	estado.sync = { ...s, modo, confirmado: true };
	armazenamento.gravar(CHAVE.sync, estado.sync);
	if (modo === "leitura" && estado.editandoId) sairDaEdicao(true);
	render();
	atualizarIndicadorSync();
	atualizarDialogoSync();
	if (primeiraVez) {
		toast("info", modo === "edicao"
			? "Convite confirmado: você <b>pode editar</b> esta lista."
			: "Convite confirmado: você pode <b>somente visualizar</b> esta lista.", 6000);
	} else if (mudou) {
		toast(modo === "edicao" ? "sucesso" : "aviso", modo === "edicao"
			? "✏️ O dono da lista liberou: agora você <b>pode editar</b>."
			: "👁️ O dono da lista mudou sua permissão: agora você <b>só pode visualizar</b>.", 8000);
	}
}

/** Convidado sem nome: pede o nome antes de continuar (obrigatório — o dono precisa saber quem é). */
let pedindoNome = false;
async function exigirNomeConvidado() {
	const s = estado.sync;
	if (pedindoNome || !s || s.papel !== "convidado" || !s.convidado) return;
	if (limparNomeConvidado(armazenamento.lerTexto(CHAVE.nomeAparelho)).length >= 2) return;
	if (!window.Swal) return;
	pedindoNome = true;
	try {
		// Na fila dos alertas: não atropela outro alerta aberto (nem é atropelado por ele)
		const abrir = () => window.Swal.fire({
			title: "Qual é o seu nome?",
			html: `<p>O dono da lista precisa saber quem está usando este convite.</p>`,
			input: "text",
			inputPlaceholder: "Seu nome",
			inputAttributes: { maxlength: "40", autocomplete: "name", autocapitalize: "words", enterkeyhint: "done" },
			confirmButtonText: "Continuar",
			showCancelButton: false,
			allowOutsideClick: false,
			allowEscapeKey: false,
			buttonsStyling: false,
			heightAuto: false,
			target: document.querySelector("dialog[open]") || "body",
			customClass: { popup: "sw-popup", input: "sw-input", confirmButton: "btn btn-primario" },
			preConfirm: valor => {
				const nome = limparNomeConvidado(valor);
				if (nome.length < 2) { window.Swal.showValidationMessage("Digite seu nome (pelo menos 2 letras)."); return false; }
				return nome;
			}
		});
		const promessa = filaDialogos.then(abrir, abrir);
		filaDialogos = promessa.catch(() => { });
		const r = await promessa;
		const nome = limparNomeConvidado(r?.value);
		if (nome.length < 2) return;
		armazenamento.gravarTexto(CHAVE.nomeAparelho, nome);
		if (el.nomeConvidado) el.nomeConvidado.value = nome;
		enviarAparelho().catch(e => console.warn("[convidados] nome:", e));
		toast("sucesso", `Obrigado, <b>${esc(nome)}</b>! O dono da lista vê este aparelho com o seu nome.`, 4000);
	} finally {
		pedindoNome = false;
	}
}

/** Convidado: envia o nome escolhido (ou do aparelho) ao dono. */
async function enviarAparelho() {
	const s = estado.sync;
	if (!s || s.papel !== "convidado" || !s.convidado || s.protecao !== "protegida") return false;
	await provAtual()?.atualizarMembro?.(s.codigo, await acessoDe(s));
	return true;
}

let removendoAcesso = false;
/** Servidor recusou a leitura: explica a causa provável (uma vez por sessão) sem tirar o aparelho da lista. */
let acessoRecusadoAvisado = false;
function avisarAcessoRecusado(prov) {
	estado.statusSync = "erro";
	estado.detalheSync = "O servidor recusou o acesso a esta lista.";
	atualizarIndicadorSync();
	if (acessoRecusadoAvisado) return;
	acessoRecusadoAvisado = true;
	const semId = !!prov?.semIdentidade;
	console.warn("[nuvem · dono do site]", semId
		? "Ative o login Anônimo: Firebase → Authentication → Sign-in method → Anônimo"
		: "Publique as regras atualizadas do Firestore (docs/CONFIGURACAO.md)");
	dialogo({
		titulo: "Não foi possível abrir a lista",
		html: semId
			? "O servidor da nuvem não conseguiu identificar este aparelho, então recusou o acesso.<br><br><small><b>Dono do site:</b> ative o login <b>Anônimo</b> em Firebase → Authentication → Sign-in method → Anônimo, e recarregue a página.</small>"
			: "O servidor da nuvem recusou o acesso a esta lista.<br><br><small><b>Dono do site:</b> publique as regras atualizadas do Firestore (docs/CONFIGURACAO.md) e confira se o login <b>Anônimo</b> está ativo. Depois, recarregue a página.</small>",
		icone: "warning"
	});
}

/** Este aparelho perdeu o acesso à lista (convite removido, lista protegida, chave errada). */
async function acessoRemovido(motivo = "dono") {
	if (removendoAcesso || !emNuvem()) return;
	removendoAcesso = true;
	try {
		pararOuvintesConvidados();
		provAtual()?.desligar();
		estado.sync = null;
		estado.itensNuvem = [];
		estado.convidados = [];
		estado.statusSync = "local";
		estado.detalheSync = "";
		estado.ultimaSync = null;
		armazenamento.remover(CHAVE.sync);
		armazenamento.remover(CHAVE.cacheNuvem);
		if (estado.editandoId) sairDaEdicao(true);
		render();
		atualizarIndicadorSync();
		atualizarDialogoSync();
		if (motivo === "silencioso") return;
		dialogo({
			titulo: "Acesso removido",
			html: motivo === "convite"
				? "Este convite não vale mais (o dono removeu ou trocou). Peça um novo link ao dono da lista."
				: motivo === "protegida"
					? "O dono protegeu esta lista: agora só entram convidados. Peça um link de convite ao dono."
					: "O dono da lista removeu o acesso deste aparelho. Os produtos deste aparelho continuam salvos nele.",
			icone: "info"
		});
	} finally {
		removendoAcesso = false;
	}
}

/* Itens reservados da versão anterior (convites dentro da lista): o dono migra para o servidor e apaga */
let migrandoConvites = false;
async function migrarConvitesAntigos(recebidos) {
	const s = estado.sync, prov = provAtual();
	if (migrandoConvites || !s || s.papel !== "dono" || s.protecao !== "protegida" || !prov?.recursos?.convidados) return;
	const antigos = recebidos.filter(ehItemReservado);
	if (!antigos.length) return;
	migrandoConvites = true;
	try {
		for (const i of antigos.filter(ehItemConvidado)) {
			const codigo = String(i.codigoBarras).slice(MARCA_CONVIDADO.length);
			if (!RE_CONVIDADO.test(codigo) || estado.convidados.some(c => c.codigo === codigo)) continue;
			await prov.salvarConvite(s.codigo, codigo, { nome: limparNomeConvidado(i.nome) || "Convidado", editar: Number(i.quantidade) > 0, criadoEm: Number(i.criadoEm) || Date.now() });
		}
		await prov.removerVarios(antigos.map(i => String(i.id)));
	} catch (e) {
		console.warn("[convidados] migração:", e);
	} finally {
		migrandoConvites = false;
	}
}

function enviarNomeLojaNuvem() {
	if (!emNuvem() || !podeEditar()) return;
	const agora = Date.now();
	provAtual()?.salvarVarios([{
		id: ID_CONFIG_LOJA,
		nome: estado.loja,
		quantidade: 0,
		vencimento: "2000-01-01",
		codigoBarras: MARCA_CONFIG_LOJA,
		criadoEm: agora,
		atualizadoEm: agora
	}]).catch(() => { });
	estado.lojaVerificadaEm = idSync(estado.sync);
}

/** Aplica o nome recebido da nuvem; se a lista ainda não tem nome, envia o deste aparelho. */
function receberNomeLojaNuvem(config, { doServidor }) {
	if (!emNuvem()) return;
	const lista = idSync(estado.sync);
	if (config) {
		estado.lojaVerificadaEm = lista;
		const nome = limparNomeLoja(config.nome);
		if (nome !== estado.loja) definirNomeLoja(nome, { origem: "nuvem" });
		else armazenamento.gravarTexto(CHAVE.lojaOrigem, "nuvem");
		return;
	}
	if (!doServidor || estado.lojaVerificadaEm === lista) return;
	estado.lojaVerificadaEm = lista;
	// Só envia um nome definido neste aparelho (nunca o de outra lista compartilhada)
	if (estado.loja && armazenamento.lerTexto(CHAVE.lojaOrigem) !== "nuvem") enviarNomeLojaNuvem();
}

async function configurarNomeLoja() {
	if (emNuvem() && !podeEditar()) {
		toast("aviso", "Este aparelho está no modo <b>somente leitura</b>: o nome da loja segue a lista compartilhada.");
		return;
	}
	const atual = estado.loja;
	let valor;
	if (!window.Swal) {
		const v = window.prompt(`Nome da sua loja (até ${LIMITE_NOME_LOJA} caracteres). Deixe em branco para usar o nome padrão:`, atual);
		if (v === null) return;
		valor = v;
	} else {
		const r = await window.Swal.fire({
			title: "Nome da loja",
			html: "Aparece antes de <b>Controle de Vencimento</b>, no topo do app e no título da aba. " + (emNuvem()
				? "Fica salvo na lista e muda na hora em <b>todos os aparelhos</b> conectados a ela."
				: "Fica salvo neste aparelho e, ao ativar a nuvem, vai para <b>todos os aparelhos</b> da lista."),
			input: "text",
			inputValue: atual,
			inputPlaceholder: "Ex.: Mercado São José",
			inputAttributes: { maxlength: String(LIMITE_NOME_LOJA), autocomplete: "organization", autocapitalize: "words", spellcheck: "false", enterkeyhint: "done" },
			showCancelButton: true,
			showDenyButton: !!atual,
			confirmButtonText: "Salvar",
			denyButtonText: "Usar nome padrão",
			cancelButtonText: "Cancelar",
			reverseButtons: true,
			buttonsStyling: false,
			heightAuto: false,
			customClass: { popup: "sw-popup", confirmButton: "btn btn-primario", denyButton: "btn btn-secundario", cancelButton: "btn btn-fantasma", input: "sw-input" }
		});
		if (r.isDenied) valor = "";
		else if (r.isConfirmed) valor = String(r.value ?? "");
		else return;
	}
	const limpo = limparNomeLoja(valor);
	if (limpo === atual) return;
	definirNomeLoja(limpo);
	enviarNomeLojaNuvem();
	const nosAparelhos = emNuvem() ? " Os outros aparelhos da lista recebem na hora." : "";
	toast("sucesso", (limpo ? `Nome da loja definido: <b>${esc(limpo)}</b>.` : "Nome padrão restaurado.") + nosAparelhos);
}

/** Parte do nome dos arquivos exportados (ex.: "mercado-sao-jose"). */
const sufixoArquivoLoja = () => {
	const slug = normalizar(estado.loja).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	return slug ? `${slug}-` : "";
};

function exportarJSON() {
	const dados = {
		app: "controle-de-vencimento",
		versao: 2,
		exportadoEm: new Date().toISOString(),
		itens: itensAtuais(),
		alerta: estado.alerta,
		silenciados: [...estado.silenciados],
		loja: estado.loja || undefined
	};
	baixarArquivo(JSON.stringify(dados, null, 2), `vencimentos-${sufixoArquivoLoja()}${hojeISO()}.json`, "application/json");
	toast("sucesso", `Backup gerado com <b>${dados.itens.length}</b> produto(s).`);
}

function exportarCSV() {
	const limite = limiteAlertaDias();
	const celula = valor => {
		let t = String(valor ?? "");
		if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // evita fórmulas maliciosas no Excel
		return `"${t.replace(/"/g, '""')}"`;
	};
	const linhas = [["Produto", "Código de barras", "Quantidade", "Vencimento", "Situação"].map(celula).join(";")];
	ordenar(itensAtuais().map(item => ({ item, sit: situacao(item, limite) })), "venc-asc").forEach(({ item, sit }) => {
		linhas.push([item.nome, item.codigoBarras, fmtNumero.format(item.quantidade), formatarData(item.vencimento), sit.texto].map(celula).join(";"));
	});
	baixarArquivo("﻿" + linhas.join("\r\n"), `vencimentos-${sufixoArquivoLoja()}${hojeISO()}.csv`, "text/csv;charset=utf-8");
	toast("sucesso", "Planilha exportada.");
}

async function importarArquivo(arquivo) {
	if (!arquivo) return;
	if (arquivo.size > 15 * 1024 * 1024) return toast("erro", "Arquivo muito grande (máximo 15 MB).");
	let dados;
	try {
		dados = JSON.parse(await arquivo.text());
		if (!dados || typeof dados !== "object") throw new Error("formato");
	} catch {
		return dialogo({ titulo: "Arquivo inválido", html: "Não foi possível ler este arquivo. Escolha um backup <b>.json</b> gerado pelo app.", icone: "error" });
	}

	// Aceita o formato novo (itens) e o antigo (produtos)
	const brutos = Array.isArray(dados.itens) ? dados.itens : Array.isArray(dados.produtos) ? dados.produtos : Array.isArray(dados) ? dados : [];
	const validos = brutos.map(sanitizarItem).filter(Boolean);
	const invalidos = brutos.length - validos.length;

	let adicionados = 0, atualizados = 0;
	if (validos.length) {
		if (!podeEditar()) {
			toast("aviso", "Este aparelho está no modo <b>somente leitura</b>; os produtos não foram importados.");
		} else {
			const atuais = itensAtuais();
			const porChave = new Map(atuais.map(i => [chaveItem(i), i]));
			const idsUsados = new Set(atuais.map(i => i.id));
			const salvar = [];
			for (const novo of validos) {
				const existente = porChave.get(chaveItem(novo));
				if (existente) {
					if (existente.quantidade !== novo.quantidade) {
						const atualizado = { ...existente, quantidade: novo.quantidade, atualizadoEm: Date.now() };
						salvar.push(atualizado);
						porChave.set(chaveItem(novo), atualizado);
						atualizados++;
					}
				} else {
					if (idsUsados.has(novo.id)) novo.id = gerarId();
					idsUsados.add(novo.id);
					porChave.set(chaveItem(novo), novo);
					salvar.push(novo);
					adicionados++;
				}
			}
			if (salvar.length) aplicarAlteracoes({ salvar });
		}
	}

	// Configurações de alerta
	const alerta = dados.alerta || (dados.configAlerta && { valor: dados.configAlerta.alertarValor, unidade: dados.configAlerta.unidade });
	if (alerta && Number.isFinite(Number(alerta.valor))) {
		estado.alerta = { valor: Math.max(0, Math.min(3650, Math.floor(Number(alerta.valor)))), unidade: alerta.unidade === "meses" ? "meses" : "dias" };
		armazenamento.gravar(CHAVE.alerta, estado.alerta);
		aplicarAlertaNaTela();
	}
	// Nome da loja do backup: só aplica se este aparelho ainda não tem um
	if (!estado.loja && typeof dados.loja === "string" && limparNomeLoja(dados.loja)) { definirNomeLoja(dados.loja); enviarNomeLojaNuvem(); }
	if (Array.isArray(dados.silenciados)) {
		const ids = new Set(itensAtuais().map(i => i.id));
		dados.silenciados.map(normalizarId).filter(id => id && ids.has(id)).forEach(id => estado.silenciados.add(id));
		salvarSilenciados();
	}
	render();

	const resumo = [`<b>${adicionados}</b> adicionado(s)`, `<b>${atualizados}</b> atualizado(s)`];
	if (invalidos > 0) resumo.push(`<b>${invalidos}</b> ignorado(s) por dados inválidos`);
	toast(adicionados || atualizados ? "sucesso" : "info", `Importação concluída: ${resumo.join(", ")}.`, 6000);
}

/* =========================================================
   Leitor de código de barras (ver leitor.js)
   ========================================================= */
let leitor = null;
let leituraConcluida = false;
let uiFocoLeitor = null;
let uiFocoValidade = null;

/** Esconde o botão e o painel de foco (até a câmera dizer o que permite). */
function esconderFoco(botao, ui) {
	botao.hidden = true;
	botao.setAttribute("aria-pressed", "false");
	ui?.fecharPainel();
}

function obterLeitor() {
	if (leitor) return leitor;
	leitor = criarLeitor({
		video: el.leitorVideo,
		mira: el.leitorMira,
		aoLer: (codigo, formato) => leituraOk(codigo, formato),
		aoStatus: texto => { el.leitorStatus.textContent = texto; },
		aoCapacidades: cap => {
			el.btnFlash.classList.toggle("indisponivel", !cap.flash);
			el.btnFlash.setAttribute("aria-pressed", String(!!cap.flashLigado));
			const titulo = !cap.flash ? "Flash indisponível neste aparelho/navegador" : cap.flashLigado ? "Desligar flash" : "Ligar flash";
			el.btnFlash.title = titulo;
			el.btnFlash.setAttribute("aria-label", titulo);
			el.btnTrocarCamera.hidden = cap.cameras < 2;
			el.leitorZoomCaixa.hidden = !cap.zoom;
			if (cap.zoom) {
				el.leitorZoom.min = cap.zoom.min;
				el.leitorZoom.max = cap.zoom.max;
				el.leitorZoom.step = cap.zoom.passo;
				el.leitorZoom.value = cap.zoom.valor;
			}
			uiFocoLeitor?.atualizar();
		}
	});
	return leitor;
}

async function abrirLeitor() {
	if (!podeEditar()) return;
	leituraConcluida = false;
	el.leitorArea.classList.remove("lido");
	el.btnFotoCodigo.classList.remove("destaque");
	el.leitorStatus.textContent = "Iniciando câmera…";
	el.btnFlash.setAttribute("aria-pressed", "false");
	el.btnFlash.innerHTML = icone("Flashlight");
	el.btnFlash.classList.remove("indisponivel");
	el.btnTrocarCamera.hidden = true;
	el.leitorZoomCaixa.hidden = true;
	esconderFoco(el.btnFoco, uiFocoLeitor);
	if (!el.dlgLeitor.open) el.dlgLeitor.showModal();
	const l = obterLeitor();
	try {
		await l.iniciar();
		if (!el.dlgLeitor.open) l.parar();
	} catch (erro) {
		console.warn("Leitor:", erro);
		l.parar();
		if (!el.dlgLeitor.open) return;
		const { mensagem, detalhe } = l.traduzirErro(erro);
		el.leitorStatus.textContent = "Câmera indisponível — use “Tirar foto do código”";
		el.btnFotoCodigo.classList.add("destaque");
		toast("erro", `${esc(mensagem)}<br><small style="opacity:.8">${esc(detalhe)}</small>`, 9000);
	}
}

function pararLeitor() {
	leitor?.parar();
	esconderFoco(el.btnFoco, uiFocoLeitor);
}

function leituraOk(codigo) {
	if (leituraConcluida) return;
	const limpo = String(codigo || "").replace(/\s+/g, "").slice(0, 64);
	if (!limpo) return;
	leituraConcluida = true;
	el.leitorArea.classList.add("lido");
	el.leitorStatus.textContent = `Lido: ${limpo}`;
	el.codigo.value = limpo;
	atualizarBotoesCampos();
	// Pequena pausa para a pessoa ver a confirmação verde
	setTimeout(() => {
		pararLeitor();
		if (el.dlgLeitor.open) el.dlgLeitor.close();
		const reconhecido = autoPreencherPorCodigo();
		marcarSugerido(el.codigo);
		fotoAutomaticaDoFormulario();
		(reconhecido ? el.quantidade : el.nome).focus();
		toast("sucesso", `Código lido: <b>${esc(limpo)}</b>`, 2500);
	}, 350);
}

async function alternarFlash() {
	if (!leitor?.ativo) return;
	// Tenta mesmo quando o aparelho não anuncia o flash (alguns Android suportam assim mesmo)
	try {
		await leitor.alternarFlash();
	} catch {
		el.btnFlash.classList.add("indisponivel");
		toast("aviso", el.btnTrocarCamera.hidden
			? "Este aparelho/navegador não permite ligar o flash pela página. Toque em <b>Tirar foto do código</b> e use o flash da câmera."
			: "Não foi possível ligar o flash nesta câmera. Tente <b>trocar de câmera</b> ou use <b>Tirar foto do código</b>.", 7000);
	}
}

async function lerFotoDoCodigo(arquivo) {
	if (!arquivo) return;
	el.leitorStatus.textContent = "Analisando foto…";
	try {
		const r = await obterLeitor().lerFoto(arquivo);
		if (r) {
			leituraConcluida = false;
			leituraOk(r.codigo, r.formato);
		} else {
			el.leitorStatus.textContent = leitor?.ativo ? "Procurando código…" : "Nenhum código na foto";
			toast("aviso", "Não encontrei um código na foto. Tire outra bem de perto, com o código nítido e reto.", 6000);
		}
	} catch (e) {
		console.warn(e);
		toast("erro", "Não foi possível analisar a foto. Verifique sua internet e tente de novo.");
	}
}

/* =========================================================
   Sincronização / compartilhamento
   ========================================================= */
/* ---------- Provedores de nuvem ----------
   firebase → "Entrar com Google" + listas por código
   supabase → "Entrar com e-mail" + listas por código
   dropbox  → "Entrar com Dropbox" (lista da conta)            */
const CODIGO_CONTA = "CONTA"; // o Dropbox não usa código: a lista é a da conta

function eventosDe(id) {
	const ativo = () => estado.sync?.provedor === id;
	return {
		aoReceber(itens, meta) {
			if (!ativo()) return;
			const recebidos = Array.isArray(itens) ? itens : [];
			estado.itensNuvem = sanitizarLista(recebidos.filter(i => !ehConfigLoja(i) && !ehItemReservado(i)));
			receberNomeLojaNuvem(recebidos.find(ehConfigLoja), meta);
			if (meta.doServidor) migrarConvitesAntigos(recebidos);
			if (meta.doServidor) estado.ultimaSync = new Date();
			if (meta.doServidor || estado.itensNuvem.length) estado.dadosProntos = true;
			armazenamento.gravar(CHAVE.cacheNuvem, { id: idSync(estado.sync), itens: estado.itensNuvem });
			render();
			if (meta.doServidor) {
				limparSilenciadosOrfaos();
				setTimeout(reconciliar, 1200);
				alertaInicial();
			}
		},
		aoStatus(status, detalhe) {
			if (!ativo()) return;
			estado.statusSync = status;
			estado.detalheSync = detalhe || "";
			atualizarIndicadorSync();
			if (!itensAtuais().length) render();
		},
		aoErro(info) {
			if (info.tipo === "rede" || info.tipo === "cancelado") return;
			toastUnico("erro", `Nuvem: ${esc(info.mensagem)}`);
		},
		aoUsuario(usuario) {
			estado.usuarios[id] = usuario;
			atualizarDialogoSync();
			atualizarIndicadorSync();
			// Login restaurado depois: confere se é a conta dona da lista que este aparelho só visualiza
			if (usuario && ativo() && estado.sync.donoPendente) ligarLista(estado.sync).catch(e => console.warn(e));
		},
		// O servidor recusou a leitura da lista: convite removido ou lista protegida sem a chave
		// O servidor recusou a leitura da lista. Não conclui "removido" daqui: mostra a causa provável
		// e mantém o aparelho na lista (volta a funcionar quando o Firebase estiver ajustado).
		// "Removido" só quando o próprio convite deixa de existir (ver aplicarPermissaoConvidado).
		aoAcessoNegado() {
			if (!ativo()) return;
			const s = estado.sync;
			if (s.papel === "dono" && !provedores[id]?.semIdentidade) { if (!s.segredo || s.protecao !== "protegida") virarVisualizacao(s); return; }
			avisarAcessoRecusado(provedores[id]);
		}
	};
}

const provedores = {
	firebase: criarFirebase(NUVEM?.firebase, eventosDe("firebase")),
	supabase: criarSupabase(NUVEM?.supabase, eventosDe("supabase")),
	dropbox: criarDropbox(NUVEM?.dropbox, eventosDe("dropbox"))
};
const nuvemDisponivel = () => Object.values(provedores).some(p => p.disponivel);
/** Provedor usado para "lista com código" (sem login). */
const provedorDeCodigo = () => [provedores.firebase, provedores.supabase].find(p => p.disponivel) || null;
const provAtual = () => (estado.sync ? provedores[estado.sync.provedor] : null);
const usuarioAtual = () => (estado.sync ? estado.usuarios[estado.sync.provedor] || null : null);
const SIGLA = { firebase: "fb", supabase: "sb" };
const DE_SIGLA = { fb: "firebase", sb: "supabase" };

/** Valida a configuração salva. Versões antigas (Firebase sem "provedor", InstantDB) retornam null. */
function normalizarSync(bruto) {
	if (!bruto || typeof bruto !== "object" || bruto.config) return null;
	const provedor = provedores[bruto.provedor] ? bruto.provedor : null;
	if (!provedor || !provedores[provedor].disponivel) return null;
	const codigo = provedor === "dropbox" ? CODIGO_CONTA : normalizarCodigoLista(bruto.codigo);
	if (!codigo) return null;
	const modo = bruto.modo === "leitura" ? "leitura" : "edicao";
	// Dropbox: a lista é sempre da própria conta. Configurações antigas (sem papel): só leitura era convidado.
	const papel = provedor === "dropbox" ? "dono"
		: bruto.papel === "convidado" || bruto.papel === "dono" ? bruto.papel
			: modo === "leitura" ? "convidado" : "dono";
	// Convidado com código próprio: a permissão vem da lista (o dono muda quando quiser)
	const convidado = papel === "convidado" && RE_CONVIDADO.test(String(bruto.convidado || "")) ? bruto.convidado : null;
	const saida = { provedor, codigo, modo, papel, reconciliar: !!bruto.reconciliar };
	if (convidado) { saida.convidado = convidado; saida.confirmado = !!bruto.confirmado; }
	if (papel === "dono" && RE_CHAVE_DONO.test(String(bruto.segredo || ""))) saida.segredo = bruto.segredo;
	if (bruto.protecao === "protegida") saida.protecao = "protegida";
	if (papel === "convidado" && !convidado && bruto.donoPendente) saida.donoPendente = true;
	return saida;
}

const idSync = s => `${s.provedor}:${s.codigo}`;

/** Id de um produto deste aparelho dentro de uma lista: o mesmo produto gera sempre o mesmo id (evita duplicar). */
const idNaLista = (s, item) => uuidDeTexto(`${idSync(s)}|${chaveItem(item)}`);

function limparSilenciadosOrfaos() {
	const ids = new Set(itensAtuais().map(i => i.id));
	let mudou = false;
	for (const id of estado.silenciados) if (!ids.has(id)) { estado.silenciados.delete(id); mudou = true; }
	if (mudou) salvarSilenciados();
}

/** Envia para a nuvem os produtos deste aparelho que ainda não estão na lista. */
function enviarLocaisParaLista(itens) {
	if (!itens.length || !emNuvem()) return 0;
	const remotas = new Set(estado.itensNuvem.map(chaveItem));
	const enviar = itens
		.filter(i => !remotas.has(chaveItem(i)))
		.map(i => ({ ...i, id: idNaLista(estado.sync, i) }));
	if (enviar.length) aplicarAlteracoes({ salvar: enviar });
	return enviar.length;
}

let reconciliando = false;
/** Ao entrar numa lista existente, oferece enviar os produtos deste aparelho que ainda não estão nela. */
async function reconciliar() {
	if (!estado.sync?.reconciliar || reconciliando) return;
	reconciliando = true;
	try {
		const cfgAtual = estado.sync;
		const finalizar = () => {
			if (estado.sync !== cfgAtual) return;
			estado.sync = { ...estado.sync, reconciliar: false };
			armazenamento.gravar(CHAVE.sync, estado.sync);
		};
		if (!podeEditar() || !estado.itensLocais.length) return finalizar();
		const remotas = new Set(estado.itensNuvem.map(chaveItem));
		const faltando = estado.itensLocais.filter(i => !remotas.has(chaveItem(i)));
		if (!faltando.length) return finalizar();
		const vazia = estado.itensNuvem.length === 0;
		const ok = await confirmar({
			titulo: "Enviar produtos deste aparelho?",
			html: vazia
				? `A lista na nuvem está vazia. Deseja enviar os <b>${faltando.length}</b> produto(s) salvos neste aparelho para ela?`
				: `Este aparelho tem <b>${faltando.length}</b> produto(s) que não estão na lista da nuvem. Deseja enviá-los?<br><br><small>Se escolher “Agora não”, eles continuam guardados no aparelho e voltam a aparecer se você desconectar.</small>`,
			confirmar: "Enviar",
			cancelar: "Agora não",
			icone: "question"
		});
		if (estado.sync !== cfgAtual) return;
		if (ok) {
			const n = enviarLocaisParaLista(faltando);
			if (n) toast("sucesso", `<b>${n}</b> produto(s) deste aparelho enviados para a nuvem.`);
		}
		finalizar();
	} finally {
		reconciliando = false;
	}
}

const TEXTO_STATUS = {
	local: "Apenas neste aparelho",
	conectando: "Conectando…",
	sincronizado: "Salvo na nuvem",
	salvando: "Salvando…",
	offline: "Offline",
	erro: "Erro na nuvem"
};
const NOME_PROVEDOR = { firebase: "Google", supabase: "e-mail", dropbox: "Dropbox" };

function atualizarIndicadorSync() {
	const st = emNuvem() ? estado.statusSync : "local";
	let texto = TEXTO_STATUS[st] || st;
	if (emNuvem() && estado.sync.modo === "leitura" && (st === "sincronizado" || st === "salvando")) texto = "Somente leitura";
	el.btnSync.dataset.estado = st;
	el.btnSyncTexto.textContent = texto;
	el.btnSync.title = emNuvem()
		? `Nuvem (${NOME_PROVEDOR[estado.sync.provedor]}) · ${texto}${estado.detalheSync ? " — " + estado.detalheSync : ""}`
		: "Salvar na nuvem e compartilhar entre aparelhos";
	el.btnSync.setAttribute("aria-label", `Nuvem: ${texto}`);

	if (emNuvem()) {
		el.syncStatusBox.dataset.estado = st;
		el.syncStatusTitulo.textContent = st === "sincronizado" ? "Conectado e salvo na nuvem" : texto;
		const u = usuarioAtual();
		const base = estado.sync.provedor === "dropbox"
			? "Salvo no seu Dropbox"
			: u?.email ? "Sincronizando em tempo real" : "Lista na nuvem (sem login)";
		el.syncStatusDetalhe.textContent = estado.detalheSync || base;
		el.syncStatusDetalhe.title = base;
	}
}

/**
 * Conecta este aparelho a uma lista na nuvem.
 * @param {{provedor: string, codigo?: string, modo?: string, reconciliar?: boolean}} destino
 */
async function conectarNuvem(destino) {
	const novo = normalizarSync({ ...destino, reconciliar: destino.reconciliar ?? (estado.itensLocais.length > 0) });
	if (!novo) {
		toast("erro", "Não foi possível conectar: opção de nuvem indisponível ou código inválido.");
		return false;
	}
	const anterior = provAtual();
	pararOuvintesConvidados();
	if (anterior) anterior.desligar();
	estado.sync = novo;
	armazenamento.gravar(CHAVE.sync, estado.sync);
	armazenamento.remover(CHAVE.cacheNuvem);
	estado.itensNuvem = [];
	estado.convidados = [];
	convidadoSelecionado = null;
	estado.dadosProntos = false;
	estado.ultimaSync = null;
	estado.statusSync = "conectando";
	estado.detalheSync = "";
	errosJaAvisados.clear();
	if (estado.editandoId) sairDaEdicao(true);
	render();
	atualizarIndicadorSync();
	atualizarDialogoSync();
	try {
		// Dono: a conta lembra a lista e a chave (outros aparelhos da conta). Convidado nunca grava na conta.
		return await ligarLista(novo);
	} catch (erro) {
		const info = explicarErro(erro);
		estado.statusSync = "erro";
		estado.detalheSync = info.mensagem;
		atualizarIndicadorSync();
		toast("erro", esc(info.mensagem));
		return false;
	}
}

/** Guarda neste aparelho uma cópia dos produtos da nuvem (ao desconectar). */
function copiarNuvemParaLocal(itens) {
	const porChave = new Map(estado.itensLocais.map(i => [chaveItem(i), i]));
	const ids = new Set(estado.itensLocais.map(i => i.id));
	for (const item of itens) {
		const existente = porChave.get(chaveItem(item));
		if (existente) existente.quantidade = item.quantidade;
		else {
			const copia = { ...item };
			if (ids.has(copia.id)) copia.id = gerarId();
			ids.add(copia.id);
			estado.itensLocais.push(copia);
			porChave.set(chaveItem(copia), copia);
		}
	}
	armazenamento.gravar(CHAVE.itens, estado.itensLocais);
}

async function desconectarNuvem() {
	if (!emNuvem()) return;
	const qtd = estado.itensNuvem.length;
	const u = usuarioAtual();
	const prov = provAtual();
	const lembrete = estado.sync.provedor === "dropbox"
		? "<br><br>Para voltar, basta entrar de novo com o Dropbox."
		: u?.email
			? `<br><br>Para voltar, basta entrar de novo com <b>${esc(u.email)}</b>.`
			: `<br><br>Para voltar a esta lista depois, guarde o código:<br><b style="font-family:var(--fonte-mono);font-size:1.05rem">${formatarCodigoLista(estado.sync.codigo)}</b>`;
	const comConta = !!u || estado.sync.provedor === "dropbox";
	const { acao } = await dialogo({
		titulo: comConta ? "Sair da conta neste aparelho?" : "Desconectar este aparelho?",
		html: `Os produtos continuam salvos na nuvem.${lembrete}${qtd ? `<br><br>Deseja guardar uma cópia dos <b>${qtd}</b> produto(s) da nuvem neste aparelho?` : ""}`,
		icone: "question",
		confirmar: qtd ? "Sair e guardar cópia" : "Sair",
		negar: qtd ? "Sair sem cópia" : undefined,
		cancelar: "Cancelar",
		perigo: !qtd
	});
	if (acao === "cancelar") return;
	if (acao === "confirmar" && qtd) copiarNuvemParaLocal(estado.itensNuvem);
	pararOuvintesConvidados();
	prov?.desligar();
	if (comConta) await prov?.sair();
	estado.sync = null;
	estado.itensNuvem = [];
	estado.convidados = [];
	estado.statusSync = "local";
	estado.detalheSync = "";
	estado.ultimaSync = null;
	armazenamento.remover(CHAVE.sync);
	armazenamento.remover(CHAVE.cacheNuvem);
	if (estado.editandoId) sairDaEdicao(true);
	render();
	atualizarIndicadorSync();
	atualizarDialogoSync();
	toast("info", "Desconectado. Os produtos agora ficam apenas neste aparelho.");
}

/* ---------- Link de compartilhamento ---------- */
/* O link novo leva código, provedor e permissão embaralhados e com verificação:
   trocar "só visualizar" por "pode editar" no texto do link deixa o link inválido. */
const CHAVE_LINK = [83, 17, 201, 64, 142, 9, 230, 117, 38, 199, 90, 13, 176, 61, 244, 128];
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = texto => Uint8Array.from(atob(texto.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const somaLink = bytes => bytes.reduce((s, b, i) => (s * 31 + b + i) % 65521, 7);

/** modo: "leitura" | "edicao" (links antigos) ou o código do convidado (10 caracteres). */
function codificarLink(sigla, codigo, modo) {
	const fim = RE_CONVIDADO.test(modo) ? `g${modo}` : modo === "leitura" ? "v" : "e";
	const texto = `${sigla}.${codigo}.${fim}`;
	const dados = Array.from(texto, c => c.charCodeAt(0) & 255);
	const soma = somaLink(dados);
	const bytes = [...dados, soma >> 8, soma & 255].map((b, i) => b ^ CHAVE_LINK[i % CHAVE_LINK.length] ^ (i * 7 & 255));
	return b64url(bytes);
}

function decodificarLink(token) {
	try {
		const bytes = Array.from(deB64url(token)).map((b, i) => b ^ CHAVE_LINK[i % CHAVE_LINK.length] ^ (i * 7 & 255));
		if (bytes.length < 6) return null;
		const dados = bytes.slice(0, -2);
		if (((bytes.at(-2) << 8) | bytes.at(-1)) !== somaLink(dados)) return null;
		const m = String.fromCharCode(...dados).match(/^([a-z]{2})\.([A-Z0-9]{16})\.(v|e|g([A-HJ-NP-Z2-9]{10}))$/);
		if (!m) return null;
		if (m[4]) return { sigla: m[1], codigo: m[2], modo: "leitura", convidado: m[4] };
		return { sigla: m[1], codigo: m[2], modo: m[3] === "v" ? "leitura" : "edicao" };
	} catch {
		return null;
	}
}

const gerarLink = modoOuConvidado =>
	`${location.origin}${location.pathname}#l=${codificarLink(SIGLA[estado.sync.provedor] || "fb", estado.sync.codigo, modoOuConvidado)}`;

function lerLink(hash) {
	const texto = String(hash || "");
	if (/[#&]conectar=/.test(texto)) return { invalido: true, motivo: "Este link é da versão antiga da nuvem. Peça um novo link a quem compartilhou." };
	const token = (texto.match(/[#&]l=([A-Za-z0-9_-]+)/) || [])[1];
	if (token) {
		const d = decodificarLink(token);
		if (!d) return { invalido: true };
		const prov = DE_SIGLA[d.sigla];
		const codigoOk = normalizarCodigoLista(d.codigo);
		if (!prov || !codigoOk) return { invalido: true };
		if (!provedores[prov]?.disponivel) return { invalido: true, motivo: "Esta opção de nuvem não está ativada nesta versão do site." };
		const dados = { provedor: prov, codigo: codigoOk, modo: d.modo, papel: "convidado" };
		if (d.convidado) dados.convidado = d.convidado;
		return dados;
	}
	const achado = texto.match(/[#&]lista=([A-Za-z0-9-]+)/);
	if (!achado) return null;
	const codigo = normalizarCodigoLista(achado[1]);
	if (!codigo) return { invalido: true };
	const sigla = (texto.match(/[#&]p=([a-z]+)/) || [])[1];
	const provedor = DE_SIGLA[sigla] || provedorDeCodigo()?.id;
	if (!provedor || !provedores[provedor]?.disponivel) return { invalido: true, motivo: "Esta opção de nuvem não está ativada nesta versão do site." };
	return { provedor, codigo, modo: /[#&]ver=1/.test(texto) ? "leitura" : "edicao", papel: "convidado" };
}

async function processarLinkCompartilhado() {
	const dados = lerLink(location.hash);
	if (!dados) return;
	try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignora */ }
	if (dados.invalido) {
		return dialogo({ titulo: "Link inválido", html: esc(dados.motivo || "Este link de compartilhamento está incompleto ou corrompido. Peça um novo link."), icone: "error" });
	}
	await entrarEmLista(dados);
}

/** Entra numa lista existente (via link ou código), pedindo confirmação. */
async function entrarEmLista(dados) {
	const novo = normalizarSync(dados);
	if (!novo) {
		dialogo({ titulo: "Não foi possível conectar", html: "Código inválido ou nuvem indisponível.", icone: "error" });
		return false;
	}
	if (emNuvem() && idSync(estado.sync) === idSync(novo)) {
		// O dono continua dono (um link não rebaixa o aparelho dele). Convidado: um link com código próprio
		// troca o convite deste aparelho; um link antigo só muda a permissão de quem também é antigo.
		const trocarConvite = estado.sync.papel === "convidado" && novo.convidado && novo.convidado !== estado.sync.convidado;
		const trocarModoAntigo = estado.sync.papel === "convidado" && !estado.sync.convidado && !novo.convidado && estado.sync.modo !== novo.modo;
		if (trocarConvite || trocarModoAntigo) {
			estado.sync = trocarConvite ? { ...estado.sync, convidado: novo.convidado, confirmado: false, modo: "leitura" } : { ...estado.sync, modo: novo.modo };
			armazenamento.gravar(CHAVE.sync, estado.sync);
			render();
			atualizarIndicadorSync();
			atualizarDialogoSync();
			// Convite novo: registra este aparelho com ele no servidor
			if (trocarConvite) ligarLista(estado.sync).catch(e => toast("erro", esc(explicarErro(e).mensagem)));
		}
		toast("info", "Este aparelho já está conectado a esta lista.");
		return true;
	}
	const trocar = emNuvem() ? "<br><br><small>Este aparelho deixará de usar a lista atual.</small>" : "";
	const ok = await confirmar({
		titulo: "Conectar à lista na nuvem?",
		html: novo.papel === "convidado"
			? novo.convidado
				? `Você vai entrar como <b>convidado</b>.<br>O <b>dono da lista</b> define se você pode editar ou só visualizar — e você é avisado quando isso mudar.${trocar}`
				: novo.donoPendente
					? `Com o <b>código da lista</b> você entra para <b>visualizar</b>.<br><small>Se você é o dono, entre com a <b>conta que criou a lista</b>: o acesso completo é liberado sozinho.</small>${trocar}`
					: `Você vai entrar como <b>convidado</b>.<br>Permissão: <b>${novo.modo === "leitura" ? "somente visualizar" : "pode editar"}</b><br><small>Só o dono da lista pode mudar essa permissão.</small>${trocar}`
			: `Código: <b style="font-family:var(--fonte-mono)">${formatarCodigoLista(novo.codigo)}</b>${trocar}`,
		confirmar: "Conectar",
		icone: "question"
	});
	if (!ok) return false;
	const conectou = await conectarNuvem(novo);
	if (conectou) toast("sucesso", "Conectado! A lista será carregada em instantes.");
	return conectou;
}

/* ---------- Diálogo da nuvem ---------- */
// Código da lista escondido até a pessoa tocar em "Mostrar"
let codigoVisivel = false;
function mostrarCodigoLista(visivel) {
	codigoVisivel = !!visivel && emNuvem();
	const codigo = emNuvem() ? formatarCodigoLista(estado.sync.codigo) : "";
	el.codigoLista.textContent = codigoVisivel ? codigo : codigo.replace(/[A-Z0-9]/g, "•");
	el.codigoLista.classList.toggle("codigo-oculto", !codigoVisivel);
	el.btnRevelarCodigo.innerHTML = `${icone(codigoVisivel ? "EyeOff" : "Eye")}`;
	el.btnRevelarCodigo.title = codigoVisivel ? "Esconder código" : "Mostrar código";
	el.btnRevelarCodigo.setAttribute("aria-label", el.btnRevelarCodigo.title);
	el.btnRevelarCodigo.setAttribute("aria-pressed", String(codigoVisivel));
}
let qrUltimoLink = "";
async function atualizarCompartilhamento() {
	if (!emNuvem()) return;
	const temCodigo = estado.sync.provedor !== "dropbox";
	// Convidado não vê o código nem gera links (só o dono compartilha e define permissões)
	el.caixaCodigo.hidden = !temCodigo || !ehDono();
	el.blocoPedidos.hidden = true; // só o dono vê (desenharPedidos mostra quando houver)
	el.blocoCompartilhar.hidden = !temCodigo || !ehDono();
	if (!temCodigo || !ehDono()) return;
	mostrarCodigoLista(codigoVisivel);
	el.ajudaCodigo.innerHTML = provAtual()?.recursos?.convidados
		? "Quem digitar este código <b>só visualiza</b> a lista. Acesso completo só com a <b>conta que criou a lista</b> (ou neste aparelho). Para outras pessoas, use <b>convidados</b>."
		: "Guarde este código: com ele você recupera a lista em qualquer aparelho.";
	// Convidados com permissão garantida pelo servidor (listas do Google/código)
	const comConvidados = temConvidadosNoServidor();
	el.btnNovoConvidado.hidden = !comConvidados;
	el.avisoConvidados.hidden = comConvidados && estado.sync.protecao === "protegida";
	el.avisoConvidados.innerHTML = !comConvidados
		? "Convidados ficam disponíveis nas listas do <b>Google</b> ou <b>com código</b>."
		: estado.sync.protecao === "sem-protecao"
			? "⚠️ A proteção do servidor ainda não está ativa. O dono do site precisa <b>publicar as regras novas</b> do Firestore e <b>ativar o login Anônimo</b> no Firebase (veja <i>docs/CONFIGURACAO.md</i>). Até lá, não é possível criar convidados."
			: "Ativando a proteção da lista no servidor… (se demorar, confira a internet)";
	desenharConvidados();
	desenharPedidos();
	const escolhido = estado.convidados.find(c => c.codigo === convidadoSelecionado);
	el.gradeLinkConvidado.hidden = !escolhido;
	if (!escolhido) { qrUltimoLink = ""; return; }
	el.textoLinkConvidado.innerHTML = `Link de <b>${esc(escolhido.nome)}</b>: abra no aparelho dele (ou leia o QR Code). Ele será conectado automaticamente.`;
	const link = gerarLink(escolhido.codigo);
	el.linkCompartilhar.value = link;
	if (link === qrUltimoLink) return;
	qrUltimoLink = link;
	el.qr.textContent = "Gerando QR Code…";
	try {
		await carregarScript(URL_QRCODE);
		if (qrUltimoLink !== link) return;
		const qr = window.qrcode(0, "M");
		qr.addData(link);
		qr.make();
		el.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
	} catch (e) {
		console.warn(e);
		el.qr.textContent = "Não foi possível gerar o QR Code. Use o link ao lado.";
		qrUltimoLink = "";
	}
}

function atualizarDialogoSync() {
	const conectado = emNuvem();
	el.syncDesconectado.hidden = conectado;
	el.syncConectado.hidden = !conectado;
	el.syncIndisponivel.hidden = nuvemDisponivel();
	el.syncOpcoes.hidden = !nuvemDisponivel();
	el.btnLoginGoogle.hidden = !provedores.firebase.disponivel;
	el.blocoEmail.hidden = !(provedores.firebase.disponivel || provedores.supabase.disponivel);
	el.btnLoginDropbox.hidden = !provedores.dropbox.disponivel;
	const algumLogin = provedores.firebase.disponivel || provedores.supabase.disponivel || provedores.dropbox.disponivel;
	el.separadorSemLogin.hidden = !algumLogin || !provedorDeCodigo();
	el.blocoCodigo.hidden = !provedorDeCodigo();
	const u = usuarioAtual();
	el.syncContaLinha.hidden = !u?.email;
	el.syncContaEmail.textContent = u?.email ? `${u.email} (${NOME_PROVEDOR[estado.sync.provedor]})` : "";
	const comConta = !!u || estado.sync?.provedor === "dropbox";
	el.btnDesconectar.innerHTML = `${icone("LogOut")}${comConta ? "Sair da conta" : "Desconectar"}`;
	if (conectado) {
		const dono = ehDono();
		el.syncPermitirEdicao.checked = estado.sync.modo !== "leitura";
		el.syncPermitirEdicao.disabled = !dono;
		el.syncPermissaoTitulo.textContent = dono ? "Permitir edição neste aparelho" : estado.sync.modo === "leitura" ? "Somente visualizar" : "Pode editar";
		el.syncPermissaoAjuda.textContent = dono
			? "Desative para que este aparelho apenas visualize a lista."
			: estado.sync.donoPendente
				? "Você entrou com o código da lista: só visualizar. Para ter acesso completo, entre com a conta que criou a lista."
			: estado.sync.convidado
				? estado.sync.confirmado
					? "Você é convidado. Só o dono da lista muda esta permissão — você é avisado quando ela mudar."
					: "Aguardando a lista confirmar o seu convite…"
				: "Você entrou como convidado. Só o dono da lista pode mudar esta permissão (enviando um novo link).";
		el.syncPermitirEdicao.closest(".interruptor")?.classList.toggle("bloqueado", !dono);
		// Só visualizando com o código: entrar como dono (lista protegida → código do dono; lista antiga → reivindicar)
		el.btnSouDono.hidden = !(estado.sync.donoPendente && provAtual()?.recursos?.convidados);
		// Pedido de acesso (quem só visualiza)
		const podePedir = !!(estado.sync.donoPendente && provAtual()?.enviarPedido);
		el.blocoPedido.hidden = !podePedir;
		if (podePedir) {
			const p = estado.meuPedido;
			const pendente = p?.status === "pendente";
			el.btnPedirAcesso.hidden = pendente;
			el.statusPedido.innerHTML = pendente
				? `⏳ Pedido enviado ${esc(fmtRelativoCurto(Number(p.criadoEm) || Date.now()))}. Código de confirmação <b class="codigo-convidado">${esc(p.confirmacao || "")}</b>. Aguardando o dono.`
				: estado.sync.protecao === "protegida" ? "O dono recebe seu pedido e decide se você pode editar." : "Pedidos ficam disponíveis quando o dono proteger a lista.";
		}
		// Convidado com código: mostra o código dele e deixa escolher o nome que o dono vê
		const comCodigo = !dono && !!estado.sync.convidado;
		el.blocoNomeConvidado.hidden = !comCodigo;
		if (comCodigo) {
			el.meuCodigoConvidado.textContent = formatarCodigoConvidado(estado.sync.convidado);
			if (document.activeElement !== el.nomeConvidado) el.nomeConvidado.value = armazenamento.lerTexto(CHAVE.nomeAparelho) || "";
			if (!el.nomeConvidado.placeholder || el.nomeConvidado.placeholder === "Nome do aparelho") {
				detectarAparelho().then(n => { if (n) el.nomeConvidado.placeholder = n; }).catch(() => { });
			}
		}
		atualizarIndicadorSync();
		if (el.dlgSync.open) atualizarCompartilhamento();
	}
}

function abrirDialogoSync() {
	el.menu.open = false;
	atualizarDialogoSync();
	if (!el.dlgSync.open) el.dlgSync.showModal();
	if (emNuvem()) atualizarCompartilhamento();
	// Carrega as bibliotecas em segundo plano (deixa o login mais rápido)
	for (const p of Object.values(provedores)) if (p.disponivel && p.id !== "dropbox") p.preparar().catch(() => { });
}

/* ---------- Login ---------- */
/** Depois do login: usa a lista guardada na conta ou cria uma nova com os produtos deste aparelho. */
async function aposLogin(provedorId, usuario) {
	if (!usuario) return;
	estado.usuarios[provedorId] = usuario;
	const prov = provedores[provedorId];
	if (provedorId === "dropbox") {
		if (await conectarNuvem({ provedor: "dropbox", codigo: CODIGO_CONTA, modo: "edicao", papel: "dono", reconciliar: estado.itensLocais.length > 0 })) {
			toast("sucesso", "Conectado ao Dropbox! Entre com a mesma conta nos outros aparelhos para ver a mesma lista.", 7000);
		}
		return;
	}
	let codigo = null, segredo = "";
	try {
		const conta = await prov.listaDaConta(usuario.id);
		// Firebase devolve { codigo, segredo } (chave do dono); Supabase, só o código
		codigo = typeof conta === "string" ? conta : conta?.codigo || null;
		segredo = typeof conta === "object" && conta ? conta.segredo || "" : "";
	} catch (e) { console.warn(e); }
	if (codigo) {
		if (await conectarNuvem({ provedor: provedorId, codigo, segredo, modo: "edicao", papel: "dono", reconciliar: estado.itensLocais.length > 0 })) {
			toast("sucesso", `Bem-vindo de volta! Lista da conta <b>${esc(usuario.email || "")}</b> carregada.`, 6000);
		}
	} else {
		const s = estado.sync;
		const adotar = s && s.provedor === provedorId && (
			(s.papel === "dono" && s.segredo) ||                              // este aparelho criou a lista
			(s.donoPendente && s.protecao !== "protegida"));                   // lista antiga, ainda sem dono
		if (adotar) {
			// A conta passa a ser a dona desta lista (outros aparelhos com a mesma conta terão acesso completo)
			if (await conectarNuvem({ provedor: provedorId, codigo: s.codigo, segredo: s.segredo || gerarChaveDono(), modo: "edicao", papel: "dono" })) {
				toast("sucesso", `Lista ligada à conta <b>${esc(usuario.email || "")}</b>: entre com ela nos outros aparelhos para ter acesso completo.`, 7000);
			}
			return;
		}
		await criarListaNova({ provedorId, silencioso: true });
		toast("sucesso", "Pronto! Entre com a mesma conta nos outros aparelhos para ver a mesma lista.", 7000);
	}
}

async function loginGoogle() {
	el.btnLoginGoogle.disabled = true;
	try {
		const u = await provedores.firebase.entrarGoogle();
		await aposLogin("firebase", u);
	} catch (e) {
		const info = explicarErro(e);
		if (info.tipo !== "cancelado") toast("erro", esc(info.mensagem), 8000);
	} finally {
		el.btnLoginGoogle.disabled = false;
	}
}

async function loginDropbox() {
	el.btnLoginDropbox.disabled = true;
	try {
		armazenamento.gravarTexto(CHAVE.loginPendente, "dropbox");
		await provedores.dropbox.entrarDropbox(); // sai do site e volta depois do login
	} catch (e) {
		el.btnLoginDropbox.disabled = false;
		toast("erro", esc(explicarErro(e).mensagem));
	}
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
let emailPendente = "";

/** Serviço usado para o login por e-mail: o link do Firebase é o principal; o Supabase é a alternativa. */
const provedorEmail = alternativo => {
	const ordem = alternativo ? ["supabase", "firebase"] : ["firebase", "supabase"];
	return ordem.map(id => provedores[id]).find(p => p.disponivel) || null;
};

async function enviarCodigoLogin(alternativo = false) {
	const email = el.loginEmail.value.trim().toLowerCase();
	if (!RE_EMAIL.test(email)) {
		el.loginEmail.setAttribute("aria-invalid", "true");
		el.loginEmail.focus();
		return toast("erro", "Digite um e-mail válido.");
	}
	const prov = provedorEmail(alternativo === true);
	if (!prov) return;
	el.loginEmail.removeAttribute("aria-invalid");
	el.btnEnviarCodigo.disabled = true;
	el.btnEnviarCodigo.textContent = "Enviando…";
	try {
		armazenamento.gravarTexto(CHAVE.loginPendente, prov.id);
		if (prov.id === "firebase") await prov.enviarLinkEmail(email);
		else await prov.enviarCodigo(email);
		emailPendente = email;
		el.emailEnviadoPara.textContent = email;
		el.emailEnviadoMsg.hidden = false;
		// O Supabase também aceita o código de 6 dígitos (se o modelo de e-mail tiver {{ .Token }})
		el.loginCodigoCaixa.hidden = prov.id !== "supabase";
		el.loginEmailTexto.textContent = email;
		el.loginCodigo.value = "";
		// Oferece o outro servidor caso o e-mail não chegue
		el.btnEmailAlternativo.hidden = !(prov.id === "firebase" && provedores.supabase.disponivel);
	} catch (e) {
		armazenamento.remover(CHAVE.loginPendente);
		toast("erro", esc(explicarErro(e).mensagem), 8000);
	} finally {
		el.btnEnviarCodigo.disabled = false;
		el.btnEnviarCodigo.textContent = "Receber link";
	}
}

async function confirmarCodigoLogin() {
	const code = el.loginCodigo.value.replace(/\D/g, "");
	if (!emailPendente) return el.loginEmail.focus();
	if (code.length < 6) {
		el.loginCodigo.setAttribute("aria-invalid", "true");
		el.loginCodigo.focus();
		return toast("erro", "Digite o código de 6 dígitos recebido por e-mail.");
	}
	el.loginCodigo.removeAttribute("aria-invalid");
	el.btnEntrarLogin.disabled = true;
	el.btnEntrarLogin.textContent = "Entrando…";
	try {
		const usuario = await provedores.supabase.confirmarCodigo(emailPendente, code);
		if (!usuario?.id) throw new Error("Não foi possível entrar.");
		armazenamento.remover(CHAVE.loginPendente);
		await aposLogin("supabase", usuario);
		emailPendente = "";
		el.loginCodigoCaixa.hidden = true;
		el.loginEmail.value = "";
	} catch (e) {
		el.loginCodigo.setAttribute("aria-invalid", "true");
		toast("erro", esc(explicarErro(e).mensagem));
	} finally {
		el.btnEntrarLogin.disabled = false;
		el.btnEntrarLogin.textContent = "Entrar";
	}
}

/** Pede o e-mail quando o link de login foi aberto em outro aparelho/navegador. */
async function dialogoEmail() {
	if (!window.Swal) {
		const v = window.prompt("Confirme seu e-mail para entrar:");
		return { acao: v ? "confirmar" : "cancelar", valor: (v || "").trim().toLowerCase() };
	}
	const r = await window.Swal.fire({
		title: "Confirme seu e-mail",
		html: "Você abriu o link em outro aparelho ou navegador. Digite o mesmo e-mail usado para pedir o link:",
		input: "email",
		inputPlaceholder: "seu@email.com",
		showCancelButton: true,
		confirmButtonText: "Entrar",
		cancelButtonText: "Cancelar",
		reverseButtons: true,
		buttonsStyling: false,
		heightAuto: false,
		validationMessage: "Digite um e-mail válido.",
		customClass: { popup: "sw-popup", confirmButton: "btn btn-primario", cancelButton: "btn btn-fantasma", input: "sw-input" }
	});
	return { acao: r.isConfirmed ? "confirmar" : "cancelar", valor: String(r.value || "").trim().toLowerCase() };
}

/** Conclui logins que voltam por redirecionamento (link do e-mail ou Dropbox). */
async function concluirLoginsPendentes() {
	const pendente = armazenamento.lerTexto(CHAVE.loginPendente);
	// Dropbox: volta com ?code=…&state=…
	if (provedores.dropbox.disponivel && /[?&](code|error)=/.test(location.search)) {
		try {
			const u = await provedores.dropbox.processarRetorno();
			if (u) {
				armazenamento.remover(CHAVE.loginPendente);
				await aposLogin("dropbox", u);
				return;
			}
		} catch (e) {
			armazenamento.remover(CHAVE.loginPendente);
			const info = explicarErro(e);
			if (info.tipo !== "cancelado") toast("erro", `Dropbox: ${esc(info.mensagem)}`, 8000);
			return;
		}
	}
	// Firebase: o link do e-mail volta com ?mode=signIn&oobCode=…
	if (provedores.firebase.disponivel && provedores.firebase.ehRetornoLinkEmail()) {
		try {
			let r = await provedores.firebase.concluirLinkEmail();
			if (r?.precisaEmail) {
				// Link aberto em outro aparelho: confirma o e-mail por segurança
				const { acao, valor } = await dialogoEmail();
				if (acao === "confirmar" && valor) r = await provedores.firebase.concluirLinkEmail(valor);
				else r = null;
			}
			if (r?.id) {
				armazenamento.remover(CHAVE.loginPendente);
				await aposLogin("firebase", r);
				return;
			}
		} catch (e) {
			armazenamento.remover(CHAVE.loginPendente);
			try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* ignora */ }
			toast("erro", `Login por e-mail: ${esc(explicarErro(e).mensagem)}`, 8000);
			return;
		}
	}
	// Supabase: o link do e-mail volta com #access_token=…
	if (provedores.supabase.disponivel && (pendente === "supabase" || /access_token=|error_description=/.test(location.hash))) {
		try {
			await provedores.supabase.preparar();
			const u = provedores.supabase.usuario;
			if (u && pendente === "supabase") {
				armazenamento.remover(CHAVE.loginPendente);
				if (!(estado.sync?.provedor === "supabase")) await aposLogin("supabase", u);
			}
		} catch (e) {
			console.warn(e);
		}
	}
}

/** Cria uma lista nova na nuvem e envia os produtos deste aparelho. */
async function criarListaNova({ provedorId = provedorDeCodigo()?.id, silencioso = false } = {}) {
	if (!provedorId) return;
	el.btnCriarLista.disabled = true;
	try {
		// Lista nova já nasce protegida no servidor (chave do dono criada aqui)
		const ok = await conectarNuvem({ provedor: provedorId, codigo: gerarCodigoLista(), segredo: provedores[provedorId]?.recursos?.convidados ? gerarChaveDono() : "", modo: "edicao", papel: "dono", reconciliar: false });
		if (!ok) return;
		// Lista nova (vazia): envia já os produtos deste aparelho. Sem internet, vão para a fila.
		const n = enviarLocaisParaLista(estado.itensLocais);
		if (!silencioso) toast("sucesso", `Lista criada na nuvem${n ? ` com <b>${n}</b> produto(s)` : ""}! Use o link ou o QR Code para abrir em outro aparelho.`, 6000);
	} finally {
		el.btnCriarLista.disabled = false;
	}
}

/** Sem login: entra numa lista digitando o código. */
async function entrarPorCodigo() {
	const valor = el.syncCodigo.value.trim();
	// Link colado: vale a permissão do link (entra como convidado)
	const doLink = valor.includes("#") ? lerLink(valor.slice(valor.indexOf("#"))) : null;
	if (doLink && !doLink.invalido) {
		el.syncCodigo.removeAttribute("aria-invalid");
		el.btnEntrarCodigo.disabled = true;
		try {
			if (await entrarEmLista(doLink)) el.syncCodigo.value = "";
		} finally {
			el.btnEntrarCodigo.disabled = false;
		}
		return;
	}
	if (doLink?.invalido) {
		el.syncCodigo.setAttribute("aria-invalid", "true");
		return toast("erro", esc(doLink.motivo || "Este link está incompleto ou foi alterado. Peça um novo link."));
	}
	// Código de convite (26): entra como convidado; a permissão vem do convite (definida pelo dono)
	const convite = lerCodigoConvite(valor);
	if (convite) {
		el.syncCodigo.removeAttribute("aria-invalid");
		el.btnEntrarCodigo.disabled = true;
		try {
			if (await entrarEmLista({ provedor: provedorDeCodigo()?.id, codigo: convite.codigo, convidado: convite.convidado, papel: "convidado", modo: "leitura" })) el.syncCodigo.value = "";
		} finally {
			el.btnEntrarCodigo.disabled = false;
		}
		return;
	}
	const codigo = lerCodigoDigitado(valor);
	if (!codigo) {
		el.syncCodigo.setAttribute("aria-invalid", "true");
		el.syncCodigo.focus();
		return toast("erro", "Código inválido. Ele tem 16 letras/números, como <b>ABCD-EFGH-JKLM-NPQR</b>.");
	}
	// Código da lista: entra só VISUALIZANDO. Edição completa só com a conta que criou a lista
	// (confirmada no login) ou com o código do dono.
	const provedor = provedorDeCodigo()?.id;
	el.syncCodigo.removeAttribute("aria-invalid");
	el.btnEntrarCodigo.disabled = true;
	try {
		if (await entrarEmLista({ provedor, codigo, modo: "leitura", papel: "convidado", donoPendente: true })) el.syncCodigo.value = "";
	} finally {
		el.btnEntrarCodigo.disabled = false;
	}
}

async function feedbackBotao(botao, ok) {
	const original = botao.innerHTML;
	botao.innerHTML = ok ? icone("Check") || "✓" : icone("X") || "✕";
	botao.disabled = true;
	setTimeout(() => { botao.innerHTML = original; botao.disabled = false; }, 1400);
}

/* =========================================================
   Comandos ocultos (compatibilidade com a versão anterior)
   ========================================================= */
function processarComando(valor) {
	const v = valor.trim().toLowerCase();
	const autorizar = v === "autorizarsyncenviar" || v === "/ase";
	const desautorizar = v === "naoautorizarsyncenviar" || v === "/dse";
	if (!autorizar && !desautorizar) return false;
	el.filtro.value = "";
	estado.busca = "";
	if (!emNuvem()) {
		toast("aviso", "Conecte uma lista compartilhada primeiro (botão de sincronização).");
	} else if (!ehDono()) {
		toast("aviso", "Só o <b>dono da lista</b> pode mudar a permissão deste aparelho.");
	} else {
		estado.sync = { ...estado.sync, modo: autorizar ? "edicao" : "leitura" };
		armazenamento.gravar(CHAVE.sync, estado.sync);
		toast(autorizar ? "sucesso" : "info", autorizar ? "✅ Este aparelho agora pode editar a lista." : "❌ Este aparelho agora é somente leitura.");
		atualizarIndicadorSync();
		atualizarDialogoSync();
	}
	render();
	return true;
}

/* =========================================================
   Tema
   ========================================================= */
function alternarTema(evento) {
	const novo = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
	const aplicar = () => {
		document.documentElement.dataset.tema = novo;
		// A barra do navegador acompanha o tema escolhido
		document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", novo === "escuro" ? "#0b0d12" : "#f5f6fa"));
	};
	armazenamento.gravarTexto(CHAVE.tema, novo);

	if (typeof document.startViewTransition !== "function") return aplicar();
	if (semMovimento()) {
		// Sem movimento: só um esmaecimento suave entre os temas
		try { document.startViewTransition(aplicar); } catch { aplicar(); }
		return;
	}

	// Transição circular a partir do botão (View Transitions API, com recuo simples)
	const r = evento?.currentTarget?.getBoundingClientRect?.();
	const x = r ? r.left + r.width / 2 : innerWidth - 40;
	const y = r ? r.top + r.height / 2 : 30;
	const raio = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
	try {
		const transicao = document.startViewTransition(aplicar);
		transicao.ready.then(() => {
			document.documentElement.animate(
				{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
				{ duration: 650, easing: "cubic-bezier(.4, 0, .2, 1)", pseudoElement: "::view-transition-new(root)" }
			);
		}).catch(() => { /* transição ignorada: o tema já foi aplicado */ });
	} catch {
		aplicar();
	}
}

function aplicarAlertaNaTela() {
	el.nAlertar.value = estado.alerta.valor;
	el.como.value = estado.alerta.unidade;
}

/* =========================================================
   Eventos
   ========================================================= */
function registrarEventos() {
	el.form.addEventListener("submit", enviarFormulario);
	el.btnCancelarEdicao.addEventListener("click", () => sairDaEdicao());

	// Enter avança para o próximo campo (leitores USB enviam Enter após o código)
	el.codigo.addEventListener("keydown", e => {
		if (e.key !== "Enter") return;
		e.preventDefault();
		const reconhecido = autoPreencherPorCodigo();
		(reconhecido || el.nome.value.trim() ? el.quantidade : el.nome).focus();
	});
	el.codigo.addEventListener("change", autoPreencherPorCodigo);
	el.codigo.addEventListener("change", fotoAutomaticaDoFormulario);
	const fotoAoDigitar = debounce(() => fotoAutomaticaDoFormulario(), 700);
	el.codigo.addEventListener("input", () => {
		// Trocou o código: a foto escolhida automaticamente para o código anterior sai
		if (fotoPendente && fotoPendente.origem !== "usuario") definirFotoPendente(null);
		if (gtinValido(el.codigo.value)) fotoAoDigitar();
	});

	// Sugerir o nome sob demanda
	el.btnSugerirNome?.addEventListener("click", sugerirNomeManual);
	// ✨ e foto acompanham o que está digitado (inclui preenchimento automático do navegador)
	[el.codigo, el.nome].forEach(c => c?.addEventListener("input", atualizarBotoesCampos));
	el.form?.addEventListener("reset", () => setTimeout(atualizarBotoesCampos, 0));
	atualizarBotoesCampos();

	// Ler a validade (câmera com moldura, ou foto)
	el.btnLerValidade?.addEventListener("click", abrirLeitorValidade);
	el.btnCapturarValidade?.addEventListener("click", lerDataDaArea);
	el.btnFotoValidade?.addEventListener("click", () => el.arquivoValidade?.click());
	el.arquivoValidade?.addEventListener("change", () => {
		const arquivo = el.arquivoValidade.files?.[0];
		el.arquivoValidade.value = "";
		if (arquivo) carregarFotoValidade(arquivo);
	});
	el.btnFlashValidade?.addEventListener("click", async () => {
		try {
			const ligado = await cameraValidade?.alternarFlash();
			el.btnFlashValidade.setAttribute("aria-pressed", String(!!ligado));
		} catch { toast("aviso", "Flash indisponível neste aparelho/navegador."); }
	});
	el.dlgValidade?.addEventListener("close", fecharLeitorValidade);
	registrarSelecaoFoto();
	// Foco: botão com as opções e toque na imagem para focar (código de barras e validade)
	uiFocoLeitor = ligarInterfaceFoco({
		area: el.leitorArea, video: el.leitorVideo, botao: el.btnFoco, painel: el.painelFoco,
		obterFoco: () => leitor?.foco || null,
		podeTocar: () => !!leitor?.ativo,
		aviso: (tipo, html) => toast(tipo, html)
	});
	uiFocoValidade = ligarInterfaceFoco({
		area: el.validadeArea, video: el.validadeVideo, botao: el.btnFocoValidade, painel: el.painelFocoValidade,
		obterFoco: () => cameraValidade?.foco || null,
		podeTocar: () => !el.validadeArea.classList.contains("modo-foto") && !lendoValidade,
		aviso: (tipo, html) => toast(tipo, html)
	});
	el.nome.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); el.quantidade.focus(); } });
	el.quantidade.addEventListener("keydown", e => {
		if (e.key === "Enter") { e.preventDefault(); el.vencimento.focus(); try { el.vencimento.showPicker?.(); } catch { /* ignora */ } }
	});
	[el.nome, el.quantidade, el.vencimento].forEach(c => c.addEventListener("input", () => c.removeAttribute("aria-invalid")));
	document.addEventListener("keydown", e => {
		if (e.key === "Escape" && estado.editandoId && !document.querySelector("dialog[open]") && !window.Swal?.isVisible?.()) sairDaEdicao();
	});

	el.btnEscanear.addEventListener("click", abrirLeitor);
	el.dlgLeitor.addEventListener("close", pararLeitor);
	el.btnFlash.addEventListener("click", alternarFlash);
	el.btnTrocarCamera.addEventListener("click", async () => {
		try {
			if (!(await leitor?.trocarCamera())) toast("info", "Só há uma câmera disponível.");
		} catch (e) {
			console.warn(e);
			toast("erro", esc(leitor?.traduzirErro(e)?.mensagem || "Não foi possível trocar de câmera."));
		}
	});
	el.leitorZoom.addEventListener("input", debounce(() => leitor?.definirZoom(el.leitorZoom.value), 60));
	// Lupas: cada toque muda o zoom em um passo (1/8 da faixa da câmera)
	$$(".zoom-passo").forEach(b => b.addEventListener("click", () => {
		const min = Number(el.leitorZoom.min) || 1, max = Number(el.leitorZoom.max) || min;
		if (!(max > min)) return;
		const grao = Number(el.leitorZoom.step) > 0 ? Number(el.leitorZoom.step) : 0.1;
		const alinhar = v => Math.round((min + Math.round((v - min) / grao) * grao) * 1000) / 1000;
		const passo = Math.max(grao, alinhar(min + (max - min) / 8) - min);
		const atual = Number(el.leitorZoom.value) || min;
		const novo = Math.min(max, Math.max(min, alinhar(atual + Number(b.dataset.zoom) * passo)));
		if (novo === atual) return;
		el.leitorZoom.value = String(novo);
		leitor?.definirZoom(novo);
	}));
	el.btnFotoCodigo.addEventListener("click", () => el.arquivoFotoCodigo.click());
	el.arquivoFotoCodigo.addEventListener("change", () => {
		const arquivo = el.arquivoFotoCodigo.files?.[0];
		el.arquivoFotoCodigo.value = "";
		lerFotoDoCodigo(arquivo);
	});
	// Pausa a câmera se o app for para segundo plano (economiza bateria e libera o flash)
	document.addEventListener("visibilitychange", () => {
		if (document.hidden && el.dlgLeitor.open) el.dlgLeitor.close();
		if (document.hidden && el.dlgValidade?.open) el.dlgValidade.close();
	});

	// Ações da tabela (delegação)
	// Computador: passar o mouse na miniatura da lista amplia a foto ao lado
	el.lista.addEventListener("mouseover", e => {
		const mini = e.target.closest(".miniatura");
		if (!mini || mini.classList.contains("sem-foto") || !temMouse() || ampliada?.dono === mini) return;
		abrirAmpliada(mini, mini.closest("tr[data-id]")?.querySelector(".nome-texto")?.firstChild?.textContent?.trim() || "");
	});
	el.lista.addEventListener("mouseout", e => {
		const mini = e.target.closest(".miniatura");
		if (mini && !mini.contains(e.relatedTarget)) fecharAmpliada();
	});
	// Rolou a lista/página: a ampliada ficaria fora do lugar
	window.addEventListener("scroll", fecharAmpliada, { passive: true, capture: true });
	// A lista foi redesenhada (ou o mouse saiu sem "mouseout"): fecha a ampliada que ficou sem dono
	let checandoAmpliada = false;
	document.addEventListener("mousemove", () => {
		if (!ampliada || checandoAmpliada) return;
		checandoAmpliada = true;
		requestAnimationFrame(() => {
			checandoAmpliada = false;
			if (ampliada && (!ampliada.dono.isConnected || !ampliada.dono.matches(":hover"))) fecharAmpliada();
		});
	}, { passive: true });
	el.lista.addEventListener("click", e => {
		const linha = e.target.closest("tr[data-id]");
		if (!linha) return;
		const id = linha.dataset.id;
		const botao = e.target.closest("button[data-acao]");
		if (botao) {
			fecharAmpliada();
			const acao = botao.dataset.acao;
			if (acao === "editar") iniciarEdicao(id);
			else if (acao === "remover") removerItem(id);
			else if (acao === "silenciar") alternarSilencio(id);
			else if (acao === "foto") abrirFotoDoItem(id);
			return;
		}
		const celulaCodigo = e.target.closest("[data-copiar]");
		if (celulaCodigo) {
			copiarTexto(celulaCodigo.textContent.trim()).then(ok => ok && toast("info", "Código copiado.", 1800));
		}
	});
	// Foto que não carrega (link quebrado): mostra o ícone e tenta de novo daqui a alguns dias
	el.lista.addEventListener("error", e => {
		const img = e.target;
		if (!(img instanceof HTMLImageElement) || !img.closest(".miniatura")) return;
		const linha = img.closest("tr[data-id]");
		const item = linha && itensAtuais().find(i => i.id === linha.dataset.id);
		const botao = img.closest(".miniatura");
		botao.classList.add("sem-foto");
		img.replaceWith(document.createRange().createContextualFragment(icone("Package")));
		const chave = item && chaveFoto(item);
		const atual = chave && estado.fotos.get(chave);
		if (atual && atual.origem !== "usuario" && atual.origem !== "nenhuma") {
			// A foto achada não abriu: tenta de novo (outra fonte) em pouco tempo, não em dias
			const registro = { src: "", origem: "nenhuma", erroImagem: true };
			estado.fotos.set(chave, registro);
			guardarFoto(chave, registro);
		}
	}, true);
	el.btnFotoForm?.addEventListener("click", fotoDoFormulario);

	el.lista.addEventListener("dblclick", e => {
		const linha = e.target.closest("tr[data-id]");
		if (linha && !e.target.closest("button,[data-copiar]")) iniciarEdicao(linha.dataset.id);
	});

	// Botão "Desfazer" dentro do aviso
	document.addEventListener("click", e => {
		const b = e.target.closest("[data-desfazer]");
		if (b) desfazerRemocao(b.dataset.desfazer);
	}, true);

	// Filtros
	$$(".cartao-resumo").forEach(b => b.addEventListener("click", () => {
		estado.filtro = estado.filtro === b.dataset.filtro && b.dataset.filtro !== "todos" ? "todos" : b.dataset.filtro;
		render();
	}));
	const aoBuscar = debounce(() => { estado.busca = el.filtro.value; render(); }, 120);
	el.filtro.addEventListener("input", () => {
		if (processarComando(el.filtro.value)) return;
		aoBuscar();
	});
	el.ordenacao.addEventListener("change", () => {
		estado.ordenacao = el.ordenacao.value;
		armazenamento.gravarTexto(CHAVE.ordenacao, estado.ordenacao);
		render();
	});

	// Configuração do alerta
	const salvarAlerta = debounce(() => {
		const valor = Math.max(0, Math.min(3650, Math.floor(Number(el.nAlertar.value))));
		if (!Number.isFinite(valor)) return;
		estado.alerta = { valor, unidade: el.como.value === "meses" ? "meses" : "dias" };
		armazenamento.gravar(CHAVE.alerta, estado.alerta);
		render();
	}, 200);
	el.nAlertar.addEventListener("input", salvarAlerta);
	el.nAlertar.addEventListener("blur", () => { if (el.nAlertar.value === "" || Number(el.nAlertar.value) < 0) aplicarAlertaNaTela(); });
	el.como.addEventListener("change", salvarAlerta);

	// Topo
	el.btnTema.addEventListener("click", alternarTema);
	el.btnSync.addEventListener("click", abrirDialogoSync);

	// Menu "mais"
	el.menu.addEventListener("click", e => {
		const b = e.target.closest("button[data-acao]");
		if (!b) return;
		el.menu.open = false;
		switch (b.dataset.acao) {
			case "exportar-json": exportarJSON(); break;
			case "exportar-csv": exportarCSV(); break;
			case "importar": el.arquivo.click(); break;
			case "sincronizar": abrirDialogoSync(); break;
			case "loja": configurarNomeLoja(); break;
			case "sugestao-auto": alternarSugestaoAuto(); break;
			case "fotos-auto": alternarFotosAuto(); break;
		}
	});
	document.addEventListener("click", e => { if (el.menu.open && !el.menu.contains(e.target)) el.menu.open = false; });
	document.addEventListener("keydown", e => { if (e.key === "Escape" && el.menu.open) el.menu.open = false; });
	el.arquivo.addEventListener("change", async () => {
		const arquivo = el.arquivo.files?.[0];
		el.arquivo.value = "";
		try { await importarArquivo(arquivo); } catch (e) { console.error(e); toast("erro", "Falha ao importar o arquivo."); }
	});

	// Diálogos: botões de fechar e clique fora
	$$("dialog").forEach(d => {
		d.addEventListener("click", e => {
			if (e.target.closest("[data-fechar]")) return d.close();
			if (e.target === d) {
				const r = d.getBoundingClientRect();
				const fora = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
				if (fora) d.close();
			}
		});
	});

	// Sincronização
	el.btnLoginGoogle.addEventListener("click", loginGoogle);
	el.btnLoginDropbox.addEventListener("click", loginDropbox);
	el.btnLoginEmail.addEventListener("click", () => {
		el.caixaEmail.hidden = !el.caixaEmail.hidden;
		if (!el.caixaEmail.hidden) setTimeout(() => el.loginEmail.focus(), 30);
	});
	el.btnEnviarCodigo.addEventListener("click", () => enviarCodigoLogin(false));
	el.btnEmailAlternativo.addEventListener("click", () => enviarCodigoLogin(true));
	el.loginEmail.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); enviarCodigoLogin(false); } });
	el.loginEmail.addEventListener("input", () => el.loginEmail.removeAttribute("aria-invalid"));
	el.btnEntrarLogin.addEventListener("click", confirmarCodigoLogin);
	el.loginCodigo.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); confirmarCodigoLogin(); } });
	el.loginCodigo.addEventListener("input", () => el.loginCodigo.removeAttribute("aria-invalid"));
	el.btnTrocarEmail.addEventListener("click", () => {
		emailPendente = "";
		el.loginCodigoCaixa.hidden = true;
		el.emailEnviadoMsg.hidden = true;
		el.btnEmailAlternativo.hidden = true;
		el.loginEmail.focus();
	});
	el.btnCriarLista.addEventListener("click", () => criarListaNova());
	el.btnEntrarCodigo.addEventListener("click", entrarPorCodigo);
	el.syncCodigo.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); entrarPorCodigo(); } });
	el.syncCodigo.addEventListener("input", () => {
		el.syncCodigo.removeAttribute("aria-invalid");
		// Formata enquanto digita: ABCD-EFGH-JKLM-NPQR (links colados ficam intactos)
		const v = el.syncCodigo.value;
		if (/[#&](lista|l)=|:\/\//.test(v)) return;
		const limpo = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 28); // lista (16) ou dono (28)
		const formatado = formatarCodigoLista(limpo);
		if (formatado !== v) el.syncCodigo.value = formatado;
	});
	el.btnRevelarCodigo.addEventListener("click", () => mostrarCodigoLista(!codigoVisivel));
	el.dlgSync.addEventListener("close", () => mostrarCodigoLista(false)); // fechou: esconde de novo
	el.btnCopiarCodigo.addEventListener("click", async () => {
		if (emNuvem()) feedbackBotao(el.btnCopiarCodigo, await copiarTexto(formatarCodigoLista(estado.sync.codigo)));
	});
	el.btnDesconectar.addEventListener("click", desconectarNuvem);
	el.syncPermitirEdicao.addEventListener("change", () => {
		if (!emNuvem()) return;
		if (!ehDono()) {
			el.syncPermitirEdicao.checked = estado.sync.modo !== "leitura";
			return toast("aviso", "Só o <b>dono da lista</b> pode mudar a permissão deste aparelho.");
		}
		estado.sync = { ...estado.sync, modo: el.syncPermitirEdicao.checked ? "edicao" : "leitura" };
		armazenamento.gravar(CHAVE.sync, estado.sync);
		if (!podeEditar() && estado.editandoId) sairDaEdicao(true);
		render();
		atualizarIndicadorSync();
	});
	el.btnNovoConvidado.addEventListener("click", novoConvidado);
	el.btnPedirAcesso.addEventListener("click", pedirAcesso);
	el.listaPedidos.addEventListener("click", acaoPedido);
	el.btnSouDono.addEventListener("click", () => { if (estado.sync?.donoPendente) pedirLoginDono(estado.sync); });
	const salvarNomeConvidado = () => {
		const nome = limparNomeConvidado(el.nomeConvidado.value);
		el.nomeConvidado.value = nome;
		// Nome é obrigatório: não deixa apagar
		if (nome.length < 2) {
			el.nomeConvidado.value = limparNomeConvidado(armazenamento.lerTexto(CHAVE.nomeAparelho));
			el.nomeConvidado.setAttribute("aria-invalid", "true");
			setTimeout(() => el.nomeConvidado.removeAttribute("aria-invalid"), 2500);
			return toast("erro", "Digite seu nome (pelo menos 2 letras). O nome é obrigatório.");
		}
		armazenamento.gravarTexto(CHAVE.nomeAparelho, nome);
		if (!estado.sync?.confirmado) return toast("info", "Nome guardado. Ele vai para o dono assim que o convite for confirmado.");
		enviarAparelho().catch(e => console.warn("[convidados] nome:", e));
		toast("sucesso", `Pronto! O dono da lista vê este aparelho como <b>${esc(nome)}</b>.`);
	};
	el.btnSalvarNomeConvidado.addEventListener("click", salvarNomeConvidado);
	el.nomeConvidado.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); salvarNomeConvidado(); } });
	el.listaConvidados.addEventListener("click", acaoConvidado);
	el.listaConvidados.addEventListener("change", acaoConvidado);
	el.listaConvidados.addEventListener("keydown", e => {
		if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[data-c="detalhes"]')) { e.preventDefault(); acaoConvidado(e); }
	});
	el.btnCopiarLink.addEventListener("click", async () => feedbackBotao(el.btnCopiarLink, await copiarTexto(el.linkCompartilhar.value)));
	el.linkCompartilhar.addEventListener("focus", () => el.linkCompartilhar.select());
	if (navigator.share) {
		el.btnCompartilharNativo.hidden = false;
		el.btnCompartilharNativo.addEventListener("click", async () => {
			try {
				await navigator.share({ title: "Controle de Vencimento", text: "Abra este link para acessar a lista compartilhada:", url: el.linkCompartilhar.value });
			} catch (e) {
				if (e?.name !== "AbortError") console.warn(e);
			}
		});
	}

	// Link aberto com a página já carregada
	window.addEventListener("hashchange", processarLinkCompartilhado);

	// Outra aba alterou os dados locais
	window.addEventListener("storage", e => {
		if (e.key === CHAVE.itens && !emNuvem()) {
			estado.itensLocais = sanitizarLista(armazenamento.ler(CHAVE.itens, []));
			render();
		} else if (e.key === CHAVE.silenciados) {
			estado.silenciados = new Set((armazenamento.ler(CHAVE.silenciados, []) || []).map(normalizarId).filter(Boolean));
			render();
		} else if (e.key === CHAVE.sugestaoAuto) {
			estado.sugestaoAuto = armazenamento.lerTexto(CHAVE.sugestaoAuto) === "1";
			aplicarSugestaoAuto();
		} else if (e.key === CHAVE.loja || e.key === null) {
			definirNomeLoja(armazenamento.lerTexto(CHAVE.loja), { salvar: false });
		}
	});

	// Atualiza as situações quando o dia muda ou o app volta a ficar visível
	let diaRenderizado = hojeISO();
	const verificarDia = () => {
		if (hojeISO() !== diaRenderizado) { diaRenderizado = hojeISO(); render(); }
	};
	document.addEventListener("visibilitychange", () => { if (!document.hidden) verificarDia(); });
	setInterval(verificarDia, 60000);
	window.addEventListener("online", atualizarIndicadorSync);
	window.addEventListener("offline", () => {
		if (emNuvem()) { estado.statusSync = "offline"; estado.detalheSync = "Sem internet — as alterações serão enviadas depois."; atualizarIndicadorSync(); }
	});
}

/* =========================================================
   Inicialização
   ========================================================= */
function iniciar() {
	aplicarIconesEstaticos();
	iniciarNotyf();
	migrarVersaoAnterior();

	estado.itensLocais = sanitizarLista(armazenamento.ler(CHAVE.itens, []));
	estado.silenciados = new Set((armazenamento.ler(CHAVE.silenciados, []) || []).map(normalizarId).filter(Boolean));
	definirNomeLoja(armazenamento.lerTexto(CHAVE.loja), { salvar: false });
	estado.sugestaoAuto = armazenamento.lerTexto(CHAVE.sugestaoAuto) === "1";
	aplicarSugestaoAuto();
	estado.fotosAuto = armazenamento.lerTexto(CHAVE.fotosAuto) !== "0";
	$("#itemFotosAuto")?.setAttribute("aria-checked", String(estado.fotosAuto));
	// Foto da internet virou cópia local: troca na tela sem baixar de novo
	const renderFotos = debounce(() => render(), 400);
	aoCopiarFoto((chave, registro) => { estado.fotos.set(chave, registro); renderFotos(); });
	carregarFotos().then(mapa => { estado.fotos = mapa; render(); copiarFotosPendentes(mapa); }).catch(e => console.warn("[fotos]", e));
	const alerta = armazenamento.ler(CHAVE.alerta, null);
	if (alerta && Number.isFinite(Number(alerta.valor))) {
		estado.alerta = { valor: Math.max(0, Math.min(3650, Math.floor(Number(alerta.valor)))), unidade: alerta.unidade === "meses" ? "meses" : "dias" };
	}
	const ordem = armazenamento.lerTexto(CHAVE.ordenacao);
	if (ordem && [...el.ordenacao.options].some(o => o.value === ordem)) estado.ordenacao = ordem;
	el.ordenacao.value = estado.ordenacao;
	aplicarAlertaNaTela();

	// Configuração da nuvem salva. Versões antigas (ou uma opção de nuvem desativada)
	// não são usadas: a última cópia da nuvem guardada no aparelho vira a lista local.
	const syncSalvo = armazenamento.ler(CHAVE.sync, null);
	const syncValido = normalizarSync(syncSalvo);
	if (syncValido) {
		estado.sync = syncValido;
		const cache = armazenamento.ler(CHAVE.cacheNuvem, null);
		if (cache && cache.id === idSync(syncValido)) estado.itensNuvem = sanitizarLista(cache.itens);
		estado.statusSync = "conectando";
	} else if (syncSalvo) {
		const cache = armazenamento.ler(CHAVE.cacheNuvem, null);
		const copia = sanitizarLista(cache?.itens);
		if (copia.length) copiarNuvemParaLocal(copia);
		armazenamento.remover(CHAVE.sync);
		armazenamento.remover(CHAVE.cacheNuvem);
		setTimeout(() => toast("info", "A nuvem do app foi atualizada. Seus produtos foram mantidos neste aparelho — toque em <b>Apenas neste aparelho</b> para salvar na nuvem de novo.", 9000), 800);
	}

	registrarEventos();
	registrarEventosLayout();
	posicionarResumo();
	// A animação de entrada roda só uma vez (mover blocos depois não a reinicia)
	setTimeout(() => document.body.classList.add("carregado"), 1200);

	// Formulário no celular: recolhido quando já há produtos (ou como a pessoa deixou)
	const recolhidoSalvo = armazenamento.lerTexto(CHAVE.formRecolhido);
	definirFormRecolhido(recolhidoSalvo === null ? itensAtuais().length > 0 : recolhidoSalvo === "1", { lembrar: false });

	render();
	atualizarIndicadorSync();

	// Anúncio (se configurado em config-anuncios.js)
	iniciarAnuncios(document.getElementById("anuncioRodape"));

	// Animação suave da lista (opcional)
	import(URL_AUTO_ANIMATE)
		.then(m => (m.default || m.autoAnimate)?.(el.lista, { duration: 320, easing: "cubic-bezier(.2, .8, .2, 1)" }))
		.catch(() => { /* sem animação */ });

	if (emNuvem()) {
		ligarLista(estado.sync).catch(erro => {
			const info = explicarErro(erro);
			estado.statusSync = "erro";
			estado.detalheSync = info.mensagem;
			atualizarIndicadorSync();
			toastUnico("erro", esc(info.mensagem));
		});
		// Se o servidor demorar, alerta com os dados em cache
		setTimeout(() => { if (estado.itensNuvem.length) alertaInicial(); }, 6000);
	} else {
		estado.dadosProntos = true;
		alertaInicial();
	}

	concluirLoginsPendentes()
		.catch(e => console.warn(e))
		.finally(() => processarLinkCompartilhado());
}

/* ---------- Service worker: abre sem internet e pega a versão nova quando há rede ---------- */
function registrarServiceWorker() {
	try {
		if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
		// Testes automatizados (navegador controlado) só registram quando pedem (?sw=1)
		if (navigator.webdriver && !new URLSearchParams(location.search).has("sw")) return;
		const registrar = () => navigator.serviceWorker.register("./sw.js", { scope: "./" })
			.then(reg => {
				window.__swPronto = true;
				// Confere atualização ao voltar para o app (PWA aberto por muito tempo)
				document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => { }); });
			})
			.catch(e => console.warn("[sw]", e));
		if (document.readyState === "complete") registrar();
		else window.addEventListener("load", registrar, { once: true });
	} catch (e) {
		console.warn("[sw]", e);
	}
}

try {
	iniciar();
	registrarServiceWorker();
} catch (erro) {
	console.error("Falha ao iniciar:", erro);
	document.body.insertAdjacentHTML("afterbegin",
		`<div style="padding:12px 16px;background:#dc3c3c;color:#fff;font-weight:600">Ocorreu um erro ao iniciar o app. Recarregue a página. (${esc(erro?.message || erro)})</div>`);
}
