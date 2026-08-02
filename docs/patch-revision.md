# Patchとリビジョン

**ステータス：Draft**

## 目的と権威範囲

設計グラフの不変リビジョンに対する変更を、再現可能・検査可能・冪等に
表現します。Phase 0のcanonical snapshotとappend-only patch JSONLの契約です。

## リビジョン

- 初期snapshotは`revision = 0`とする。
- 正常に適用されたpatchは`baseRevision`から一つの
  `resultRevision = baseRevision + 1`を生成する。
- リビジョンは上書きしない。snapshotは新しいrevisionとして保存する。
- patchの順序は`baseRevision`、受理順、patch IDで決定的に記録する。
- 欠番、逆行、同じresult revisionへの二重書き込みは拒否する。

## Patch envelope

```json
{
  "patchId": "patch:example:001",
  "baseRevision": 0,
  "resultRevision": 1,
  "operations": [{ "op": "replace", "path": "/entities/0/name", "value": "example" }],
  "createdAt": "2026-01-01T00:00:00Z",
  "createdBy": "agent:example"
}
```

既存Schemaのpatch構造をPhase 0の最小形式とし、追加のsemantic validationを
本書で定めます。

## 操作形式

- 操作はRFC 6902 JSON Patchの`add`、`remove`、`replace`、`test`を使う。
- `path`はRFC 6901 JSON Pointerとして解釈する。`~0`と`~1`のエスケープを
  必ず処理する。
- 配列の数値indexを永続的なEntity識別子として使わない。Entity配列を変更する
  操作は、適用前に安定IDを解決し、対象の存在と一意性を検査する。
- `test`は適用前の値を厳密比較し、不一致ならpatch全体を適用しない。
- `add`、`remove`、`replace`の各操作は記載順に適用する。
- 不明な操作、未指定のvalue、対象不存在、型違反はpatch conflictまたは
  schema-invalidとして停止する。

## 原子適用と競合

1. `baseRevision`が現在revisionと一致するか確認する。
2. 操作列を一時snapshotへ適用する。
3. Schemaとsemantic validatorを実行する。
4. 出力hashと`resultRevision`を計算する。
5. 全て成功した場合だけsnapshot、patch JSONL、イベントを同一トランザクション
   として確定する。

いずれかが失敗した場合、元snapshotは変更しない。base revision不一致、
`test`不一致、同一ID競合、参照破壊はjidokaとして停止し、自動マージしない。

## 冪等な再送

同じ`patchId`を同じprojectへ再送した場合、既に確定済みなら保存済みの結果を
返し、二重適用しない。patchIdが同じなのにpayload hashまたはbase revisionが
異なる場合はpatch conflictとして停止する。未確定の実行は再読込時にイベントと
snapshotから判断し、確定または明示的失敗へ収束させる。

## 変更理由と再検証範囲の提案

patchには変更理由と、提案する再検証範囲（対象ゲート、除外したゲートと除外理由）をイベントまたは`Rationale`として記録する。提案は検証省略の根拠にならず、実際の再検証範囲は決定論的な影響分析とゲート契約が決める（[`verification-gates.md`](verification-gates.md)参照）。

## Phase 0の制限

競合解決、複数ユーザー同期、差分の自動rebase、型付き影響伝播はPhase 0の
必須機能ではない。未定義の影響は狭く見積もらず、より広い再検証へ送る。

## 関連文書

- [`design-graph.md`](design-graph.md)
- [`event-log.md`](event-log.md)
- [`error-taxonomy.md`](error-taxonomy.md)
- [`../schemas/design-graph.schema.json`](../schemas/design-graph.schema.json)
