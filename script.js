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
	let nome = produtoInput.value.trim(),quantidade = quantidadeInput.value.trim(),vencimento = vencimentoInput.value.trim(),codigoBarras = codigoBarrasInput.value.trim();
	if (!nome || !quantidade || !vencimento || !codigoBarras) return msg("OK", "", true, "Preencha todos os campos!", () => {}, () => {});
	if (produtoEditadoIndex === -1 && adicionarBtn.textContent !== "Atualizar") {
		let produtoExistente = produtos.find(p => p.codigoBarras === codigoBarras && p.nome === nome && formatarData(p.vencimento) === formatarData(vencimento));
		if (produtoExistente) {
			if (produtoExistente.quantidade === quantidade) {
				produtoInput.value = quantidadeInput.value = vencimentoInput.value = codigoBarrasInput.value = "";
				return;
			}
			msg("Sim", "Não", false, `Produto ${nome} já adicionado<br>Com o mesmo código de barras e data de vencimento!<br>Deseja atualizar a quantidade deste produto com a nova fornecida?<br>Quantidade anterior: ${produtoExistente.quantidade} | Nova quantidade: ${quantidade}`, function () {
					Object.assign(produtoExistente, { nome, quantidade, vencimento, codigoBarras });
					modal.style.display = "none";
					salvarProdutos();
					atualizarLista();
					produtoInput.value = quantidadeInput.value = vencimentoInput.value = codigoBarrasInput.value = "";
				});
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
	let produtosProximos = [], produtosVencidos = [], produtosRestantes = [];
	const alertarValor = parseInt(document.getElementById("nAlertar").value) || 60;
	const unidade = document.getElementById("como").value;
	const fator = unidade === "meses" ? 30 : 1;
	const limiteAlerta = alertarValor * fator;
	produtos.forEach((p, index) => {
		let dias = verificarVencimento(p.vencimento);
		let tr = document.createElement("tr");
		let vencido = dias <= -1;
		let proximo = dias >= -1 && dias <= limiteAlerta;
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
	filtrarProdutos();
}
function alertarProdutosProximos() {
	const alertarValor = parseInt(document.getElementById("nAlertar").value) || 60;
	const unidade = document.getElementById("como").value;
	const fator = unidade === "meses" ? 30 : 1;
	const limiteAlerta = alertarValor * fator;
	let proximos = produtos.filter(p => {
		let dias = verificarVencimento(p.vencimento);
		return dias >= -1 && dias <= limiteAlerta && !ignorados.includes(p.vencimento + "+" + p.codigoBarras);
	});

	function mostrarAlerta(index) {
		if (index >= proximos.length) return;
		let p = proximos[index];
		msg("Sim", "Não", false, `O produto <b>${p.nome}</b><br>está próximo do vencimento! <b>${formatarData(p.vencimento)}</b><br>Deseja continuar sendo alertado?`,
			() => mostrarAlerta(index + 1),
			function () {
				ignorados.push(p.vencimento + "+" + p.codigoBarras);
				salvarIgnorados();
				atualizarLista();
				mostrarAlerta(index + 1);
			});
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
function salvarProdutos() {localStorage.setItem("produtos", JSON.stringify(produtos));}
function salvarIgnorados() {localStorage.setItem("ignorados", JSON.stringify(ignorados));}
function formatarData(data) {return data.split("-").reverse().join("/");}
function verificarVencimento(data) {
	const hoje = new Date(),validade = new Date(data);
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
["keydown", "keyup"].forEach(qual => {
	filtroInput.addEventListener(qual, () => {
		const syncenviar = localStorage.getItem("syncenviar");
		const inputValue = filtroInput.value.toLowerCase();
		if (inputValue === "autorizarsyncenviar" || inputValue === "/ase") {
			if (syncenviar !== "true") {
				localStorage.setItem("syncenviar", "true");
				msg("OK", "", true, "✅ Este usuário foi autorizado a enviar dados ao firebase!");
			} else {
				msg("OK", "", true, "✅ Este usuário já foi autorizado a enviar dados ao firebase!");
			}
			filtroInput.value = "";
			filtrarProdutos();
		} else if (inputValue === "naoautorizarsyncenviar" || inputValue === "/dse") {
			if (syncenviar === "true") {
				localStorage.setItem("syncenviar", "false");
				msg("OK", "", true, "❌ Este usuário foi desautorizado a enviar dados ao firebase!");
			} else {
				msg("OK", "", true, "❌ Este usuário já foi desautorizado a enviar dados ao firebase!");
			}
			filtroInput.value = "";
			filtrarProdutos();
		}
	});
});
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
	msg("Sim", "Não", false, `Tem certeza que deseja remover o item<br><b>${nome}</b><br>com vencimento em <b>${vencimento}</b> ?`, function () {
			let linhas = document.querySelectorAll("#lista tr");
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
			filtrarProdutos();
		});
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
		unidade: "dias"
	};
	document.getElementById("nAlertar").value = config.alertarValor;
	document.getElementById("como").value = config.unidade;
}
carregarConfiguracaoAlerta();
function exportarLista() {
	let configAlerta = JSON.parse(localStorage.getItem("configAlerta")) || { alertarValor: 60, unidade: "dias" };
	let firebaseConfig = {
		chavefire: localStorage.getItem("chave-fire") || "",
		dominiofire: localStorage.getItem("dominio-fire") || "",
		projetofire: localStorage.getItem("projeto-fire") || "",
		bucketfire: localStorage.getItem("bucket-fire") || "",
		idfire: localStorage.getItem("id-fire") || "",
		appidfire: localStorage.getItem("appid-fire") || ""
	};
	let ignorados = JSON.parse(localStorage.getItem("ignorados")) || [];
	let dados = { produtos, configAlerta, firebaseConfig, ignorados };
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
				let produtos = JSON.parse(localStorage.getItem("produtos")) || [];

				dados.produtos.forEach(novoProduto => {
					// Verifica se já existe um produto com o mesmo nome, data e código de barras
					let indexExistente = produtos.findIndex(produto =>
						produto.nome === novoProduto.nome &&
						produto.data === novoProduto.data &&
						produto.codigoBarras === novoProduto.codigoBarras
					);

					if (indexExistente !== -1) {
						// Se já existir e a única diferença for a quantidade, atualiza apenas a quantidade
						if (produtos[indexExistente].quantidade !== novoProduto.quantidade) {
							produtos[indexExistente].quantidade = novoProduto.quantidade;
						}
					} else {
						// Se não existir, adiciona o novo produto
						produtos.push(novoProduto);
					}
				});

				localStorage.setItem("produtos", JSON.stringify(produtos));
			}

			if (Array.isArray(dados.ignorados)) {
				localStorage.setItem("ignorados", JSON.stringify(dados.ignorados));
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
	atualizarLista();
}
document.getElementById("nAlertar").addEventListener("input", salvarConfiguracaoAlerta);
document.getElementById("como").addEventListener("change", salvarConfiguracaoAlerta);
let modalAtivo = false;
let filaModais = [];
function exibirProximoModal() {
	if (filaModais.length > 0) {
		const { confText, canctext, cancVis, mensagem, confOnclick, cancOnclick } = filaModais.shift();
		msg(confText, canctext, cancVis, mensagem, confOnclick, cancOnclick);
	}
}
function msg(confText, canctext, cancVis, mensagem, confOnclick = () => {}, cancOnclick = () => {}) {
	let modal = document.querySelector("#modal");
	if (modalAtivo || window.getComputedStyle(modal).display === "flex") {
		// Verifica se já existe um modal com as mesmas informações na fila
		const modalExistente = filaModais.some(modal => 
			modal.confText === confText &&
			modal.canctext === canctext &&
			modal.cancVis === cancVis &&
			modal.mensagem === mensagem &&
			modal.confOnclick.toString() === confOnclick.toString() &&
			modal.cancOnclick.toString() === cancOnclick.toString()
		);
		if (!modalExistente) {
			filaModais.push({ confText, canctext, cancVis, mensagem, confOnclick, cancOnclick });
		}
		return;
	}

	modalAtivo = true;
	let confirmar = document.querySelector("#confirmar");
	let cancelar = document.querySelector("#cancelar");
	let modalBody = document.querySelector("#modalBody");
	confirmar.textContent = confText;
	cancelar.style.display = cancVis ? "none" : "";
	cancelar.textContent = canctext;
	modalBody.innerHTML = mensagem;
	modal.style.display = "flex";

	const fecharModal = (callback) => {
		callback();
		modal.style.display = "none";
		modalAtivo = false;
		exibirProximoModal();
	};

	confirmar.onclick = () => fecharModal(confOnclick);
	cancelar.onclick = () => fecharModal(cancOnclick);
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
iniciar.addEventListener("click", function () {
	Quagga.init({
		inputStream: {
			type: "LiveStream",
			constraints: {
				facingMode: "environment"/*,
				width: { ideal: 1280 },
				height: { ideal: 720 }*/
			},
			target: document.getElementById("containerleitor")
		},
		locator: {
			patchSize: "medium",
			halfSample: true
		},
		decoder: {
			readers: ["ean_reader", "code_128_reader"]
		},
		numOfWorkers: navigator.hardwareConcurrency || 4
	}, (err) => {
		if (err) return msg("OK", "", true, err);

		containerleitor.classList.remove("displaynone");
		Quagga.start();
	});

	Quagga.onDetected((res) => {
		let codigo = res.codeResult.code;
		if (codigo) {
			codigoBarras.value = codigo;
			containerleitor.classList.add("displaynone");
			Quagga.stop();
		}
	});
});
pararleitor.addEventListener("click", function () {
	containerleitor.classList.add("displaynone");
	Quagga.stop();
});
CancelarDadosFire.addEventListener("click", () => {dadosfirediv.style.display = "none";});
ConfirmarDadosFire.addEventListener("click", () => {
	// Coleta os valores dos campos
	const chaveValue = SUA_CHAVE?.value;
	const dominioValue = SEU_DOMINIO?.value;
	const projetoValue = SEU_PROJETO?.value;
	const bucketValue = SEU_BUCKET?.value;
	const idValue = SEU_ID?.value;
	const appIdValue = SUA_APP_ID?.value;
	// Salva os dados no localStorage
	localStorage.setItem("chave-fire", chaveValue || "");
	localStorage.setItem("dominio-fire", dominioValue || "");
	localStorage.setItem("projeto-fire", projetoValue || "");
	localStorage.setItem("bucket-fire", bucketValue || "");
	localStorage.setItem("id-fire", idValue || "");
	localStorage.setItem("appid-fire", appIdValue || "");
	// Verifica se todos os campos estão preenchidos
	const allFilled = chaveValue && dominioValue && projetoValue && bucketValue && idValue && appIdValue;
	if (!allFilled) {
		// Caso algum campo esteja vazio, alerta o usuário
		msg("OK", "", true, "Todos os campos devem estar preenchidos!");
	} else {
		dadosfirediv.style.display = "none";
		msg("OK", "", true, "Verificando se as informações fornecidas estão corretas!<br>Os dados deverão ser sincronizados após a página recarregar!<br>Se nenhum dado aparecer, as informações fornecidas estão incorretas! verifique com seu suporte qualquer dúvida.<br>Clique em OK para recarregar a página",
		() => window.location.reload());
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
			msg("Sim", "Não", false, "Deixar de sincronizar?", function () {
				["chave-fire", "dominio-fire", "projeto-fire", "bucket-fire", "id-fire", "appid-fire"].forEach(key => localStorage.setItem(key, ""));
					window.location.reload();
				});
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