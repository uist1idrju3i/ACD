# ADR-0021：fabフィードバック取り込みの入力源

**ステータス：Accepted（Phase 3 WP1の入力境界）**

## 背景

Phase 3の完了条件は、1次試作で受けたDFM指摘とフットプリント修正が、2次試作の設計で
自動的に回避されることです。実fabの報告を常時取得できるとは限らず、fabごとにreportの
書式も異なります。一方、CIと受入検証はofflineで再現でき、入力hashを固定できなければ
決定論的なgateになりません。

入力源として、(a)実fabからのlive reportのみ、(b)実際のfab（JLCPCB級）のDFM report
書式を模した記録済みfixture、(c)自前のDRC結果から合成した指摘を比較しました。

## 決定

CIと受入検証は、実際のfab（JLCPCB級）のDFM report形式を模した、記録済みfab-report
fixtureで実行します。

1. fixtureは入力ファイル、fixture artifactのcanonical hash、fixture由来であることを示す
   provenanceを持ちます。`rawReport.contentHash`はreport本文のhash、`source.contentHash`
   は`source.contentHash`自身を空にしたfixture JSONのcanonical hashです。
   fixtureから導出したfindingは、実fabのEvidenceとして表示または扱いません。
2. 実fabのreportを取り込むlive adapterは、fixtureと同じ構造化intake contractの背後に
   opt-inで追加します。live経路をCIの必須入力にはしません。
3. 取り込み結果は入力hashとadapter／profileの版へ紐付け、同一入力から同一の構造化finding
   と同一hashを得られるようにします。
4. gateは自分で生成したDRC結果をfab feedbackとして再入力して自己証明しません。fixtureは
   fab report形式を再現する入力であり、gate自身の出力ではありません。

## 代替案

- **実fabのreportを待つ**：実データに基づくが、入手時期を制御できずPhase 3のCIと受入が
  ブロックされる。
- **自前のDRCからfindingを合成する**：再現性は高いが、gateが自分の出力を再入力して
  自分を証明することになり、独立したfab feedbackにならないため却下する。
- **schemaなしのケース別手書きstub**：短期実装は容易だが、report形式・provenance・
  重複排除の契約が固定されず、fabごとのadapterへ一般化できないため却下する。

## 結果とリスク

- CIはofflineで再現でき、入力hashとfixture provenanceを根拠にfindingの由来を追跡できます。
- fixtureが実fabの全ての揺らぎや未定義のreport形式を表すわけではありません。未知形式は
  `verification-failed`で停止し、fixture由来の結果を実測結果へ昇格させません。
- live adapterを追加しても、fixtureと同じschema、reference integrity、hash、停止条件を
  通過させます。live経路をopt-inに限定することで、CIの再現性と実fab連携を分離します。
- 見直し条件：実fab reportの継続的な取得が可能になり、fixtureとの差分を同一contractで
  検証できる場合。

## 参照

- [`../../README.md`](../../README.md)
- [`../phase3-plan.md`](../phase3-plan.md)
- [`../knowledge-base.md`](../knowledge-base.md)
- [`../event-log.md`](../event-log.md)
- [`0003-deterministic-tools-first.md`](0003-deterministic-tools-first.md)
- [`0019-repair-loop-llm-proposal-with-deterministic-validation.md`](0019-repair-loop-llm-proposal-with-deterministic-validation.md)
