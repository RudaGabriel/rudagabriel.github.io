/* =========================================================
   Leitura da data de validade por foto (OCR no aparelho)
   ---------------------------------------------------------
   - A foto é tratada (escala de cinza e contraste) e lida pelo
     Tesseract.js, que roda no próprio navegador: a imagem não
     é enviada a nenhum servidor.
   - Na primeira vez, o navegador baixa o leitor (~3 MB) do
     jsDelivr; depois fica guardado.
   - extrairValidade() interpreta os formatos comuns em
     embalagens brasileiras e prefere a data de validade à de
     fabricação.
   ========================================================= */
import { carregarScript } from "./nuvem/comum.js";

const URL_TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

/* ---------- Interpretação do texto ---------- */
const MESES = {
	JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6,
	JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12
};
// Letras que o OCR costuma confundir com números
const PARA_DIGITO = { O: "0", Q: "0", D: "0", I: "1", L: "1", "|": "1", T: "1", Z: "2", S: "5", B: "8", G: "6" };
const D = "[0-9OQDILTZSBG|]"; // "dígito" tolerante a erros de OCR
const digitos = t => t.replace(/[OQDILTZSBG|]/g, c => PARA_DIGITO[c]);

const PALAVRAS_VALIDADE = /(VAL|VALID|VALIDADE|VENC|VENCIMENTO|VCTO|VTO|EXP|EXPIRA|BB|BEST|CONSUMIR|USE ATE|V\s?[:.])\W{0,4}$/;
const PALAVRAS_FABRICACAO = /(FAB|FABR|FABRICACAO|FABRICADO|PROD|PRODUCAO|EMB|EMBALADO|F\s?[:.]|L\s?[:.]|LOTE)\W{0,4}$/;

const doisDigitos = n => String(n).padStart(2, "0");
const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

function dataValida(ano, mes, dia) {
	if (!(ano >= 2000 && ano <= 2099 && mes >= 1 && mes <= 12 && dia >= 1)) return null;
	if (dia > ultimoDiaDoMes(ano, mes)) return null;
	return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

const anoCompleto = a => (a.length === 2 ? 2000 + Number(a) : Number(a));

/**
 * Encontra a data de validade num texto lido por OCR.
 * @param {string} texto
 * @param {Date} [hoje]
 * @returns {{ data: string, trecho: string } | null} data no formato AAAA-MM-DD
 */
export function extrairValidade(texto, hoje = new Date()) {
	const original = String(texto || "")
		.normalize("NFD").replace(/[̀-ͯ]/g, "")
		.toUpperCase()
		.replace(/[\r\n\t]+/g, " ");
	let resto = original;
	const candidatas = [];

	const registrar = (inicio, trecho, data) => {
		if (!data) return;
		const antes = original.slice(Math.max(0, inicio - 14), inicio);
		candidatas.push({
			data,
			trecho: trecho.trim(),
			validade: PALAVRAS_VALIDADE.test(antes),
			fabricacao: PALAVRAS_FABRICACAO.test(antes)
		});
	};
	const apagar = (inicio, fim) => { resto = resto.slice(0, inicio) + " ".repeat(fim - inicio) + resto.slice(fim); };

	// 1) Dia/mês/ano: 15/03/2027, 15.03.27, 15-03-2027, 15 03 27
	const reDMA = new RegExp(`(?<![0-9A-Z])(${D}{1,2})\\s?[/.\\-\\s]\\s?(${D}{1,2})\\s?[/.\\-\\s]\\s?((?:2${D})?${D}{2})(?![0-9])`, "g");
	for (const m of original.matchAll(reDMA)) {
		const dia = Number(digitos(m[1])), mes = Number(digitos(m[2])), ano = anoCompleto(digitos(m[3]));
		const data = dataValida(ano, mes, dia) || dataValida(ano, dia, mes); // aceita mês/dia se dia/mês for impossível
		if (data) { registrar(m.index, m[0], data); apagar(m.index, m.index + m[0].length); }
	}

	// 2) Dia + mês por extenso + ano: 15 MAR 2027, 15/MAR/27, MAR/2027, MAR 27
	const reMes = new RegExp(`(?<![A-Z])(?:(${D}{1,2})\\s?[/.\\-\\s]?\\s?)?(${Object.keys(MESES).join("|")})[A-Z]*\\.?\\s?[/.\\-\\s]?\\s?((?:2${D})?${D}{2})(?![0-9])`, "g");
	for (const m of resto.matchAll(reMes)) {
		const mes = MESES[m[2]], ano = anoCompleto(digitos(m[3]));
		const dia = m[1] ? Number(digitos(m[1])) : ultimoDiaDoMes(ano, mes);
		const data = dataValida(ano, mes, dia);
		if (data) { registrar(m.index, m[0], data); apagar(m.index, m.index + m[0].length); }
	}

	// 3) Mês/ano: 03/2027, 03/27 (validade = último dia do mês)
	const reMA = new RegExp(`(?<![0-9A-Z/.\\-])(${D}{1,2})\\s?[/.\\-]\\s?((?:2${D})?${D}{2})(?![0-9/.\\-])`, "g");
	for (const m of resto.matchAll(reMA)) {
		const mes = Number(digitos(m[1])), ano = anoCompleto(digitos(m[2]));
		if (mes >= 1 && mes <= 12) registrar(m.index, m[0], dataValida(ano, mes, ultimoDiaDoMes(ano, mes)));
	}

	// Descarta datas absurdas (mais de 5 anos atrás ou 15 anos à frente)
	const minimo = new Date(hoje); minimo.setFullYear(minimo.getFullYear() - 5);
	const maximo = new Date(hoje); maximo.setFullYear(maximo.getFullYear() + 15);
	const plausiveis = candidatas.filter(c => {
		const d = new Date(`${c.data}T12:00:00`);
		return d >= minimo && d <= maximo;
	});
	if (!plausiveis.length) return null;

	const maisTarde = lista => lista.reduce((a, b) => (b.data > a.data ? b : a));
	const marcadas = plausiveis.filter(c => c.validade);
	if (marcadas.length) return pick(maisTarde(marcadas));
	const semFabricacao = plausiveis.filter(c => !c.fabricacao);
	// Sem indicação: a validade é a data mais distante (a de fabricação vem antes)
	return pick(maisTarde(semFabricacao.length ? semFabricacao : plausiveis));
}

const pick = c => ({ data: c.data, trecho: c.trecho });

/* ---------- Preparação da imagem ---------- */
async function carregarImagem(arquivo) {
	const url = URL.createObjectURL(arquivo);
	try {
		const img = new Image();
		img.decoding = "async";
		img.src = url;
		await img.decode();
		return img;
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 30000);
	}
}

