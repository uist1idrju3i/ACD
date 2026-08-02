# 故障注入と修復ループ（Gate 17）

**ステータス：Draft**

## 目的と範囲

READMEのPhase 2完了条件は「Phase 1のgolden taskで、**注入した設計ミスが人間の介入なしに
検証gateで検出・修復され**、テスト項目リストが出力される」ことです。本gateは、golden
fixtureへ決定論的に欠陥を注入し、修復候補を適用し、Gate 14〜16を再実行して収束を確認します。

方式は[ADR-0019](adr/0019-repair-loop-llm-proposal-with-deterministic-validation.md)（B案）です。
**修復候補は提案に過ぎず、合否は決定論的gateが決めます。** CIをoffline再現可能に保つため、
既定のproposerは記録済み提案（hash固定）を再生するもので、live LLM呼び出しはopt-inです。

実装は[`../packages/graph-core/src/repair-loop.ts`](../packages/graph-core/src/repair-loop.ts)、
記録の再生成は`pnpm phase2:record-repairs`
（[`../scripts/phase2-record-repairs.mts`](../scripts/phase2-record-repairs.mts)）です。

## ループ

1. 対象fixtureでGate 14（lint）、Gate 15（rationale）、Gate 16（test plan）を評価する。
2. 未解決finding（`fail`または`unknown`）が無ければ`already-passing`。
3. 未解決findingをproposerへ渡し、修復候補を受け取る。
4. 各候補を**受理条件**で判定する。
5. 受理した候補を適用して1へ戻る。反復上限（既定4回）を超えたら`convergence-failure`として停止する。

## 受理条件

候補は次を**すべて**満たすときだけ受理されます。

| 条件            | 内容                                                           |
| --------------- | -------------------------------------------------------------- |
| admissibility   | 記録済みの事実を書き換えていない（下記）                       |
| patch適用可能性 | JSON Pointer操作が競合なく適用できる（`patch-conflict`で却下） |
| finding単調減少 | 未解決findingが厳密に減る                                      |
| 新規failure無し | 元のfinding集合に無い`fail`を新たに生じさせない                |

**admissibility**：修復は設計を変えてよいが、gateが判定の根拠にしている記録を書き換えては
なりません。次の操作は理由付きで却下します。

- `datasheet:`由来のpart parameter（LEDの順電圧・電流窓、regulatorの出力電圧など）
- partの`provenance`
- BOMの`availability`／`lifecycle`／`supplier`／`sku`／`provenance`

これは実装中に実際に必要になった制約です。LED過電流のcaseに対し、直列抵抗を戻す代わりに
「LEDの順電圧が3.2 Vだと主張する」候補を与えると、電流計算は合格範囲に入り、gateだけでは
合格してしまいます。**基板は何も直っていないのに合格する**ため、事実の書き換えを構造的に
禁止しました。

## 記録済みproposerとprovenance

記録は`fixtures/phase2/repair-recordings.json`です。各提案は次を持ちます。

- `promptHash`：未解決findingの`(ruleId, entity, status)`列のsha256。これがproposerの
  ルックアップキーで、fixture本文やcase名では引きません（正解を先に教えないため）。
- `provenance.responseHash`：`targets`／`rationale`／`operations`のsha256。再生時に
  再計算し、不一致なら`stale-result`で停止します。手で書き換えた記録は修復に使えません。
- `provenance.source`：本記録はfixture所有で、live modelを呼ばずに著者が作成したものです。
  記録済みLLM応答を装いません。

live LLM proposerは同じ`RepairProposer`インターフェースで差し替える設計ですが、本WPでは
実装していません（BYOK・ネットワーク・注入対策はopt-in経路として別途）。

## 注入case

`fixtures/phase2/repair-cases.json`（生成物）に、注入patchと期待rule IDと修復列を記録します。

| case                           | 注入              | 検出rule                     |
| ------------------------------ | ----------------- | ---------------------------- |
| `case:led-overcurrent`         | R3を47 Ωへ        | `led-series-current`         |
| `case:i2c-pullup-out-of-range` | R8／R9を100 kΩへ  | `i2c-pullup`                 |
| `case:capacitor-underrated`    | C4の定格を6.3 Vへ | `capacitor-voltage-derating` |
| `case:usb-cc-termination`      | R6を10 kΩへ       | `usb-cc-termination`         |

## Evidence

golden runは`artifacts/phase1-golden/repair-loop.json`を出力し、gate Evidenceへ
case数、修復数、却下提案数、記録のhashを記録します。case単位では、状態、反復数、
適用proposal ID、試行数、却下数、停止理由を残します。

## 範囲外

- live LLM呼び出し（BYOK経路）。
- topology構造そのものを変える修復（部品追加・net追加）。現状のcaseは値・定格の修復です。
- KiCad投影後のartifact（routing、DRC）を伴う再検証ループ。Gate 17はfixture段階で閉じます。
