# Controle de Vencimento

Controle a validade dos seus produtos, receba alertas de vencimento e compartilhe a mesma lista entre vários aparelhos.

👉 **Acesse:** https://rudagabriel.github.io/

## Recursos

- Cadastro com código de barras (câmera com flash, zoom e troca de câmera, leitura por foto ou leitor USB), produto, quantidade e vencimento
- Resumo com filtros rápidos: **Vencendo**, **Vencidos**, **Vencem este mês** e **Em dia**
- Situação clara em cada item ("Vence em 5 dias", "Venceu há 3 dias")
- Alerta ao abrir o app, com opção de silenciar por produto
- Busca sem acentos, ordenação, edição, remoção com **Desfazer**
- Backup/restauração (`.json`) e exportação para planilha (`.csv`)
- Tema claro e escuro, layout próprio para celular
- Salvar e compartilhar em tempo real (opcional), funcionando também offline

## Salvar na nuvem e compartilhar

Sem fazer nada, os produtos ficam salvos **apenas no aparelho**. Para usar a mesma lista em vários aparelhos:

### Modo fácil (recomendado)

1. Toque no botão de sincronização (topo) → **Criar lista na nuvem**. Pronto: um clique, sem cadastro.
2. Nos outros aparelhos, abra o **link** ou leia o **QR Code** exibido — ou digite o **código da lista** (ex.: `ABCD-EFGH-JKLM-NPQR`).
   - **Pode editar:** o aparelho adiciona, altera e remove produtos.
   - **Só visualizar:** o aparelho apenas acompanha a lista.

> Guarde o código da lista: com ele você recupera os produtos em qualquer aparelho. Quem tiver o link ou o código acessa a lista.

#### Para o dono do site: ativar a nuvem do app (uma única vez)

O modo fácil usa um projeto Firebase do próprio site. Enquanto `config-nuvem.js` estiver com `null`, o app mostra só o modo avançado.

1. Em https://console.firebase.google.com/ crie (ou reutilize) um projeto e, em **Firestore Database**, crie o banco.
2. Na aba **Regras**, publique:

```
rules_version = '2';
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
  }
}
```

   Se reutilizar o projeto antigo, mantenha também o bloco `match /dados/{document}` que já existia.

3. Em **Configurações do projeto → Seus apps**, adicione um app Web e copie os valores do `firebaseConfig` para `config-nuvem.js`.

Cada lista fica em `listas/<código>`; o código tem 16 caracteres aleatórios (impossível de adivinhar) e ninguém consegue listar as listas dos outros.

### Modo avançado: usar o próprio Firebase

Em **Avançado: usar meu próprio Firebase**, cole o bloco `firebaseConfig` do seu projeto e escolha um nome de lista. As regras necessárias são:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dados/{document} {
      allow read, write: if true;
    }
  }
}
```

Cada lista é salva em `dados/lista-<nome>`. Quem já usava a versão anterior é migrado automaticamente (produtos, alertas e configuração do Firebase) — os dados antigos continuam guardados.

### Comandos (compatibilidade)

Digite no campo de busca:

- **`autorizarsyncenviar`** ou **`/ase`** — permite que este aparelho edite a lista compartilhada
- **`naoautorizarsyncenviar`** ou **`/dse`** — deixa este aparelho como somente leitura

## Bibliotecas

[Firebase 12](https://firebase.google.com/) · [SweetAlert2](https://sweetalert2.github.io/) · [Notyf](https://carlosroso.com/notyf/) · [Lucide](https://lucide.dev/) · [barcode-detector / ZXing-C++](https://github.com/Sec-ant/barcode-detector) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) · [AutoAnimate](https://auto-animate.formkit.com/)
