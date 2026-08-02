# ADR-0020：SPICE engineはngspiceを固定digestコンテナの外部processで実行する

**ステータス：Accepted（Phase 2 WP6の境界。gate 18として実装済み）**

## 背景

READMEのPhase 2は「トポロジー → ERC → SPICE」の多段検証を求めます。engine候補として
(a) ngspiceを固定digestコンテナの外部processで実行、(b) ngspice WASMをブラウザ内で実行、
(c) Xyce、(d) Phase 2ではSPICEを入れないを比較し、利用者は(a)を選択しました。

## 決定

SPICE gateはngspiceを**固定digestコンテナの外部process**として起動します。

1. KiCad／Freeroutingと同じく、image digestを固定し、引数配列で起動します。jarや
   ライブラリをACDへvendor／link／copyしません。GPLの境界はexternal-processのままとし、
   in-process linkは行いません。
2. 対象はPhase 2ではnominal解析に限定します。高忠実度SI／熱解析はREADMEの
   「やらないこと」によりPhase 2の対象外です。モンテカルロ等の広い解析は
   [`0016-worst-case-analysis-fidelity.md`](0016-worst-case-analysis-fidelity.md)の
   忠実度ラダーに従って別途決めます。
3. Evidenceには、engine名とバージョン、image digest、netlist入力hash、解析条件、
   出力hash、収束状態、モデルの出所とライセンス、マージンと不確かさを記録します。
   収束失敗・timeout・モデル欠落は`verification-failed`で停止します。
4. vendor提供の`.lib`／`.mod`は再配布しません。利用者が用意する外部入力として扱い、
   ACDが取り込むのはライセンス上問題のないmetadataと解析結果だけです。
5. ブラウザ内実行（WASM）はPhase 4で別ADRとして再検討します。本ADRはPhase 4の
   実行形態を決めません。

## 代替案

- **(b) ngspice WASM**：Phase 4のブラウザ実行を先取りできるが、ビルド・維持が重く、
  WASM同梱はin-process linkに近いため配布境界の法務判断が必要。
- **(c) Xyce**：ライセンス境界は緩いが入手・ビルドが重く、Phase 2にはオーバースペック。
- **(d) SPICEを入れない**：範囲は小さいが、READMEのPhase 2記述に対して未達となる。

## 結果とリスク

- Docker前提となるため、ブラウザ単独実行はPhase 2の対象外であることをdocsに明示します。
- モデルの出所が不明な解析はEvidenceとして採用できません。出所不明は`unknown`として
  検証を広げ、合格にしません。
- 見直し条件：ngspiceの収束特性がgolden回帰を不安定にする場合、または配布形態の変更で
  external-process境界が成立しなくなった場合。

## 参照

- [`../../README.md`](../../README.md)
- [`../phase2-plan.md`](../phase2-plan.md)
- [`../verification-gates.md`](../verification-gates.md)
- [`../spice-gate.md`](../spice-gate.md)
- [`../tool-contract.md`](../tool-contract.md)
- [`0016-worst-case-analysis-fidelity.md`](0016-worst-case-analysis-fidelity.md)
- [`0018-golden-routing-technology.md`](0018-golden-routing-technology.md)
