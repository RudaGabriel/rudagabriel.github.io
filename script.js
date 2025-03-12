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
	sincronizar = document.getElementById("sincronizar"),
	pararleitor = document.getElementById("pararleitor"),
	containerleitor = document.getElementById("containerleitor"),
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
		let produtoExistente = produtos.find(p => p.codigoBarras === codigoBarras && p.nome === nome && formatarData(p.vencimento) === formatarData(vencimento));
		if (produtoExistente) {
			modalBody.innerHTML = "Produto já adicionado<br>Com o mesmo código de barras, nome e data de vencimento!<br>Deseja atualizar esse produto?";
			confirmar.textContent = "Sim";
			cancelar.removeAttribute("style");
			cancelar.textContent = "Não";
			modal.style.display = "flex";
			
			confirmar.onclick = () => {
				Object.assign(produtoExistente, { nome, quantidade, vencimento, codigoBarras });
				modal.style.display = "none";
				salvarProdutos();
				atualizarLista();
				produtoInput.value = quantidadeInput.value = vencimentoInput.value = codigoBarrasInput.value = "";
			};
			cancelar.onclick = () => modal.style.display = "none";
			return;
		}
		produtos.push({ nome, quantidade, vencimento, codigoBarras });
	} else {
		Object.assign(produtos[produtoEditadoIndex], { nome, quantidade, vencimento, codigoBarras });
		produtoEditadoIndex = -1;
		adicionarBtn.textContent = "Adicionar";
		if (botaodesabilitado) botaodesabilitado.disabled = false;
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
	if (botaodesabilitado) botaodesabilitado.disabled = false;
	botaodesabilitado = botao.parentNode.children[1];
	botaodesabilitado.disabled = true;
}

