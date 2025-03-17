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

function showCascadeAlert(message) {
    if (!document.querySelector("#cascade-alert-style")) {
        const style = document.createElement("style");
        style.id = "cascade-alert-style";
        style.innerHTML = `
            .cascade-alert {
                position: fixed; left: 20px; background: #222; border: 2px solid #0ff;
                box-shadow: 0 0 10px #0ff, 0 0 20px #0ff; padding: 12px 10px; text-align: left;
                border-radius: 8px; font-family: Arial, sans-serif; color: #fff; z-index: 10000;
                display: flex; flex-direction: row; justify-content: space-between;
                align-items: center; word-wrap: break-word; max-width: 35%; transition: opacity 0.4s, transform 0.4s;
            }
            .cascade-alert.removing {
                opacity: 0; transform: translateX(-100%);
            }
            .cascade-alert .message-cascade { flex-grow: 1; }
            .cascade-alert .close-btn-cascade { font-size: 16px; color: #fff; background: transparent; border: none; cursor: pointer; padding: 0; margin-left: 12px; }
            .cascade-alert .close-btn-cascade:hover { color: #0cc; }
            .cascade-clear-btn {
                position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
                background: #0ff; color: #000; border: 2px solid #000; padding: 10px 20px;
                font-weight: bold; cursor: pointer; z-index: 10001; border-radius: 5px;
                box-shadow: 0 0 20px #0ff, 0 0 40px #0ff;
            }
            .cascade-clear-btn:hover { background: #0cc; }
        `;
        document.head.appendChild(style);
    }

    if (!document.querySelector(".cascade-clear-btn")) {
        const clearButton = document.createElement("button");
        clearButton.className = "cascade-clear-btn";
		clearButton.title = "Limpar todas as mensagens de informações exibidas a esquerda"; 
        clearButton.textContent = "<< Limpar todos estes alertas";
        clearButton.addEventListener("click", () => {
            document.querySelectorAll(".cascade-alert").forEach((el) => removeAlert(el));
        });
        document.body.appendChild(clearButton);
    }

    const formattedMessage = message.replace(/https?:\/\/[^\s]+/g, (url) =>
        `<a href="${url}" target="_blank" style="color: #0ff; text-decoration: underline;">${url}</a>`
    ).replace(/<br\s*\/?>/g, "\n").trim();

    if ([...document.querySelectorAll(".cascade-alert .message-cascade")].some(el =>
        el.innerText.replace(/\s+/g, " ").trim() === formattedMessage.replace(/\s+/g, " ")
    )) return;

    const alert = document.createElement("div");
    alert.className = "cascade-alert";
    alert.innerHTML = `
        <div class="message-cascade">${formattedMessage.replace(/\n/g, "<br>")}</div>
        <button class="close-btn-cascade" title="fechar esta mensagem">X</button>
    `;

    alert.querySelector(".close-btn-cascade").addEventListener("click", () => removeAlert(alert));
    document.body.appendChild(alert);

    const removeAlert = (el) => {
        el.classList.add("removing");
        setTimeout(() => {
            el.remove();
            positionAlerts();
            toggleClearButton();
        }, 400);
    };

    const positionAlerts = () => {
        let offset = 20;
        document.querySelectorAll(".cascade-alert").forEach((el) => {
            el.style.top = `${offset}px`;
            offset += el.offsetHeight + 15;
        });
    };

    const toggleClearButton = () => {
        const clearButton = document.querySelector(".cascade-clear-btn");
        clearButton.style.display = document.querySelectorAll(".cascade-alert").length > 0 ? "block" : "none";
    };

    positionAlerts();
    toggleClearButton();
}

