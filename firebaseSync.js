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

let db, docRef, bloqueioExecucao = false, bloqueioSincronizacao = false;
if (Object.values(firebaseConfig).some(valor => !valor)) {
	showCascadeAlert("⚠️ Configuração do Firebase está vazia.");
} else {
	const appfire = initializeApp(firebaseConfig);
	db = getFirestore(appfire);
	docRef = doc(db, "dados", "sync");
	showCascadeAlert("✅ Firebase inicializado com sucesso!");
	compararEPrivilegiarDados();
	limparChavesNaoPermitidas();
}

async function salvarLocalStorageOnline() {
	if (!db) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar.");
	if (localStorage.getItem("syncenviar") !== "true") return;

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
		showCascadeAlert(`❌ Erro ao salvar dados:<br>${error}<br>Verifique as informações clicando no botão sincronizar.`);
	}
}

async function carregarLocalStorageOnline() {
	if (!db) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar.");
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
		showCascadeAlert(`❌ Erro ao carregar dados:<br>${error}<br>Verifique as informações clicando no botão sincronizar.`);
	}
}

async function limparChavesNaoPermitidas() {
  const chavesPermitidas = ["-fire", "produtos", "configAlerta", "ignorados", "syncenviar"];

  Object.keys(localStorage).forEach(chave => {
    if (!chavesPermitidas.some(term => chave.includes(term))) {
      console.log(`🗑 Removendo chave não permitida do localStorage: ${chave}`);
      localStorage.removeItem(chave);
    }
  });

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
    showCascadeAlert(`❌ Erro ao limpar dados no Firebase:<br>${error}<br>Verifique as informações clicando no botão sincronizar.`);
  }
}

async function compararEPrivilegiarDados() {
  if (!db || !docRef) return showCascadeAlert("❌ Firebase não inicializado.<br>Verifique as informações clicando no botão sincronizar.");
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
    const valorAntigo = localStorage.getItem(chave);
    if (valorAntigo !== valor) {
        originalSetItem.apply(this, arguments);
        console.log(`📥 LocalStorage modificado: ${chave} | Antigo: ${valorAntigo} | Novo: ${valor}`);
        if (localStorage.getItem("syncenviar") === "true") salvarLocalStorageOnline();
        atualizarLista();
    }
};

const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function(chave) {
	if (localStorage.getItem(chave) !== null) {
		originalRemoveItem.apply(this, arguments);
		console.log("🗑 LocalStorage item removido:", chave);
		if (localStorage.getItem("syncenviar") === "true") salvarLocalStorageOnline();
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