function atualizarLista() {
	produtos = JSON.parse(localStorage.getItem("produtos")) || [];
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
	let filtro = filtroInput.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
	document.querySelectorAll("#lista tr").forEach(row => {
		let [codigo, nome] = row.children;
		let nomeNormalizado = nome.textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
		row.style.display = nomeNormalizado.includes(filtro) || codigo.textContent.includes(filtro) ? "" : "none";
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
	cancelar.removeAttribute("style");
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

function carregarConfiguracaoAlerta() {
	let config = JSON.parse(localStorage.getItem("configAlerta")) || {
		alertarValor: 60,
		unidade: "meses"
	};
	document.getElementById("nAlertar").value = config.alertarValor;
	document.getElementById("como").value = config.unidade;
}
carregarConfiguracaoAlerta();

function exportarLista() {
	let configAlerta = JSON.parse(localStorage.getItem("configAlerta")) || { alertarValor: 60, unidade: "meses" };
	let firebaseConfig = {
		chavefire: localStorage.getItem("chave-fire") || "",
		dominiofire: localStorage.getItem("dominio-fire") || "",
		projetofire: localStorage.getItem("projeto-fire") || "",
		bucketfire: localStorage.getItem("bucket-fire") || "",
		idfire: localStorage.getItem("id-fire") || "",
		appidfire: localStorage.getItem("appid-fire") || ""
	};
	let dados = { produtos, configAlerta, firebaseConfig };
	let blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
	let a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = "estoque.json";
	a.click();
}

function importarLista(event) {
	let file = event.target.files[0];
	if (!file) return;
	let reader = new FileReader();
	reader.onload = () => {
		try {
			let dados = JSON.parse(reader.result);
			if (!dados || typeof dados !== "object") throw new Error("Arquivo inválido.");

			if (Array.isArray(dados.produtos)) {
				localStorage.setItem("produtos", JSON.stringify(dados.produtos));
			} else {
				console.warn("⚠️ Dados de produtos inválidos ou ausentes.");
			}

			if (dados.configAlerta && typeof dados.configAlerta === "object") {
				localStorage.setItem("configAlerta", JSON.stringify(dados.configAlerta));
			}

			if (dados.firebaseConfig && typeof dados.firebaseConfig === "object") {
				const mapeamentoFirebase = {
					chavefire: "chave-fire",
					dominiofire: "dominio-fire",
					projetofire: "projeto-fire",
					bucketfire: "bucket-fire",
					idfire: "id-fire",
					appidfire: "appid-fire"
				};
				Object.entries(dados.firebaseConfig).forEach(([key, value]) => {
					if (mapeamentoFirebase[key] && typeof value === "string") {
						localStorage.setItem(mapeamentoFirebase[key], value);
					}
				});
			}

			atualizarLista();
			carregarConfiguracaoAlerta();
			setTimeout(() => {
				if (dados.firebaseConfig) window.location.reload();
			}, 200);
		} catch (error) {
			console.error("❌ Erro ao importar lista:", error);
			alert("Erro ao importar o arquivo. Verifique se o formato está correto.");
		}
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
		cancelar.removeAttribute("style");
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

pararleitor.addEventListener("click", function() {
	Quagga.stop()
	containerleitor.style.display = "none";
});

iniciar.addEventListener("click", function() {
	Quagga.init({
		inputStream: {
			type: "LiveStream",
			constraints: {
				facingMode: "environment"
			},
			target: document.getElementById("leitor")
		},
		decoder: {
			readers: ["ean_reader", "code_128_reader"]
		}
	}, (err) => {
		if (err) {
			confirmar.textContent = "OK";
			cancelar.style.display = "none";
			modalBody.innerHTML = err;
			modal.style.display = "flex";
			containerleitor.style.display = "none";
			confirmar.onclick = () => modal.style.display = "none";
			return
		}
		Quagga.start()
		containerleitor.style.display = "flex";
	})

	Quagga.onDetected((res) => {
		let codigo = res.codeResult.code
		codigoBarras.value = codigo;
		Quagga.stop()
		containerleitor.style.display = "none";
	})
});

ConfirmarDadosFire.addEventListener("click", () => {
	// Coleta os valores dos campos
	const chaveValue = SUA_CHAVE?.value;
	const dominioValue = SEU_DOMINIO?.value;
	const projetoValue = SEU_PROJETO?.value;
	const bucketValue = SEU_BUCKET?.value;
	const idValue = SEU_ID?.value;
	const appIdValue = SUA_APP_ID?.value;

	// Verifica se todos os campos estão preenchidos
	const allFilled = chaveValue && dominioValue && projetoValue && bucketValue && idValue && appIdValue;

	if (!chaveValue && !dominioValue && !projetoValue && !bucketValue && !idValue && !appIdValue) {
		// Se nenhum campo tiver valor, oculta a div
		dadosfirediv.style.display = "none";
	} else if (!allFilled) {
		// Caso algum campo esteja vazio, alerta o usuário
		confirmar.textContent = "OK";
		cancelar.style.display = "none";
		modalBody.innerHTML = "Todos os campos devem estar preenchidos!";
		modal.style.display = "flex";
		confirmar.onclick = () => modal.style.display = "none";
	} else {
		// Salva os dados no localStorage
		localStorage.setItem("chave-fire", chaveValue || "");
		localStorage.setItem("dominio-fire", dominioValue || "");
		localStorage.setItem("projeto-fire", projetoValue || "");
		localStorage.setItem("bucket-fire", bucketValue || "");
		localStorage.setItem("id-fire", idValue || "");
		localStorage.setItem("appid-fire", appIdValue || "");
		dadosfirediv.style.display = "none";
		confirmar.textContent = "OK";
		cancelar.style.display = "none";
		modalBody.innerHTML = "Verificando se as informações fornecidas estão corretas!<br>Os dados deverão ser sincronizados após a página recarregar!<br>Se nenhum dado aparecer, as informações fornecidas estão incorretas! verifique com seu suporte.<br>Recarregue a página se for necessário";
		modal.style.display = "flex";
		confirmar.onclick = () => modal.style.display = "none";
	}
});

sincronizar.addEventListener("click", () => {
	const firebaseConfig = {
		apiKey: localStorage.getItem("chave-fire") || "",
		authDomain: localStorage.getItem("dominio-fire") || "",
		projectId: localStorage.getItem("projeto-fire") || "",
		storageBucket: localStorage.getItem("bucket-fire") || "",
		messagingSenderId: localStorage.getItem("id-fire") || "",
		appId: localStorage.getItem("appid-fire") || ""
	};
	if (Object.values(firebaseConfig).every(valor => valor === "")) {
		// Exibe a div de dados quando todos os valores estão vazios
		dadosfirediv.style.display = "flex";
	} else {
		// Verifica se todos os valores estão preenchidos no localStorage
		const chaveValue = localStorage.getItem("chave-fire");
		const dominioValue = localStorage.getItem("dominio-fire");
		const projetoValue = localStorage.getItem("projeto-fire");
		const bucketValue = localStorage.getItem("bucket-fire");
		const idValue = localStorage.getItem("id-fire");
		const appIdValue = localStorage.getItem("appid-fire");

		// Se todos os valores estiverem preenchidos, mostra o modal
		if (chaveValue && dominioValue && projetoValue && bucketValue && idValue && appIdValue) {
			confirmar.textContent = "Sim";
			cancelar.removeAttribute("style");
			cancelar.textContent = "Não";
			modalBody.innerHTML = "Deixar de sincronizar?";
			modal.style.display = "flex";

			confirmar.onclick = () => {
				// Limpa os valores no localStorage
				["chave-fire", "dominio-fire", "projeto-fire", "bucket-fire", "id-fire", "appid-fire"].forEach(key => localStorage.setItem(key, ""));
				window.location.reload();
			};

			cancelar.onclick = () => modal.style.display = "none";
		} else {
			// Caso nem todos os valores estejam preenchidos, exibe os inputs
			dadosfirediv.style.display = "flex";

			// Preenche os inputs com os valores do localStorage, se existirem
			if (chaveValue) document.getElementById("SUA_CHAVE").value = chaveValue;
			if (dominioValue) document.getElementById("SEU_DOMINIO").value = dominioValue;
			if (projetoValue) document.getElementById("SEU_PROJETO").value = projetoValue;
			if (bucketValue) document.getElementById("SEU_BUCKET").value = bucketValue;
			if (idValue) document.getElementById("SEU_ID").value = idValue;
			if (appIdValue) document.getElementById("SUA_APP_ID").value = appIdValue;
		}
	}
});