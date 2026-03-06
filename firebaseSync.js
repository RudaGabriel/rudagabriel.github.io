import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
const firebaseConfig = {
	apiKey: localStorage.getItem("chave-fire") || "",
	authDomain: localStorage.getItem("dominio-fire") || "",
	projectId: localStorage.getItem("projeto-fire") || "",
	storageBucket: localStorage.getItem("bucket-fire") || "",
	messagingSenderId: localStorage.getItem("id-fire") || "",
	appId: localStorage.getItem("appid-fire") || ""
};
const __ncToastMsgs = new Set();
function showCascadeAlert(msg, dur = 5200) {
	if (!msg || __ncToastMsgs.has(msg)) return;
	__ncToastMsgs.add(msg);
	if (!document.getElementById("__nc_toast_style")) {
		const st = document.createElement("style");
		st.id = "__nc_toast_style";
		st.textContent = ".__nc_toast_box{position:fixed;top:16px;left:16px;z-index:2147483647!important;display:flex;flex-direction:column;gap:10px;max-width:min(520px,92vw);pointer-events:none}.__nc_toast{pointer-events:auto;z-index:2147483647!important;background:#111;border:1px solid rgba(0,255,255,.45);box-shadow:0 0 10px rgba(0,255,255,.25),0 0 18px rgba(0,255,255,.18);color:#fff;border-radius:12px;padding:10px 32px 16px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;font-weight:600;font-size:13px;line-height:1.3;position:relative;opacity:0;transform:translateX(-18px);transition:opacity .18s ease,transform .18s ease;overflow:hidden}.__nc_toast.__on{opacity:1;transform:translateX(0)}.__nc_toast_x{position:absolute;top:8px;right:8px;width:18px;height:18px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font-weight:600;font-size:10px;cursor:pointer;padding:0;display:grid;place-items:center}.__nc_toast_x:hover{background:rgba(255,255,255,.10)}.__nc_toast a{color:#0ff;text-decoration:none}.__nc_toast a:hover{text-decoration:underline}.__nc_toast_bar{position:absolute;left:10px;right:10px;bottom:8px;height:3px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden}.__nc_toast_bar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,rgba(0,255,255,.85),rgba(0,255,255,.35));transform-origin:left;transform:scaleX(1);animation:__nc_toast_bar var(--dur) linear forwards}@keyframes __nc_toast_bar{to{transform:scaleX(0)}}";
		(document.head || document.documentElement).appendChild(st);
	}
	let box = document.querySelector(".__nc_toast_box");
	if (!box) {
		box = document.createElement("div");
		box.className = "__nc_toast_box";
		(document.body || document.documentElement).appendChild(box);
	}
	const el = document.createElement("div");
	el.className = "__nc_toast";
	const html = msg.replace(/https?:\/\/[^\s]+/g, u => `<a href="${u}" target="_blank" rel="noreferrer noopener">${u}</a>`).replace(/\n/g, "<br>");
	el.style.setProperty("--dur", dur + "ms");
	el.innerHTML = `<div>${html}</div><button class="__nc_toast_x" aria-label="Fechar">✕</button><div class="__nc_toast_bar"><i></i></div>`;
	const rm = () => {
		if (!el.isConnected) return;
		el.remove();
		__ncToastMsgs.delete(msg);
	};
	el.querySelector("button").addEventListener("click", rm);
	box.appendChild(el);
	requestAnimationFrame(() => el.classList.add("__on"));
	setTimeout(rm, dur);
}

(function () {
	const originalXHR = XMLHttpRequest.prototype.open;
	const originalXHRSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function (method, url, ...rest) {
		this._url = url;
		this._method = method;
		return originalXHR.apply(this, arguments);
	};
	XMLHttpRequest.prototype.send = function (...args) {
		this.addEventListener("load", function () {
			if (this.status === 400 && this._url.includes("firestore")) {
				console.log(this._url);
				showCascadeAlert("❌ Erro ao tentar conectar com o Firestore!<br>Verifique as informações clicando no botão sincronizar.");
			}
		});
		return originalXHRSend.apply(this, args);
	};
	const originalFetch = window.fetch;
	window.fetch = function (url, options = {}) {
		return originalFetch(url, options).then(response => {
			if (response.status === 400 && typeof url === "string" && url.includes("firestore")) {
				console.log(url);
				showCascadeAlert("❌ Erro ao tentar conectar com o Firestore!<br>Verifique as informações clicando no botão sincronizar.");
			}
			return response;
		}).catch(error => {
			console.error("Erro na requisição", error);
			return Promise.reject(error);
		});
	};
})();
let db, docRef, bloqueioExecucao = false, bloqueioSincronizacao = false;
const chavesPermitidas = ["-fire", "produtos", "configAlerta", "ignorados", "syncenviar"];

