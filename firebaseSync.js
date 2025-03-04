import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// Configuração do Firebase
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

// Salvar LocalStorage no Firestore
export async function salvarLocalStorageOnline() {
  if (!db) return console.error("❌ Firebase não inicializado corretamente.");
  let todosDados = {};
  Object.keys(localStorage).forEach(chave => todosDados[chave] = localStorage.getItem(chave));
  try {
    await setDoc(doc(db, "dados", "sync"), { dados: todosDados });
    console.log("✅ Dados salvos no Firebase!");
  } catch (error) {
    console.error("❌ Erro ao salvar dados:", error);
  }
}

// Carregar LocalStorage do Firestore
export async function carregarLocalStorageOnline() {
  if (!db) return console.error("❌ Firebase não inicializado corretamente.");
  try {
    const docSnap = await getDoc(doc(db, "dados", "sync"));
    if (docSnap.exists()) {
      Object.entries(docSnap.data().dados).forEach(([chave, valor]) => localStorage.setItem(chave, valor));
      console.log("✅ Dados carregados do Firebase!");
	  atualizarLista();
    } else {
      console.log("⚠️ Nenhum dado encontrado no Firestore.");
    }
  } catch (error) {
    console.error("❌ Erro ao carregar dados:", error);
  }
}

// ✅ Interceptar mudanças no localStorage
const originalSetItem = localStorage.setItem;
localStorage.setItem = function (chave, valor) {
  originalSetItem.apply(this, arguments);
  console.log("📥 LocalStorage modificado:", chave, valor);
  atualizarLista();
  salvarLocalStorageOnline();
};

// ✅ Interceptar remoção de itens do localStorage
const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function (chave) {
  originalRemoveItem.apply(this, arguments);
  console.log("🗑 LocalStorage item removido:", chave);
  atualizarLista();
  salvarLocalStorageOnline();
};

// Observador de mudanças no Firestore
if (db) {
  onSnapshot(doc(db, "dados", "sync"), snapshot => {
    if (snapshot.exists()) {
      Object.entries(snapshot.data().dados).forEach(([chave, valor]) => {
        if (localStorage.getItem(chave) !== valor) {
          localStorage.setItem(chave, valor);
          console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
		  atualizarLista();
        }
      });
    }
  });
}

// Carregar os dados ao iniciar
carregarLocalStorageOnline();