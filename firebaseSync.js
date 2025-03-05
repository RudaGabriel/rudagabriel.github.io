import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

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
  console.log("✅ Firebase inicializado!");
}

async function sincronizarDados() {
  if (!db) return console.error("❌ Firebase não inicializado.");

  const docSnap = await getDoc(doc(db, "dados", "sync"));
  const dadosFirestore = docSnap.exists() ? docSnap.data().dados : {};
  const dadosLocal = Object.fromEntries(Object.entries(localStorage));

  let atualizado = false;

  Object.entries(dadosLocal).forEach(([chave, valor]) => {
    if (!(chave in dadosFirestore)) {
      dadosFirestore[chave] = valor;
      atualizado = true;
    }
  });

  Object.entries(dadosFirestore).forEach(([chave, valor]) => {
    if (!(chave in dadosLocal)) {
      localStorage.setItem(chave, valor);
      atualizado = true;
    }
  });

  if (atualizado) {
    await setDoc(doc(db, "dados", "sync"), { dados: dadosFirestore });
    console.log("✅ Sincronização concluída!");
  }
}

const originalSetItem = localStorage.setItem;
localStorage.setItem = function (chave, valor) {
  originalSetItem.apply(this, arguments);
  console.log("📥 LocalStorage atualizado:", chave, valor);
  sincronizarDados();
};

const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function (chave) {
  originalRemoveItem.apply(this, arguments);
  console.log("🗑 LocalStorage item removido:", chave);
  sincronizarDados();
};

if (db) {
  onSnapshot(doc(db, "dados", "sync"), snapshot => {
    if (snapshot.exists()) {
      const dadosFirestore = snapshot.data().dados;
      Object.entries(dadosFirestore).forEach(([chave, valor]) => {
        if (localStorage.getItem(chave) !== valor) {
          localStorage.setItem(chave, valor);
          console.log("🔄 Firestore → LocalStorage:", chave);
        }
      });
    }
  });
}

sincronizarDados();