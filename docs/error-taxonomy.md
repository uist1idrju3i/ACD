# エラー分類

**ステータス：Draft**

## 目的と権威範囲

Schema、graph-core、patch、外部tool、検証、承認、予算で発生する異常を安定した
code、severity、jidoka actionへ対応付けます。メッセージ本文を機械判定の契約に
しません。

機械可読なtaxonomy dataは[`../schemas/error-taxonomy.json`](../schemas/error-taxonomy.json)
で管理し、構造は[`../schemas/error-taxonomy.schema.json`](../schemas/error-taxonomy.schema.json)
で検証します。graph-coreが発生させるcodeはtaxonomy dataに含まれなければなりません。

## Code形式

codeは小文字kebab-caseの`<class>-<condition>`形式とします。例：
`schema-invalid`、`patch-conflict`。codeは変更せず、詳細はtyped contextへ入れます。

## 基本分類

| code                   | 意味                                 | severity      | jidoka action                  |
| ---------------------- | ------------------------------------ | ------------- | ------------------------------ |
| `schema-invalid`       | JSON Schema違反                      | error         | 即時停止、pathを表示           |
| `reference-integrity`  | ID重複、未解決参照、循環など         | error         | snapshotを確定せず停止         |
| `patch-conflict`       | base revision、test、ID競合          | error         | 自動mergeせず停止              |
| `revision-invalid`     | 欠番、逆行、result revision不一致    | error         | replay停止、監査通知           |
| `event-replay-failure` | event/hash/replay不一致              | critical      | 再開を止め、snapshotを保全     |
| `tool-timeout`         | deterministic toolの期限超過         | error         | cancel、再試行上限後停止       |
| `tool-failure`         | 外部toolの非ゼロ終了または起動失敗   | error         | stdout/stderrを保存し停止      |
| `reopen-failure`       | KiCad等の再オープン失敗              | critical      | downstreamをブロック           |
| `convergence-failure`  | simulationが収束しない               | error         | Evidenceを未検証として停止     |
| `verification-failed`  | ERC/DRC/DFM等の不合格                | error         | downstreamへ流さない           |
| `stale-result`         | 入力revision/hashが現行と不一致      | error         | 結果を合格証拠から除外         |
| `license-restriction`  | 実行・再配布・モデル利用が許諾範囲外 | critical      | 実行・配布を止めてエスカレート |
| `approval-required`    | 承認IDが必要                         | warning/error | 不可逆操作を保留               |
| `budget-exceeded`      | 予算上限超過                         | error         | 発注を停止し承認を要求         |
| `unknown-impact`       | 影響伝播が未定義                     | warning/error | 広い再検証へフォールバック     |
| `patent-concern`       | 特許リスクの credible concern        | critical      | 実装を停止し法務判断へ         |

## Error envelope

```json
{
  "code": "patch-conflict",
  "severity": "error",
  "message": "base revision does not match",
  "retryable": false,
  "recoverable": true,
  "context": {
    "projectId": "project:example",
    "expectedRevision": 3,
    "actualRevision": 4
  },
  "evidenceIds": []
}
```

`message`は人間向け説明であり、`code`、`severity`、`retryable`、
`recoverable`、contextのschemaを機械契約とします。

## 再試行と停止

timeoutや一時的なtool起動失敗だけを、同一input hash、同一idempotency key、
明示されたretry budget内で再試行できます。patch conflict、schema-invalid、
license-restriction、patent-concern、approval-required、budget-exceededは
盲目的に再試行しません。停止時は何が、どこで、なぜ、再開条件、推奨アクション
をイベントへ記録します。

## 関連文書

- [`agent-runtime.md`](agent-runtime.md)
- [`tool-contract.md`](tool-contract.md)
- [`patch-revision.md`](patch-revision.md)
- [`verification-gates.md`](verification-gates.md)
