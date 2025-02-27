const lista = document.getElementById("lista"),
	produtoInput = document.getElementById("produto"),
	quantidadeInput = document.getElementById("quantidade"),
	vencimentoInput = document.getElementById("vencimento"),
	codigoBarrasInput = document.getElementById("codigoBarras"),
	adicionarBtn = document.getElementById("adicionar"),
	filtroInput = document.getElementById("filtro"),
	filtroVencidosBtn = document.getElementById("filtroVencidos"),
	exportarBtn = document.getElementById("exportar"),
	importarInput = document.getElementById("importar"),
	iniciar = document.getElementById("iniciar"),
	leitor = document.getElementById("leitor"),
	botaoImportar = document.getElementById("botaoImportar"),
	modal = document.getElementById("modal"),
	modalBody = document.getElementById("modalBody"),
	confirmarBtn = document.getElementById("confirmar"),
	cancelarBtn = document.getElementById("cancelar");

let produtos = JSON.parse(localStorage.getItem("produtos")) || [];
let ocultarVencidos = false;
let ignorados = JSON.parse(localStorage.getItem("ignorados")) || [];
let produtoEditadoIndex = -1
let botaodesabilitado;

function adicionarProduto() {
	let nome = produtoInput.value.trim(),
		quantidade = quantidadeInput.value.trim(),
		vencimento = vencimentoInput.value.trim(),
		codigoBarras = codigoBarrasInput.value.trim();

	if (!nome || !quantidade || !vencimento || !codigoBarras) return alert("Preencha todos os campos!");

	if (produtoEditadoIndex === -1 && adicionarBtn.textContent !== "Atualizar") {
		if (produtos.some(p => p.codigoBarras === codigoBarras && p.nome === nome && p.vencimento === vencimento))
			return alert("Produto já adicionado com o mesmo código de barras, nome e data de vencimento!");
		produtos.push({
			nome,
			quantidade,
			vencimento,
			codigoBarras
		});
	} else {
		Object.assign(produtos[produtoEditadoIndex], {
			nome,
			quantidade,
			vencimento,
			codigoBarras
		});
		produtoEditadoIndex = -1;
		adicionarBtn.textContent = "Adicionar";
		if(botaodesabilitado) botaodesabilitado.disabled = false;
	}

	filtroVencidosBtn.textContent = "Mostrar produtos vencidos";
	ocultarVencidos = false;
	salvarProdutos();
	atualizarLista();
	filtroInput.value = '';
	produtoInput.value = quantidadeInput.value = vencimentoInput.value = codigoBarrasInput.value = "";
}

function editarProduto(index, botao) {
	let p = produtos[index];
	produtoInput.value = p.nome;
	quantidadeInput.value = p.quantidade;
	vencimentoInput.value = p.vencimento;
	codigoBarrasInput.value = p.codigoBarras;
	produtoEditadoIndex = index;
	adicionarBtn.textContent = "Atualizar";
	if(botaodesabilitado) botaodesabilitado.disabled = false;
	botaodesabilitado = botao.parentNode.children[1];
	botaodesabilitado.disabled = true;
}

function atualizarLista() {
	lista.innerHTML = "";
	let produtosProximos = [],
		produtosVencidos = [],
		produtosRestantes = [];

	const alertarValor = parseInt(document.getElementById("nAlertar").value) || 60;
	const unidade = document.getElementById("como").value;
	const fator = unidade === "meses" ? 30 : 1;
	const limiteAlerta = alertarValor * fator;

	produtos.forEach((p, index) => {
		let dias = verificarVencimento(p.vencimento);
		let tr = document.createElement("tr");
		let vencido = dias < 0;
		let proximo = dias > -1 && dias <= limiteAlerta;
		let estilo = proximo ? "font-size:1.2em;font-weight:bold;filter:drop-shadow(2px 0px 5px red)" : "";
		let fontbold = "font-size:1.2em;font-weight:bold;";

		tr.innerHTML = `
            <td class="${vencido ? "riscado" : ""}" onclick="selectTudo(this);" style="${estilo}">${p.codigoBarras}</td>
            <td class="${vencido ? "riscado" : ""}" onclick="selectTudo(this);" style="${estilo}">${p.nome}</td>
            <td class="${vencido ? "riscado" : ""}" style="${estilo}">${p.quantidade}</td>
            <td ${proximo ? 'class="back-vermelho"' : ""} class="${vencido ? "riscado" : ""}" style="${proximo ? fontbold : ''}">${formatarData(p.vencimento)}</td>
            <td>
                <button onclick="editarProduto(${index}, this)">Editar</button>
                <button onclick="removerProduto('${p.nome}','${formatarData(p.vencimento)}')">Remover</button>
                ${!vencido && ignorados.includes(p.vencimento + "+" + p.codigoBarras) ? `<button onclick="reverterAlerta('${p.vencimento + "+" + p.codigoBarras}')">Mostrar alerta ao iniciar</button>` : ""}
            </td>
        `;

		if (vencido) produtosVencidos.push(tr);
		else if (proximo) produtosProximos.push(tr);
		else produtosRestantes.push(tr);
	});

	produtosProximos.sort((a, b) => {
		let dataA = new Date(a.children[3].textContent.split('/').reverse().join('-'));
		let dataB = new Date(b.children[3].textContent.split('/').reverse().join('-'));
		return dataA - dataB;
	});

	produtosProximos.forEach(tr => (lista.appendChild(tr), piscar(tr.children[3])));
	produtosRestantes.concat(produtosVencidos).forEach(tr => lista.appendChild(tr));
}

