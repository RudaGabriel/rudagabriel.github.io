# Controle de Vencimento
Controle de vencimento com salvamento no localStorage e opção de importar e exportar
<br>
Sincronização automática: localStorage <> Firebase
<br>
https://console.firebase.google.com/
## Crie um banco de dados na aba Firestore Database
<pre>
const firebaseConfig = {
	apiKey: SUA_CHAVE,
	authDomain: SEU_DOMINIO,
	projectId: SEU_PROJETO,
	storageBucket: SEU_BUCKET,
	messagingSenderId: SEU_ID,
	appId: SUA_APP_ID
};
</pre>
## Ainda na aba Firestore Database, mude as regras conforme
```bash
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dados/{document} {
      allow read, write: if true;
    }
  }
}
```
## Novidades
digite no input de filtro: **`autorizarsyncenviar`** ou **`/ase`** para: ✅ Este usuário foi autorizado a enviar dados ao firebase!
<br>
digite no input de filtro: **`naoautorizarsyncenviar`** ou **`/dse`** para: ❌ Este usuário foi desautorizado a enviar dados ao firebase!
## Acesse o site [CLICANDO AQUI](https://rudagabriel.github.io/) você será redirecionado!
