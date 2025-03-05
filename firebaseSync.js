import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

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

async function sincronizarLocalStorageComFirestore() {
  if (!db) return console.error("❌ Firebase não inicializado corretamente.");
  
  try {
    const docSnap = await getDoc(doc(db, "dados", "sync"));
    const dadosFirebase = docSnap.exists() ? docSnap.data().dados : {};
    const dadosLocal = Object.fromEntries(Object.entries(localStorage));

    let atualizado = false;
    
    for (const [chave, valor] of Object.entries(dadosLocal)) {
      if (!(chave in dadosFirebase) || dadosFirebase[chave] !== valor) {
        dadosFirebase[chave] = valor;
        atualizado = true;
      }
    }

    for (const [chave, valor] of Object.entries(dadosFirebase)) {
      if (!(chave in dadosLocal)) {
        localStorage.setItem(chave, valor);
        console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
      }
    }

    if (atualizado) {
      await setDoc(doc(db, "dados", "sync"), { dados: dadosFirebase });
      console.log("✅ Firebase atualizado com novos dados.");
    }
  } catch (error) {
    console.error("❌ Erro na sincronização:", error);
  }
}

const originalSetItem = localStorage.setItem;
localStorage.setItem = function (chave, valor) {
  originalSetItem.apply(this, arguments);
  console.log("📥 LocalStorage modificado:", chave, valor);
  atualizarLista();
  sincronizarLocalStorageComFirestore();
};

const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function (chave) {
  originalRemoveItem.apply(this, arguments);
  console.log("🗑 LocalStorage item removido:", chave);
  atualizarLista();
  sincronizarLocalStorageComFirestore();
};

if (db) {
  onSnapshot(doc(db, "dados", "sync"), snapshot => {
    if (snapshot.exists()) {
      const dadosFirebase = snapshot.data().dados;
      Object.entries(dadosFirebase).forEach(([chave, valor]) => {
        if (localStorage.getItem(chave) !== valor) {
          localStorage.setItem(chave, valor);
          console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
          atualizarLista();
        }
      });
    }
  });
}

sincronizarLocalStorageComFirestore();