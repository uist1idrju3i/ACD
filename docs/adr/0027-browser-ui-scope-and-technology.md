# ADR-0027：ブラウザUIの範囲と技術選択

**ステータス：Proposed（Phase 4 WP6）**

## 背景

Phase 4は、長時間runの状態をブラウザから確認し、設計成果物とEvidenceの差分を
レビューできるread-only UIを対象とします。設計グラフが正のデータであり、UIが設計や
Evidenceを直接変更すると、投影と正規状態の境界が崩れます。

ADR-0004はbrowser-firstと任意workerを定めています。本ADRはそのブラウザ側のPhase 4
受入範囲を定めますが、UIフレームワーク自体は実装と検証の結果を踏まえて選ぶため、
現時点では固定しません。

## 決定

Phase 4のブラウザUI受入範囲は次のとおりとします。

1. read-onlyの2D投影ビューア（pad、track、via、courtyard、mask）
2. 設計graph revision間の差分レビュー
3. タスク台帳、gate結果、checkpoint、停止理由、Evidenceの表示
4. ブラウザの強制終了後に再接続し、workerが継続したrunの最新状態を表示するUI回帰

UIは正の設計データ、KnowledgeItem、Evidenceを作成・変更しません。表示値は成果物IDまたは
Evidence IDへ辿れることを必須とし、要約値を権威として扱いません。UIフレームワークは
未決定とし、WP6着手時にread-only、再接続、性能、license、保守性を比較して決定します。

以下はPhase 4の受入対象外です。

- 編集UI、対話的な設計変更
- 3Dビューアの本格実装
- タブレット最適化

### 未解決の論点

3Dビューアとタブレット対応をPhase 4受入からread-only 2Dへ絞り込むことは、README §7の
記載に対する範囲の絞り込みです。READMEを更新して範囲を合わせるか、Phase 4受入を
read-only 2Dに限定して3Dビューア／タブレット対応を後続フェーズへ移すかは、READMEを
権威とするためユーザー判断待ちの未決定事項として残します。

## 代替案

- **編集UIまで実装する**：Phase 4のread-only境界を越え、UIが正のデータを作る経路を
  導入するため却下する。
- **3Dビューアを受入対象にする**：表示・性能・投影範囲が拡大し、README §7のPhase 4
  完了条件に対する必須性がないため後続へ送る。ただし、README §7との範囲差を解消する
  README更新または後続フェーズへの移行は未決定である。
- **UIフレームワークを今決定する**：実装速度は上がるが、worker再接続、2D描画、成果物
  provenanceの検証前に技術を固定するため未決定として残す。

## 結果とリスク

- read-only境界により、ブラウザ表示と正規設計グラフ・Evidenceを分離できます。
- 表示対象が成果物ID／Evidence IDへ追跡できない、またはUIから正のデータを書き換えられる
  場合は停止します。
- ブラウザ強制終了後の再接続とworker継続はPlaywright UI回帰で検証します。受入gateの
  実行基盤耐久性はADR-0025に従いworker process強制終了で測定します。
- UIフレームワークの決定はWP6着手時に、実測した受入条件とlicense境界を根拠として
  別途記録します。

## 参照

- [`../../README.md`](../../README.md#7-ロードマップ)
- [`../phase4-plan.md`](../phase4-plan.md)
- [`../architecture.md`](../architecture.md)
- [`0004-browser-first-optional-workers.md`](0004-browser-first-optional-workers.md)
- [`0025-checkpoint-granularity-and-invalidation.md`](0025-checkpoint-granularity-and-invalidation.md)
