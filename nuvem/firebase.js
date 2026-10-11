/* =========================================================
   Provedor: Firebase (Google)
   - Lista por código: documento "listas/<CÓDIGO>" com o mapa "itens".
   - Login com Google: "contas/<uid>" guarda o código da lista da conta.
   - Offline nativo (cache persistente do Firestore).
   ========================================================= */
import { explicarErro, normalizarCodigoLista } from "./comum.js";

const VERSAO = "12.19.0";
const URL_BASE = `https://www.gstatic.com/firebasejs/${VERSAO}`;
const TEMPO_LIMITE_MS = 15000;

export const REGRAS_FIREBASE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /listas/{codigo} {
      allow get: if codigo.matches('^[A-HJ-NP-Z2-9]{16}$');
      allow list, delete: if false;
      allow create, update: if codigo.matches('^[A-HJ-NP-Z2-9]{16}$')
        && request.resource.data.keys().hasOnly(['itens', 'versao', 'atualizadoEm'])
        && request.resource.data.itens is map
        && request.resource.data.itens.size() <= 5000;
    }
    match /contas/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

/** Aceita o objeto firebaseConfig; exige apiKey, projectId e appId. */
export function configFirebaseValida(config) {
	if (!config || typeof config !== "object") return null;
	const chaves = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
	const limpa = {};
	for (const c of chaves) if (typeof config[c] === "string" && config[c].trim()) limpa[c] = config[c].trim();
	if (!limpa.apiKey || !limpa.projectId || !limpa.appId) return null;
	if (!limpa.authDomain) limpa.authDomain = `${limpa.projectId}.firebaseapp.com`;
	return limpa;
}

