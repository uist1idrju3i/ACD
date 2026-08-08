# ADR-0029：JSONL耐久・回復セマンティクス

**ステータス：Accepted（Phase 4 WP1／WP2）**

## 目的と権威範囲

Phase 4のworker-owned runで使用するappend-only JSONLの耐久性、排他、クラッシュ回復、
破損時の停止条件を固定する。

## 文脈

ラン台帳、event log、checkpointは再接続とworker再開の正規状態である。append-only形式を
採用する場合、書き込み完了の境界、単一writerの保証、クラッシュ末尾、途中行破損、
保持方針を明示しなければ、未検証状態を再開したり不完全な証跡を合格扱いしたりする
危険がある。

## 決定

1. 各イベントappendの完了時に`fsync`または`fdatasync`を実行する。
2. 1 runにつきwriterは単一プロセス・単一ハンドルに固定し、ロックファイル方式で
   同時writerを拒否する。
3. クラッシュ後に末尾の部分行がある場合、その部分行だけを切り捨て、最後の完全行まで
   回復する。
4. 完全行のハッシュ不整合など途中行の破損を検出した場合は即停止し、unknownとして
   扱う。passへ変換しない。
5. Phase 4では無期限保持とし、圧縮を行わない。

## 代替案

- バッチ単位のsync：クラッシュ時にappend済みイベントの耐久境界が不明になるため採用しない。
- 複数writerとOSロックだけで運用する：順序と単一runの所有権を決定論的に固定できないため採用しない。
- 末尾を含む任意の破損を修復する：証跡を改変してpassへ流す危険があるため採用しない。
- 期限付き保持または圧縮：Phase 4受入証跡の再現性と監査可能性を損なうため採用しない。

## 結果とリスク

appendごとのsyncにより書き込みコストは増えるが、耐久境界を明確にできる。末尾部分行は
回復できる一方、途中行破損は停止してEvidenceを残す。保持期間と圧縮は後続ADRで再検討
できるが、Phase 4の正規経路では変更しない。

## 参照

- [`0024-long-running-run-ownership-and-persistence.md`](0024-long-running-run-ownership-and-persistence.md)
- [`0025-checkpoint-granularity-and-invalidation.md`](0025-checkpoint-granularity-and-invalidation.md)
- [`../phase4-plan.md`](../phase4-plan.md)
- [`../event-log.md`](../event-log.md)
