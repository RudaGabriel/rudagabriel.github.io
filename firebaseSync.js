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
	console.error("⚠️ Configuração do Firebase está vazia.");
} else {
	const appfire = initializeApp(firebaseConfig);
	db = getFirestore(appfire);
	docRef = doc(db, "dados", "sync");
	console.log("✅ Firebase inicializado com sucesso!");
	compararEPrivilegiarDados();
}

async function salvarLocalStorageOnline() {
	if (!db) return console.error("❌ Firebase não inicializado.");
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
	if (!db) return console.error("❌ Firebase não inicializado.");
	try {
		const docSnap = await getDoc(docRef);
		if (docSnap.exists()) {
			Object.entries(docSnap.data().dados).forEach(([chave, valor]) => {
				if (localStorage.getItem(chave) !== valor) localStorage.setItem(chave, valor);
			});
			console.log("✅ Dados carregados do Firebase!");
			atualizarLista();
		} else {
			console.log("⚠️ Nenhum dado encontrado no Firestore.");
		}
	} catch (error) {
		console.error("❌ Erro ao carregar dados:", error);
	}
}

async function compararEPrivilegiarDados() {
  if (!db || !docRef) return console.error("❌ Firebase não inicializado.");
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
    console.log("📤 LocalStorage tem mais itens em 'produtos', será priorizado para exportação.");
    await salvarLocalStorageOnline();
  } else if (produtosFirebase > produtosLocal) {
    console.log("📥 Firebase tem mais itens em 'produtos', será priorizado para importação.");
    await carregarLocalStorageOnline();
  } else {
    console.log("✅ Os dados estão sincronizados.");
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