function salvarProdutos() {
	localStorage.setItem("produtos", JSON.stringify(produtos));
}

function salvarIgnorados() {
	localStorage.setItem("ignorados", JSON.stringify(ignorados));
}

function formatarData(data) {
	return data.split("-").reverse().join("/");
}

function verificarVencimento(data) {
	const hoje = new Date(),
		validade = new Date(data);
	const diffDias = (validade - hoje) / (1000 * 60 * 60 * 24);
	return diffDias;
}

function selectTudo(elemento) {
	const range = document.createRange()
	const selection = window.getSelection()
	range.selectNodeContents(elemento)
	selection.removeAllRanges()
	selection.addRange(range)
}

function filtrarProdutos() {
	filtroVencidosBtn.textContent = "Mostrar produtos vencidos";
	ocultarVencidos = false;
	let filtro = filtroInput.value.toLowerCase();
	document.querySelectorAll("#lista tr").forEach(row => {
		let [codigo, nome] = row.children;
		row.style.display = nome.textContent.toLowerCase().includes(filtro) || codigo.textContent.includes(filtro) ? "" : "none";
	});
}

function removerProduto(nome, vencimento) {
	let linhas = document.querySelectorAll("#lista tr");

	function removerItem() {
		for (let linha of linhas) {
			let colunas = linha.querySelectorAll("td");
			if (!colunas.length) continue;

			let nomeProduto = colunas[1].textContent.trim();
			let vencimentoProduto = colunas[3].textContent.trim();

			if (nomeProduto === nome && formatarData(vencimentoProduto) === formatarData(vencimento)) {
				linha.remove();
			}
		}

		produtos = produtos.filter(prod => !(prod.nome === nome && formatarData(prod.vencimento) === formatarData(vencimento)));
		localStorage.setItem("produtos", JSON.stringify(produtos));
		modal.style.display = "none";
	}
	modalBody.innerHTML = `Tem certeza que deseja remover o item<br><b>${nome}</b><br>com vencimento em <b>${vencimento}</b> ?`;
	confirmar.textContent = "Sim";
	cancelar.textContent = "Não";
	modal.style.display = "flex";

	confirmarBtn.onclick = removerItem;
	cancelarBtn.onclick = () => modal.style.display = "none";
}


function toggleVencidos() {
	if (filtroInput.value) return;
	ocultarVencidos = !ocultarVencidos;
	filtroVencidosBtn.textContent = ocultarVencidos ? "Mostrar Todos" : "Mostrar produtos vencidos";
	document.querySelectorAll("#lista tr").forEach(row => {
		let erisc = row.querySelector(".riscado");
		if (filtroVencidosBtn.textContent == "Mostrar Todos") {
			row.style.display = erisc ? "" : "none";
		} else {
			row.style.display = "";
		}
	});
}

function exportarLista() {
	let configAlerta = JSON.parse(localStorage.getItem("configAlerta")) || {
		alertarValor: 60,
		unidade: "meses"
	};
	let dados = {
		produtos,
		configAlerta
	};
	let blob = new Blob([JSON.stringify(dados, null, 2)], {
		type: "application/json"
	});
	let a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = "estoque.json";
	a.click();
}

function carregarConfiguracaoAlerta() {
	let config = JSON.parse(localStorage.getItem("configAlerta")) || {
		alertarValor: 60,
		unidade: "meses"
	};
	document.getElementById("nAlertar").value = config.alertarValor;
	document.getElementById("como").value = config.unidade;
}
carregarConfiguracaoAlerta();


