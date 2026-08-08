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
  "inputHash": "sha256:<64 lowercase hex digits>",
  "graphRevision": 3,
  "correlationId": "run:example/invocation:1",
  "idempotencyKey": "project:example/tool:kicad.project.export/rev:3/input:...",
  "operationClass": "reversible",
  "timeoutMs": 300000,
  "maxOutputBytes": 10485760,
  "input": {}
}
```

必須項目は`toolName`、`contractVersion`、`inputHash`、`graphRevision`、
`correlationId`、`idempotencyKey`、`operationClass`、`timeoutMs`、typed `input`です。
`irreversible`では`approvalId`も必須です。input hashはcanonical JSONに対して
計算し、同じkeyで別inputを送らない。

## Result／Error

Schemaの`toolResult`は`kind: "result"`、`status`（`completed`、`timedOut`、
`cancelled`、`failed`）、requestの識別項目、開始／終了時刻、tool／container
version、provenance、artifact／evidence ID、stdout／stderr、終了コード、signal、
retryability、recoverabilityを持ちます。`rawOutputHash`は生バイトのSHA-256、
`normalizedOutputHash`は正規化後のSHA-256です。ただし現在のprocess boundaryでは
timestamp normalizationを定義していないため、両hashは同じ出力から
計算されます。この同値はrawとnormalizedの混同ではなく、process出力に正規化を
適用しないという仕様です。`bytes`相当の
`outputBytes`も生出力の長さとして保存します。

`toolError`はerror codeを必須とし、taxonomyにない分類を作りません。未分類の
失敗は`tool-failure`として停止し、`context`とEvidence IDに分類不能だった事実を
残します。cancelはerrorではなくresult statusです。timeout、非0終了、起動失敗、
出力上限超過、強制終了はそれぞれ構造化されたprocess結果と既存taxonomy codeで
記録します。

同一attemptの再送は同じ`idempotencyKey`でreplayし、新しいattemptはkey末尾の
`/attempt:<n>`を増分して再実行します。resumeは同じattemptを引き継ぎます。

## 操作分類

- `read`：状態を観測する。副作用を持たない。
- `reversible`：snapshot、patch、生成artifactなど、明示的に戻せる副作用。
- `irreversible`：発注、支払い、公開、削除など。承認IDを要求する。
- ただし発注前最終ゲート合格かつ総発注額が予算上限内の発注は、既定の
  自働発注例外を適用する。

## 冪等性、timeout、cancel

worker/runtime共通registryを`.acd/runs/<runId>/tool-invocations.jsonl`に置く。
appendごとにsyncし、single-writer lockを使い、末尾部分行だけを回復する。保持は
無期限である。同じidempotency keyは一度だけ確定し、再送時は保存済みresultまたは
errorを返して外部processを再実行しない。同じkeyでinput hashが違えば
`reference-integrity`で停止し、上書きしない。`correlationId`はinvocationを関連
付ける値であり、`idempotencyKey`および各eventの`eventId`とは別である。

retry loopとretry budgetの所有者はtask ledgerだけである。tool envelopeは
`retryable`、timeout、cancel、終了情報を返すが、独自のnested retry budgetを持たない。
cancel後の外部processは終了を確認してから`cancelled`として記録する。

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
