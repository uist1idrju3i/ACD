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
   `ProcessSpec.cwd`で実行ディレクトリを明示し、既存の外部process呼び出しは
   WP3と同じ`root`を渡す。Node adapterは従来どおり親processの環境変数を継承し、
   `spec.environment`を上書き適用する。これはWP3の`execFileSync`／`spawnSync`の
   継承挙動を維持するためであり、host環境変数のallowlist化は本ADRでは行わない。
   `kicad-cli`、KiCad Python、ngspiceは600秒、FreeRoutingは1800秒、library抽出は
   300秒、出力上限は64 MiBとする。これはPhase 4の外部processが大規模fixtureで
   完了するための固定値であり、retry budgetとは別のprocess watchdogである。
7. 生出力hashとtimestamp-only正規化後hashを別フィールドで保存する。
   Evidence／artifactのhashはWP3互換のraw bytes／raw text semanticsを使い、
   `scripts/golden-shared.mts`の`rawSha256`で計算する。tool envelopeの
   `inputHash`など構造化値のhashにはgraph-coreのcanonical `sha256`を使い、
   両者を同じ関数名で扱わない。これにより、構造化入力のcanonical hashと
   外部artifactの生内容hashを混同しない。
8. timeout/cancelではSIGTERMを送信し、猶予後にSIGKILLへエスカレーションする。
   子processの`close`を受信してから結果またはerrorを永続化する。stdoutとstderrは
   別々に収集し、Evidenceからstderrを欠落させない。
9. registryの完全行は構造検証し、mid-stream破損は`event-replay-failure`で停止する。
   末尾の部分行だけを最後の完全行まで切り捨てて回復する。
10. 新しいerror codeは追加しない。Gate 23〜25のstatusは`planned`のままとし、
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
