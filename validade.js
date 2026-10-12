/* =========================================================
   Leitura da data de validade (OCR no aparelho)
   ---------------------------------------------------------
   - A imagem (recorte da câmera ou foto) é lida pelo Tesseract.js,
     que roda no próprio navegador: nada é enviado a servidores.
     Na primeira vez, o navegador baixa o leitor (~3 MB) do jsDelivr.
   - Datas impressas em pontinhos (jato de tinta matricial) são
     difíceis: cada imagem é lida de várias formas (escalas e
     tratamentos que "unem" os pontos) e as datas são votadas.
   - O app mostra as datas encontradas para a pessoa confirmar.
   ========================================================= */
import { carregarScript } from "./nuvem/comum.js";
import { criarFoco } from "./foco.js";

const URL_TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

/* =========================================================
   Interpretação do texto
   ========================================================= */
const MESES = {
	JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6,
	JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12
};
// Letras que o OCR costuma confundir com números
// (o "7" da impressão de pontinhos costuma sair como "T")
const PARA_DIGITO = { O: "0", Q: "0", D: "0", I: "1", L: "1", "|": "1", T: "7", Z: "2", S: "5", B: "8", G: "6" };
const D = "[0-9OQDILTZSBG|]"; // "dígito" tolerante a erros de OCR
const digitos = t => t.replace(/[OQDILTZSBG|]/g, c => PARA_DIGITO[c]);

// Inclui leituras comuns com erro de OCR: "VENC" → "UENC"/"ENC"/"VENG"; "FABR" → "FRER"/"FABER"
const PALAVRAS_VALIDADE = /(VAL|VALID|VALIDADE|VENC|VENCIMENTO|VCTO|VTO|EXP|EXPIRA|BB|BEST|CONSUMIR|USE ATE|V\s?[:.]|[UVL]?I?EN[CG])\W{0,4}$/;
const PALAVRAS_FABRICACAO = /(FAB|FABR|FABRICACAO|FABRICADO|PROD|PRODUCAO|EMB|EMBALADO|F\s?[:.]|L\s?[:.]|LOTE|F[A-Z]{2,4}R)\W{0,4}$/;

// Letras que o OCR troca entre si em letras de pontinhos (custo menor na comparação)
const LETRAS_PARECIDAS = ["AR", "MH", "MN", "O0", "UV", "EF", "B8", "S5", "I1", "L1", "Z2", "G6", "T7", "DO", "CG", "PR", "EB"];
const parecidas = (a, b) => LETRAS_PARECIDAS.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));

/** Distância de edição tolerante a letras parecidas. */
function distanciaOCR(a, b) {
	const m = a.length, n = b.length;
	const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) d[i][0] = i * 1.5;
	for (let j = 1; j <= n; j++) d[0][j] = j * 1.5;
	for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
		// Trocar letras parecidas custa 0,5; qualquer outro erro custa 1,5 (passa do limite de 1)
		const troca = a[i - 1] === b[j - 1] ? 0 : parecidas(a[i - 1], b[j - 1]) ? 0.5 : 1.5;
		d[i][j] = Math.min(d[i - 1][j] + 1.5, d[i][j - 1] + 1.5, d[i - 1][j - 1] + troca);
	}
	return d[m][n];
}

/** "MRR" → 3 (MAR), "HAR" → 3, "SEI" → 9… null se não parecer claramente um mês. */
function mesAproximado(token) {
	const t = String(token || "").toUpperCase();
	if (t.length < 3 || t.length > 4 || (t.match(/[A-Z]/g) || []).length < 2) return null;
	let melhor = null, segunda = Infinity;
	for (const [nome, mes] of Object.entries(MESES)) {
		const dist = distanciaOCR(t, nome);
		if (!melhor || dist < melhor.dist) {
			if (melhor && melhor.mes !== mes) segunda = Math.min(segunda, melhor.dist);
			melhor = { dist, mes };
		} else if (mes !== melhor.mes) segunda = Math.min(segunda, dist);
	}
	return melhor && melhor.dist <= 1 && segunda - melhor.dist >= 0.5 ? melhor.mes : null;
}

const doisDigitos = n => String(n).padStart(2, "0");
const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

