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
let bloqueioSync = false; // Evita loops de sincronização

// 🔄 Salvar LocalStorage no Firestore (com debounce)
export async function salvarLocalStorageOnline() {
  if (!db || bloqueioSync) return;

  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    let novosDados = {};
    Object.keys(localStorage).forEach(chave => novosDados[chave] = localStorage.getItem(chave));

    if (JSON.stringify(novosDados) !== JSON.stringify(ultimaVersaoLocal)) {
      try {
        console.log("⏳ Salvando dados no Firestore...");
        await setDoc(doc(db, "dados", "sync"), { dados: novosDados });
        ultimaVersaoLocal = novosDados;
        console.log("✅ Dados salvos no Firestore!");
      } catch (error) {
        console.error("❌ Erro ao salvar dados:", error);
      }
    }
  }, 2000); // Aguardar 2 segundos antes de sincronizar
}

// 🔄 Carregar LocalStorage do Firestore (evitando sobrecarga)
export async function carregarLocalStorageOnline() {
  if (!db) return;

  try {
    const docSnap = await getDoc(doc(db, "dados", "sync"));
    if (docSnap.exists()) {
      let dadosRemotos = docSnap.data().dados;
      if (JSON.stringify(dadosRemotos) !== JSON.stringify(ultimaVersaoLocal)) {
        bloqueioSync = true; // Evita loop de sincronização
        Object.entries(dadosRemotos).forEach(([chave, valor]) => localStorage.setItem(chave, valor));
        ultimaVersaoLocal = dadosRemotos;
        console.log("✅ Dados carregados do Firebase!");
        setTimeout(() => bloqueioSync = false, 2000); // Desbloqueia após 2s
      }
    } else {
      console.log("⚠️ Nenhum dado encontrado no Firestore.");
    }
  } catch (error) {
    console.error("❌ Erro ao carregar dados:", error);
  }
}

// ✅ Interceptar mudanças no LocalStorage (com debounce)
const originalSetItem = localStorage.setItem;
localStorage.setItem = function (chave, valor) {
  originalSetItem.apply(this, arguments);
  if (!bloqueioSync) salvarLocalStorageOnline();
};

const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function (chave) {
  originalRemoveItem.apply(this, arguments);
  if (!bloqueioSync) salvarLocalStorageOnline();
};

// 🔄 Observador do Firestore (evita loops e sobrecarga)
if (db) {
  onSnapshot(doc(db, "dados", "sync"), snapshot => {
    if (snapshot.exists() && !bloqueioSync) {
      let dadosRemotos = snapshot.data().dados;
      if (JSON.stringify(dadosRemotos) !== JSON.stringify(ultimaVersaoLocal)) {
        bloqueioSync = true;
        Object.entries(dadosRemotos).forEach(([chave, valor]) => {
          if (localStorage.getItem(chave) !== valor) {
            localStorage.setItem(chave, valor);
            console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
          }
        });
        ultimaVersaoLocal = dadosRemotos;
        setTimeout(() => bloqueioSync = false, 2000); // Desbloqueia após 2s
      }
    }
  });
}

// 🔄 Carregar dados ao iniciar
carregarLocalStorageOnline();