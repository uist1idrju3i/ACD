# イベントログ

**ステータス：Draft**

## 目的と権威範囲

Phase 0の実行、patch、検証、停止、再開を追記専用で記録します。これは
完全な分散runtimeイベント仕様ではなく、snapshotとpatchを再生できる最小契約です。

## 最小イベントEnvelope

```json
{
  "eventId": "event:example:000001",
  "type": "patch.accepted",
  "occurredAt": "2026-01-01T00:00:00Z",
  "actor": "agent:example",
  "projectId": "project:example",
  "baseRevision": 0,
  "resultRevision": 1,
  "payloadHash": "sha256:...",
  "payload": {}
}
```

必須フィールドは`eventId`、`type`、`occurredAt`、`actor`、`projectId`、
`baseRevision`、`resultRevision`、`payloadHash`です。`payload`はイベント種別
ごとのtyped payloadとし、hashはcanonical JSON化したpayloadへ適用します。

## イベント種別

Phase 0では少なくとも次を扱います。

- `snapshot.created`
- `patch.accepted`
- `patch.rejected`
- `verification.started`
- `verification.completed`
- `verification.stale`
- `checkpoint.created`
- `run.stopped`
- `run.resumed`

イベント種別ごとのpayload schemaとerror codeは実装時に追加し、未知の種別は
削除せず`unknown event`として保存してreplayを停止します。

## Append-onlyと順序

- 一度確定したイベントは変更・削除しない。
- `eventId`はproject内で一意にする。
- replay順は保存順ではなく、revision、occurredAt、eventIdを検査した順序とする。
- 同一revisionに複数の結果を確定しない。
- payload hash、snapshot hash、patch IDを相互参照できるようにする。

## Replay

初期snapshotを読み、patch.acceptedイベントのpatchを順に適用して、各
`resultRevision`のsnapshot hashを再計算します。hash不一致、欠落revision、
未知のpatch、イベントの改変はreplay failureとしてjidoka停止します。
`patch.rejected`や`run.stopped`は状態を進めず、停止理由の証拠として残します。

## Checkpoint

checkpointはイベント位置、対象revision、入力hash、成果物hash、検証結果ID、
実行環境を参照します。再開時は最後の検証済みcheckpointから開始し、未確定の
副作用を再実行する前にidempotency keyを確認します。

## Phase 0の範囲と将来拡張

Phase 0では一つのprojectを対象とするJSONLまたは同等のappend-onlyファイルを
想定します。分散順序、マルチユーザー同期、暗号化、保持期間、署名、ストリーム
配信、worker間イベントは後続のruntime仕様で拡張します。

## 関連文書

- [`agent-runtime.md`](agent-runtime.md)
- [`patch-revision.md`](patch-revision.md)
- [`phase0-plan.md`](phase0-plan.md)
- [`error-taxonomy.md`](error-taxonomy.md)
