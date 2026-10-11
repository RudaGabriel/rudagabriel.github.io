/* =========================================================
   Nuvem — configuração única (feita pelo dono do site)
   ---------------------------------------------------------
   Preencha UMA ou MAIS opções. Cada opção preenchida aparece
   como um botão de login para quem usa o app. As que ficarem
   como null simplesmente não aparecem.

   Passo a passo de cada uma: veja o README.
   ========================================================= */

export const NUVEM = {
	/* 1) Google (Firebase) — "Entrar com Google" + listas por código.
	   Cole aqui o objeto firebaseConfig do seu projeto. Exemplo:
	   firebase: {
	     apiKey: "AIza...",
	     authDomain: "seu-projeto.firebaseapp.com",
	     projectId: "seu-projeto",
	     storageBucket: "seu-projeto.appspot.com",
	     messagingSenderId: "123456789",
	     appId: "1:123456789:web:abc123"
	   }, */
	firebase: null,

	/* 2) E-mail (Supabase) — "Entrar com e-mail" (sem senha) + listas por código.
	   supabase: { url: "https://xxxx.supabase.co", chave: "sua anon/public key" }, */
	supabase: null,

	/* 3) Dropbox — "Entrar com Dropbox" (os dados ficam no Dropbox de cada pessoa).
	   dropbox: { appKey: "sua app key" }, */
	dropbox: null
};
