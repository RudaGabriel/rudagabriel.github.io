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
- Salvar na nuvem com login por e-mail (sem senha) ou por código, em tempo real e funcionando offline

## Salvar na nuvem e compartilhar

Sem fazer nada, os produtos ficam salvos **apenas no aparelho**. Para usar a mesma lista em vários aparelhos, toque no botão de nuvem (topo):

- **Entrar com e-mail (recomendado):** digite seu e-mail, receba um código e pronto. Em qualquer outro aparelho, entre com o **mesmo e-mail** e a mesma lista aparece. Sem senha.
- **Criar lista com código (sem login):** um clique gera um código (ex.: `ABCD-EFGH-JKLM-NPQR`). Nos outros aparelhos, abra o **link**, leia o **QR Code** ou digite o código.
  - **Pode editar:** o aparelho adiciona, altera e remove produtos.
  - **Só visualizar:** o aparelho apenas acompanha a lista.

Tudo sincroniza em tempo real e funciona offline (as alterações são enviadas quando a internet voltar).

### Para o dono do site: ativar a nuvem (uma vez, ~2 minutos)

A nuvem usa o [InstantDB](https://www.instantdb.com/) (gratuito). Só é preciso o **App ID**:

1. Acesse https://instantdb.com/dash e entre com sua conta Google.
2. Crie um app (**New app**) e copie o **App ID**.
3. Cole o App ID em [`config-nuvem.js`](config-nuvem.js):
   ```js
   export const INSTANT_APP_ID = "seu-app-id-aqui";
   ```
4. (Recomendado) Em **Permissions**, cole as regras abaixo — assim cada pessoa só acessa a lista cujo código conhece, e cada conta só vê os próprios dados:

```json
{
  "produtos": {
    "bind": [
      "daLista",
      "ruleParams.lista != null && data.lista == ruleParams.lista"
    ],
    "allow": {
      "view": "daLista",
      "create": "daLista",
      "update": "daLista && newData.lista == ruleParams.lista",
      "delete": "daLista"
    }
  },
  "contas": {
    "bind": [
      "dono",
      "auth.id != null && data.usuario == auth.id"
    ],
    "allow": {
      "view": "dono",
      "create": "dono",
      "update": "dono && newData.usuario == auth.id",
      "delete": "dono"
    }
  }
}
```

Enquanto o App ID estiver vazio, o app funciona normalmente, salvando apenas no aparelho.

> Quem usava a sincronização antiga (Firebase) não perde nada: a última cópia da nuvem fica guardada no aparelho. Basta entrar com e-mail para voltar a sincronizar.

### Comandos (compatibilidade)

Digite no campo de busca:

- **`autorizarsyncenviar`** ou **`/ase`** — permite que este aparelho edite a lista compartilhada
- **`naoautorizarsyncenviar`** ou **`/dse`** — deixa este aparelho como somente leitura

## Bibliotecas

[InstantDB](https://www.instantdb.com/) · [SweetAlert2](https://sweetalert2.github.io/) · [Notyf](https://carlosroso.com/notyf/) · [Lucide](https://lucide.dev/) · [barcode-detector / ZXing-C++](https://github.com/Sec-ant/barcode-detector) · [ZXing JS](https://github.com/zxing-js/library) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) · [AutoAnimate](https://auto-animate.formkit.com/)
