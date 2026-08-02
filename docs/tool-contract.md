# 型付きツール契約

**ステータス：Draft**

## 目的と権威範囲

Phase 1以降の外部tool、worker、LLM adapterを同じ決定論的境界へ置く最小契約
です。MCPは後から接続できるtransport adapterであり、本契約そのものではありません。

## Request envelope

```json
{
  "toolName": "kicad.project.export",
  "contractVersion": "0.1.0",
  "inputHash": "sha256:...",
  "graphRevision": 3,
  "idempotencyKey": "project:example/tool:kicad.project.export/rev:3/input:...",
  "operationClass": "reversible",
  "input": {}
}
```

必須項目は`toolName`、`contractVersion`、`inputHash`、`graphRevision`、
`idempotencyKey`、`operationClass`、typed `input`です。input hashはcanonical
JSONに対して計算し、同じkeyで別inputを送らない。

## Result／Error

成功結果はtyped `result`、`toolName`、contract version、input hash、graph
revision、idempotency key、開始／終了時刻、tool version、artifact／evidence ID
を持ちます。失敗結果は[`error-taxonomy.md`](error-taxonomy.md)のerror envelope
を持ち、stdout/stderr、終了コード、retryability、recovery actionを保存します。

## 操作分類

- `read`：状態を観測する。副作用を持たない。
- `reversible`：snapshot、patch、生成artifactなど、明示的に戻せる副作用。
- `irreversible`：発注、支払い、公開、削除など。承認IDを要求する。
- ただし発注前最終ゲート合格かつ総発注額が予算上限内の発注は、既定の
  自働発注例外を適用する。

## 冪等性、timeout、cancel

同じidempotency keyは一度だけ確定する。再送時は以前のresultまたはerrorを返し、
二重patch・二重発注を起こさない。各toolはtimeout、cancel、retry budget、
最大出力サイズを明示する。cancel後の外部processは終了を確認してから停止済み
と記録する。

## 決定論的ゲート

toolは合否を独自に決めるのではなく、入力、tool version、model provenance、
出力hash、error／findingを返す。最終的なgate pass/fail、stale、下流停止は
verification-gatesの契約で決める。

## ツールの適格性

決定論的toolも無条件には信頼しない。既知の合格fixtureと意図的な不合格fixtureで期待どおりに判定できることを確認した記録を持ち、tool、container、model、libraryの版を更新したときは再確認する。再確認が済むまで、旧版で得た合格結果を新版の合格証拠として流用しない（[`golden-tasks.md`](golden-tasks.md)、[`testing.md`](testing.md)参照）。

## Transport

Phase 0は直接TypeScript関数またはCLI adapterでよい。MCP、HTTP、worker IPC、
function callingは、同じrequest/result/error schemaを運ぶ後続transport adapter
として追加する。transportごとに別の業務意味論を作らない。

## 関連文書

- [`agent-runtime.md`](agent-runtime.md)
- [`error-taxonomy.md`](error-taxonomy.md)
- [`repo-structure.md`](repo-structure.md)
- [`verification-gates.md`](verification-gates.md)