(function() {
    const originalXHR = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        this._method = method;
        return originalXHR.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener("load", function() {
            if (this.status === 400 && this._url.includes("firestore")) {
                console.log(this._url);
                showCascadeAlert("❌ Erro ao tentar conectar com o Firestore!<br>Verifique as informações clicando no botão sincronizar.");
            }
        });
        return originalXHRSend.apply(this, args);
    };

    const originalFetch = window.fetch;

    window.fetch = function(url, options = {}) {
        return originalFetch(url, options)
            .then(response => {
                if (response.status === 400 && typeof url === "string" && url.includes("firestore")) {
                    console.log(url);
                    showCascadeAlert("❌ Erro ao tentar conectar com o Firestore!<br>Verifique as informações clicando no botão sincronizar.");
                }
                return response;
            })
            .catch(error => {
                console.error("Erro na requisição", error);
                return Promise.reject(error);
            });
    };
})();

let db, docRef, bloqueioExecucao = false, bloqueioSincronizacao = false;
const chavesPermitidas = ["-fire", "produtos", "configAlerta", "ignorados", "syncenviar"];
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
	if(localStorage.getItem("syncenviar") !== "true") return;
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
							const novoArray = [...new Set([...localObj, ...firebaseObj])];
							localStorage.setItem(chave, JSON.stringify(novoArray));
						} else if (typeof localObj === "object" && typeof firebaseObj === "object") {
							const novoObjeto = { ...localObj, ...firebaseObj };
							localStorage.setItem(chave, JSON.stringify(novoObjeto));
						} else {
							if (localValor !== valor) localStorage.setItem(chave, valor);
						}
					} catch {
						if (localValor !== valor) localStorage.setItem(chave, valor);
					}
				} else {
					localStorage.setItem(chave, valor);
				}
			});

			showCascadeAlert("✅ Dados carregados do Firebase e mesclados!");
			atualizarLista();
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

  const localSize = Object.keys(localData).length;
  const firebaseSize = Object.keys(firebaseData).length;

  // Comparando o comprimento da chave 'produtos'
  const produtosLocal = Array.isArray(localData.produtos) ? localData.produtos.length : 0;
  const produtosFirebase = Array.isArray(firebaseData.produtos) ? firebaseData.produtos.length : 0;

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
localStorage.setItem = function(chave, valor) {
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
        atualizarLista();
    }
};

function compararDiferencas(antigo, novo) {
    try {
        const objAntigo = JSON.parse(antigo);
        const objNovo = JSON.parse(novo);

        if (typeof objAntigo === "object" && typeof objNovo === "object") {
            const diffs = {};
            Object.keys({...objAntigo, ...objNovo}).forEach(chave => {
                const valorAntigo = objAntigo.hasOwnProperty(chave) ? objAntigo[chave] : undefined;
                const valorNovo = objNovo.hasOwnProperty(chave) ? objNovo[chave] : undefined;

                if (JSON.stringify(valorAntigo) !== JSON.stringify(valorNovo)) {
                    diffs[chave] = { antes: valorAntigo, depois: valorNovo };
                }
            });
            return diffs;
        }
    } catch (error) {
        console.error("Erro ao comparar diferenças:", error);
    }

    return { antes: antigo, depois: novo };
}

const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function(chave) {
	if (localStorage.getItem(chave) !== null) {
		originalRemoveItem.apply(this, arguments);
		console.log("🗑 LocalStorage item removido:", chave);
		salvarLocalStorageOnline();
		atualizarLista();
	}
};

if (db) {
	onSnapshot(docRef, snapshot => {
		if (snapshot.exists()) {
			if (bloqueioSincronizacao) return;
			bloqueioSincronizacao = true;
			setTimeout(() => bloqueioSincronizacao = false, 1000);

			const firebaseData = snapshot.data().dados || {};
			Object.entries(firebaseData).forEach(([chave, valor]) => {
				const antigoValor = localStorage.getItem(chave);
				if (antigoValor !== valor) {
					localStorage.setItem(chave, valor);
					console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
					if (chave == "configAlerta") document.querySelector("#nAlertar")?.value = valor?.alertarValor || 60;
					if (chave == "configAlerta") document.querySelector("#como")?.value = valor?.unidade || "meses";
					
					if (antigoValor !== null) {
						const diferencas = compararDiferencas(antigoValor, valor);
						console.log("🔍 Alterações:", diferencas);
					} else {
						console.log("➕ Novo valor:", valor);
					}

					atualizarLista();
				}
			});
		}
	});
}