function dataValida(ano, mes, dia) {
	if (!(ano >= 2000 && ano <= 2099 && mes >= 1 && mes <= 12 && dia >= 1)) return null;
	if (dia > ultimoDiaDoMes(ano, mes)) return null;
	return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

const anoCompleto = a => (a.length === 2 ? 2000 + Number(a) : Number(a));

// Trocas comuns do leitor em impressão matricial (ordem = mais provável primeiro)
const PARECIDOS = { 8: "0639", 6: "085", 9: "08", 3: "80", 5: "63", 0: "86", 7: "1", 4: "1", 1: "7" };

/** Número de 1–2 dígitos fora de 1..max → tenta trocar UM dígito parecido. null se não der. */
function repararNumero(texto, max) {
	const valido = t => { const n = Number(t); return n >= 1 && n <= max; };
	if (valido(texto)) return Number(texto);
	for (let i = 0; i < texto.length; i++) {
		for (const alt of PARECIDOS[texto[i]] || "") {
			const t = texto.slice(0, i) + alt + texto.slice(i + 1);
			if (valido(t)) return Number(t);
		}
	}
	return null;
}

/**
 * Todas as datas plausíveis num texto lido por OCR (em ordem de aparição).
 * @param {{ soDigitos?: boolean }} [opcoes] soDigitos: o texto veio de uma leitura que só reconhece números
 * @returns {{ data: string, trecho: string, reparada: boolean, extenso: boolean, validade: boolean, fabricacao: boolean }[]}
 */
export function extrairCandidatas(texto, hoje = new Date(), { soDigitos = false } = {}) {
	const original = String(texto || "")
		.normalize("NFD").replace(/[̀-ͯ]/g, "")
		.toUpperCase()
		.replace(/\r?\n|\r|\t/g, " ¦ "); // quebra de linha separa datas (uma data não atravessa linhas)
	let resto = original;
	const candidatas = [];

	const registrar = (inicio, trecho, data, reparada = false, extenso = false) => {
		if (!data) return;
		const antes = original.slice(Math.max(0, inicio - 16), inicio).replace(/¦/g, " ");
		// "FABRICAÇÃO/VALIDADE:" antes das duas datas não diz qual é qual
		const ambas = /(FAB|F[A-Z]{3,})\w*\W{0,3}VAL/.test(antes) || /\/ ?VAL/.test(antes);
		candidatas.push({
			inicio,
			data,
			trecho: trecho.replace(/\s*¦\s*/g, " ").trim(),
			reparada,
			extenso,
			validade: !ambas && PALAVRAS_VALIDADE.test(antes),
			fabricacao: !ambas && PALAVRAS_FABRICACAO.test(antes)
		});
	};
	const apagar = (inicio, fim) => { resto = resto.slice(0, inicio) + " ".repeat(fim - inicio) + resto.slice(fim); };

	// 1) Dia/mês/ano: 15/03/2027, 15.03.27, 15-03-2027, 15 03 27
	//    Dia ou mês impossível (ex.: "88" do zero cortado Ø) → tenta trocar um dígito parecido
	const reDMA = new RegExp(`(?<![0-9A-Z])(${D}{1,2})[ ]?[/.\\- ][ ]?(${D}{1,2})[ ]?[/.\\- ][ ]?((?:2${D})?${D}{2})(?![0-9])`, "g");
	for (const m of original.matchAll(reDMA)) {
		const dia = Number(digitos(m[1])), mes = Number(digitos(m[2])), ano = anoCompleto(digitos(m[3]));
		let data = dataValida(ano, mes, dia), reparada = false;
		if (!data) {
			const d2 = repararNumero(digitos(m[1]), 31), m2 = repararNumero(digitos(m[2]), 12);
			data = d2 !== null && m2 !== null ? dataValida(ano, m2, d2) : null;
			reparada = !!data;
		}
		data ||= dataValida(ano, dia, mes); // aceita mês/dia (formato americano) se dia/mês for impossível
		if (data) { registrar(m.index, m[0], data, reparada); apagar(m.index, m.index + m[0].length); }
	}

	// 2) Dia + mês por extenso + ano: 15 MAR 2027, 15/MAR/27, MAR/2027, MAR 27
	const reMes = new RegExp(`(?<![A-Z])(?:(${D}{1,2})[ ]?[/.\\- ]?[ ]?)?(${Object.keys(MESES).join("|")})[A-Z]*\\.?[ ]?[/.\\- ]?[ ]?((?:2${D})?${D}{2})(?![0-9])`, "g");
	for (const m of resto.matchAll(reMes)) {
		const mes = MESES[m[2]], ano = anoCompleto(digitos(m[3]));
		const dia = m[1] ? Number(digitos(m[1])) : ultimoDiaDoMes(ano, mes);
		const data = dataValida(ano, mes, dia);
		if (data) { registrar(m.index, m[0], data, false, true); apagar(m.index, m.index + m[0].length); }
	}

	// 2b) Mês por extenso lido com erro ("MRR/27", "HAR-2T" = MAR/27): só com separador antes do ano
	const reMesAprox = new RegExp(`(?<![A-Z0-9])(?:(${D}{1,2})[ ]?[/.\\- ][ ]?)?([A-Z0-9]{3,4})[ ]?[/.\\- ][ ]?((?:2${D})?${D}{2})(?![0-9])`, "g");
	for (const m of resto.matchAll(reMesAprox)) {
		const mes = mesAproximado(m[2]);
		if (!mes) continue;
		const ano = anoCompleto(digitos(m[3]));
		const dia = m[1] ? Number(digitos(m[1])) : ultimoDiaDoMes(ano, mes);
		const data = dataValida(ano, mes, dia);
		if (data) { registrar(m.index, m[0], data, true, true); apagar(m.index, m.index + m[0].length); }
	}

	// 3) Mês/ano: 03/2027, 03/27 (validade = último dia do mês)
	const reMA = new RegExp(`(?<![0-9A-Z/.\\-])(${D}{1,2})[ ]?[/.\\-][ ]?((?:2${D})?${D}{2})(?![0-9/.\\-])`, "g");
	for (const m of resto.matchAll(reMA)) {
		// Leitura só de números: mês de 1 dígito costuma ser lixo de um mês por extenso ("MAR/27" → "1/27")
		if (soDigitos && digitos(m[1]).length < 2) continue;
		const mes = Number(digitos(m[1])), ano = anoCompleto(digitos(m[2]));
		if (mes >= 1 && mes <= 12) registrar(m.index, m[0], dataValida(ano, mes, ultimoDiaDoMes(ano, mes)));
	}

	// Descarta datas absurdas (mais de 5 anos atrás ou 15 anos à frente)
	const minimo = new Date(hoje); minimo.setFullYear(minimo.getFullYear() - 5);
	const maximo = new Date(hoje); maximo.setFullYear(maximo.getFullYear() + 15);
	return candidatas
		.filter(c => { const d = new Date(`${c.data}T12:00:00`); return d >= minimo && d <= maximo; })
		.sort((a, b) => a.inicio - b.inicio)
		.map(({ inicio, ...c }) => c);
}

/**
 * Escolhe a validade num texto: a data marcada como validade, senão a mais
 * distante (a fabricação sempre vem antes).
 * @returns {{ data: string, trecho: string } | null}
 */
export function extrairValidade(texto, hoje = new Date()) {
	const plausiveis = extrairCandidatas(texto, hoje);
	if (!plausiveis.length) return null;
	const maisTarde = lista => lista.reduce((a, b) => (b.data > a.data ? b : a));
	const marcadas = plausiveis.filter(c => c.validade);
	const semFabricacao = plausiveis.filter(c => !c.fabricacao);
	const escolhida = maisTarde(marcadas.length ? marcadas : (semFabricacao.length ? semFabricacao : plausiveis));
	return { data: escolhida.data, trecho: escolhida.trecho };
}

/* =========================================================
   Tratamento da imagem
   ========================================================= */
function paraCinza(fonte, lado) {
	const largura0 = fonte.naturalWidth || fonte.videoWidth || fonte.width;
	const altura0 = fonte.naturalHeight || fonte.videoHeight || fonte.height;
	const escala = lado / Math.max(largura0, altura0, 1);
	const W = Math.max(1, Math.round(largura0 * escala)), H = Math.max(1, Math.round(altura0 * escala));
	const canvas = document.createElement("canvas");
	canvas.width = W; canvas.height = H;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.drawImage(fonte, 0, 0, W, H);
	const dados = ctx.getImageData(0, 0, W, H).data;
	const g = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) g[i] = (dados[i * 4] * 299 + dados[i * 4 + 1] * 587 + dados[i * 4 + 2] * 114) / 1000;
	return { g, W, H };
}

