# Phase 0実装計画

**ステータス：完了（完了条件1〜7を同一検証環境で再現。残存制約は「実装状況」参照）**

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

## 実装状況

完了条件1〜7は次の実装で再現できます。

| 条件 | 実装                                                                                           | 実行コマンド                                |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1、2 | `schemas/`、`packages/schema`                                                                  | `pnpm schema:validate`、`pnpm typegen-sync` |
| 3    | `packages/graph-core/src/semantic.ts`、`packages/graph-core/src/board.ts`                      | `pnpm test`                                 |
| 4、5 | `packages/graph-core/src/patch.ts`、`verification.ts`、`event-log.ts`                          | `pnpm test`、`pnpm golden`                  |
| 6    | `fixtures/design-graphs/normal-2layer.json`、`packages/adapters/kicad/src/graph-projection.ts` | `pnpm kicad:spike`、`pnpm golden`           |
| 7    | `scripts/golden-run.mts`、`fixtures/golden/*.json`                                             | `pnpm golden`                               |

`normal-2layer` fixtureは、Project、Requirement、BoardStackup、Part、Footprint、
Component、Pin、Net、Layoutを持つ20×15 mmの2層基板です。graph-coreの
`readBoardModel`がpad対応、net所属、配置、stackupの参照整合性を検査し、KiCad
adapterが同一グラフから`.kicad_pro`／`.kicad_sch`／`.kicad_pcb`を投影します。
`pnpm golden`はfixture 6本を実replayし、netlist読み戻し（schematic netlistと
IPC-D-356）、ERC/DRC、Gerber/drill、再投影による正規化artifact hash一致、
patch conflict、stale result、再オープン失敗の停止をevidenceとして
`artifacts/golden/`へ保存します。

### 残存制約

- Footprintのpad geometryはfixture内の簡略値（0603系1.2 mm角、1x02コネクタ
  2 mmピッチ）であり、KiCad公式footprintの実geometryではありません。fixtureの
  `uncertainty`に記録し、公式ライブラリ抽出はPhase 1のライブラリ作業で行います。
- 配線はfixtureが持つ固定track/viaであり、routerは実装していません（Phase 0の
  範囲外）。
- 回路図投影はlabelベースのnet接続で、wire描画・階層シートは扱いません。

## マイルストーン

### M0：fixturesと開発基盤（完了）

- 正常な最小2層基板fixtureを作る
- 意図的ERC/DRC失敗、patch conflict、stale result、再オープン失敗の入力を
  作る
- pnpm workspace、Node.js LTS、型チェック・テスト・lintの契約を置く

### M1：Schema検証と型生成（完了）

- `schemas/design-graph.schema.json`から型を生成する
- AJV runtime validationを実行する
- Schema validだが意味的に不正なfixtureをsemantic validatorで拒否する

### M2：graph-core semantic validator（完了）

- Entity ID、Entity type、revision、参照先存在を検査する
- Projectとentitiesの整合性を検査する
- Phase 0では影響伝播の完全な型付きリンク規則を実装せず、未定義の影響は
  広い再検証へフォールバックする

### M3：patch／replay（完了）

- [`patch-revision.md`](patch-revision.md)に従いRFC 6902操作を適用する
- snapshot、patch JSONL、イベントの再生結果を比較する
- conflict、重複送信、途中停止からの再開を検証する

### M4：KiCad投影adapter（完了）

- graph fixtureから最小`.kicad_pro`、`.kicad_pcb`、必要な回路図投影を生成する
- adapterの入出力、tool version、入力hash、出力hashを記録する
- 回路図IPCを前提にしない

### M5：`kicad-cli` CI（完了）

- [`kicad-ci-profile.md`](kicad-ci-profile.md)の固定環境で再オープン、ERC/DRC、
  Gerber/drillを実行する
- capability probeとstdout/stderr、終了コード、成果物hashを保存する

### M6：golden task（完了）

- [`golden-tasks.md`](golden-tasks.md)の全fixtureをreplayする
- 合否、停止理由、stale、conflict、artifact hashの期待値を比較する
- CIが再現不能な差分を検出したらPhase 0完了にしない

## Phase 0に含めないもの

- UI、ブラウザUX、3Dビューア
- LLM、自然言語要件変換、MCP公開
- Phase 1の自然言語入力およびLLMによる`Requirement`変換（Phase 1は事前変換済み
  `Requirement` fixtureから開始する）
