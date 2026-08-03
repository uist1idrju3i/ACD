# ADR-0025：checkpointの粒度と無効化条件

**ステータス：Proposed（Phase 4 WP2／WP3）**

## 背景

Phase 4の再開は、要件からの無意味なやり直しを避けつつ、前提が変わった検証結果を
再利用しないことが必要です。checkpointの粒度とstale判定が曖昧なままだと、古いtool、
library、fab条件、またはKnowledgeItemに基づく結果を現行runの合格証拠として扱う
危険があります。

README §7の「ブラウザ強制終了しても最後のチェックポイントから完走できる」という
完了条件は、ランを所有するworker processの耐久性を測る受入gateとして実施します。
実ブラウザの強制終了と再接続は、WP6のUI回帰で検証します。

## 決定

checkpointはgate境界単位で作成します。checkpointには少なくとも入力hash、設計グラフ
revision、tool／container version、library revision、fab profile、参照KnowledgeItemの
status、成果物hash、検証結果ID、event位置、実行環境を記録します。

次のいずれかが変わったcheckpointはstaleとし、再利用せず対象stageを再実行します。

1. input hash
2. tool versionまたはcontainer version
3. library revision
4. fab profile
5. 参照KnowledgeItem status

完了条件の受入測定は、決定論的なstage境界でworker processを強制終了し、最後の検証済み
checkpointから再開して無中断runと同一の完了結果を得る方法に固定します。workerがランを
所有するため、これはブラウザUIではなく実行基盤の耐久性を直接測定します。

## 代替案

- **全stageをcheckpointにする**：細粒度で再実行を減らせるが、checkpointの整合性と
  保持コストが増え、gate契約との対応が不明確になるため採用しない。
- **入力hashだけでstale判定する**：tool、library、fab条件、KnowledgeItemの変更を
  捕捉できず、古いEvidenceを再利用するため却下する。
- **実ブラウザ強制終了を受入gateの正にする**：UI、browser、workerの複数要因が混ざり、
  ラン所有者の耐久性を直接測定できないため、WP6のUI回帰へ分離する。

## 結果とリスク

- worker process kill後の再開、無中断runとの成果物hash・gate結果比較をWP3で実施します。
- 未検証、失敗、stale、欠落、revision不一致、event replay不一致のcheckpointからは再開せず、
  Evidenceを残して停止します。
- 再開時はidempotency keyを確認し、未確定の副作用を二重実行しません。
- stale判定の対象を拡張する場合は、本ADRとcheckpoint schema、再開テストを同時に更新します。

## 参照

- [`../../README.md`](../../README.md#7-ロードマップ)
- [`../phase4-plan.md`](../phase4-plan.md)
- [`../agent-runtime.md`](../agent-runtime.md)
- [`../event-log.md`](../event-log.md)
- [`../patch-revision.md`](../patch-revision.md)
- [`0024-long-running-run-ownership-and-persistence.md`](0024-long-running-run-ownership-and-persistence.md)
