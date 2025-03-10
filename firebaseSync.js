import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: localStorage.getItem("chave-fire") || "",
  authDomain: localStorage.getItem("dominio-fire") || "",
  projectId: localStorage.getItem("projeto-fire") || "",
  storageBucket: localStorage.getItem("bucket-fire") || "",
  messagingSenderId: localStorage.getItem("id-fire") || "",
  appId: localStorage.getItem("appid-fire") || ""
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const userId = localStorage.getItem("user-id") || "defaultUser";
const docRef = doc(db, "usuarios", userId);

// 🔹 Obtém dados do localStorage como objeto
const getLocalStorageData = () => Object.keys(localStorage).reduce((acc, key) => {
  acc[key] = localStorage.getItem(key);
  return acc;
}, {});

// 🔹 Sincroniza mudanças do Firestore para o localStorage
const syncFromFirestore = (firebaseData) => {
  if (!firebaseData) return;
  Object.entries(firebaseData).forEach(([key, value]) => {
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
  });
};

// 🔹 Sincroniza mudanças do localStorage para o Firestore
const syncToFirestore = async () => {
  const docSnap = await getDoc(docRef);
  const firebaseData = docSnap.exists() ? docSnap.data() : {};
  const localData = getLocalStorageData();

  let updatedData = {};
  let hasChanges = false;

  Object.entries(localData).forEach(([key, value]) => {
    if (firebaseData[key] !== value) {
      updatedData[key] = value;
      hasChanges = true;
    }
  });

  if (hasChanges) await setDoc(docRef, { ...firebaseData, ...updatedData }, { merge: true });
};

// 🔹 Monitora mudanças no localStorage e atualiza o Firestore
const observeLocalStorage = () => {
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    if (localStorage.getItem(key) !== value) {
      originalSetItem.apply(this, arguments);
      syncToFirestore();
    }
  };
};

// 🔹 Monitora mudanças no Firestore e atualiza o localStorage
onSnapshot(docRef, (docSnap) => {
  if (docSnap.exists()) syncFromFirestore(docSnap.data());
});

// 🔹 Executa a sincronização inicial
(async () => {
  const docSnap = await getDoc(docRef);
  const firebaseData = docSnap.exists() ? docSnap.data() : {};
  const localData = getLocalStorageData();

  let hasLocalChanges = Object.keys(localData).some(key => firebaseData?.[key] !== localData[key]);
  let hasFirestoreChanges = Object.keys(firebaseData || {}).some(key => localData[key] !== firebaseData[key]);

  if (hasLocalChanges) await syncToFirestore();
  if (hasFirestoreChanges) syncFromFirestore(firebaseData);

  observeLocalStorage();
})();