export function criarFirebase(configBruta, { aoReceber, aoStatus, aoErro, aoUsuario }) {
	const config = configFirebaseValida(configBruta);
	let fb = null, app = null, db = null, auth = null;
	let preparando = null;
	let ref = null;
	let cancelarEscuta = null;
	let temporizador = null;
	let geracao = 0;
	let recebeuDoServidor = false;
	let usuario = null;

	const seguro = (fn, ...a) => { try { fn?.(...a); } catch (e) { console.error(e); } };
	const emitirErro = erro => {
		const info = explicarErro(erro);
		console.warn("[firebase]", erro);
		seguro(aoErro, info);
		return info;
	};

	async function preparar() {
		if (!config) throw new Error("Configuração do Firebase ausente (config-nuvem.js).");
		if (db) return;
		if (!preparando) {
			preparando = (async () => {
				const [mApp, mFs, mAuth] = await Promise.all([
					import(`${URL_BASE}/firebase-app.js`),
					import(`${URL_BASE}/firebase-firestore.js`),
					import(`${URL_BASE}/firebase-auth.js`)
				]);
				fb = { ...mApp, ...mFs, ...mAuth };
				app = fb.getApps().find(a => a.name === "cv-nuvem") || fb.initializeApp(config, "cv-nuvem");
				try {
					db = fb.initializeFirestore(app, {
						localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() })
					});
				} catch (e) {
					console.warn("[firebase] cache persistente indisponível:", e);
					try { db = fb.initializeFirestore(app, { localCache: fb.memoryLocalCache() }); }
					catch { db = fb.getFirestore(app); }
				}
				try {
					auth = fb.initializeAuth(app, {
						persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence],
						popupRedirectResolver: fb.browserPopupRedirectResolver
					});
				} catch {
					auth = fb.getAuth(app);
				}
				fb.onAuthStateChanged(auth, u => {
					usuario = u ? { id: u.uid, email: u.email || "", nome: u.displayName || "" } : null;
					seguro(aoUsuario, usuario);
				});
			})().catch(e => { preparando = null; db = null; throw e; });
		}
		return preparando;
	}

	async function conectar(codigo) {
		desligar();
		const minha = ++geracao;
		recebeuDoServidor = false;
		seguro(aoStatus, "conectando");
		await preparar();
		if (minha !== geracao) return;
		ref = fb.doc(db, "listas", codigo);

		temporizador = setTimeout(() => {
			if (minha !== geracao || recebeuDoServidor) return;
			if (navigator.onLine === false) seguro(aoStatus, "offline", "Sem internet — usando a cópia salva no aparelho.");
			else seguro(aoStatus, "erro", "O Firebase não respondeu. Confira a configuração e se o Firestore foi criado.");
		}, TEMPO_LIMITE_MS);

		cancelarEscuta = fb.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
			if (minha !== geracao) return;
			const doServidor = !snap.metadata.fromCache;
			if (doServidor) { recebeuDoServidor = true; clearTimeout(temporizador); }
			const mapa = snap.exists() ? (snap.data()?.itens || {}) : {};
			const itens = Object.entries(mapa).filter(([, v]) => v && typeof v === "object").map(([id, v]) => ({ ...v, id }));
			seguro(aoReceber, itens, { doServidor });
			if (snap.metadata.hasPendingWrites) seguro(aoStatus, "salvando");
			else if (doServidor) seguro(aoStatus, "sincronizado");
			else if (navigator.onLine === false) seguro(aoStatus, "offline", "Sem internet — as alterações serão enviadas depois.");
		}, erro => {
			if (minha !== geracao) return;
			clearTimeout(temporizador);
			seguro(aoStatus, "erro", emitirErro(erro).mensagem);
		});
	}

	function desligar() {
		geracao++;
		clearTimeout(temporizador);
		try { cancelarEscuta?.(); } catch { /* ignora */ }
		cancelarEscuta = null;
		ref = null;
	}

	const paraDocumento = item => ({
		nome: item.nome,
		quantidade: item.quantidade,
		vencimento: item.vencimento,
		codigoBarras: item.codigoBarras || "",
		criadoEm: item.criadoEm || Date.now(),
		atualizadoEm: item.atualizadoEm || Date.now()
	});

	function escrever(itensMapa) {
		if (!ref || !fb) return Promise.reject(emitirErro(new Error("A nuvem não está conectada.")));
		// Não espera o servidor: o Firestore aplica na hora e envia em segundo plano (inclusive offline)
		return fb.setDoc(ref, { itens: itensMapa, versao: 2, atualizadoEm: fb.serverTimestamp() }, { merge: true })
			.catch(e => { emitirErro(e); throw e; });
	}

	function salvarVarios(itens) {
		if (!itens.length) return Promise.resolve();
		const mapa = {};
		for (const i of itens) mapa[i.id] = paraDocumento(i);
		return escrever(mapa);
	}

	function removerVarios(ids) {
		if (!ids.length || !fb) return Promise.resolve();
		const mapa = {};
		for (const id of ids) mapa[id] = fb.deleteField();
		return escrever(mapa);
	}

	/* ---------- Login com Google ---------- */
	async function entrarGoogle() {
		await preparar();
		const provedor = new fb.GoogleAuthProvider();
		provedor.setCustomParameters({ prompt: "select_account" });
		const r = await fb.signInWithPopup(auth, provedor);
		usuario = { id: r.user.uid, email: r.user.email || "", nome: r.user.displayName || "" };
		return usuario;
	}

	async function sair() {
		if (!auth) return;
		try { await fb.signOut(auth); } catch (e) { console.warn(e); }
		usuario = null;
	}

	async function listaDaConta(uid) {
		await preparar();
		const snap = await fb.getDoc(fb.doc(db, "contas", uid));
		return snap.exists() ? normalizarCodigoLista(snap.data()?.lista) : null;
	}

	async function salvarListaNaConta(uid, codigo) {
		await preparar();
		await fb.setDoc(fb.doc(db, "contas", uid), { lista: codigo, atualizadoEm: fb.serverTimestamp() }, { merge: true });
	}

	return {
		id: "firebase",
		nome: "Google",
		disponivel: !!config,
		recursos: { codigo: true, login: "google" },
		preparar,
		conectar,
		desligar,
		salvarVarios,
		removerVarios,
		entrarGoogle,
		sair,
		listaDaConta,
		salvarListaNaConta,
		get usuario() { return usuario; }
	};
}
