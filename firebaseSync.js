import {
	initializeApp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import {
	getFirestore,
	doc,
	setDoc,
	getDoc,
	onSnapshot
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const firebaseConfig = {
	apiKey: localStorage.getItem("chave-fire") || "",
	authDomain: localStorage.getItem("dominio-fire") || "",
	projectId: localStorage.getItem("projeto-fire") || "",
	storageBucket: localStorage.getItem("bucket-fire") || "",
	messagingSenderId: localStorage.getItem("id-fire") || "",
	appId: localStorage.getItem("appid-fire") || ""
};

let db;
if (Object.values(firebaseConfig).some(valor => !valor)) {
	console.error("⚠️ Configuração do Firebase está vazia!");
} else {
	const appfire = initializeApp(firebaseConfig);
	db = getFirestore(appfire);
	console.log("✅ Firebase inicializado com sucesso!", firebaseConfig);
}

const docRef = db ? doc(db, "dados", "sync") : null;

// 🔹 Salvar LocalStorage no Firestore
export async function salvarLocalStorageOnline() {
	if (!db) return console.error("❌ Firebase não inicializado.");
	let todosDados = {};
	Object.keys(localStorage).forEach(chave => todosDados[chave] = localStorage.getItem(chave));
	try {
		await setDoc(docRef, {
			dados: todosDados
		}, {
			merge: true
		});
		console.log("✅ Dados salvos no Firebase!", todosDados);
	} catch (error) {
		console.error("❌ Erro ao salvar dados:", error);
	}
}

// 🔹 Carregar LocalStorage do Firestore
export async function carregarLocalStorageOnline() {
	if (!db) return console.error("❌ Firebase não inicializado.");
	try {
		const docSnap = await getDoc(docRef);
		if (docSnap.exists()) {
			Object.entries(docSnap.data().dados).forEach(([chave, valor]) => {
				if (localStorage.getItem(chave) !== valor) {
					localStorage.setItem(chave, valor);
				}
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

// 🔹 Interceptar mudanças no localStorage e salvar no Firestore
const originalSetItem = localStorage.setItem;
localStorage.setItem = function(chave, valor) {
	if (localStorage.getItem(chave) !== valor) {
		originalSetItem.apply(this, arguments);
		console.log("📥 LocalStorage modificado:", chave, valor);
		salvarLocalStorageOnline();
		atualizarLista();
	}
};

// 🔹 Interceptar remoção de itens do localStorage
const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function(chave) {
	if (localStorage.getItem(chave) !== null) {
		originalRemoveItem.apply(this, arguments);
		console.log("🗑 LocalStorage item removido:", chave);
		salvarLocalStorageOnline();
		atualizarLista();
	}
};

// 🔹 Observador de mudanças no Firestore → Atualiza o LocalStorage
if (db) {
	onSnapshot(docRef, snapshot => {
		if (snapshot.exists()) {
			const firebaseData = snapshot.data().dados || {};
			Object.entries(firebaseData).forEach(([chave, valor]) => {
				if (localStorage.getItem(chave) !== valor) {
					localStorage.setItem(chave, valor);
					console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
					atualizarLista();
				}
			});

			/*// 🔹 Remover chaves locais que não existem mais no Firestore
      Object.keys(localStorage).forEach(chave => {
        if (!(chave in firebaseData)) {
			if(confirm(`O seguinte item não existe mais:${chave} | Deseja remover?`)){
				localStorage.removeItem(chave);
				console.log("🗑 Removido LocalStorage → Firestore:", chave);
				atualizarLista();
			}
        }
      });*/
		}
	});
}

// 🔹 Carregar dados ao iniciar
carregarLocalStorageOnline();