function atualizarUIComSeguranca() {
	if (typeof window.atualizarLista === "function") window.atualizarLista();
	if (typeof window.filtrarProdutos === "function") window.filtrarProdutos();
}
if (Object.values(firebaseConfig).some(valor => !valor)) {
	showCascadeAlert("⚠️ Configuração do Firebase está vazia.");
} else {
	const appfire = initializeApp(firebaseConfig);
	db = getFirestore(appfire);
	docRef = doc(db, "dados", "sync");
	showCascadeAlert("✅ Firebase inicializado com sucesso!");
	compararEPrivilegiarDados();
}
async function salvarLocalStorageOnline() {
	if (localStorage.getItem("syncenviar") !== "true") return;
	if (!db) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar.");
	let todosDados = {};
	Object.keys(localStorage).forEach(chave => {
		if (chavesPermitidas.some(term => chave.includes(term)) && !chave.includes("syncenviar")) {
			todosDados[chave] = localStorage.getItem(chave);
		}
	});
	try {
		const docSnap = await getDoc(docRef);
		const firebaseData = docSnap.exists() ? docSnap.data().dados || {} : {};
		let diferenca = {};
		Object.entries(todosDados).forEach(([chave, valor]) => {
			if (firebaseData[chave] !== valor) diferenca[chave] = valor;
		});
		if (Object.keys(diferenca).length > 0) {
			await setDoc(docRef, { dados: todosDados }, { merge: true });
			console.log("✅ Dados salvos no Firebase:", diferenca);
		}
	} catch (error) {
		showCascadeAlert(`❌ Erro ao salvar dados:<br>${error}<br>Verifique as informações clicando no botão sincronizar.`);
	}
}
async function carregarLocalStorageOnline() {
	if (!db) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar.");
	try {
		const docSnap = await getDoc(docRef);
		if (docSnap.exists()) {
			const firebaseData = docSnap.data().dados || {};
			Object.entries(firebaseData).forEach(([chave, valor]) => {
				const localValor = localStorage.getItem(chave);
				if (localValor) {
					try {
						const localObj = JSON.parse(localValor);
						const firebaseObj = JSON.parse(valor);
						if (Array.isArray(localObj) && Array.isArray(firebaseObj)) {
							const novoArray = [...new Map([...localObj, ...firebaseObj].map(item => [JSON.stringify(item), item])).values()];
							localStorage.setItem(chave, JSON.stringify(chave === "ignorados" ? localObj : novoArray));
						} else if (typeof localObj === "object" && typeof firebaseObj === "object") {
							localStorage.setItem(chave, JSON.stringify(chave === "ignorados" ? localObj : { ...firebaseObj, ...localObj }));
						}
					} catch {
						if (!localValor) localStorage.setItem(chave, valor);
					}
				} else {
					localStorage.setItem(chave, JSON.stringify(chave === "ignorados" ? JSON.parse(valor) : valor));
				}
			});
			showCascadeAlert("✅ Dados carregados do Firebase!");
			atualizarUIComSeguranca();
		} else {
			console.log("⚠️ Nenhum dado encontrado no Firestore.");
		}
	} catch (error) {
		showCascadeAlert(`❌ Erro ao carregar dados:<br>${error}<br>Verifique as informações clicando no botão sincronizar.`);
	}
}
async function compararEPrivilegiarDados() {
	if (!db || !docRef) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar.");
	if (bloqueioExecucao) return;
	bloqueioExecucao = true;
	setTimeout(() => bloqueioExecucao = false, 1000);
	const docSnap = await getDoc(docRef);
	const firebaseData = docSnap.exists() ? docSnap.data().dados || {} : {};
	const localData = {};
	Object.keys(localStorage).forEach(chave => {
		if (chavesPermitidas.some(termo => chave.includes(termo))) {
			localData[chave] = localStorage.getItem(chave);
		}
	});
	const produtosLocal = (() => {
		try {
			const parsed = JSON.parse(localData.produtos || "[]");
			return Array.isArray(parsed) ? parsed.length : 0;
		} catch (_) {
			return 0;
		}
	})();
	const produtosFirebase = (() => {
		try {
			const parsed = firebaseData.produtos ? JSON.parse(firebaseData.produtos) : [];
			return Array.isArray(parsed) ? parsed.length : 0;
		} catch (_) {
			return 0;
		}
	})();
	if (produtosLocal > produtosFirebase) {
		showCascadeAlert("📤 LocalStorage tem mais itens em 'produtos', será priorizado para exportação.");
		await salvarLocalStorageOnline();
	} else if (produtosFirebase > produtosLocal) {
		showCascadeAlert("📥 Firebase tem mais itens em 'produtos', será priorizado para importação.");
		await carregarLocalStorageOnline();
	} else {
		showCascadeAlert("✅ Os dados estão sincronizados.");
	}
}
const originalSetItem = localStorage.setItem;
localStorage.setItem = function (chave, valor) {
	if (!chavesPermitidas.some(permitida => chave.includes(permitida))) return;
	const antigoValor = localStorage.getItem(chave);
	if (antigoValor !== valor) {
		originalSetItem.apply(this, arguments);
		console.log("📥 LocalStorage modificado:", chave);
		if (antigoValor !== null) {
			const diferencas = compararDiferencas(antigoValor, valor);
			console.log("🔄 Alterações:", diferencas);
		} else {
			console.log("➕ Novo valor:", valor);
		}
		salvarLocalStorageOnline();
		atualizarUIComSeguranca();
	}
};
function compararDiferencas(antigo, novo) {
	try {
		const objAntigo = JSON.parse(antigo);
		const objNovo = JSON.parse(novo);
		if (typeof objAntigo === "object" && typeof objNovo === "object") {
			const diffs = {};
			Object.keys({ ...objAntigo, ...objNovo }).forEach(chave => {
				const valorAntigo = objAntigo.hasOwnProperty(chave) ? objAntigo[chave] : undefined;
				const valorNovo = objNovo.hasOwnProperty(chave) ? objNovo[chave] : undefined;
				// Comparar quando os valores são strings ou números
				if ((typeof valorAntigo === "string" || typeof valorAntigo === "number") && (typeof valorNovo === "string" || typeof valorNovo === "number")) {
					if (valorAntigo !== valorNovo) {
						diffs[chave] = { antes: valorAntigo, agora: valorNovo };
					}
				}
				// Caso sejam objetos ou arrays, utiliza JSON.stringify
				else if (JSON.stringify(valorAntigo) !== JSON.stringify(valorNovo)) {
					diffs[chave] = { antes: valorAntigo, agora: valorNovo };
				}
			});
			return diffs;
		}
	} catch (_) {}
	// Caso a comparação não seja de objetos, compara os valores diretamente
	if (antigo !== novo) return { antes: antigo, agora: novo };
	return {};
}
const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function (chave) {
	if (localStorage.getItem(chave) !== null) {
		originalRemoveItem.apply(this, arguments);
		console.log("🗑 LocalStorage item removido:", chave);
		salvarLocalStorageOnline();
		atualizarUIComSeguranca();
	}
};
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
if (db) {
	onSnapshot(docRef, snapshot => {
		if (snapshot.exists()) {
			if (bloqueioSincronizacao) return;
			bloqueioSincronizacao = true;
			setTimeout(() => bloqueioSincronizacao = false, 1000);
			const firebaseData = snapshot.data().dados || {};
			Object.entries(firebaseData).forEach(([chave, valor]) => {
				const antigoValor = localStorage.getItem(chave);
				if (valor !== null && valor !== undefined) {
					if (antigoValor !== valor) {
						if (chave === "produtos") {
							const produtosFirebase = JSON.parse(valor || "[]");
							const produtosLocal = JSON.parse(antigoValor || "[]");
							if (Array.isArray(produtosFirebase) && produtosFirebase.length > 0) {
								const produtosUnificados = [...produtosLocal];
								produtosFirebase.forEach(produto => {
									const index = produtosUnificados.findIndex(p => p.nome === produto.nome && p.codigoBarras === produto.codigoBarras && p.vencimento === produto.vencimento);
									if (index !== -1) {
										produtosUnificados[index] = produto;
									} else {
										produtosUnificados.push(produto);
									}
								});
								localStorage.setItem("produtos", JSON.stringify(produtosUnificados));
								console.log("🔄 Sincronizado Firestore → LocalStorage: produtos");
							}
							produtosLocal.forEach(produto => {
								if (!produtosFirebase.some(p => p.nome === produto.nome && p.codigoBarras === produto.codigoBarras)) {
									msg("SIM", "NÃO", false, `O produto com nome "${produto.nome}", código de barras "${produto.codigoBarras}", quantidade "${produto.quantidade}" e data de vencimento em "${formatarData(produto.vencimento)}"<br>Não existe mais para sincronização ou ainda não foi enviado ao firebase.<br>Você deseja manter esse produto?<br>Clique em "SIM" para manter, ou "NÃO" para excluir.`, () => {}, () => {
										const produtosAtualizados = produtosLocal.filter(p => !(p.nome === produto.nome && p.codigoBarras === produto.codigoBarras && p.vencimento === produto.vencimento));
										localStorage.setItem("produtos", JSON.stringify(produtosAtualizados));
										console.log(`❌ Produto "${produto.nome}" removido do localStorage.`);
										atualizarUIComSeguranca();
									});
								}
							});
						} else {
							if (!(JSON.stringify(valor) === '{}' || JSON.stringify(valor) === '[]')) {
								if (chave === "ignorados") {
									const ignoradosLocal = localStorage.getItem("ignorados");
									if (!ignoradosLocal) localStorage.setItem("ignorados", valor);
								} else {
									localStorage.setItem(chave, valor);
								}
								console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
							}
						}
					}
				}
				if (chave === "configAlerta" && valor) {
					const valorparse = JSON.parse(valor);
					const hashnAlertar = document.querySelector("#nAlertar");
					const hashcomo = document.querySelector("#como");
					if (hashnAlertar) hashnAlertar.value = valorparse.alertarValor ?? 60;
					if (hashcomo) hashcomo.value = valorparse.unidade ?? "dias";
				}
				if (antigoValor !== null) {
					const diferencas = compararDiferencas(antigoValor, valor);
					if (Object.keys(diferencas).length > 0) console.log("🔍 Alterações:", diferencas);
				} else {
					console.log("➕ Novo valor:", valor);
				}
			});
			atualizarUIComSeguranca();
		}
	});
}