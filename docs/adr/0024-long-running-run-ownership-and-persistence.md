# ADR-0024：長時間ランの所有者と永続化形式

**ステータス：Proposed（Phase 4 WP1／WP2／WP6）**

## 背景

Phase 4は、設計ランを途中で中断しても最後の検証済みcheckpointから完走できる
実行基盤を対象とします。ブラウザのUIと長時間ランの所有者を同一にすると、タブ終了や
接続断が実行状態の存続へ直接影響します。一方、台帳とcheckpointには再接続後も参照できる
永続的な境界が必要です。

ADR-0004はブラウザを第一に設計しつつ、重い・長い・秘密性の高い処理を任意のローカル／
サーバーワーカーへ委譲できると定めています。本ADRは、そのワーカーモードでのラン所有と
Phase 4の最小永続化形式を具体化します。

## 決定

ランはworker processが所有します。ブラウザはランを所有せず、状態を観測・操作する再接続
端末として扱います。

1. 台帳とcheckpointは、runごとに`.acd/runs/<runId>/`へappend-only JSONLとして保存します。
2. worker processはランの実行、台帳、checkpoint、event logの整合性を管理します。
3. ブラウザ切断はランの停止を意味しません。再接続時はworkerが保持するrevisionとeventから
   最新状態を取得します。
4. IndexedDB／OPFSはPhase 4の正規永続化には採用しません。ブラウザ側にキャッシュを置く
   場合も、worker側のJSONLを正規状態とします。

## 代替案

- **ブラウザをランの所有者にする**：実装は単純だが、タブ終了中にランを継続できず、
  README §7の完了条件とworker耐久性の検証境界を満たさないため却下する。
- **IndexedDB／OPFSを正規状態にする**：ブラウザ単独実行には適するが、worker processの
  独立実行と再接続を正規経路にしにくく、Phase 4の実行所有者が曖昧になるため却下する。
- **分散workflow engineを導入する**：将来の拡張余地はあるが、Phase 4の最小契約に対して
  運用・依存・検証範囲が過大なため採用しない。

## 結果とリスク

- worker processを強制終了しても、最後の検証済みcheckpointから再開できることを
  Phase 4受入gateで検証します。
- worker停止、JSONL破損、欠落revision、event replay不一致、正規状態との不一致は
  jidoka停止条件とし、未検証状態から再開しません。
- workerの起動、停止、再接続、JSONLの排他と保持期間は実装時に決定論的なテストで固定します。
- ブラウザのみの実行やIndexedDB／OPFSの採用は、必要性が明確になった場合に後続ADRで再検討します。

## 参照

- [`../../README.md`](../../README.md#9-長時間タスクを走り切る実行基盤)
- [`../phase4-plan.md`](../phase4-plan.md)
- [`0004-browser-first-optional-workers.md`](0004-browser-first-optional-workers.md)
- [`../agent-runtime.md`](../agent-runtime.md)
- [`../architecture.md`](../architecture.md)
- [`../event-log.md`](../event-log.md)
