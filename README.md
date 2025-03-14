# Controle de Vencimento
 Controle de vencimento com salvamento no localStorage e opção de importar e exportar
 <br>
 Sincronização automática: localStorage <> Firebase
 <br>
 # Crie um banco de dados na aba Firestore Database:
 <br>
 const firebaseConfig = {
	apiKey: SUA_CHAVE,
	authDomain: SEU_DOMINIO,
	projectId: SEU_PROJETO,
	storageBucket: SEU_BUCKET,
	messagingSenderId: SEU_ID,
	appId: SUA_APP_ID
};
<br>
# Ainda na aba Firestore Database, mude as regras conforme:
<br>
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dados/{document} {
      allow read, write: if true;
    }
  }
}
 <br>
 digite no input de filtro: <b>autorizarsyncenviar<b/> para: ✅ Este usuário foi autorizado a enviar dados ao firebase!
 <br>
  digite no input de filtro: <b>naoautorizarsyncenviar<b/> para: ❌ Este usuário foi desautorizado a enviar dados ao firebase!
# https://rudagabriel.github.io/