/** Redimensiona e aumenta o contraste; `binarizar` gera preto e branco puro (2ª tentativa). */
function prepararCanvas(img, { binarizar = false } = {}) {
	const lado = Math.max(img.naturalWidth, img.naturalHeight) || 1;
	const escala = Math.min(2.5, Math.max(1, 1000 / lado), 1800 / lado);
	const largura = Math.max(1, Math.round(img.naturalWidth * escala));
	const altura = Math.max(1, Math.round(img.naturalHeight * escala));
	const canvas = document.createElement("canvas");
	canvas.width = largura;
	canvas.height = altura;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.drawImage(img, 0, 0, largura, altura);
	const dados = ctx.getImageData(0, 0, largura, altura);
	const p = dados.data;
	// Escala de cinza + esticar o contraste (ignora 1% dos extremos)
	const hist = new Uint32Array(256);
	for (let i = 0; i < p.length; i += 4) {
		const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0;
		p[i] = y;
		hist[y]++;
	}
	const total = p.length / 4, corte = total * 0.01;
	let baixo = 0, alto = 255, soma = 0;
	for (; baixo < 255 && (soma += hist[baixo]) < corte; baixo++);
	soma = 0;
	for (; alto > 0 && (soma += hist[alto]) < corte; alto--);
	const faixa = Math.max(1, alto - baixo);
	// Limiar de Otsu para a versão preto e branco
	let limiar = 128;
	if (binarizar) {
		let somaTotal = 0;
		for (let i = 0; i < 256; i++) somaTotal += i * hist[i];
		let somaFundo = 0, pesoFundo = 0, melhor = 0;
		for (let i = 0; i < 256; i++) {
			pesoFundo += hist[i];
			if (!pesoFundo) continue;
			const pesoFrente = total - pesoFundo;
			if (!pesoFrente) break;
			somaFundo += i * hist[i];
			const mf = somaFundo / pesoFundo, mt = (somaTotal - somaFundo) / pesoFrente;
			const variancia = pesoFundo * pesoFrente * (mf - mt) ** 2;
			if (variancia > melhor) { melhor = variancia; limiar = i; }
		}
	}
	for (let i = 0; i < p.length; i += 4) {
		let y = Math.min(255, Math.max(0, ((p[i] - baixo) * 255) / faixa));
		if (binarizar) y = p[i] > limiar ? 255 : 0;
		p[i] = p[i + 1] = p[i + 2] = y;
	}
	ctx.putImageData(dados, 0, 0);
	return canvas;
}

/* ---------- OCR ---------- */
let trabalhador = null;
let preparando = null;

async function obterTrabalhador(aoProgresso) {
	if (trabalhador) return trabalhador;
	if (!preparando) {
		preparando = (async () => {
			await carregarScript(URL_TESSERACT, () => !!window.Tesseract?.createWorker);
			const w = await window.Tesseract.createWorker("eng", 1, {
				logger: m => { try { aoProgresso?.(m); } catch { /* ignora */ } }
			});
			await w.setParameters({
				tessedit_pageseg_mode: "11", // texto esparso (rótulos)
				preserve_interword_spaces: "1"
			});
			trabalhador = w;
			return w;
		})().catch(e => { preparando = null; throw e; });
	}
	return preparando;
}

/**
 * Lê a data de validade de uma foto.
 * @param {File|Blob} arquivo
 * @param {{ aoProgresso?: (info: {etapa: string, progresso: number}) => void }} [opcoes]
 * @returns {Promise<{ data: string, trecho: string, texto: string } | null>}
 */
export async function lerValidadeDaImagem(arquivo, { aoProgresso } = {}) {
	if (!arquivo) return null;
	const avisar = (etapa, progresso = 0) => { try { aoProgresso?.({ etapa, progresso }); } catch { /* ignora */ } };
	avisar("preparando");
	const img = await carregarImagem(arquivo);
	const w = await obterTrabalhador(m => {
		if (m?.status === "recognizing text") avisar("lendo", m.progress || 0);
		else if (m?.status) avisar("baixando", m.progress || 0);
	});
	let textos = "";
	for (const binarizar of [false, true]) {
		avisar("lendo", 0);
		const { data } = await w.recognize(prepararCanvas(img, { binarizar }));
		const texto = String(data?.text || "");
		textos += "\n" + texto;
		const achada = extrairValidade(texto);
		if (achada) return { ...achada, texto: textos.trim() };
	}
	// Última chance: juntando o texto das duas leituras
	const achada = extrairValidade(textos);
	return achada ? { ...achada, texto: textos.trim() } : null;
}
