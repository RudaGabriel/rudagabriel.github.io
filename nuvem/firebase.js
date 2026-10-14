/* =========================================================
   Provedor: Firebase (Google)
   - Lista por código: documento "listas/<CÓDIGO>" com o mapa "itens".
   - Lista PROTEGIDA (permissões garantidas pelo servidor, ver REGRAS_FIREBASE):
       listas/<CÓDIGO>.donoHash      resumo (SHA-256) da chave do dono
       listas/<CÓDIGO>/donos/<uid>   aparelhos/contas que provaram a chave do dono
       listas/<CÓDIGO>/convites/<C>  um por convidado: nome e "editar" (só o dono muda)
       listas/<CÓDIGO>/membros/<uid> aparelho do convidado (convite, nome, aparelho, visto)
     Sem login, cada aparelho entra com login anônimo (só para ter uma identidade).
   - Login com Google ou link no e-mail: "contas/<uid>" guarda o código e a chave da lista da conta.
   - Offline nativo (cache persistente do Firestore).
   ========================================================= */
import { explicarErro, normalizarCodigoLista } from "./comum.js";

const VERSAO = "12.19.0";
const URL_BASE = `https://www.gstatic.com/firebasejs/${VERSAO}`;
const TEMPO_LIMITE_MS = 15000;

export const REGRAS_FIREBASE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function codigoOk(c) { return c.matches('^[A-HJ-NP-Z2-9]{16}$'); }
    function logado() { return request.auth != null; }
    function caminhoLista(c) { return /databases/$(database)/documents/listas/$(c); }
    function caminhoDono(c) { return /databases/$(database)/documents/listas/$(c)/donos/$(request.auth.uid); }
    function caminhoMembro(c) { return /databases/$(database)/documents/listas/$(c)/membros/$(request.auth.uid); }
    function caminhoConvite(c, g) { return /databases/$(database)/documents/listas/$(c)/convites/$(g); }
    // Dono: este aparelho/conta provou que tem a chave do dono
    function ehDono(c) { return logado() && exists(caminhoDono(c)); }
    // Convidado: tem um convite que o dono ainda não removeu
    function conviteDe(c) { return get(caminhoMembro(c)).data.convite; }
    function ehMembro(c) { return logado() && exists(caminhoMembro(c)) && exists(caminhoConvite(c, conviteDe(c))); }
    function membroEdita(c) { return ehMembro(c) && get(caminhoConvite(c, conviteDe(c))).data.editar == true; }
    function protegida(dados) { return dados.get('donoHash', null) != null; }
    function camposLista() {
      return request.resource.data.keys().hasOnly(['itens', 'versao', 'atualizadoEm', 'donoHash'])
        && request.resource.data.itens is map
        && request.resource.data.itens.size() <= 5000;
    }

    match /listas/{codigo} {
      // Ler: quem tem o código (com identidade no app) só VISUALIZA; gravar exige ser dono ou convidado com "pode editar"
      allow get: if codigoOk(codigo) && (resource == null || !protegida(resource.data) || logado());
      allow list, delete: if false;
      allow create: if codigoOk(codigo) && camposLista();
      allow update: if codigoOk(codigo) && camposLista() && (
        // Protegida: só o dono ou convidado com "pode editar"; ninguém troca a chave do dono
        (protegida(resource.data) && request.resource.data.donoHash == resource.data.donoHash
          && (ehDono(codigo) || membroEdita(codigo)))
        // Lista antiga (sem proteção): continua aberta até o dono protegê-la
        || !protegida(resource.data)
      );

      // Aparelhos/contas do dono: entram provando a chave do dono (só o resumo dela fica na lista)
      match /donos/{uid} {
        allow get: if logado() && request.auth.uid == uid;
        allow list, update, delete: if false;
        allow create: if logado() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['segredo', 'criadoEm'])
          && request.resource.data.segredo is string
          && request.resource.data.segredo.size() >= 12
          && hashing.sha256(request.resource.data.segredo).toHexString().lower() == getAfter(caminhoLista(codigo)).data.donoHash;
      }

      // Convites: um por convidado; só o dono cria, muda a permissão e remove
      match /convites/{convite} {
        allow get: if logado();
        allow list, delete: if ehDono(codigo);
        allow create, update: if ehDono(codigo)
          && convite.matches('^[A-HJ-NP-Z2-9]{10}$')
          && request.resource.data.keys().hasOnly(['nome', 'editar', 'criadoEm'])
          && request.resource.data.nome is string && request.resource.data.nome.size() <= 40
          && request.resource.data.editar is bool;
      }

      // Aparelhos dos convidados: o próprio aparelho se registra com um convite válido
      // (não escolhe a permissão: ela fica no convite, que só o dono altera)
      match /membros/{uid} {
        allow get: if logado() && (request.auth.uid == uid || ehDono(codigo));
        allow list: if ehDono(codigo);
        allow create: if logado() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['convite', 'nome', 'aparelho', 'visto'])
          && request.resource.data.convite is string
          && exists(caminhoConvite(codigo, request.resource.data.convite))
          && request.resource.data.nome is string && request.resource.data.nome.size() <= 40
          && request.resource.data.aparelho is string && request.resource.data.aparelho.size() <= 80;
        allow update: if logado() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['convite', 'nome', 'aparelho', 'visto'])
          && request.resource.data.convite == resource.data.convite
          && request.resource.data.nome is string && request.resource.data.nome.size() <= 40
          && request.resource.data.aparelho is string && request.resource.data.aparelho.size() <= 80;
        allow delete: if logado() && (request.auth.uid == uid || ehDono(codigo));
      }
      // Pedidos de acesso: quem só visualiza pede para editar; o dono aprova (cria um convite) ou recusa
      match /pedidos/{uid} {
        allow get: if logado() && (request.auth.uid == uid || ehDono(codigo));
        allow list: if ehDono(codigo);
        allow create: if logado() && request.auth.uid == uid
          && exists(caminhoLista(codigo))
          && request.resource.data.keys().hasOnly(['nome', 'telefone', 'aparelho', 'navegador', 'confirmacao', 'criadoEm', 'status'])
          && request.resource.data.status == 'pendente'
          && request.resource.data.nome is string && request.resource.data.nome.size() >= 2 && request.resource.data.nome.size() <= 40
          && request.resource.data.telefone is string && request.resource.data.telefone.size() <= 20
          && request.resource.data.aparelho is string && request.resource.data.aparelho.size() <= 80
          && request.resource.data.navegador is string && request.resource.data.navegador.size() <= 160
          && request.resource.data.confirmacao is string && request.resource.data.confirmacao.matches('^[0-9]{4}$');
        allow update: if ehDono(codigo)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'convite'])
          && request.resource.data.status in ['aprovado', 'recusado'];
        allow delete: if logado() && (request.auth.uid == uid || ehDono(codigo));
      }
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
	// Só para desenvolvimento/testes: emuladores locais do Firebase
	const e = config.emulador;
	if (e && typeof e === "object" && /^[\w.-]+$/.test(String(e.host || ""))) limpa.emulador = { host: e.host, firestore: Number(e.firestore) || 8080, auth: Number(e.auth) || 9099 };
	return limpa;
}

