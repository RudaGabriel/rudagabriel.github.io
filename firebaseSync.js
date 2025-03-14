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
                align-items: center; word-wrap: break-word; max-width: 50%;
            }
            .cascade-alert .message-cascade { flex-grow: 1; }
            .cascade-alert .close-btn-cascade { font-size: 16px; color: #fff; background: transparent; border: none; cursor: pointer; padding: 0; margin-left: 8px; }
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
        clearButton.textContent = "Limpar alertas";
        clearButton.addEventListener("click", () => {
            document.querySelectorAll(".cascade-alert").forEach((el) => el.remove());
            document.querySelector(".cascade-clear-btn").style.display = "none";
        });
        document.body.appendChild(clearButton);
    }
    const alert = document.createElement("div");
    alert.className = "cascade-alert";
    const formattedMessage = message.replace(/https?:\/\/[^\s]+/g, (url) =>
                                             `<a href="${url}" target="_blank" style="color: #0ff; text-decoration: underline;">${url}</a>`
    );
    alert.innerHTML = `
        <div class="message-cascade">${formattedMessage}</div>
        <button class="close-btn-cascade">X</button>
    `;
    alert.querySelector(".close-btn-cascade").addEventListener("click", () => {
        alert.remove();
        positionAlerts();
        toggleClearButton();
    });
    document.body.appendChild(alert);
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

let db, docRef, bloqueioExecucao = false, bloqueioSincronizacao = false;
if (Object.values(firebaseConfig).some(valor => !valor)) {
	showCascadeAlert("⚠️ Configuração do Firebase está vazia.");
} else {
	const appfire = initializeApp(firebaseConfig);
	db = getFirestore(appfire);
	docRef = doc(db, "dados", "sync");
	showCascadeAlert("✅ Firebase inicializado com sucesso!");
	compararEPrivilegiarDados();
	limparChavesNaoPermitidas(); // Limpa as chaves não permitidas
}

async function salvarLocalStorageOnline() {
	if (!db) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar");
	let todosDados = {};
	const chavesPermitidas = ["-fire", "produtos", "configAlerta", "ignorados"];

	Object.keys(localStorage).forEach(chave => {
		if (chavesPermitidas.some(term => chave.includes(term))) {
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
		console.error("❌ Erro ao salvar dados:", error);
	}
}

async function carregarLocalStorageOnline() {
	if (!db) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar");
	try {
		const docSnap = await getDoc(docRef);
		if (docSnap.exists()) {
			Object.entries(docSnap.data().dados).forEach(([chave, valor]) => {
				if (localStorage.getItem(chave) !== valor) localStorage.setItem(chave, valor);
			});
			showCascadeAlert("✅ Dados carregados do Firebase!");
			atualizarLista();
		} else {
			console.log("⚠️ Nenhum dado encontrado no Firestore.");
		}
	} catch (error) {
		console.error("❌ Erro ao carregar dados:", error);
	}
}

async function limparChavesNaoPermitidas() {
  const chavesPermitidas = ["-fire", "produtos", "configAlerta", "ignorados"];

  // Limpar no localStorage
  Object.keys(localStorage).forEach(chave => {
    if (!chavesPermitidas.some(term => chave.includes(term))) {
      console.log(`🗑 Removendo chave não permitida do localStorage: ${chave}`);
      localStorage.removeItem(chave);
    }
  });

  // Limpar no Firebase
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const firebaseData = docSnap.data().dados || {};
      let dadosAtualizados = { ...firebaseData };

      Object.keys(firebaseData).forEach(chave => {
        if (!chavesPermitidas.some(term => chave.includes(term))) {
          console.log(`🗑 Removendo chave não permitida do Firebase: ${chave}`);
          delete dadosAtualizados[chave];
        }
      });

      if (Object.keys(dadosAtualizados).length !== Object.keys(firebaseData).length) {
        await setDoc(docRef, { dados: dadosAtualizados }, { merge: true });
        showCascadeAlert("✅ Dados atualizados no Firebase após remoção de chaves inválidas.");
      }
    }
  } catch (error) {
    console.error("❌ Erro ao limpar dados no Firebase:", error);
  }
}

async function compararEPrivilegiarDados() {
  if (!db || !docRef) {
	  
	  showCascadeAlert.error("❌ Firebase não inicializado.");
  }
  if (bloqueioExecucao) return;

  bloqueioExecucao = true;
  setTimeout(() => bloqueioExecucao = false, 1000);

  const docSnap = await getDoc(docRef);
  const firebaseData = docSnap.exists() ? docSnap.data().dados || {} : {};

  const chavesPermitidas = ["-fire", "produtos", "configAlerta", "ignorados"];
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
	if (localStorage.getItem(chave) !== valor) {
		originalSetItem.apply(this, arguments);
		console.log("📥 LocalStorage modificado:", chave, valor);
		salvarLocalStorageOnline();
		atualizarLista();
	}
};

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
				if (localStorage.getItem(chave) !== valor) {
					localStorage.setItem(chave, valor);
					console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
					atualizarLista();
				}
			});
		}
	});
}