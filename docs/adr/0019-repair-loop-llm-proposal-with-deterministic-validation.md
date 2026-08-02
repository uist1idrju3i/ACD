# ADR-0019：自動修復ループはLLM提案＋決定論的gate判定とする

**ステータス：Accepted（Phase 2 WP5の境界。実装は未着手）**

## 背景

READMEのPhase 2完了条件は、golden taskへ注入した設計ミスが人間の介入なしに検証gateで
検出・修復され、テスト項目リストが出力されることです。修復候補の生成方式として、
(a) 決定論的ルールベースのみ、(b) LLM提案＋決定論的gate判定、(c) ハイブリッドを比較し、
利用者は(b)を選択しました。

## 決定

修復候補の生成はLLM（[`0005-byok-self-hosted-llm.md`](0005-byok-self-hosted-llm.md)の
BYOK境界）に行わせ、採否は決定論的gateだけで判定します。

1. LLM出力は**提案**であり、合否のEvidenceではありません。提案はtyped patchとして
   受け取り、schema検証、reference integrity、patch競合検査を通過しないものは破棄します。
2. 適用可否はlint（gate 14）、ERC、DRC、pre-order gateの再実行結果だけで判定します。
   gateがpassしない提案は下流へ流しません。
3. 修復ループは反復回数と入力hashで境界を持ち、同一入力hashでの再試行は冪等に扱います。
   反復上限に達しても閉じない場合は`verification-failed`で停止し、人へエスカレートします。
4. golden／CIのoffline再現性を壊さないため、既定の回帰はhash固定の記録済みLLM応答
   fixtureで実行します。live LLM呼び出しはopt-inとし、通常のoffline回帰の前提にしません。
5. 各修復試行は、提案元モデル名・バージョン・prompt hash・応答hash・対象revision・
   適用後のgate結果を記録します。LLMの説明文はEvidenceになりません。

## 代替案

- **(a) 決定論的ルールのみ**：patchが完全に決定論的でCIが軽い一方、想定した故障しか
  修復できず、rule表とfix表の二重管理になる。
- **(c) ハイブリッド（既定a、残りだけb）**：CIを決定論的に閉じつつ拡張余地を残せるが、
  2経路の実装・test費用が増える。

利用者の選択により(b)を採用します。(a)相当の決定論的fix templateは、必要になった時点で
LLM提案の前段としてWP5内で追加できます。

## 結果とリスク

- LLM提案は未知の故障へ一般化できる一方、非決定論のためgolden期待値を提案そのものに
  置けません。回帰の権威はgate結果とし、提案内容ではなくgate結果を固定します。
- BYOK鍵とネットワークが必要な経路をCI必須にすると、offline再現性とコスト予測性が
  壊れます。ADRの5項により、必須経路は記録済み応答に限定します。
- prompt injection対策として、fixture・tool出力・外部テキストはデータとして扱い、
  提案patchは常にschemaと gateで検証します。
- 見直し条件：記録済み応答fixtureで修復ループを再現できない場合、または反復上限内で
  収束しない故障クラスが定常化した場合。

## 参照

- [`../../README.md`](../../README.md)
- [`../phase2-plan.md`](../phase2-plan.md)
- [`../electrical-lint.md`](../electrical-lint.md)
- [`0003-deterministic-tools-first.md`](0003-deterministic-tools-first.md)
- [`0005-byok-self-hosted-llm.md`](0005-byok-self-hosted-llm.md)
- [`0011-three-valued-rule-evaluation-and-validity-domain.md`](0011-three-valued-rule-evaluation-and-validity-domain.md)
