/* =========================================================
   Nuvem — configuração única (feita pelo dono do site)
   ---------------------------------------------------------
   Preencha UMA ou MAIS opções. Cada opção preenchida aparece
   como um botão de login para quem usa o app. As que ficarem
   como null simplesmente não aparecem.

   Passo a passo de cada uma: veja o README.
   ========================================================= */

export const NUVEM = {
	/* 1) Google (Firebase) — "Entrar com Google", "Entrar com e-mail" (link) + listas por código.
	   Cole aqui o objeto firebaseConfig do seu projeto. Exemplo:
	   firebase: {
	     apiKey: "AIza...",
	     authDomain: "seu-projeto.firebaseapp.com",
	     projectId: "seu-projeto",
	     storageBucket: "seu-projeto.appspot.com",
	     messagingSenderId: "123456789",
	     appId: "1:123456789:web:abc123"
	   }, */
	firebase: {
		apiKey: "AIzaSyB-tuxoS2ZPyQEmfJ1ka8IUoaAw_vHAmh8",
		authDomain: "sincronizarestoque.firebaseapp.com",
		projectId: "sincronizarestoque",
		storageBucket: "sincronizarestoque.firebasestorage.app",
		messagingSenderId: "29639046896",
		appId: "1:29639046896:web:c8bf173e5bf9b62258f435"
	},

	/* 2) E-mail (Supabase) — "Entrar com e-mail" (sem senha) + listas por código.
	   Use a chave "publishable" (sb_publishable_…) ou "anon public". NUNCA a "secret"/"service_role".
	   supabase: { url: "https://xxxx.supabase.co", chave: "sua anon/public key" }, */
	supabase: {
		url: "https://pmvmpftigwjpiasbktvt.supabase.co",
		chave: "sb_publishable_lVIj7dolUL-ise_q6JzSSA_U3PG5Jo3"
	},

	/* 3) Dropbox — "Entrar com Dropbox" (os dados ficam no Dropbox de cada pessoa).
	   Só o App key. NUNCA coloque aqui o App secret nem um access token.
	   dropbox: { appKey: "sua app key" }, */
	dropbox: { appKey: "dp43yrw0n4j56a9" }
};
