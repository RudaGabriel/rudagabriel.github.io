# Controle de Vencimento

Controle a validade dos seus produtos, receba alertas de vencimento e compartilhe a mesma lista entre vários aparelhos.

👉 **Acesse:** https://rudagabriel.github.io/

## Recursos

- Cadastro com código de barras (leitura pela câmera ou leitor USB), produto, quantidade e vencimento
- Resumo com filtros rápidos: **Vencendo**, **Vencidos**, **Vencem este mês** e **Em dia**
- Situação clara em cada item ("Vence em 5 dias", "Venceu há 3 dias")
- Alerta ao abrir o app, com opção de silenciar por produto
- Busca sem acentos, ordenação, edição, remoção com **Desfazer**
- Backup/restauração (`.json`) e exportação para planilha (`.csv`)
- Tema claro e escuro, layout próprio para celular
- Salvar e compartilhar em tempo real (opcional), funcionando também offline

## Salvar e compartilhar (sincronização)

Sem configurar nada, os produtos ficam salvos **apenas no aparelho**. Para usar a mesma lista em vários aparelhos:

1. Crie um projeto gratuito em https://console.firebase.google.com/
2. Em **Firestore Database**, crie o banco de dados e, na aba **Regras**, publique:

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

3. Em **Configurações do projeto → Seus apps**, adicione um app Web e copie o bloco `firebaseConfig`.
4. No site, clique no botão de sincronização (topo), **cole o bloco inteiro**, escolha um nome de lista e clique em **Conectar**.
5. Nos outros aparelhos, basta abrir o **link de compartilhamento** ou ler o **QR Code** exibido — eles se conectam sozinhos.
   - **Pode editar:** o aparelho adiciona, altera e remove produtos.
   - **Só visualizar:** o aparelho apenas acompanha a lista.

> O link contém a configuração do projeto. Envie apenas para pessoas de confiança.

Cada lista é salva no documento `dados/lista-<nome>` do Firestore. Quem já usava a versão anterior é migrado automaticamente (produtos, alertas e configuração do Firebase) — os dados antigos continuam guardados.

### Comandos (compatibilidade)

Digite no campo de busca:

- **`autorizarsyncenviar`** ou **`/ase`** — permite que este aparelho edite a lista compartilhada
- **`naoautorizarsyncenviar`** ou **`/dse`** — deixa este aparelho como somente leitura

## Bibliotecas

[Firebase 12](https://firebase.google.com/) · [SweetAlert2](https://sweetalert2.github.io/) · [Notyf](https://carlosroso.com/notyf/) · [Lucide](https://lucide.dev/) · [html5-qrcode](https://github.com/mebjas/html5-qrcode) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) · [AutoAnimate](https://auto-animate.formkit.com/)
