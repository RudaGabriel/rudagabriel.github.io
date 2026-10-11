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
import { iniciarAnuncios } from "./anuncios.js";

const URL_AUTO_ANIMATE = "https://cdn.jsdelivr.net/npm/@formkit/auto-animate@0.10.0/index.mjs";
const URL_QRCODE = "https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js";

const CHAVE = {
	itens: "cv2:itens",
	silenciados: "cv2:silenciados",
	alerta: "cv2:alerta",
	ordenacao: "cv2:ordenacao",
	sync: "cv2:sync",
	cacheNuvem: "cv2:cacheNuvem",
	migrado: "cv2:migrado",
	tema: "cv2:tema",
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
function toast(tipo, html, duracao) {
	if (notyf) {
		const opcoes = { type: TIPOS_TOAST[tipo] || "info", message: html };
		if (duracao) opcoes.duration = duracao;
		try { return notyf.open(opcoes); } catch { /* cai no console */ }
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
function dialogo({ titulo, html, icone: tipoIcone, confirmar = "OK", negar, cancelar, perigo = false, checkbox, foco = "confirmar" }) {
	const executar = async () => {
		if (!window.Swal) {
			const mensagem = `${titulo ? titulo + "\n\n" : ""}${textoPuro(html)}`;
			if (!cancelar && !negar) { window.alert(mensagem); return { acao: "confirmar", valor: false }; }
			return { acao: window.confirm(mensagem) ? "confirmar" : (negar ? "negar" : "cancelar"), valor: false };
		}
		const dialogoAberto = document.querySelector("dialog[open]");
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
			input: checkbox ? "checkbox" : undefined,
			inputValue: checkbox ? 0 : undefined,
			inputPlaceholder: checkbox || undefined,
			customClass: {
				popup: "sw-popup",
				confirmButton: perigo ? "btn btn-perigo" : "btn btn-primario",
				denyButton: "btn btn-secundario",
				cancelButton: "btn btn-fantasma"
			}
		});
		const acao = r.isConfirmed ? "confirmar" : r.isDenied ? "negar" : "cancelar";
		return { acao, valor: checkbox ? !!r.value : r.value };
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
	alerta: { valor: 60, unidade: "dias" },
	filtro: "todos",
	busca: "",
	ordenacao: "prioridade",
	editandoId: null,
	sync: null,              // { tipo: "facil"|"proprio", config, codigo|lista, modo: "edicao"|"leitura", reconciliar }
	usuarios: {},            // conta logada em cada provedor de nuvem
	statusSync: "local",
	detalheSync: "",
	ultimaSync: null,
	dadosProntos: false,
	alertaInicialFeito: false
};

const emNuvem = () => !!estado.sync;
const podeEditar = () => !emNuvem() || estado.sync.modo !== "leitura";
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
	leitorArea: $(".leitor-area"),
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
	return `
		<td class="celula-nome">${esc(item.nome)}${silenciado ? `<span class="selo-silenciado" title="Alerta silenciado">${icone("BellOff")}</span>` : ""}</td>
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
	$("#totTodos").textContent = contagem.todos;
	$("#totAlerta").textContent = contagem.alerta;
	$("#totVencidos").textContent = contagem.vencidos;
	$("#totMes").textContent = contagem.mes;
	$("#totOk").textContent = contagem.ok;
	$$(".cartao-resumo").forEach(b => {
		const ativo = b.dataset.filtro === estado.filtro;
		b.classList.toggle("ativo", ativo);
		b.setAttribute("aria-pressed", String(ativo));
	});

	const busca = normalizar(estado.busca);
	const visiveis = ordenar(calculados.filter(c => {
		switch (estado.filtro) {
			case "alerta": if (c.sit.estado !== "alerta") return false; break;
			case "vencidos": if (c.sit.estado !== "vencido") return false; break;
			case "ok": if (c.sit.estado !== "ok") return false; break;
			case "mes": if (!c.esteMes) return false; break;
		}
		if (!busca) return true;
		return normalizar(c.item.nome).includes(busca) || (c.item.codigoBarras || "").toLowerCase().includes(busca);
	}), estado.ordenacao);

	// Atualização por chave: só reescreve linhas que mudaram (anima bem e é rápido).
	// Posiciona cada linha logo após a anterior, sem depender de índices — a animação
	// pode manter temporariamente no DOM linhas que estão saindo.
	const novas = new Map();
	let anterior = null;
	visiveis.forEach(({ item, sit }) => {
		const silenciado = estado.silenciados.has(item.id);
		const editando = estado.editandoId === item.id;
		const assinatura = [item.nome, item.codigoBarras, item.quantidade, item.vencimento, sit.texto, sit.estado, silenciado, editando, editavel].join("\u0001");
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
}

function atualizarEstadoFormulario() {
	const editavel = podeEditar();
	el.avisoLeitura.hidden = editavel;
	[el.codigo, el.nome, el.quantidade, el.vencimento, el.btnSalvar, el.btnEscanear].forEach(c => { c.disabled = !editavel; });
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
	[el.nome, el.quantidade, el.vencimento].forEach(c => c.removeAttribute("aria-invalid"));
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
		aplicarAlteracoes({ salvar: [{ ...existente, quantidade, atualizadoEm: agora }] });
		toast("sucesso", `Quantidade de <b>${esc(existente.nome)}</b> atualizada para <b>${fmtNumero.format(quantidade)}</b>.`);
	} else {
		const item = sanitizarItem({ ...novo, id: gerarId(), criadoEm: agora, atualizadoEm: agora });
		if (!item) return toast("erro", "Dados inválidos.");
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
	if (!conhecido) return false;
	el.nome.value = conhecido.nome;
	el.nome.removeAttribute("aria-invalid");
	toast("info", `Produto reconhecido: <b>${esc(conhecido.nome)}</b>`, 2500);
	return true;
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
		`<li><span>${esc(item.nome)} <small>· ${fmtNumero.format(item.quantidade)} un.</small></span><span class="selo selo-alerta">${esc(sit.texto)}</span></li>`
	).join("");
	const extra = proximos.length > MAX ? `<p style="margin-top:8px">…e mais ${proximos.length - MAX}.</p>` : "";
	const { acao, valor } = await dialogo({
		titulo: `${proximos.length} produto${proximos.length > 1 ? "s" : ""} perto do vencimento`,
		html: `<ul class="lista-alerta">${linhas}</ul>${extra}`,
		icone: "warning",
		confirmar: "Ver produtos",
		cancelar: "Fechar",
		checkbox: "Não alertar novamente sobre estes produtos"
	});
	if (valor) {
		proximos.forEach(c => estado.silenciados.add(c.item.id));
		salvarSilenciados();
		toast("info", "Pronto! Você pode reativar o alerta pelo ícone do sino.");
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

function exportarJSON() {
	const dados = {
		app: "controle-de-vencimento",
		versao: 2,
		exportadoEm: new Date().toISOString(),
		itens: itensAtuais(),
		alerta: estado.alerta,
		silenciados: [...estado.silenciados]
	};
	baixarArquivo(JSON.stringify(dados, null, 2), `vencimentos-${hojeISO()}.json`, "application/json");
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
	baixarArquivo("﻿" + linhas.join("\r\n"), `vencimentos-${hojeISO()}.csv`, "text/csv;charset=utf-8");
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
}

function leituraOk(codigo) {
	if (leituraConcluida) return;
	const limpo = String(codigo || "").replace(/\s+/g, "").slice(0, 64);
	if (!limpo) return;
	leituraConcluida = true;
	el.leitorArea.classList.add("lido");
	el.leitorStatus.textContent = `Lido: ${limpo}`;
	el.codigo.value = limpo;
	// Pequena pausa para a pessoa ver a confirmação verde
	setTimeout(() => {
		pararLeitor();
		if (el.dlgLeitor.open) el.dlgLeitor.close();
		const reconhecido = autoPreencherPorCodigo();
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
			estado.itensNuvem = sanitizarLista(itens);
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
	return { provedor, codigo, modo: bruto.modo === "leitura" ? "leitura" : "edicao", reconciliar: !!bruto.reconciliar };
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
	if (anterior) anterior.desligar();
	estado.sync = novo;
	armazenamento.gravar(CHAVE.sync, estado.sync);
	armazenamento.remover(CHAVE.cacheNuvem);
	estado.itensNuvem = [];
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
		const prov = provedores[novo.provedor];
		await prov.conectar(novo.codigo);
		// Com login, a conta passa a lembrar esta lista (para os outros aparelhos)
		const u = estado.usuarios[novo.provedor];
		if (u?.id && prov.salvarListaNaConta) prov.salvarListaNaConta(u.id, novo.codigo).catch(e => console.warn(e));
		return true;
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
	prov?.desligar();
	if (comConta) await prov?.sair();
	estado.sync = null;
	estado.itensNuvem = [];
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
const gerarLink = modo =>
	`${location.origin}${location.pathname}#lista=${estado.sync.codigo}&p=${SIGLA[estado.sync.provedor] || "fb"}${modo === "leitura" ? "&ver=1" : ""}`;

function lerLink(hash) {
	const texto = String(hash || "");
	if (/[#&]conectar=/.test(texto)) return { invalido: true, motivo: "Este link é da versão antiga da nuvem. Peça um novo link a quem compartilhou." };
	const achado = texto.match(/[#&]lista=([A-Za-z0-9-]+)/);
	if (!achado) return null;
	const codigo = normalizarCodigoLista(achado[1]);
	if (!codigo) return { invalido: true };
	const sigla = (texto.match(/[#&]p=([a-z]+)/) || [])[1];
	const provedor = DE_SIGLA[sigla] || provedorDeCodigo()?.id;
	if (!provedor || !provedores[provedor]?.disponivel) return { invalido: true, motivo: "Esta opção de nuvem não está ativada nesta versão do site." };
	return { provedor, codigo, modo: /[#&]ver=1/.test(texto) ? "leitura" : "edicao" };
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
		if (estado.sync.modo !== novo.modo) {
			estado.sync = { ...estado.sync, modo: novo.modo };
			armazenamento.gravar(CHAVE.sync, estado.sync);
			render();
			atualizarIndicadorSync();
			atualizarDialogoSync();
		}
		toast("info", "Este aparelho já está conectado a esta lista.");
		return true;
	}
	const trocar = emNuvem() ? "<br><br><small>Este aparelho deixará de usar a lista atual.</small>" : "";
	const ok = await confirmar({
		titulo: "Conectar à lista na nuvem?",
		html: `Código: <b style="font-family:var(--fonte-mono)">${formatarCodigoLista(novo.codigo)}</b><br>Permissão: <b>${novo.modo === "leitura" ? "somente visualizar" : "pode editar"}</b>${trocar}`,
		confirmar: "Conectar",
		icone: "question"
	});
	if (!ok) return false;
	const conectou = await conectarNuvem(novo);
	if (conectou) toast("sucesso", "Conectado! A lista será carregada em instantes.");
	return conectou;
}

/* ---------- Diálogo da nuvem ---------- */
let qrUltimoLink = "";
async function atualizarCompartilhamento() {
	if (!emNuvem()) return;
	const temCodigo = estado.sync.provedor !== "dropbox";
	el.caixaCodigo.hidden = !temCodigo;
	el.blocoCompartilhar.hidden = !temCodigo;
	if (!temCodigo) return;
	const tipo = document.querySelector('input[name="tipoLink"]:checked')?.value || "edicao";
	const link = gerarLink(tipo);
	el.linkCompartilhar.value = link;
	el.codigoLista.textContent = formatarCodigoLista(estado.sync.codigo);
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
		el.syncPermitirEdicao.checked = estado.sync.modo !== "leitura";
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
		if (await conectarNuvem({ provedor: "dropbox", codigo: CODIGO_CONTA, modo: "edicao", reconciliar: estado.itensLocais.length > 0 })) {
			toast("sucesso", "Conectado ao Dropbox! Entre com a mesma conta nos outros aparelhos para ver a mesma lista.", 7000);
		}
		return;
	}
	let codigo = null;
	try { codigo = await prov.listaDaConta(usuario.id); } catch (e) { console.warn(e); }
	if (codigo) {
		if (await conectarNuvem({ provedor: provedorId, codigo, modo: "edicao", reconciliar: estado.itensLocais.length > 0 })) {
			toast("sucesso", `Bem-vindo de volta! Lista da conta <b>${esc(usuario.email || "")}</b> carregada.`, 6000);
		}
	} else {
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
		const ok = await conectarNuvem({ provedor: provedorId, codigo: gerarCodigoLista(), modo: "edicao", reconciliar: false });
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
	const codigo = normalizarCodigoLista(el.syncCodigo.value);
	if (!codigo) {
		el.syncCodigo.setAttribute("aria-invalid", "true");
		el.syncCodigo.focus();
		return toast("erro", "Código inválido. Ele tem 16 letras/números, como <b>ABCD-EFGH-JKLM-NPQR</b>.");
	}
	// Um link colado indica o provedor; um código digitado usa o provedor padrão
	const doLink = lerLink(el.syncCodigo.value.includes("#") ? el.syncCodigo.value.slice(el.syncCodigo.value.indexOf("#")) : "");
	const provedor = doLink?.provedor || provedorDeCodigo()?.id;
	el.syncCodigo.removeAttribute("aria-invalid");
	el.btnEntrarCodigo.disabled = true;
	try {
		if (await entrarEmLista({ provedor, codigo, modo: "edicao" })) el.syncCodigo.value = "";
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
function alternarTema() {
	const novo = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
	document.documentElement.dataset.tema = novo;
	armazenamento.gravarTexto(CHAVE.tema, novo);
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
	el.btnFotoCodigo.addEventListener("click", () => el.arquivoFotoCodigo.click());
	el.arquivoFotoCodigo.addEventListener("change", () => {
		const arquivo = el.arquivoFotoCodigo.files?.[0];
		el.arquivoFotoCodigo.value = "";
		lerFotoDoCodigo(arquivo);
	});
	// Pausa a câmera se o app for para segundo plano (economiza bateria e libera o flash)
	document.addEventListener("visibilitychange", () => {
		if (document.hidden && el.dlgLeitor.open) el.dlgLeitor.close();
	});

	// Ações da tabela (delegação)
	el.lista.addEventListener("click", e => {
		const linha = e.target.closest("tr[data-id]");
		if (!linha) return;
		const id = linha.dataset.id;
		const botao = e.target.closest("button[data-acao]");
		if (botao) {
			const acao = botao.dataset.acao;
			if (acao === "editar") iniciarEdicao(id);
			else if (acao === "remover") removerItem(id);
			else if (acao === "silenciar") alternarSilencio(id);
			return;
		}
		const celulaCodigo = e.target.closest("[data-copiar]");
		if (celulaCodigo) {
			copiarTexto(celulaCodigo.textContent.trim()).then(ok => ok && toast("info", "Código copiado.", 1800));
		}
	});
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
		if (/lista=/.test(v)) return;
		const limpo = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
		const formatado = formatarCodigoLista(limpo);
		if (formatado !== v) el.syncCodigo.value = formatado;
	});
	el.btnCopiarCodigo.addEventListener("click", async () => {
		if (emNuvem()) feedbackBotao(el.btnCopiarCodigo, await copiarTexto(formatarCodigoLista(estado.sync.codigo)));
	});
	el.btnDesconectar.addEventListener("click", desconectarNuvem);
	el.syncPermitirEdicao.addEventListener("change", () => {
		if (!emNuvem()) return;
		estado.sync = { ...estado.sync, modo: el.syncPermitirEdicao.checked ? "edicao" : "leitura" };
		armazenamento.gravar(CHAVE.sync, estado.sync);
		if (!podeEditar() && estado.editandoId) sairDaEdicao(true);
		render();
		atualizarIndicadorSync();
	});
	$$('input[name="tipoLink"]').forEach(r => r.addEventListener("change", atualizarCompartilhamento));
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
	render();
	atualizarIndicadorSync();

	// Anúncio (se configurado em config-anuncios.js)
	iniciarAnuncios(document.getElementById("anuncioRodape"));

	// Animação suave da lista (opcional)
	import(URL_AUTO_ANIMATE)
		.then(m => (m.default || m.autoAnimate)?.(el.lista, { duration: 180 }))
		.catch(() => { /* sem animação */ });

	if (emNuvem()) {
		provAtual().conectar(estado.sync.codigo).catch(erro => {
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

try {
	iniciar();
} catch (erro) {
	console.error("Falha ao iniciar:", erro);
	document.body.insertAdjacentHTML("afterbegin",
		`<div style="padding:12px 16px;background:#dc3c3c;color:#fff;font-weight:600">Ocorreu um erro ao iniciar o app. Recarregue a página. (${esc(erro?.message || erro)})</div>`);
}