export function criarFirebase(configBruta, { aoReceber, aoStatus, aoErro, aoUsuario, aoAcessoNegado }) {
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
				const { emulador, ...configApp } = config;
				app = fb.getApps().find(a => a.name === "cv-nuvem") || fb.initializeApp(configApp, "cv-nuvem");
				try {
					db = fb.initializeFirestore(app, {
						localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
						...(config.emulador ? { experimentalForceLongPolling: true } : {})
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
				if (config.emulador) {
					try { fb.connectFirestoreEmulator(db, config.emulador.host, config.emulador.firestore); } catch (e) { console.warn(e); }
					try { fb.connectAuthEmulator(auth, `http://${config.emulador.host}:${config.emulador.auth}`, { disableWarnings: true }); } catch (e) { console.warn(e); }
				}
				// E-mails de login (link) em português
				try { auth.languageCode = "pt-BR"; } catch { /* ignora */ }
				let primeiro;
				const pronto = new Promise(r => { primeiro = r; });
				fb.onAuthStateChanged(auth, u => {
					// O login anônimo é só uma identidade do aparelho: para o app, "sem conta"
					usuario = u && !u.isAnonymous ? { id: u.uid, email: u.email || "", nome: u.displayName || "" } : null;
					primeiro();
					seguro(aoUsuario, usuario);
				});
				await Promise.race([pronto, new Promise(r => setTimeout(r, 4000))]);
			})().catch(e => { preparando = null; db = null; throw e; });
		}
		return preparando;
	}

	/* ---------- Identidade e acesso ---------- */
	/** Garante uma identidade (conta ou anônima). null se o login anônimo estiver desligado no projeto. */
	let semIdentidade = false; // login anônimo desligado no projeto: o servidor recusa listas protegidas
	async function garantirIdentidade() {
		await preparar();
		if (auth.currentUser) { semIdentidade = false; return auth.currentUser.uid; }
		try {
			const r = await fb.signInAnonymously(auth);
			semIdentidade = false;
			return r.user.uid;
		} catch (e) {
			semIdentidade = true;
			console.warn("[firebase] login anônimo indisponível:", e?.code || e);
			if (/operation-not-allowed|admin-restricted/i.test(String(e?.code || e?.message))) {
				console.warn("[nuvem · dono do site] Ative o login Anônimo: Firebase → Authentication → Sign-in method → Anônimo — veja docs/CONFIGURACAO.md");
			}
			return null;
		}
	}

	const negado = e => /permission|insufficient/i.test(String(e?.code || "") + String(e?.message || ""));
	async function resumoChave(segredo) {
		const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo));
		return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
	}

	/**
	 * Dono: prova a chave para esta conta/aparelho (e protege a lista, se ainda não estiver).
	 * @returns {"protegida"|"sem-protecao"} sem-protecao: regras antigas ou sem login anônimo
	 */
	async function garantirDono(codigo, segredo) {
		const uid = await garantirIdentidade();
		if (!uid) return "sem-protecao";
		const refDono = fb.doc(db, "listas", codigo, "donos", uid);
		try { if ((await fb.getDocFromServer(refDono)).exists()) return "protegida"; } catch (e) { if (!negado(e)) throw e; }
		const hash = await resumoChave(segredo);
		// Lista ainda sem proteção (ou nova)? Protege e registra o aparelho no mesmo lote
		let protegidaJa = false, existe = false;
		try {
			const snap = await fb.getDocFromServer(fb.doc(db, "listas", codigo));
			existe = snap.exists();
			protegidaJa = !!snap.data()?.donoHash;
		} catch (e) {
			if (!negado(e)) throw e;
			protegidaJa = true; // não deixa ler: já é protegida
		}
		const lote = fb.writeBatch(db);
		// Lista existente: só acrescenta a chave (NUNCA reescreve os itens); lista nova: cria vazia
		if (!protegidaJa && existe) lote.update(fb.doc(db, "listas", codigo), { donoHash: hash });
		else if (!protegidaJa) lote.set(fb.doc(db, "listas", codigo), { itens: {}, versao: 2, donoHash: hash });
		lote.set(refDono, { segredo, criadoEm: Date.now() });
		try {
			await lote.commit();
			return "protegida";
		} catch (e) {
			if (!negado(e)) throw e;
			if (protegidaJa) throw Object.assign(new Error("Chave do dono incorreta para esta lista."), { code: "chave-dono" });
			console.warn("[nuvem · dono do site] Publique as regras novas do Firestore para proteger as listas — veja docs/CONFIGURACAO.md");
			return "sem-protecao";
		}
	}

	/** Convidado: registra este aparelho com o convite (a permissão fica no convite, controlada pelo dono). */
	async function garantirMembro(codigo, convite, { nome = "", aparelho = "" } = {}) {
		const uid = await garantirIdentidade();
		if (!uid) return "sem-protecao";
		const refMembro = fb.doc(db, "listas", codigo, "membros", uid);
		const dados = { convite, nome: String(nome).slice(0, 40), aparelho: String(aparelho).slice(0, 80), visto: Date.now() };
		try {
			const snap = await fb.getDocFromServer(refMembro);
			if (snap.exists() && snap.data()?.convite === convite) {
				await fb.setDoc(refMembro, dados);
				return "protegida";
			}
			if (snap.exists()) await fb.deleteDoc(refMembro); // trocou de convite (link novo do dono)
		} catch (e) { if (!negado(e)) throw e; }
		try {
			await fb.setDoc(refMembro, dados);
			return "protegida";
		} catch (e) {
			if (!negado(e)) throw e;
			// Convite inexistente/removido — ou regras antigas (aí a lista ainda é aberta)
			try {
				const snap = await fb.getDocFromServer(fb.doc(db, "listas", codigo));
				if (!snap.data()?.donoHash) return "sem-protecao";
			} catch { /* protegida e sem acesso */ }
			throw Object.assign(new Error("Este convite não vale mais."), { code: "convite-invalido" });
		}
	}

	async function conectar(codigo, acesso = {}) {
		desligar();
		const minha = ++geracao;
		recebeuDoServidor = false;
		seguro(aoStatus, "conectando");
		await preparar();
		if (minha !== geracao) return;
		let protecao = "sem-protecao";
		if (acesso.segredo) protecao = await garantirDono(codigo, acesso.segredo);
		else if (acesso.convite) protecao = await garantirMembro(codigo, acesso.convite, acesso);
		else if (await garantirIdentidade()) {
			// Só visualizar (entrou com o código da lista): descobre se a lista já é protegida
			try { protecao = (await fb.getDocFromServer(fb.doc(db, "listas", codigo))).data()?.donoHash ? "protegida" : "sem-protecao"; }
			catch { /* offline: tenta de novo na próxima conexão */ }
		}
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
			if (negado(erro)) seguro(aoAcessoNegado, erro);
			seguro(aoStatus, "erro", emitirErro(erro).mensagem);
		});
		return { protecao };
	}

	/* ---------- Convites (dono) e permissão (convidado) ---------- */
	/** Dono: acompanha convites e aparelhos dos convidados. Devolve a função para parar. */
	function ouvirConvidados(codigo, aoMudar) {
		if (!db) return () => { };
		let convites = [], membros = [], vivo = true;
		const emitir = () => vivo && seguro(aoMudar, { convites, membros });
		const erro = e => console.warn("[firebase] convidados:", e?.code || e);
		const pararC = fb.onSnapshot(fb.collection(db, "listas", codigo, "convites"), snap => {
			convites = snap.docs.map(d => ({ codigo: d.id, ...d.data() }));
			emitir();
		}, erro);
		const pararM = fb.onSnapshot(fb.collection(db, "listas", codigo, "membros"), snap => {
			membros = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
			emitir();
		}, erro);
		return () => { vivo = false; try { pararC(); pararM(); } catch { /* ignora */ } };
	}

	function salvarConvite(codigo, convite, { nome, editar, criadoEm }) {
		return fb.setDoc(fb.doc(db, "listas", codigo, "convites", convite), {
			nome: String(nome || "Convidado").slice(0, 40),
			editar: !!editar,
			criadoEm: Number(criadoEm) || Date.now()
		});
	}

	/** Remove o convite e os aparelhos que entraram com ele (perdem o acesso na hora). */
	async function removerConvite(codigo, convite, uidsMembros = []) {
		const lote = fb.writeBatch(db);
		lote.delete(fb.doc(db, "listas", codigo, "convites", convite));
		for (const uid of uidsMembros) lote.delete(fb.doc(db, "listas", codigo, "membros", uid));
		await lote.commit();
	}

	/** Convidado: acompanha o próprio convite (permissão definida pelo dono). */
	function ouvirMeuConvite(codigo, convite, aoMudar) {
		if (!db) return () => { };
		return fb.onSnapshot(fb.doc(db, "listas", codigo, "convites", convite), { includeMetadataChanges: true }, snap => {
			if (snap.metadata.fromCache && !snap.exists()) return; // ainda sem resposta do servidor
			seguro(aoMudar, snap.exists() ? { existe: true, editar: snap.data()?.editar === true, doServidor: !snap.metadata.fromCache } : { existe: false, doServidor: !snap.metadata.fromCache });
		}, e => seguro(aoMudar, { erro: e, negado: negado(e) }));
	}

	/* ---------- Pedidos de acesso (quem só visualiza pede para editar) ---------- */
	async function enviarPedido(codigo, dados) {
		const uid = await garantirIdentidade();
		if (!uid) throw Object.assign(new Error("Sem identidade no servidor."), { code: "sem-identidade" });
		await fb.setDoc(fb.doc(db, "listas", codigo, "pedidos", uid), {
			nome: String(dados.nome || "").slice(0, 40),
			telefone: String(dados.telefone || "").slice(0, 20),
			aparelho: String(dados.aparelho || "").slice(0, 80),
			navegador: String(dados.navegador || "").slice(0, 160),
			confirmacao: String(dados.confirmacao || ""),
			criadoEm: Date.now(),
			status: "pendente"
		});
	}

	/** Quem pediu: acompanha o próprio pedido (aprovado → recebe o convite). */
	function ouvirMeuPedido(codigo, aoMudar) {
		const uid = auth?.currentUser?.uid;
		if (!db || !uid) return () => { };
		return fb.onSnapshot(fb.doc(db, "listas", codigo, "pedidos", uid), snap => {
			seguro(aoMudar, snap.exists() ? { existe: true, ...snap.data() } : { existe: false });
		}, e => console.warn("[firebase] pedido:", e?.code || e));
	}

	async function cancelarPedido(codigo) {
		const uid = auth?.currentUser?.uid;
		if (uid) await fb.deleteDoc(fb.doc(db, "listas", codigo, "pedidos", uid));
	}

	/** Dono: acompanha os pedidos pendentes. */
	function ouvirPedidos(codigo, aoMudar) {
		if (!db) return () => { };
		return fb.onSnapshot(fb.collection(db, "listas", codigo, "pedidos"), snap => {
			seguro(aoMudar, snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(p => p.status === "pendente"));
		}, e => console.warn("[firebase] pedidos:", e?.code || e));
	}

	/** Dono: aprova (cria o convite com "pode editar" e responde o pedido no mesmo lote) ou recusa. */
	async function responderPedido(codigo, uid, { aprovar, convite, nome }) {
		const lote = fb.writeBatch(db);
		if (aprovar) {
			lote.set(fb.doc(db, "listas", codigo, "convites", convite), { nome: String(nome || "Convidado").slice(0, 40), editar: true, criadoEm: Date.now() });
			lote.update(fb.doc(db, "listas", codigo, "pedidos", uid), { status: "aprovado", convite });
		} else {
			lote.update(fb.doc(db, "listas", codigo, "pedidos", uid), { status: "recusado" });
		}
		await lote.commit();
	}

	/** Convidado: atualiza nome/aparelho e "visto por último". */
	async function atualizarMembro(codigo, { nome = "", aparelho = "" } = {}) {
		const uid = auth?.currentUser?.uid;
		if (!uid) return;
		const refMembro = fb.doc(db, "listas", codigo, "membros", uid);
		await fb.updateDoc(refMembro, { nome: String(nome).slice(0, 40), aparelho: String(aparelho).slice(0, 80), visto: Date.now() });
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

	/* ---------- Login por link no e-mail (sem senha) ---------- */
	const CHAVE_EMAIL = "cv2:emailLinkFirebase";

	async function enviarLinkEmail(email) {
		await preparar();
		await fb.sendSignInLinkToEmail(auth, email, {
			url: location.origin + location.pathname,
			handleCodeInApp: true
		});
		try { localStorage.setItem(CHAVE_EMAIL, email); } catch { /* ignora */ }
	}

	/** A página foi aberta pelo link do e-mail? (checagem rápida, sem carregar o Firebase) */
	const ehRetornoLinkEmail = () => /[?&]oobCode=/.test(location.search) && /[?&]mode=signIn/.test(location.search);

	/**
	 * Conclui o login do link do e-mail.
	 * Retorna o usuário; { precisaEmail: true } se o link foi aberto em outro aparelho; ou null.
	 */
	async function concluirLinkEmail(emailInformado) {
		await preparar();
		const url = location.href;
		if (!fb.isSignInWithEmailLink(auth, url)) return null;
		let email = emailInformado;
		if (!email) { try { email = localStorage.getItem(CHAVE_EMAIL); } catch { email = null; } }
		if (!email) return { precisaEmail: true };
		const r = await fb.signInWithEmailLink(auth, email, url);
		try { localStorage.removeItem(CHAVE_EMAIL); } catch { /* ignora */ }
		try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* ignora */ }
		usuario = { id: r.user.uid, email: r.user.email || email, nome: r.user.displayName || "" };
		return usuario;
	}

	async function sair() {
		if (!auth || !auth.currentUser || auth.currentUser.isAnonymous) return;
		try { await fb.signOut(auth); } catch (e) { console.warn(e); }
		usuario = null;
	}

	/** Lista da conta: { codigo, segredo } (segredo = chave do dono, guardada só na conta). */
	async function listaDaConta(uid) {
		await preparar();
		const snap = await fb.getDoc(fb.doc(db, "contas", uid));
		if (!snap.exists()) return null;
		const codigo = normalizarCodigoLista(snap.data()?.lista);
		const segredo = String(snap.data()?.segredo || "");
		return codigo ? { codigo, segredo: /^[A-HJ-NP-Z2-9]{12}$/.test(segredo) ? segredo : "" } : null;
	}

	async function salvarListaNaConta(uid, codigo, segredo = "") {
		await preparar();
		const dados = { lista: codigo, atualizadoEm: fb.serverTimestamp() };
		if (segredo) dados.segredo = segredo;
		await fb.setDoc(fb.doc(db, "contas", uid), dados, { merge: true });
	}

	return {
		id: "firebase",
		nome: "Google",
		disponivel: !!config,
		recursos: { codigo: true, login: "google", email: true, convidados: true },
		preparar,
		conectar,
		desligar,
		salvarVarios,
		removerVarios,
		entrarGoogle,
		enviarLinkEmail,
		ehRetornoLinkEmail,
		concluirLinkEmail,
		sair,
		listaDaConta,
		salvarListaNaConta,
		ouvirConvidados,
		salvarConvite,
		removerConvite,
		ouvirMeuConvite,
		atualizarMembro,
		enviarPedido,
		ouvirMeuPedido,
		cancelarPedido,
		ouvirPedidos,
		responderPedido,
		get usuario() { return usuario; },
		get semIdentidade() { return semIdentidade; }
	};
}
