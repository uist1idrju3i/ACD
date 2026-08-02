# Phase 0実装計画

**ステータス：Draft（Schema、graph-core、KiCad投影spikeを実装済み）**

## 目的と権威範囲

READMEのPhase 0「データモデル」と、暫定実装プロファイル
[`ADR-0008`](adr/0008-phase0-provisional-implementation-profile.md)を、実装可能な
マイルストーンへ分解します。Phase 0は正規設計グラフと決定論的な契約を作る
フェーズであり、UI、AI、カスタムエンジンを作るフェーズではありません。

## 完了条件

Phase 0は、次の全てを同じCI環境で再現できた時点で完了とします。

1. 固定JSON fixtureをJSON Schema draft 2020-12で検証できる。
2. SchemaからTypeScript型を再生成でき、生成差分を検出できる。
3. ID参照、重複ID、revision、必須Entity、基本的な参照整合性をsemantic
   validatorで検査できる。
4. patchを原子適用し、同じ入力から同じresult revisionとsnapshot hashを得る。
5. 競合、stale入力、壊れた参照を検出して停止できる。
6. fixtureからKiCad投影を生成し、固定CI profileで再オープン、ERC/DRC、
   Gerber/drill出力を実行できる。
7. 正常系と意図的失敗系のgolden taskをreplayし、期待結果とエラー分類を比較
   できる。

## マイルストーン

### M0：fixturesと開発基盤

- 正常な最小2層基板fixtureを作る
- 意図的ERC/DRC失敗、patch conflict、stale result、再オープン失敗の入力を
  作る
- pnpm workspace、Node.js LTS、型チェック・テスト・lintの契約を置く

### M1：Schema検証と型生成

- `schemas/design-graph.schema.json`から型を生成する
- AJV runtime validationを実行する
- Schema validだが意味的に不正なfixtureをsemantic validatorで拒否する

### M2：graph-core semantic validator

- Entity ID、Entity type、revision、参照先存在を検査する
- Projectとentitiesの整合性を検査する
- Phase 0では影響伝播の完全な型付きリンク規則を実装せず、未定義の影響は
  広い再検証へフォールバックする

### M3：patch／replay

- [`patch-revision.md`](patch-revision.md)に従いRFC 6902操作を適用する
- snapshot、patch JSONL、イベントの再生結果を比較する
- conflict、重複送信、途中停止からの再開を検証する

### M4：KiCad投影adapter

- graph fixtureから最小`.kicad_pro`、`.kicad_pcb`、必要な回路図投影を生成する
- adapterの入出力、tool version、入力hash、出力hashを記録する
- 回路図IPCを前提にしない

### M5：`kicad-cli` CI

- [`kicad-ci-profile.md`](kicad-ci-profile.md)の固定環境で再オープン、ERC/DRC、
  Gerber/drillを実行する
- capability probeとstdout/stderr、終了コード、成果物hashを保存する

### M6：golden task

- [`golden-tasks.md`](golden-tasks.md)の全fixtureをreplayする
- 合否、停止理由、stale、conflict、artifact hashの期待値を比較する
- CIが再現不能な差分を検出したらPhase 0完了にしない

## Phase 0に含めないもの

- UI、ブラウザUX、3Dビューア
- LLM、自然言語要件変換、MCP公開
- Phase 1の自然言語入力およびLLMによる`Requirement`変換（Phase 1は事前変換済み
  `Requirement` fixtureから開始する）
- custom router、custom WASM engine
- 永続knowledge baseへの書き戻し
- `FirmwarePackage`の実装・ビルド・検証
- 自動発注、外部checkout、支払い
- 高忠実度SI/PI/EMC、熱、仮想組込み検証
- 最終的なIndexedDB、OPFS、SQLite、RDBの選定
- `ManufacturingProfile`の独立Entity化

## 技術spike

| Spike               | 成功基準                                                                   | 失敗時の扱い                                            |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `kicad-cli`再現性   | 固定KiCad 10.x環境で再オープン、ERC/DRC、Gerber/drill、hashが再現          | CI基準または投影範囲を見直す                            |
| ngspice WASM        | 同一input/model/tool hashでDC/AC/transient、timeout/cancel、結果出力が再現 | Phase 0ゲートには含めず、workerまたは外部Evidenceへ延期 |
| freerouting DSN/SES | 固定fixtureでCLI実行、SES取込、DRC再実行、失敗分類が再現                   | adapterを後続Phaseへ延期                                |
| ブラウザstorage     | quota、snapshot復旧、export/import、中断復旧を確認                         | Phase 0はJSON Repositoryのまま継続                      |

### Spike実測メモ

- **Freerouting DSN/SES（2026-08-02）：** 公式
  `ghcr.io/freerouting/freerouting:2.2.4`（digest
  `sha256:0d010c6bf13b562551e8cb41fb298090006033fa2850e5bfc678c98ecf47111e`）を
  外部processとして実行した。公式の`multichannel_mixer-unrouted.dsn`を入力し、
  `-mp 1`でSESを生成できた（入力約62 KB、SES約33 KB）。ただし、ログ上141
  unrouted nets中128が未配線であり、round-trip成功は「入出力とSES生成」の範囲に
  限定する。DSN/SESのKiCad再取込とDRC合格は未実施のため、Phase 1 adapter採用は
  保留する。FreeroutingはGPLのためjar/containerをvendor・再配布しない。

## 完了レビュー

完了時には、実行コマンド、Node/pnpm/KiCadの版、fixture hash、生成物hash、
既知の未決定事項、失敗したspikeと縮退方針をイベントとCI artifactへ残します。

## 関連文書

- [`../README.md`](../README.md#7-ロードマップ)
- [`adr/0008-phase0-provisional-implementation-profile.md`](adr/0008-phase0-provisional-implementation-profile.md)
- [`patch-revision.md`](patch-revision.md)
- [`event-log.md`](event-log.md)
- [`kicad-ci-profile.md`](kicad-ci-profile.md)
- [`golden-tasks.md`](golden-tasks.md)
