/* =========================================================
   Nuvem do app (modo fácil)
   ---------------------------------------------------------
   Preencha UMA VEZ com a configuração de um projeto Firebase
   do dono do site. A partir daí, qualquer pessoa cria uma
   lista na nuvem com um clique, sem conta e sem configurar nada.

   Como preencher:
   1. console.firebase.google.com → crie (ou use) um projeto.
   2. Firestore Database → Criar banco de dados.
   3. Aba "Regras" → cole as regras de REGRAS_NUVEM_FACIL
      (arquivo sync.js ou README) e publique.
   4. Configurações do projeto → Seus apps → app Web (</>)
      → copie os valores do firebaseConfig para o objeto abaixo.

   Enquanto ficar como null, o app mostra apenas a opção
   "Usar meu próprio Firebase".

   Observação: a configuração Web do Firebase não é segredo —
   ela sempre fica visível no navegador. A proteção dos dados
   vem das regras do Firestore e do código aleatório de cada lista.
   ========================================================= */

export const CONFIG_NUVEM_FACIL = null;

/* Exemplo preenchido:
export const CONFIG_NUVEM_FACIL = {
	apiKey: "AIza...",
	authDomain: "seu-projeto.firebaseapp.com",
	projectId: "seu-projeto",
	storageBucket: "seu-projeto.appspot.com",
	messagingSenderId: "123456789",
	appId: "1:123456789:web:abc123"
};
*/
