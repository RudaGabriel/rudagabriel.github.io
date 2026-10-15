/* =========================================================
   Service worker — o app abre sem internet e, com internet,
   sempre pega a versão nova.
   ---------------------------------------------------------
   • Páginas (index, privacidade): rede primeiro; sem rede,
     a última versão guardada.
   • Arquivos do app com "?v=" (js/css): guardados de vez
     (cada publicação muda o "?v=", então nunca fica velho).
   • Ícones/manifesto: mostra o guardado e atualiza por trás.
   • Bibliotecas e fontes de CDN (endereço com versão fixa):
     guardadas na primeira vez.
   • Dados (nuvem, intermediário, buscas, anúncios): nunca
     passam pelo cache — sempre direto da rede.
   A lista dos arquivos do app é lida do próprio index.html
   (importmap + <script>/<link>), então não precisa manter
   lista à mão aqui.
   ========================================================= */
const CACHE_APP = "cv-app-v1";
const CACHE_LIBS = "cv-libs-v1";
const LIMITE_LIBS = 120;
const TEMPO_REDE_MS = 4000;
const HOSTS_LIBS = new Set(["cdn.jsdelivr.net", "unpkg.com", "www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "tessdata.projectnaptha.com"]);
// Nunca guardar: nuvem, logins, intermediário, bases de produtos e anúncios
const NUNCA = /(firestore\.googleapis|identitytoolkit|securetoken|firebaseinstallations|workers\.dev|supabase\.co|dropbox|openfoodfacts|openproductsfacts|openbeautyfacts|openpetfoodfacts|wikidata|upcitemdb|googlesyndication|doubleclick|googleadservices|google-analytics|googletagmanager)/i;

/** Arquivos do app citados no index.html (caminhos locais, com o "?v=" atual). */
async function arquivosDoApp() {
	const lista = new Set(["./", "./index.html", "./manifest.webmanifest", "./privacidade.html",
		"./icones/icone.svg", "./icones/icone-192.png", "./icones/icone-512.png", "./icones/favicon-32.png", "./icones/apple-touch-icon.png"]);
	try {
		const r = await fetch("./index.html", { cache: "no-cache" });
		const html = r.ok ? await r.text() : "";
		const mapa = html.match(/<script type="importmap">([\s\S]*?)<\/script>/i);
		if (mapa) {
			try { Object.values(JSON.parse(mapa[1]).imports || {}).forEach(u => lista.add(u)); } catch { /* importmap inválido: segue com o resto */ }
		}
		for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
			const u = m[1];
			if (!/^(https?:|data:|#|mailto:|javascript:)/i.test(u)) lista.add(u.startsWith(".") ? u : `./${u}`);
		}
	} catch { /* sem rede na instalação: guarda o básico */ }
	return [...lista];
}

self.addEventListener("install", evento => {
	evento.waitUntil((async () => {
		const cache = await caches.open(CACHE_APP);
		const lista = await arquivosDoApp();
		// Um arquivo que falhe não impede os outros
		await Promise.all(lista.map(u => cache.add(new Request(u, { cache: "reload" })).catch(() => { })));
		await self.skipWaiting();
	})());
});

self.addEventListener("activate", evento => {
	evento.waitUntil((async () => {
		// Apaga caches de versões antigas deste service worker
		const nomes = await caches.keys();
		await Promise.all(nomes.filter(n => n.startsWith("cv-") && n !== CACHE_APP && n !== CACHE_LIBS).map(n => caches.delete(n)));
		// Arquivos com "?v=" antigo (de publicações anteriores) não servem mais
		const atuais = new Set((await arquivosDoApp()).map(u => new URL(u, self.registration.scope).href));
		const cache = await caches.open(CACHE_APP);
		for (const req of await cache.keys()) {
			const u = new URL(req.url);
			if (u.searchParams.has("v") && !atuais.has(u.href)) await cache.delete(req);
		}
		await self.clients.claim();
	})());
});

/** Rede primeiro (com tempo limite); sem rede, o guardado. */
async function redePrimeiro(req, chaveCache) {
	const cache = await caches.open(CACHE_APP);
	try {
		const resposta = await Promise.race([
			fetch(req),
			new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo")), TEMPO_REDE_MS))
		]);
		if (resposta.ok) cache.put(chaveCache, resposta.clone()).catch(() => { });
		return resposta;
	} catch {
		return (await cache.match(chaveCache, { ignoreSearch: true }))
			|| (await cache.match("./index.html"))
			|| new Response("Sem conexão.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
	}
}

/** Guardado primeiro; se não tiver, busca e guarda. */
async function guardadoPrimeiro(req, nomeCache) {
	const cache = await caches.open(nomeCache);
	const guardado = await cache.match(req);
	if (guardado) return guardado;
	const resposta = await fetch(req);
	if (resposta.ok || resposta.type === "opaque") {
		await cache.put(req, resposta.clone()).catch(() => { });
		if (nomeCache === CACHE_LIBS) limitar(cache, LIMITE_LIBS);
	}
	return resposta;
}

/** Mostra o guardado na hora e atualiza por trás (para o próximo acesso). */
async function guardadoEAtualiza(req, evento) {
	const cache = await caches.open(CACHE_APP);
	const guardado = await cache.match(req, { ignoreSearch: true });
	const daRede = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()).catch(() => { }); return r; });
	if (guardado) { evento.waitUntil(daRede.catch(() => { })); return guardado; }
	return daRede;
}

async function limitar(cache, maximo) {
	const chaves = await cache.keys();
	for (let i = 0; i < chaves.length - maximo; i++) await cache.delete(chaves[i]);
}

self.addEventListener("fetch", evento => {
	const req = evento.request;
	if (req.method !== "GET") return;
	let url;
	try { url = new URL(req.url); } catch { return; }
	if (!/^https?:$/.test(url.protocol) || NUNCA.test(url.href)) return;
	const mesmaOrigem = url.origin === self.location.origin;

	if (req.mode === "navigate" && mesmaOrigem) {
		// Chave sem a parte depois de "#"/"?" (links de convite usam "#lista=…")
		const chave = new URL(url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname, url.origin).href;
		evento.respondWith(redePrimeiro(req, chave));
		return;
	}
	if (mesmaOrigem) {
		if (url.pathname.endsWith("/sw.js")) return;
		evento.respondWith(url.searchParams.has("v") ? guardadoPrimeiro(req, CACHE_APP) : guardadoEAtualiza(req, evento));
		return;
	}
	if (HOSTS_LIBS.has(url.hostname)) {
		// Folha de estilos das fontes muda pouco, mas não tem versão no endereço: atualiza por trás
		if (url.hostname === "fonts.googleapis.com") {
			evento.respondWith((async () => {
				const cache = await caches.open(CACHE_LIBS);
				const guardado = await cache.match(req);
				const daRede = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()).catch(() => { }); return r; });
				if (guardado) { evento.waitUntil(daRede.catch(() => { })); return guardado; }
				return daRede;
			})());
			return;
		}
		evento.respondWith(guardadoPrimeiro(req, CACHE_LIBS));
	}
});
