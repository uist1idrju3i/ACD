# ADR-0026：高速チェックのWASM対象と実装言語

**ステータス：Proposed（Phase 4 WP7）**

## 背景

Phase 4はブラウザUXと実行基盤を対象としますが、README §7は全エンジンのWASM化を
対象外としています。一方、pad間クリアランスやmask sliverのような幾何系チェックは、
ブラウザで高速に実行する価値があり、native実装との判定一致を機械的に確認する必要があります。

ADR-0020はPhase 2のSPICEを固定digestコンテナの外部processとして実行し、ブラウザ内
実行はPhase 4で別ADRとして再検討すると定めています。本ADRはその再検討の範囲を限定し、
SPICEや他の外部engineの実装形態を変更しません。

## 決定

WASM化の対象は次の幾何系高速チェックに限定します。

- pad間クリアランス
- mask sliver
- courtyard重なり

native TypeScript実装を判定の正とし、WASMは同一入力で同一結果を返す高速経路として
追加します。

1. nativeとWASMの結果が一致するparity testを必須とします。
2. 結果、不確実性、module version、build digest、toolchain versionをEvidenceへ記録します。
3. nativeとWASMの不一致、provenance欠落、入力不一致は停止します。
4. WASMが利用できない環境ではnative経路へ決定論的にfallbackします。
5. `kicad-cli`、ngspice、routerなど全エンジンのWASM化は行いません。
6. 実装言語は未決定とし、Rustを推奨候補としてWP7着手時に決定します。

## 代替案

- **全エンジンをWASM化する**：ブラウザ単独実行の範囲は広がるが、README §7のPhase 4
  境界を越え、ライセンス、性能、provenance、検証負担が過大になるため却下する。
- **native TypeScriptだけを使う**：実装は単純だが、高速チェックのブラウザ実行という
  Phase 4の目的を満たす経路を失うため採用しない。
- **WASMを正の実装にする**：nativeとの結果差を正当化する別判定系となり、決定論的な
  gateの一貫性を損なうため採用しない。
- **実装言語を今決定する**：toolchainとruntime boundaryを先に固定するが、WP7の
  parity要件と実行環境を確認する前に選択を狭めるため未決定として残す。

## 結果とリスク

- 幾何系チェックのブラウザ応答性を高めつつ、native経路を基準に判定の一貫性を検証できます。
- parity failure、WASM runtime failure、build digest欠落、未対応環境ではWASM経路を
  無効化または停止し、未検証結果をgateへ流しません。
- nativeとWASMの性能差、浮動小数点差、toolchain差はfixture集合で測定します。
- 言語選択はWP7の着手時に、license、build再現性、browser runtime、parity結果を
  根拠として別途確定します。

## 参照

- [`../../README.md`](../../README.md#7-ロードマップ)
- [`../phase4-plan.md`](../phase4-plan.md)
- [`../architecture.md`](../architecture.md)
- [`../verification-gates.md`](../verification-gates.md)
- [`0020-spice-engine-ngspice-external-process.md`](0020-spice-engine-ngspice-external-process.md)
