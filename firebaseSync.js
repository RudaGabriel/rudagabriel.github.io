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

let bloqueioSync = false;

// Sincronizar com o Firestore
const sincronizarComFirestore = async () => {
  if (!db || bloqueioSync) return;

  bloqueioSync = true;
  try {
    const dados = {};
    Object.keys(localStorage).forEach(chave => {
      dados[chave] = localStorage.getItem(chave);
    });

    console.log("⏳ Sincronizando dados com o Firestore...");
    await setDoc(doc(db, "dados", "sync"), { dados }, { merge: true });
    console.log("✅ Dados sincronizados com o Firestore!");
	atualizarLista();
  } catch (error) {
    console.error("❌ Erro ao sincronizar dados:", error);
  } finally {
    bloqueioSync = false;
  }
};

// Observa alterações no LocalStorage e sincroniza
const originalSetItem = localStorage.setItem;
localStorage.setItem = function (chave, valor) {
  originalSetItem.apply(this, arguments);
  sincronizarComFirestore();
};

const originalRemoveItem = localStorage.removeItem;
localStorage.removeItem = function (chave) {
  originalRemoveItem.apply(this, arguments);
  sincronizarComFirestore();
};

// Carregar dados do Firestore para o LocalStorage
const carregarDadosFirestore = async () => {
  if (!db) return;

  try {
    const docSnap = await getDoc(doc(db, "dados", "sync"));
    if (docSnap.exists()) {
      const dadosRemotos = docSnap.data().dados;
      Object.entries(dadosRemotos).forEach(([chave, valor]) => {
        if (localStorage.getItem(chave) !== valor) {
          localStorage.setItem(chave, valor);
          console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
		  atualizarLista();
        }
      });
    } else {
      console.log("⚠️ Nenhum dado encontrado no Firestore.");
    }
  } catch (error) {
    console.error("❌ Erro ao carregar dados do Firestore:", error);
  }
};

// Observador de alterações no Firestore
if (db) {
  onSnapshot(doc(db, "dados", "sync"), snapshot => {
    if (snapshot.exists()) {
      const dadosRemotos = snapshot.data().dados;
      Object.entries(dadosRemotos).forEach(([chave, valor]) => {
        if (localStorage.getItem(chave) !== valor) {
          localStorage.setItem(chave, valor);
          console.log("🔄 Sincronizado Firestore → LocalStorage:", chave);
		  atualizarLista();
        }
      });
    }
  });
}

// Carregar dados do Firestore ao iniciar
carregarDadosFirestore();