function desenhar({ g, W, H }) {
	const canvas = document.createElement("canvas");
	canvas.width = W; canvas.height = H;
	const ctx = canvas.getContext("2d");
	const img = ctx.createImageData(W, H);
	for (let i = 0; i < W * H; i++) {
		const v = g[i] < 0 ? 0 : g[i] > 255 ? 255 : g[i];
		img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
		img.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

/** Média em caixa (separável, O(n)). */
function borrar(g, W, H, r) {
	if (r < 1) return g;
	const t = new Float32Array(W * H), o = new Float32Array(W * H), n = 2 * r + 1;
	for (let y = 0; y < H; y++) {
		let s = 0;
		for (let x = -r; x <= r; x++) s += g[y * W + Math.min(W - 1, Math.max(0, x))];
		for (let x = 0; x < W; x++) {
			t[y * W + x] = s / n;
			s += g[y * W + Math.min(W - 1, x + r + 1)] - g[y * W + Math.max(0, x - r)];
		}
	}
	for (let x = 0; x < W; x++) {
		let s = 0;
		for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x];
		for (let y = 0; y < H; y++) {
			o[y * W + x] = s / n;
			s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x];
		}
	}
	return o;
}

/** Limiar adaptativo (média local): tinta = 0, fundo = 255. Lida com luz desigual. */
function limiarLocal(g, W, H, raio, folga) {
	const m = borrar(g, W, H, raio), o = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) o[i] = g[i] < m[i] - folga ? 0 : 255;
	return o;
}

/** Limiar global de Otsu. */
function limiarOtsu(g) {
	const hist = new Float64Array(256);
	for (let i = 0; i < g.length; i++) hist[g[i] < 0 ? 0 : g[i] > 255 ? 255 : g[i] | 0]++;
	let total = 0;
	for (let i = 0; i < 256; i++) total += i * hist[i];
	let somaFundo = 0, pesoFundo = 0, melhor = -1, limiar = 128;
	for (let i = 0; i < 256; i++) {
		pesoFundo += hist[i];
		if (!pesoFundo) continue;
		const pesoFrente = g.length - pesoFundo;
		if (!pesoFrente) break;
		somaFundo += i * hist[i];
		const v = pesoFundo * pesoFrente * (somaFundo / pesoFundo - (total - somaFundo) / pesoFrente) ** 2;
		if (v > melhor) { melhor = v; limiar = i; }
	}
	const o = new Float32Array(g.length);
	for (let i = 0; i < g.length; i++) o[i] = g[i] > limiar ? 255 : 0;
	return o;
}

/** Mínimo (expande a tinta) ou máximo (encolhe a tinta) numa janela quadrada — separável. */
function filtroExtremo(g, W, H, r, usarMinimo) {
	if (r < 1) return g;
	const melhor = usarMinimo ? Math.min : Math.max;
	const t = new Float32Array(W * H), o = new Float32Array(W * H);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		let v = g[y * W + x];
		for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < W) v = melhor(v, g[y * W + xx]); }
		t[y * W + x] = v;
	}
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		let v = t[y * W + x];
		for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H) v = melhor(v, t[yy * W + x]); }
		o[y * W + x] = v;
	}
	return o;
}
const expandirTinta = (g, W, H, r) => filtroExtremo(g, W, H, r, true);
const encolherTinta = (g, W, H, r) => filtroExtremo(g, W, H, r, false);

/** "Une" os pontinhos da impressão matricial em traços contínuos. */
const unirPontos = (g, W, H, expandir, encolher) => encolherTinta(expandirTinta(g, W, H, expandir), W, H, encolher);

/**
 * Apaga manchas que não são letras: faixas escuras na borda do recorte (dedo,
 * aba da caixa, sombra), borrões grandes demais e pontinhos soltos.
 */
function limparManchas(g, W, H) {
	const o = Float32Array.from(g);
	const rotulo = new Int32Array(W * H);
	const pilha = new Int32Array(W * H);
	const minPontos = Math.max(4, Math.round(W * H * 0.000015));
	let atual = 0;
	for (let inicio = 0; inicio < W * H; inicio++) {
		if (o[inicio] !== 0 || rotulo[inicio]) continue;
		atual++;
		let topo = 0, n = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
		pilha[topo++] = inicio; rotulo[inicio] = atual;
		const membros = [];
		while (topo) {
			const i = pilha[--topo];
			membros.push(i); n++;
			const x = i % W, y = (i - x) / W;
			if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
			if (x > 0 && o[i - 1] === 0 && !rotulo[i - 1]) { rotulo[i - 1] = atual; pilha[topo++] = i - 1; }
			if (x < W - 1 && o[i + 1] === 0 && !rotulo[i + 1]) { rotulo[i + 1] = atual; pilha[topo++] = i + 1; }
			if (y > 0 && o[i - W] === 0 && !rotulo[i - W]) { rotulo[i - W] = atual; pilha[topo++] = i - W; }
			if (y < H - 1 && o[i + W] === 0 && !rotulo[i + W]) { rotulo[i + W] = atual; pilha[topo++] = i + W; }
		}
		const larg = x1 - x0 + 1, alt = y1 - y0 + 1;
		const naBorda = x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1;
		// Recorte de uma linha só: as letras podem ocupar quase toda a altura
		const grande = alt > H * 0.92 || larg > W * 0.5 || n > W * H * 0.08;
		// Na borda: faixas (dedo, aba, sombra) e linhas cortadas pela moldura
		const bordaGrande = naBorda && (alt > H * 0.3 || larg > W * 0.3);
		if (grande || bordaGrande || n < minPontos) for (const i of membros) o[i] = 255;
	}
	return o;
}

