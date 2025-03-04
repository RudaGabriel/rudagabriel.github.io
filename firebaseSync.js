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
if (Object.values(firebaseConfig).some(v => !v)) {
  console.error("⚠️ Configuração do Firebase está vazia!");
} else {
  const appfire = initializeApp(firebaseConfig);
  db = getFirestore(appfire);
  console.log("✅ Firebase inicializado!", firebaseConfig);
}

let ultimaVersaoLocal = {}; 
let syncTimeout;

// 🔄 Salvar LocalStorage no Firestore (com otimização)
export async function salvarLocalStorageOnline() {
  if (!db) return console.error("❌ Firebase não inicializado corretamente.");
  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(async () => {
    let novosDados = {};
    Object.keys(localStorage).forEach(chave => novosDados[chave] = localStorage.getItem(chave));

    if (JSON.stringify(novosDados) !== JSON.stringify(ultimaVersaoLocal)) {
      try {
        await setDoc(doc(db, "dados", "sync"), { dados: novosDados });
        ultimaVersaoLocal = novosDados;
        console.log("✅ Dados salvos no Firebase!");
      } catch (error) {
        console.error("❌ Erro ao salvar dados:", error);
      }
    }
  }, 1000); // Aguardar 1 segundo para evitar múltiplas requisições seguidas
}

// 🔄 Carregar LocalStorage do Firestore (apenas quando há mudanças)
export async function carregarLocalStorageOnline() {
  if (!db) return console.error("❌ Firebase não inicializado corretamente.");
  try {
    const docSnap = await getDoc(doc(db, "dados", "sync"));
    if (docSnap.exists()) {
      let dadosRemotos = docSnap.data().dados;
      if (JSON.stringify(dadosRemotos) !== JSON.stringify(ultimaVersaoLocal)) {
        Object.entries(dadosRemotos).forEach(([chave, valor]) => localStorage.setItem(chave, valor));
        ultimaVersaoLocal = dadosRemotos;
        console.log("✅ Dados carregados do Firebase!");
      }
    } else {
      console.log("⚠️ Nenhum dado encontrado no Firestore.");
    }
  } catch (error) {
    console.error("❌ Erro ao carregar dados:", error);
  }
}

// ✅ Interceptar mudanças no LocalStorage e agrupar alterações
const originalSetItem = localStorage.setItem;
localStorage.setItem = function (chave, valor) {
  originalSetItem.apply(this, arguments);
  salvarLocalStorageOnline();
};

const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function (chave) {
  originalRemoveItem.apply(this, arguments);
  salvarLocalStorageOnline();
};

// 🔄 Observador do Firestore (evita loops infinitos)
if (db) {
  onSnapshot(doc(db, "dados", "sync"), snapshot => {
    if (snapshot.exists()) {
      let dadosRemotos = snapshot.data().dados;
      if (JSON.stringify(dadosRemotos) !== JSON.stringify(ultimaVersaoLocal)) {
        Object.entries(dadosRemotos).forEach(([chave, valor]) => {
          if (localStorage.getItem(chave) !== valor) {
            localStorage.setItem(chave, valor);
            console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
          }
        });
        ultimaVersaoLocal = dadosRemotos;
      }
    }
  });
}

// 🔄 Carregar dados ao iniciar
carregarLocalStorageOnline();