- 一般用途のcustom router、custom WASM engine（smoke fixture限定の承認済み
  deterministic track/via projectionはPhase 1の例外。goldenは外部routing toolまたは
  将来ADRで承認された方式を使用する）
- 永続knowledge baseへの書き戻し
- `FirmwarePackage`の実装・ビルド・検証
- 自動発注、外部checkout、支払い
- 高忠実度SI/PI/EMC、熱、仮想組込み検証
- 最終的なIndexedDB、OPFS、SQLite、RDBの選定
- `ManufacturingProfile`の独立Entity化

## Phase 1境界（Phase 0実装後に確定した事項）

Phase 1は、自然言語やLLMからの変換ではなく、事前変換済みの`Requirement`
fixtureから開始します。Phase 1の初期sourcing入力はfixture提供のMPN/AVLに限定し、
sourcing APIは後続adapterです。受入はCLI／fixture runnerで行い、viewerは後続の
read-only投影へ延期します。配線は`unrouted=0`を必須とし、未配線ratsnestを発注
準備として許容しません。

3〜5部品のsmoke fixtureは実装中の内部gate、ESP32・センサー・LED・電源・通信を
含む2層fixtureはPhase 1の最終golden taskとします。FW package、自動発注、自然言語
入力はPhase 1の受入対象外です。詳細なgateと製造package契約は
[`phase1-gates.md`](phase1-gates.md)に定義します。

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
- **ngspice WASM（2026-08-02）：** `eecircuit-engine@1.7.0`（MIT、npm registry
  のtarball、package integrityは実行時にnpmが表示）をmonorepo外の一時ディレクトリ
  で評価した。ngspice互換のRC transient netlistを実行し、`dataType=real`、
  `numPoints=208`、`time/v(in)/v(out)`を取得できた。したがって小規模なNode／
  browser WASM feasibilityは肯定的だが、ngspice本体との完全互換、モデル・include、
  timeout/cancel、worker isolation、ブラウザ性能は未検証であり、Phase 1の必須
  engine採用は決定しない。packageは依存として追加していない。

## 完了レビュー

完了時には、実行コマンド、Node/pnpm/KiCadの版、fixture hash、生成物hash、
既知の未決定事項、失敗したspikeと縮退方針をイベントとCI artifactへ残します。

### Phase 0完了検証（2026-08-02）

- 検証環境：Node.js `v22.23.2`、pnpm `11.18.0`、Docker `27.4.1`、
  KiCad `10.0.5`、digest固定イメージ
  `kicad/kicad@sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de`
- `pnpm schema:validate`：終了コード0。全Schema、sample、fixtureを検証。
- `pnpm typegen-sync`：終了コード0。型を生成し、`src/generated`の差分なし。
- `pnpm test`：終了コード0。13 test files、37 testsすべてpass。
- `pnpm lint`：終了コード0。
- `pnpm typecheck`：終了コード0。全workspace packageの型チェックpass。
- `pnpm golden`：終了コード0。6 fixtureすべてpass、期待結果との不一致なし。
  `artifacts/golden/summary.json`および各fixtureの`result.json`に証拠を保存した。
  正常系ではschematic/PCB netlist readback、ERC/DRC、Gerber/drill、
  再投影artifact hash一致を確認し、失敗系ではERC/DRC失敗、
  patch conflict、stale result、再オープン失敗時の停止とエラー分類を確認した。
  正常系のgraph hashは
  `sha256:7be6a9ed61680e3d5a9abca9f14a73afdf69ca467b62ae82c82c96601c8af325`。
- `pnpm kicad:spike`：終了コード0。ただし
  `kicad/kicad:10.0`タグが取得済みでなかったため、`SKIP: Docker or KiCad image unavailable`
  となり、spike本体は未実行。これは成功とは扱わない。条件6のKiCad再オープン、
  ERC/DRC、Gerber/drill、hash検証は、上記digest固定イメージを使用した
  `pnpm golden`の正常系fixtureで実証した。

## 関連文書

- [`../README.md`](../README.md#7-ロードマップ)
- [`adr/0008-phase0-provisional-implementation-profile.md`](adr/0008-phase0-provisional-implementation-profile.md)
- [`patch-revision.md`](patch-revision.md)
- [`event-log.md`](event-log.md)
- [`kicad-ci-profile.md`](kicad-ci-profile.md)
- [`golden-tasks.md`](golden-tasks.md)