const SO_DIGITOS = { tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789/.-: " };
const LETRAS_E_DIGITOS = { tessedit_pageseg_mode: "6", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/:.- " };
const TEXTO_LIVRE = { tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" };

/**
 * Formas de ler um recorte com a data (calibradas com fotos reais de
 * impressão em pontinhos). Cada uma: tamanho, tratamento e parâmetros do OCR.
 */
// Desfoque forte "derrete" os pontinhos da impressão matricial em traços contínuos.
const derreter = (g, W, H, passos) => passos.reduce((a, r) => borrar(a, W, H, r), g);
const otsuDerretido = passos => (g, W, H) => limiarOtsu(derreter(g, W, H, passos));
const localDerretido = (passos, raio, folga) => (g, W, H) => limiarLocal(derreter(g, W, H, passos), W, H, raio, folga);

/**
 * Leituras do recorte, em vários tamanhos (o tamanho das letras na foto varia
 * com a distância). Alternadas para a votação ficar boa mesmo se parar cedo.
 */
const PALPITES_ALTURA = [0.2, 0.32, 0.5, 0.15, 0.27, 0.12, 0.65]; // 0,5+: recorte de uma linha só

const LEITURAS_RECORTE = [
	{ alvo: 70, tratar: otsuDerretido([3, 3]), ocr: SO_DIGITOS },
	{ alvo: 60, tratar: localDerretido([4, 4], 70, 3), ocr: LETRAS_E_DIGITOS }, // mês por extenso (MAR/27)
	{ alvo: 65, tratar: localDerretido([4, 4], 70, 3), ocr: SO_DIGITOS },
	{ alvo: 65, tratar: otsuDerretido([3, 3]), ocr: SO_DIGITOS },
	{ alvo: 60, tratar: (g, W, H) => limiarLocal(g, W, H, 30, 12), ocr: LETRAS_E_DIGITOS },
	{ alvo: 70, tratar: localDerretido([4, 4], 70, 3), ocr: SO_DIGITOS },
	{ alvo: 70, tratar: otsuDerretido([3, 2]), ocr: SO_DIGITOS },
	{ alvo: 65, tratar: localDerretido([3, 3], 60, 4), ocr: SO_DIGITOS },
	{ alvo: 75, tratar: otsuDerretido([3, 3]), ocr: SO_DIGITOS },
	{ alvo: 70, tratar: localDerretido([3, 3], 60, 4), ocr: SO_DIGITOS },
	{ alvo: 65, tratar: otsuDerretido([3, 2]), ocr: SO_DIGITOS },
	{ alvo: 68, tratar: otsuDerretido([3, 3]), ocr: SO_DIGITOS },
	{ alvo: 75, tratar: localDerretido([4, 4], 70, 3), ocr: LETRAS_E_DIGITOS },
	{ lado: 1200, tratar: (g, W, H) => limiarLocal(g, W, H, 30, 12), ocr: TEXTO_LIVRE } // pega datas com mês por extenso (MAR, OUT…)
].map(l => ({ ...l, tratar: (g, W, H) => limparManchas(l.tratar(g, W, H), W, H) }));

/** Para uma foto inteira (sem recorte): menos variações, imagem maior. */
const LEITURAS_FOTO = [
	{ lado: 1800, tratar: (g, W, H) => limiarLocal(g, W, H, 30, 12), ocr: TEXTO_LIVRE },
	{ lado: 1600, tratar: (g, W, H) => unirPontos(limiarLocal(g, W, H, 26, 10), W, H, 2, 1), ocr: SO_DIGITOS },
	{ lado: 2000, tratar: (g, W, H) => expandirTinta(limiarOtsu(borrar(g, W, H, 1)), W, H, 1), ocr: SO_DIGITOS }
];

/* =========================================================
   OCR
   ========================================================= */
let trabalhador = null;
let preparando = null;
let avisoProgresso = null;

async function obterTrabalhador() {
	if (trabalhador) return trabalhador;
	if (!preparando) {
		preparando = (async () => {
			await carregarScript(URL_TESSERACT, () => !!window.Tesseract?.createWorker);
			const w = await window.Tesseract.createWorker("eng", 1, {
				logger: m => { try { avisoProgresso?.(m); } catch { /* ignora */ } }
			});
			trabalhador = w;
			return w;
		})().catch(e => { preparando = null; throw e; });
	}
	return preparando;
}

/** Linhas reconhecidas, cada uma com suas palavras (texto, caixa e confiança). */
function linhasDe(data) {
	const linhas = [];
	for (const bloco of data?.blocks || []) for (const par of bloco?.paragraphs || []) for (const linha of par?.lines || []) linhas.push(Array.isArray(linha?.words) ? linha.words : []);
	return linhas;
}
const palavrasDe = data => linhasDe(data).flat();

/**
 * Peso (0,3–1) de uma data lida: a confiança média do leitor nas palavras
 * da linha que formam o trecho. Sem como saber, vale 0,6.
 */
function confiancaDe(trecho, linhas) {
	const normalizar = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, "");
	const alvo = normalizar(trecho);
	let melhor = null, cobertura = 0;
	for (const linha of linhas) {
		let soma = 0, somaConf = 0;
		for (const p of linha) {
			const t = normalizar(p?.text);
			if (t.length < 1 || !/[0-9A-Z]/.test(t) || !alvo.includes(t)) continue;
			soma += t.length;
			somaConf += t.length * Math.max(0, Math.min(100, Number(p.confidence) || 0));
		}
		if (soma > cobertura) { cobertura = soma; melhor = somaConf / soma; }
	}
	if (melhor === null || cobertura < alvo.replace(/[^0-9A-Z]/g, "").length * 0.6) return 0.6;
	return 0.3 + 0.7 * (melhor / 100); // média ponderada pelos caracteres; nunca zera o voto
}

/** Já baixou o leitor? (para avisar "só na primeira vez") */
export const leitorPronto = () => !!trabalhador;

/**
 * Lê as datas de uma imagem (recorte da câmera, foto ou canvas) e as ordena
 * por votos (quantas leituras concordam) e, no empate, pela mais distante.
 * @param {HTMLCanvasElement|HTMLImageElement|File|Blob|Array} fonte uma imagem, ou vários quadros
 *   da mesma cena (as leituras se alternam entre eles e os erros se diluem na votação)
 * @param {{ recorte?: boolean, aoProgresso?: (info: {etapa: string, atual?: number, total?: number}) => void }} [opcoes]
 * @returns {Promise<{ candidatas: { data: string, votos: number, fabricacao: boolean, validade: boolean }[], texto: string }>}
 */
export async function lerDatas(fonte, { recorte = true, aoProgresso } = {}) {
	const avisar = info => { try { aoProgresso?.(info); } catch { /* ignora */ } };
	const lista = (Array.isArray(fonte) ? fonte : [fonte]).filter(Boolean);
	if (!lista.length) throw new Error("Nenhuma imagem para ler");
	const imagens = [];
	for (const f of lista) imagens.push(f instanceof Blob ? await carregarImagem(f) : f);
	const imagem = imagens[0];
	avisar({ etapa: trabalhador ? "lendo" : "baixando" });
	avisoProgresso = m => { if (m?.status && m.status !== "recognizing text") avisar({ etapa: "baixando" }); };
	const w = await obterTrabalhador();

	const leituras = recorte ? LEITURAS_RECORTE : LEITURAS_FOTO;
	const larguraImagem = imagem.naturalWidth || imagem.videoWidth || imagem.width || 0;
	const alturaImagem = imagem.naturalHeight || imagem.videoHeight || imagem.height || 0;
	const maiorLado = Math.max(larguraImagem, alturaImagem, 1);
	const votos = new Map();
	let textos = "";
	const cache = new Map();
	// Altura das letras (px da imagem original), medida pelas próprias leituras:
	// depois de medida, cada leitura redimensiona para o tamanho de letra em que funciona melhor
	const alturas = [];
	let alturaLetra = null;
	for (let i = 0; i < leituras.length; i++) {
		avisar({ etapa: "lendo", atual: i + 1, total: leituras.length });
		const { tratar, ocr, alvo } = leituras[i];
		let lado = leituras[i].lado;
		if (alvo) {
			// Sem medida ainda: a letra costuma ter 12–65% da altura do recorte (palpites alternados)
			const letra = alturaLetra || Math.max(8, alturaImagem * PALPITES_ALTURA[i % PALPITES_ALTURA.length]);
			lado = Math.round(Math.min(2000, Math.max(400, maiorLado * alvo / letra)) / 25) * 25;
		}
		const quadro = i % imagens.length;
		const chave = `${quadro}:${lado}`;
		if (!cache.has(chave)) {
			if (cache.size >= 2) cache.delete(cache.keys().next().value); // limita a memória (celular)
			cache.set(chave, paraCinza(imagens[quadro], lado));
		}
		const base = cache.get(chave);
		const canvas = desenhar({ g: tratar(base.g, base.W, base.H), W: base.W, H: base.H });
		await w.setParameters(ocr);
		const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
		const texto = String(data?.text || "");
		const escala = lado / maiorLado; // px da leitura por px da imagem original
		if (alvo && !alturaLetra) {
			for (const p of palavrasDe(data)) {
				const h = (p.bbox?.y1 ?? 0) - (p.bbox?.y0 ?? 0);
				// Só números bem lidos e de uma linha só (caixas que juntam linhas são ignoradas)
				if (/^\d{2,}$/.test(p.text || "") && p.confidence >= 60 && h > base.H * 0.06 && h < base.H * 0.6) alturas.push(h / escala);
			}
			if (alturas.length >= 3) alturaLetra = [...alturas].sort((a, b) => a - b)[Math.floor(alturas.length / 2)];
		}
		textos += `\n${texto}`;
		// Cada leitura vota uma vez em cada data que encontrou, com peso pela confiança do leitor
		const vistas = new Set();
		const linhas = linhasDe(data);
		const soDigitos = !/[A-Z]/.test(ocr.tessedit_char_whitelist ?? "A");
		const achadas = extrairCandidatas(texto, new Date(), { soDigitos });
		// Voto de validade desta leitura: com 2+ datas, a mais distante (a fabricação vem antes);
		// com uma só, meio voto (pode ser qualquer uma das linhas)
		// (ano absurdo, como 27 lido 37, ainda é a linha da validade — a ordenação corrige o ano depois)
		const distintas = [...new Set(achadas.map(c => c.data))];
		const designada = distintas.length >= 2 ? distintas.reduce((a, b) => (b > a ? b : a)) : null;
		for (const c of achadas) {
			const atual = votos.get(c.data) || { data: c.data, votos: 0, peso: 0, pesoVal: 0, fabricacao: false, validade: false, glifos: [] };
			if (!vistas.has(c.data)) {
				// Mês por extenso reconhecido é um sinal forte; dígito consertado, um pouco mais fraco
				const peso = confiancaDe(c.trecho, linhas) * (c.reparada ? 0.8 : 1) * (c.extenso ? 1.4 : 1);
				atual.votos++;
				atual.peso += peso;
				atual.pesoVal += designada ? (c.data === designada ? peso : 0) : peso * 0.5;
				vistas.add(c.data);
				// Guarda onde cada dígito foi visto (para conferir dígitos duvidosos no fim)
				const glifos = caixasDosDigitos(c.trecho, linhas, escala, quadro);
				if (glifos && atual.glifos.length < 12) atual.glifos.push(glifos);
			}
			atual.fabricacao ||= c.fabricacao;
			atual.validade ||= c.validade;
			votos.set(c.data, atual);
		}
		// Parada antecipada: uma data com vantagem clara depois de 6 leituras
		if (i >= 5) {
			const ordem = ordenarCandidatas([...votos.values()]);
			const principal = ordem[0], rivais = ordem.filter(c => c !== principal && !c.fabricacao);
			if (principal?.peso >= 3 && rivais.every(c => principal.peso - c.peso >= 2)) break;
		}
	}
	let candidatas = ordenarCandidatas([...votos.values()]);
	try {
		candidatas = conferirDigitoDuvidoso(candidatas, imagens);
	} catch (e) {
		console.warn("[validade] conferência de dígito falhou:", e?.message || e);
	}
	return { candidatas: candidatas.map(({ glifos, ...c }) => c), texto: textos.trim(), alturaLetra };
}

/* =========================================================
   Conferência de dígitos parecidos (6/8, 5/6, 0/8, 3/8, 9/8…)
   ---------------------------------------------------------
   O leitor às vezes troca dígitos da impressão matricial com
   alta confiança. Quando a escolhida e uma rival diferem em um
   único dígito, olhamos o desenho daquele dígito na imagem:
   cada dígito tem "segmentos" (como num relógio digital) e a
   diferença entre os dois está em regiões específicas.
   ========================================================= */
// Segmentos: a topo, b direita-alto, c direita-baixo, d base, e esquerda-baixo, f esquerda-alto, g meio
const SEGMENTOS_DIGITO = { 0: "abcdef", 3: "abcdg", 5: "acdfg", 6: "acdefg", 8: "abcdefg", 9: "abcdfg" };
const REGIOES = {
	a: [0.25, 0.75, 0, 0.14], b: [0.7, 1, 0.28, 0.42], c: [0.7, 1, 0.6, 0.8], d: [0.25, 0.75, 0.86, 1],
	e: [0, 0.3, 0.6, 0.8], f: [0, 0.3, 0.2, 0.4], g: [0.25, 0.75, 0.43, 0.57]
};

/** Caixas (px da imagem original) de cada dígito do trecho, se o leitor as informou. */
function caixasDosDigitos(trecho, linhas, escala, quadro) {
	const alvo = String(trecho || "").replace(/\D/g, "");
	if (!alvo || !escala) return null;
	for (const linha of linhas) {
		const simbolos = [];
		for (const p of linha) for (const s of p?.symbols || []) if (/^\d$/.test(s?.text || "") && s.bbox) simbolos.push(s);
		const texto = simbolos.map(s => s.text).join("");
		const pos = texto.indexOf(alvo);
		if (pos < 0) continue;
		return {
			quadro,
			digitos: alvo,
			caixas: simbolos.slice(pos, pos + alvo.length).map(s => ({
				x0: s.bbox.x0 / escala, y0: s.bbox.y0 / escala, x1: s.bbox.x1 / escala, y1: s.bbox.y1 / escala
			}))
		};
	}
	return null;
}

/** Tinta (0–1) em cada segmento do dígito dentro da caixa. */
function medirSegmentos(imagem, caixa) {
	const larg0 = caixa.x1 - caixa.x0, alt0 = caixa.y1 - caixa.y0;
	if (!(larg0 > 3 && alt0 > 6)) return null;
	// Recorta com folga e normaliza a altura do dígito para ~60 px
	const folga = 0.18;
	const x0 = caixa.x0 - larg0 * folga, y0 = caixa.y0 - alt0 * folga;
	const lw = larg0 * (1 + 2 * folga), lh = alt0 * (1 + 2 * folga);
	const esc = 60 / alt0;
	const W = Math.max(8, Math.round(lw * esc)), H = Math.max(8, Math.round(lh * esc));
	const canvas = document.createElement("canvas");
	canvas.width = W; canvas.height = H;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.drawImage(imagem, x0, y0, lw, lh, 0, 0, W, H);
	const dados = ctx.getImageData(0, 0, W, H).data;
	const g = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) g[i] = (dados[i * 4] * 299 + dados[i * 4 + 1] * 587 + dados[i * 4 + 2] * 114) / 1000;
	const b = limiarOtsu(borrar(borrar(g, W, H, 2), W, H, 2)); // une os pontinhos
	// Endireita o itálico: inclinação que deixa a projeção vertical mais "nítida"
	const tinta = (x, y) => (x >= 0 && x < W && y >= 0 && y < H && b[y * W + x] === 0 ? 1 : 0);
	let melhorK = 0, melhorNitidez = -1;
	for (let k = -0.35; k <= 0.351; k += 0.05) {
		const col = new Float32Array(W);
		for (let y = 0; y < H; y++) { const desloc = Math.round(k * (y - H / 2)); for (let x = 0; x < W; x++) col[x] += tinta(x + desloc, y); }
		let nitidez = 0;
		for (let x = 0; x < W; x++) nitidez += col[x] * col[x];
		if (nitidez > melhorNitidez) { melhorNitidez = nitidez; melhorK = k; }
	}
	const reta = (x, y) => tinta(x + Math.round(melhorK * (y - H / 2)), y);
	// Limites do dígito (só a parte central do recorte, para não pegar os vizinhos)
	const cx0 = Math.round(W * folga / (1 + 2 * folga) - 4), cx1 = Math.round(W - W * folga / (1 + 2 * folga) + 4);
	let bx0 = W, bx1 = -1, by0 = H, by1 = -1;
	for (let y = 0; y < H; y++) for (let x = Math.max(0, cx0); x < Math.min(W, cx1); x++) {
		if (!reta(x, y)) continue;
		if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
	}
	const lx = bx1 - bx0 + 1, ly = by1 - by0 + 1;
	if (lx < 8 || ly < 20 || lx > ly * 1.3) return null; // não parece um dígito
	const medida = {};
	for (const [seg, [ax, bx, ay, byy]] of Object.entries(REGIOES)) {
		let n = 0, t = 0;
		const xi = bx0 + Math.floor(ax * lx), xf = bx0 + Math.ceil(bx * lx), yi = by0 + Math.floor(ay * ly), yf = by0 + Math.ceil(byy * ly);
		for (let y = yi; y < yf; y++) for (let x = xi; x < xf; x++) { t++; n += reta(x, y); }
		medida[seg] = t ? n / t : 0;
	}
	const maximo = Math.max(...Object.values(medida), 0.01);
	for (const seg in medida) medida[seg] = Math.min(1, medida[seg] / (maximo * 0.6)); // ~60% do mais cheio já conta como "presente"
	return medida;
}

/**
 * Se a escolhida e uma rival forte diferem em um único dígito "parecido",
 * confere o desenho e, se a imagem favorecer claramente a rival, troca a ordem.
 */
function conferirDigitoDuvidoso(candidatas, imagens) {
	if (candidatas.length < 2 || typeof document === "undefined") return candidatas;
	const principal = candidatas[0];
	if (!principal.glifos?.length) return candidatas;
	// Data escrita como dia-mês-ano só com dígitos (6 ou 8), na ordem em que aparece impressa
	const formaDe = (data, tamanho) => {
		const [a, m, d] = data.split("-");
		return tamanho === 6 ? d + m + a.slice(2) : tamanho === 8 ? d + m + a : null;
	};
	// Rival: data forte que difere da escolhida em UM único dígito
	let rival = null, pos = -1, tamanho = 0;
	for (const c of candidatas.slice(1)) {
		if (c.fabricacao || c.peso < principal.peso * 0.3) continue;
		for (const t of [6, 8]) {
			const fp = formaDe(principal.data, t), fr = formaDe(c.data, t);
			const d = [...fp].map((ch, i) => (ch !== fr[i] ? i : -1)).filter(i => i >= 0);
			if (d.length === 1) { rival = c; pos = d[0]; tamanho = t; break; }
		}
		if (rival) break;
	}
	if (!rival) return candidatas;
	const dP = formaDe(principal.data, tamanho)[pos], dR = formaDe(rival.data, tamanho)[pos];
	const segP = SEGMENTOS_DIGITO[dP], segR = SEGMENTOS_DIGITO[dR];
	if (!segP || !segR) return candidatas; // só pares que dá para separar com segurança
	const distintivos = Object.keys(REGIOES).filter(seg => segP.includes(seg) !== segR.includes(seg));
	if (!distintivos.length) return candidatas;
	// Mede o mesmo dígito em todas as leituras que o localizaram (das duas datas)
	let placar = 0, medidas = 0;
	for (const gl of [...principal.glifos, ...(rival.glifos || [])]) {
		if (gl.digitos.length !== tamanho || !gl.caixas[pos]) continue; // mesma forma de escrever
		const m = medirSegmentos(imagens[gl.quadro] || imagens[0], gl.caixas[pos]);
		if (!m) continue;
		medidas++;
		// > 0 favorece a principal; < 0, a rival
		for (const seg of distintivos) placar += segP.includes(seg) ? (m[seg] - 0.5) : (0.5 - m[seg]);
	}
	const media = placar / (Math.max(1, medidas) * distintivos.length);
	if (medidas < 2) return candidatas;
	if (media < -0.15) {
		// A imagem mostra claramente o dígito da rival: ela passa a ser a escolhida
		rival.conferida = true;
		return [rival, ...candidatas.filter(c => c !== rival)];
	}
	if (media > 0.15) principal.conferida = true;
	return candidatas;
}

/**
 * Escolhe a validade entre as datas lidas e ordena as demais.
 * - Agrupa por mês/ano: leituras do mesmo mês/ano quase sempre são a mesma data
 *   com um dígito do dia trocado (6/8/5), então somam força.
 * - Entre os grupos fortes, a validade é o mais distante (vem depois da fabricação),
 *   mas um ano isolado muito à frente (27 lido como 37) não ganha de um grupo mais votado.
 * - Dentro do grupo, vence o dia mais votado.
 * Datas bem anteriores à escolhida (ou marcadas com FAB) são indicadas como fabricação.
 */
export function ordenarCandidatas(lista, hoje = new Date()) {
	const candidatas = lista.map(c => ({ ...c }));
	if (!candidatas.length) return candidatas;
	for (const c of candidatas) c.peso ??= c.votos; // listas sem peso contam um por voto
	// Ano a mais de 6 anos (27 lido como 33/37): os votos vão para a data plausível de mesmo dia/mês
	const limite = dataMaisAnos(hoje, 6);
	for (const c of candidatas) {
		if (c.data <= limite || c.validade) continue;
		const destino = candidatas
			.filter(o => o.data <= limite && o.data.slice(5) === c.data.slice(5))
			.reduce((a, b) => (!a || b.peso > a.peso ? b : a), null);
		if (!destino) continue;
		destino.peso += c.peso * 0.8;
		destino.pesoVal = (destino.pesoVal ?? 0) + (c.pesoVal ?? 0) * 0.8;
		c.peso *= 0.2;
		if (c.pesoVal !== undefined) c.pesoVal *= 0.2;
	}
	const grupos = new Map();
	for (const c of candidatas) {
		const chave = c.data.slice(0, 7);
		const g = grupos.get(chave) || { chave, forca: 0, membros: [] };
		g.forca += c.peso;
		g.forcaVal = (g.forcaVal || 0) + (c.pesoVal ?? 0);
		g.membros.push(c);
		grupos.set(chave, g);
	}
	const todos = [...grupos.values()];
	// Validade a mais de 6 anos é rara (e "27" lido como "37" é comum): pesa menos
	const limiteTexto = limite.slice(0, 7);
	for (const g of todos) if (g.chave > limiteTexto) { g.forca *= 0.35; g.forcaVal *= 0.35; }
	const temVotoVal = todos.some(g => g.forcaVal > 0);
	const maxForca = Math.max(...todos.map(g => g.forca));
	// A linha da validade às vezes sai pior que a da fabricação: basta 1/3 da força do grupo mais forte
	const corte = maxForca / 3;
	let fortes = todos.filter(g => g.forca >= corte);
	// Marcadas como validade ("VAL", "VENC") têm prioridade, mesmo com menos leituras;
	// grupos só com FAB ficam por último
	const comVal = todos.filter(g => g.forca >= maxForca / 6 && g.membros.some(c => c.validade));
	if (comVal.length) fortes = comVal;
	else {
		const semFab = fortes.filter(g => !g.membros.every(c => c.fabricacao));
		if (semFab.length) fortes = semFab;
	}
	// Ano isolado muito à frente de um grupo pelo menos tão votado: provável erro de leitura
	const anoDe = g => Number(g.chave.slice(0, 4));
	const plausiveis = fortes.filter(g => !fortes.some(o => o !== g && anoDe(g) - anoDe(o) > 5 && o.forca >= g.forca));
	if (plausiveis.length) fortes = plausiveis;
	// Com votos de validade (leituras que viram as duas datas): o grupo mais votado como validade.
	// Sem eles: entre os grupos fortes, o mais distante.
	const grupo = temVotoVal
		? fortes.reduce((a, b) => (b.forcaVal > a.forcaVal || (b.forcaVal === a.forcaVal && b.chave > a.chave) ? b : a))
		: fortes.reduce((a, b) => (b.chave > a.chave || (b.chave === a.chave && b.forca > a.forca) ? b : a));
	// Dia: o mais lido dentro do grupo (anos absurdos já passaram seus votos acima)
	const principal = grupo.membros.reduce((a, b) => (b.peso > a.peso || (b.peso === a.peso && b.data > a.data) ? b : a));
	for (const c of candidatas) {
		if (c !== principal && !c.validade && c.data < principal.data && diasEntre(c.data, principal.data) > 45) c.fabricacao = true;
	}
	const porVoto = (a, b) => (b.peso - a.peso) || (b.data > a.data ? 1 : b.data < a.data ? -1 : 0);
	return [principal, ...candidatas.filter(c => c !== principal).sort((a, b) => (a.fabricacao - b.fabricacao) || porVoto(a, b))];
}

/** "aaaa-mm-dd" daqui a n anos. */
function dataMaisAnos(hoje, anos) {
	const d = new Date(hoje);
	d.setFullYear(d.getFullYear() + anos);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

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

/* =========================================================
   Câmera com moldura (recorta só a área da data)
   ========================================================= */
/**
 * @param {HTMLVideoElement} video
 * @returns {{ iniciar: () => Promise<{flash: boolean}>, parar: () => void, recortar: (mira: Element) => HTMLCanvasElement | null, alternarFlash: () => Promise<boolean> }}
 */
const CHAVE_CAMERA_VALIDADE = "cv2:cameraValidade";

export function criarCameraValidade(video) {
	let fluxo = null;
	let flashLigado = false;
	let cameraAtualId = null;
	const trilhaAtual = () => fluxo?.getVideoTracks()[0] || null;
	const listarCameras = async () => {
		try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput"); } catch { return []; }
	};
	const foco = criarFoco({
		obterTrilha: trilhaAtual,
		listarCameras,
		cameraAtual: () => cameraAtualId,
		trocarPara: async deviceId => {
			try {
				if (deviceId) localStorage.setItem(CHAVE_CAMERA_VALIDADE, deviceId);
				else localStorage.removeItem(CHAVE_CAMERA_VALIDADE);
			} catch { /* ignora */ }
			try {
				await abrir(deviceId);
			} catch (e) {
				console.warn("[validade] troca de câmera falhou, voltando à padrão:", e);
				try { localStorage.removeItem(CHAVE_CAMERA_VALIDADE); } catch { /* ignora */ }
				await abrir(null);
			}
		}
	});

	/** Abre a câmera escolhida (ou a salva, ou a traseira padrão). */
	async function iniciar() {
		let salva = null;
		try { salva = localStorage.getItem(CHAVE_CAMERA_VALIDADE); } catch { /* ignora */ }
		try {
			return await abrir(salva);
		} catch (e) {
			if (!salva || e?.name === "NotAllowedError" || e?.name === "SecurityError") throw e;
			try { localStorage.removeItem(CHAVE_CAMERA_VALIDADE); } catch { /* ignora */ }
			return abrir(null);
		}
	}

	async function abrir(deviceId) {
		const tinha = !!fluxo;
		pararFluxo();
		if (tinha) await new Promise(r => setTimeout(r, 300)); // o iPhone precisa de um tempo para liberar a câmera
		if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("Câmera indisponível neste navegador."), { name: "NotSupportedError" });
		const alvo = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } };
		const tentativas = [
			{ video: { ...alvo, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
			{ video: { ...alvo }, audio: false },
			{ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false }
		];
		let ultimoErro = null;
		for (const restricoes of tentativas) {
			try { fluxo = await navigator.mediaDevices.getUserMedia(restricoes); break; } catch (e) {
				ultimoErro = e;
				if (e?.name === "NotAllowedError" || e?.name === "SecurityError") throw e;
			}
		}
		if (!fluxo) throw ultimoErro || new Error("Não foi possível abrir a câmera.");
		video.setAttribute("playsinline", "");
		video.muted = true;
		video.srcObject = fluxo;
		await video.play().catch(() => { });
		if (!video.videoWidth) await new Promise(r => video.addEventListener("loadedmetadata", r, { once: true }));
		const trilha = fluxo.getVideoTracks()[0];
		try { cameraAtualId = trilha?.getSettings?.().deviceId || deviceId || null; } catch { cameraAtualId = deviceId || null; }
		let flash = false;
		try { flash = !!trilha?.getCapabilities?.().torch; } catch { /* ignora */ }
		// Foco contínuo, se o aparelho deixar (ou o foco manual escolhido)
		try {
			const modos = trilha?.getCapabilities?.().focusMode || [];
			if (modos.includes("continuous")) await trilha.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
		} catch { /* ignora */ }
		await foco.reaplicar();
		return { flash };
	}

	function pararFluxo() {
		try { fluxo?.getTracks().forEach(t => t.stop()); } catch { /* ignora */ }
		fluxo = null;
		flashLigado = false;
		try { video.srcObject = null; } catch { /* ignora */ }
	}

	function parar() {
		foco.reiniciar();
		pararFluxo();
	}

	async function alternarFlash() {
		const trilha = fluxo?.getVideoTracks()[0];
		if (!trilha) return false;
		flashLigado = !flashLigado;
		await trilha.applyConstraints({ advanced: [{ torch: flashLigado }] });
		return flashLigado;
	}

	/** Recorta do quadro atual da câmera exatamente a área sob a moldura. */
	function recortar(mira) {
		const vw = video.videoWidth, vh = video.videoHeight;
		if (!vw || !vh) return null;
		const rv = video.getBoundingClientRect(), rm = mira.getBoundingClientRect();
		// O vídeo é exibido com object-fit: cover — converte coordenadas da tela para o vídeo
		const escala = Math.max(rv.width / vw, rv.height / vh);
		const sobraX = (vw * escala - rv.width) / 2, sobraY = (vh * escala - rv.height) / 2;
		let x = (rm.left - rv.left + sobraX) / escala, y = (rm.top - rv.top + sobraY) / escala;
		let w = rm.width / escala, h = rm.height / escala;
		x = Math.max(0, Math.min(vw - 1, x)); y = Math.max(0, Math.min(vh - 1, y));
		w = Math.max(1, Math.min(vw - x, w)); h = Math.max(1, Math.min(vh - y, h));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(w); canvas.height = Math.round(h);
		canvas.getContext("2d").drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);
		return canvas;
	}

	return { iniciar, parar, recortar, alternarFlash, foco };
}
