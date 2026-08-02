# Phase 2レトロスペクティブ

**対象：** PR #23、#24、#25、#27、#28、#29、#30で実装したPhase 2（WP1〜WP7）

## 完了状態

READMEのPhase 2完了条件（**Phase 1のgolden taskで、注入した設計ミスが人間の介入なしに
検証gateで検出・修復され、テスト項目リストが出力される**）に到達しています。

| 項目                | 測定済みの結果                                                    |
| ------------------- | ----------------------------------------------------------------- |
| golden run          | Gate 1〜12、14〜18が`passed`（Gate 13は実機測定待ち）             |
| Gate 14 lint        | rule 9件、finding 37件、verdict `pass`                            |
| Gate 15 rationale   | rule 4件、subject 29件、verdict `pass`                            |
| Gate 16 test plan   | rule 4件、TestItem 20件（うちmeasurement 8件）、`test-plan.json`  |
| Gate 17 repair loop | 注入case 4件すべて自動修復、却下された提案1件、`repair-loop.json` |
| Gate 18 SPICE       | ngspice 44.2、解析3件、rule 5件、`spice/results.json`             |
| 注入case            | LED過電流、I2C pull-up範囲外、capacitor定格不足、USB-C CC終端欠落 |

## 事実と教訓

- **gateは実在の欠陥を見つけた：** WP2のlintは、Gate 1〜12を通過していたgolden fixtureの
  I2C pull-up欠落とR5 pin 2フローティングを検出した。ERCとDRCだけでは電気設計の妥当性を
  閉じられないという Phase 1の教訓が定量的に裏付けられた。lintを緩めず設計側を直した。
- **「導出できない」をskipしない：** 初期実装には、宣言不足の入力を`continue`で飛ばす
  箇所が複数あった（capacitorのnet電圧、SPICE解析の導出、LEDの期待帯）。skipは合格に
  見えるが検証を縮小する。いずれも`unknown`として記録し`blocked`へ集約する形へ直した。
  **判定できないことは、判定できたことにしない。**
- **自己証明の排除：** WP4の初期実装はacceptance criterionごとにplaceholderのTestItemを
  生成し、そのplaceholderの存在をもってcoverage合格としていた。計画が自身の網羅性を
  証明する構造になるため、要求側が`acceptanceVerifiedBy`で検証手段を宣言する形へ変更し、
  未宣言は`unknown`とした。同様に、rationaleの仮定も「自分で作ったid」ではなく
  「rationaleが名指ししたid」を要求する。
- **gateの合否は修復の受理条件として不十分：** LED過電流に対し「LEDの順電圧が高い」と
  主張する修復候補は、電流計算を合格範囲へ入れてしまう。基板は何も直っていないため、
  datasheet由来parameter、part provenance、order-relevantなBOM状態の書き換えを構造的に
  却下する。レビューで、保護対象そのものだけでなく**その祖先pathへの操作**（`/parts/11`や
  `/bom/0`の丸ごと置換）も同じ理由で却下する必要があることが判明した。
  安全条件はpathの完全一致ではなく、書き換わる部分木で判断する。
- **監査記録は「入力」を残す：** 修復ループのiterationは当初、受理後の状態を記録して
  いた。提案の妥当性を後から検査するには、proposerへ渡した時点のfindingsとそのhashが
  必要になる。
- **topologyを名前や大小で推定しない：** SPICEのpull-up同定は当初「netで最も小さい抵抗」
  だった。直列・シャント抵抗と取り違え、rail電圧も無関係なnetから取ってしまう。
  「busと電源netの両方に足を持つ抵抗」というtopologyで同定し、rail電圧はその電源netから
  取る形へ直した。lintのLED分岐トレースも同様に、分岐がある場合は`unknown`で停止する。
- **失敗の帰属：** goldenのrunnerは`currentGate`を成功時にしか更新しておらず、新gateの
  失敗が直前の合格gateとして記録された。gate評価の**前**に`enter(gate)`で入場を宣言する
  形へ直した。停止の記録先が誤っていれば、jidokaの再開条件も誤る。
- **外部processのstderr：** ngspiceは正常終了時もbanner・version・診断の多くをstderrへ
  出す。stdoutだけを保存するとEvidenceが欠ける。engine versionが読めない場合は`unknown`
  で停止する。
- **読みやすさの再配置は電気的意味を変え得る：** eeschemaは同一座標のpinを接続するため、
  WP7の再配置は初回実装でJ1とR7のpinを重ねて意図しない接続を作りかけた。異なるsymbol間の
  pin重なりとsheet外配置を停止条件にした。可読性そのものは決定論的gateでは判定できず、
  目視確認が残る。
- **機能ブロックはrationaleにしかない：** partには機能ブロックの宣言がないため、WP7の
  配置はWP3のrationale（`appliesTo`）から導いた。設計根拠の構造化が、可読性という別の
  成果を副産物として生んだ。
- **stacked PRの積み上げ：** WP1（#23）を単独でmainへ入れたあと、WP2〜WP7の6本を
  stack #26として積み、下段のレビュー修正を上段へ順に統合した。gate matrixの
  `runsAfter`により、gate番号を振り直さずに実行位置だけを宣言できた。

## 残課題とPhase 3候補

- Gate 13（実機測定Evidence）はhardware測定待ちで、Phase 2でも未完了のまま。
- 可読性は決定論的gateで判定できない。目視確認、または比較可能な代理指標の検討が必要。
- live LLM提案経路はopt-inのまま未使用。CIは記録済み提案（hash固定）で回している
  （[ADR-0019](adr/0019-repair-loop-llm-proposal-with-deterministic-validation.md)）。
- SPICEは理想電源と線形受動素子だけのnominal解析。vendorモデルの取り扱いは
  `spice-model-provenance`の`unknown`境界として据え置き（[ADR-0020](adr/0020-spice-engine-ngspice-external-process.md)）。
- 修復caseは注入した4件のみ。未知の故障への一般化はPhase 3の知識ループと合わせて評価する。
- `acceptanceVerifiedBy`はJSON Schemaでは`acceptanceCriteria`との長さ整合を強制できない。
  index整合は生成器とruleで扱っており、未宣言のindexは`unknown`になる。

## 関連文書

- [`phase2-plan.md`](phase2-plan.md)
- [`gates.md`](gates.md)
- [`electrical-lint.md`](electrical-lint.md)
- [`design-rationale-gate.md`](design-rationale-gate.md)
- [`test-plan-generation.md`](test-plan-generation.md)
- [`repair-loop.md`](repair-loop.md)
- [`spice-gate.md`](spice-gate.md)
- [`schematic-readability.md`](schematic-readability.md)
- [`phase1-retrospective.md`](phase1-retrospective.md)