function importarLista(event) {
	let file = event.target.files[0];
	if (!file) return;
	let reader = new FileReader();
	reader.onload = () => {
		let dados = JSON.parse(reader.result);
		produtos = dados.produtos || [];
		if (dados.configAlerta) localStorage.setItem("configAlerta", JSON.stringify(dados.configAlerta));
		salvarProdutos();
		atualizarLista();
		carregarConfiguracaoAlerta();
		window.location.reload();
	};
	reader.readAsText(file);
}


function salvarConfiguracaoAlerta() {
	const alertarValor = document.getElementById("nAlertar").value;
	const unidade = document.getElementById("como").value;
	localStorage.setItem("configAlerta", JSON.stringify({
		alertarValor,
		unidade
	}));
	atualizarLista(); // Atualiza a tabela após modificar a configuração
}

document.getElementById("nAlertar").addEventListener("input", salvarConfiguracaoAlerta);
document.getElementById("como").addEventListener("change", salvarConfiguracaoAlerta);

function alertarProdutosProximos() {
	const alertarValor = parseInt(document.getElementById("nAlertar").value) || 60;
	const unidade = document.getElementById("como").value;
	const fator = unidade === "meses" ? 30 : 1;
	const limiteAlerta = alertarValor * fator;

	let proximos = produtos.filter(p => {
		let dias = verificarVencimento(p.vencimento);
		return dias > -1 && dias <= limiteAlerta && !ignorados.includes(p.vencimento + "+" + p.codigoBarras);
	});

	function mostrarAlerta(index) {
		if (index >= proximos.length) return;

		let p = proximos[index];
		confirmar.textContent = "Sim";
		cancelar.textContent = "Não";
		modalBody.innerHTML = `O produto <b>${p.nome}</b><br>está próximo do vencimento! <b>${formatarData(p.vencimento)}</b><br>Deseja continuar sendo alertado?`;
		modal.style.display = "flex";

		confirmarBtn.onclick = () => {
			modal.style.display = "none";
			mostrarAlerta(index + 1);
		};

		cancelarBtn.onclick = () => {
			ignorados.push(p.vencimento + "+" + p.codigoBarras);
			salvarIgnorados();
			modal.style.display = "none";
			atualizarLista();
			mostrarAlerta(index + 1);
		};
	}

	if (proximos.length > 0) mostrarAlerta(0);
}

function reverterAlerta(cod) {
	ignorados = ignorados.filter(c => c !== cod);
	salvarIgnorados();
	atualizarLista();
}

function piscar(elemento, intervalo = 300) {
	setInterval(() => {
		elemento.style.visibility = elemento.style.visibility === "hidden" ? "visible" : "hidden";
	}, intervalo);
}

adicionarBtn.addEventListener("click", adicionarProduto);
filtroInput.addEventListener("input", filtrarProdutos);
filtroVencidosBtn.addEventListener("click", toggleVencidos);
exportarBtn.addEventListener("click", exportarLista);
botaoImportar.addEventListener("click", () => importarInput.click());
importarInput.addEventListener("change", importarLista);

atualizarLista();
alertarProdutosProximos();

const ajustarAlturaTabela = () => {
	const alturaTela = window.innerHeight;
	const h1 = document.querySelector('h1');
	const controls = document.querySelectorAll('.controls');

	let alturaAcimaDaTabela = 0;

	if (h1) {
		alturaAcimaDaTabela += h1.offsetHeight;
	}

	controls.forEach(control => {
		alturaAcimaDaTabela += control.offsetHeight;
	});

	const alturaTabela = alturaTela - alturaAcimaDaTabela - 80;
	document.querySelector('.table-container').style.maxHeight = `${alturaTabela}px`;
};
	
window.addEventListener('load', ajustarAlturaTabela);
window.addEventListener('resize', ajustarAlturaTabela);

iniciar.addEventListener("click", function(){
	leitor.style.display = "inline";
	Quagga.init({
            inputStream: {
                type: "LiveStream",
                constraints: { facingMode: "environment" },
                target: document.getElementById("leitor")
            },
            decoder: { readers: ["ean_reader", "code_128_reader"] }
        }, (err) => {
            if (err) {
                alert("Erro ao iniciar Quagga:", err);
				leitor.style.display = "none";
                return
            }
            Quagga.start()
        })

        Quagga.onDetected((res) => {
            let codigo = res.codeResult.code
            codigoBarras.value = codigo;
            Quagga.stop()
			leitor.style.display = "none";
})
});