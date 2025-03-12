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
  Object.keys(localStorage).forEach(chave => todosDados[chave] = localStorage.getItem(chave));

  try {
    const docSnap = await getDoc(docRef);
    const firebaseData = docSnap.exists() ? docSnap.data().dados || {} : {};

    let diferenca = {};
    Object.entries(todosDados).forEach(([chave, valor]) => {
      const valorFirebase = firebaseData[chave] || "N/A";

      // Verificando se o valor é um objeto ou array antes de compará-lo
      if (typeof valor === 'object' && valor !== null) {
        valor = JSON.stringify(valor);
      }
      if (typeof valorFirebase === 'object' && valorFirebase !== null) {
        valorFirebase = JSON.stringify(valorFirebase);
      }

      // Verificando diferença real entre valor local e o valor do Firebase
      if (valor !== valorFirebase) {
        diferenca[chave] = { antes: valorFirebase, depois: valor };
      }
    });

    // Exibe a diferença apenas se houver alterações reais
    if (Object.keys(diferenca).length > 0) {
      await setDoc(docRef, { dados: todosDados }, { merge: true });
      console.log("✅ Dados modificados e salvos no Firebase:", diferenca);
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
	const localData = {};
	Object.keys(localStorage).forEach(chave => localData[chave] = localStorage.getItem(chave));

	const localSize = Object.keys(localData).length;
	const firebaseSize = Object.keys(firebaseData).length;

	if (localSize > firebaseSize) {
		console.log("📤 LocalStorage atual tem mais dados, será priorizado para exportação.");
		await salvarLocalStorageOnline();
	} else if (firebaseSize > localSize) {
		console.log("📥 Firebase tem mais dados, será priorizado para importação.");
		await carregarLocalStorageOnline();
	} else {
		let conflito = false;
		for (let chave in localData) {
			if (firebaseData[chave] !== localData[chave]) {
				conflito = true;
				console.log(`⚠️ Conflito detectado na chave "${chave}".`);
			}
		}
		if (conflito) {
			console.log("🛑 Existem diferenças entre LocalStorage e Firebase. Defina uma política de resolução.");
		} else {
			console.log("✅ Os dados estão sincronizados.");
		}
	}
}

const originalSetItem = localStorage.setItem;
localStorage.setItem = function(chave, valor) {
  let valorAntigo = localStorage.getItem(chave);

  // Verificando se o valor é um objeto ou um array
  if (typeof valor === 'object' && valor !== null) {
    if (Array.isArray(valor)) {
      valor = JSON.stringify(valor);
    } else {
      valor = JSON.stringify(valor);
    }
  }

  // Verificando se houve alteração no valor
  if (valorAntigo !== valor) {
    originalSetItem.apply(this, arguments);

    // Comparando os valores e verificando se são objetos ou arrays
    let diferenca = { antes: valorAntigo ? JSON.parse(valorAntigo) : "N/A", depois: JSON.parse(valor) };

    // Exibe apenas se houver diferença real
    if (JSON.stringify(diferenca.antes) !== JSON.stringify(diferenca.depois)) {
      console.log(`📥 ${chave} modificado:`, diferenca);
    }

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
      let diferencas = {};

      Object.entries(firebaseData).forEach(([chave, valor]) => {
        const valorLocalStorage = localStorage.getItem(chave);

        // Verificando se o valor é um objeto ou um array
        if (typeof valor === 'object' && valor !== null) {
          if (Array.isArray(valor)) {
            // Se for um array, compara os elementos
            const localStorageArray = JSON.parse(valorLocalStorage || '[]');
            if (JSON.stringify(valor) !== JSON.stringify(localStorageArray)) {
              diferencas[chave] = { antes: localStorageArray, depois: valor };
              localStorage.setItem(chave, JSON.stringify(valor));
            }
          } else {
            // Se for um objeto, compara as propriedades
            const localStorageObject = JSON.parse(valorLocalStorage || '{}');
            if (JSON.stringify(valor) !== JSON.stringify(localStorageObject)) {
              diferencas[chave] = { antes: localStorageObject, depois: valor };
              localStorage.setItem(chave, JSON.stringify(valor));
            }
          }
        } else if (valor !== valorLocalStorage) {
          // Caso seja um valor primitivo, compara diretamente
          diferencas[chave] = { antes: valorLocalStorage, depois: valor };
          localStorage.setItem(chave, valor);
        }
      });

      // Exibe apenas se houver modificações
      if (Object.keys(diferencas).length > 0) {
        console.log("🔄 Sincronizado Firestore → LocalStorage:", diferencas);
        atualizarLista();
      }
    }
  });
}