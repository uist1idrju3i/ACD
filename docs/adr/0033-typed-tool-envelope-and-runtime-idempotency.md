# ADR-0033：型付きtool envelopeとruntime共通冪等性

**ステータス：Accepted（Phase 4 WP5）**

## 文脈

外部processの呼び出しがrunnerごとに複製され、request、result、error、timeout、
cancel、出力hash、provenanceの意味が統一されていなかった。再送時の二重実行を
worker/runtime共通で防ぎ、失敗を既存のerror taxonomyで停止させる必要がある。

## 決定

1. tool request/result/error envelopeを`schemas/tool-envelope.schema.json`で型付けする。
   既存のprovenanceとID定義をSchema参照で再利用する。
2. 冪等性registryはtool adapterごとではなくworker/runtime共通とし、
   `.acd/runs/<runId>/tool-invocations.jsonl`へappend-onlyで保存する。appendごとの
   sync、single-writer lock、末尾部分行だけの回復、無期限保持を適用する。
3. 同一keyの再送は保存済みresult/errorを返し、外部processを再実行しない。同一keyで
   input hashが変わる再送は`reference-integrity`で停止する。
4. retry budgetはtask ledgerが単独で所有する。tool envelopeにretry loopを持ち込まない。
5. `correlationId`、`idempotencyKey`、`eventId`を分離する。
6. 外部依存なしの`ProcessPort`をgraph-coreに置き、Nodeのprocess実装をfilesystem
   adapter側へ分離する。timeout、cancel、signal、出力上限を型付きで扱う。
7. 生出力hashとtimestamp-only正規化後hashを別フィールドで保存する。
8. 新しいerror codeは追加しない。Gate 23〜25のstatusは`planned`のままとし、
   WP4、WP6、WP7、Phase 5の機能は本ADRの範囲外とする。

## 結果とリスク

同じinvocationの再送は副作用を重複させず、task ledgerはretry責務を一元管理できる。
一方、registryのsingle writerは同一runの並列writerを拒否する。完全行の破損は修復
せず停止し、unknownをpassへ変換しない。

## 参照

- [`../tool-contract.md`](../tool-contract.md)
- [`0024-long-running-run-ownership-and-persistence.md`](0024-long-running-run-ownership-and-persistence.md)
- [`0029-jsonl-durability-and-recovery-semantics.md`](0029-jsonl-durability-and-recovery-semantics.md)
- [`../phase4-plan.md`](../phase4-plan.md)
