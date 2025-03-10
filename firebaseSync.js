import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getDatabase, ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-database.js";

const firebaseConfig = {
  apiKey: localStorage.getItem("chave-fire") || "",
  authDomain: localStorage.getItem("dominio-fire") || "",
  projectId: localStorage.getItem("projeto-fire") || "",
  storageBucket: localStorage.getItem("bucket-fire") || "",
  messagingSenderId: localStorage.getItem("id-fire") || "",
  appId: localStorage.getItem("appid-fire") || ""
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const userId = localStorage.getItem("user-id") || "defaultUser"; 
const dbRef = ref(db, `usuarios/${userId}/localStorage`);

// 🔹 Função para obter dados do localStorage como objeto
const getLocalStorageData = () => Object.keys(localStorage).reduce((acc, key) => {
  acc[key] = localStorage.getItem(key);
  return acc;
}, {});

// 🔹 Sincroniza mudanças do Firebase para o localStorage
const syncFromFirebase = (firebaseData) => {
  if (!firebaseData) return;
  Object.entries(firebaseData).forEach(([key, value]) => {
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
  });
};

// 🔹 Sincroniza mudanças do localStorage para o Firebase
const syncToFirebase = async () => {
  const snapshot = await get(dbRef);
  const firebaseData = snapshot.val() || {};
  const localData = getLocalStorageData();

  let updatedData = {};
  let hasChanges = false;

  Object.entries(localData).forEach(([key, value]) => {
    if (firebaseData[key] !== value) {
      updatedData[key] = value;
      hasChanges = true;
    }
  });

  if (hasChanges) await set(dbRef, { ...firebaseData, ...updatedData });
};

// 🔹 Monitora mudanças no localStorage e atualiza o Firebase
const observeLocalStorage = () => {
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    if (localStorage.getItem(key) !== value) {
      originalSetItem.apply(this, arguments);
      syncToFirebase();
    }
  };
};

// 🔹 Monitora mudanças no Firebase e atualiza o localStorage
onValue(dbRef, (snapshot) => syncFromFirebase(snapshot.val()));

// 🔹 Executa a sincronização inicial
(async () => {
  const snapshot = await get(dbRef);
  const firebaseData = snapshot.val();
  const localData = getLocalStorageData();

  let hasLocalChanges = Object.keys(localData).some(key => firebaseData?.[key] !== localData[key]);
  let hasFirebaseChanges = Object.keys(firebaseData || {}).some(key => localData[key] !== firebaseData[key]);

  if (hasLocalChanges) await syncToFirebase();
  if (hasFirebaseChanges) syncFromFirebase(firebaseData);

  observeLocalStorage();
})();