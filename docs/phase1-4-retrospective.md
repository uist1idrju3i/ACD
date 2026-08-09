# Phase 1〜4通しの振り返りと計画見直し

**ステータス：Draft（Phase 5着手前の見直し。README §7の権威は変更しない）**

## 目的

Phase 1〜4の実装結果を通しで点検し、フェーズ単位の振り返りでは見えない**再発パターン**と
**構造的な残債**を特定します。そのうえでPhase 5以降の計画に対する見直し案を提示します。
README §7がフェーズ境界と完了条件の権威であり、本書は見直しの根拠と提案を記録するだけです。
README本文の改訂は、提案が承認されたあとに別途行います。

## 到達点

| フェーズ | READMEの完了条件                                                   | 測定済みの結果                                                                             |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1        | fixtureからESP32級の基板を生成・発注、実機Evidenceは後日           | Gate 1〜12合格、`ready-for-order, approval required`。Gate 13はcontract-onlyで実機測定待ち |
| 2        | 注入した設計ミスが人手なしに検出・修復され、テスト項目が出力される | Gate 14〜18合格。注入4caseすべて自動修復、TestItem 20件、SPICE解析3件                      |
| 3        | 1枚目のDFM指摘・footprint修正が2枚目で自動回避される               | Gate 19〜22合格。mask sliver 0.29mm→0.33mm、違反1件→0件                                    |
| 4        | 途中で強制終了しても最後のcheckpointから完走できる                 | Gate 23〜25合格。worker強制終了3caseで成果物hash・gate結果・event列・台帳再構成が一致      |

現在の`main`（`2f740b5`）で、`pnpm lint`／`typecheck`／`test`（47 files / 286 tests）／
`schema:validate`／`typegen-sync`／`gates:check`／`golden`／`phase4:resume`／`wasm:build`／
`wasm:test`がすべて成功します。gate matrixは25 gate（24 implemented、Gate 13のみcontract-only）
です。

## 4フェーズを通じて繰り返した失敗の型

各フェーズで独立に見つかった欠陥は、実際には少数の型の再発です。**同じ型が次のフェーズで
必ず別の場所に出た**ため、型として記録し、レビュー時のチェック項目として使います。

### 1. 自己証明（self-attestation）

自分が作った成果物の存在をもって合格とする構造です。

- Phase 2 WP4：acceptance criterionごとにplaceholderのTestItemを生成し、その存在でcoverage合格。
- Phase 3：完了判定がACD自身のoverlay markerの有無を見る循環。
- Phase 4 WP6：browser evidenceが「再接続したから重複抑止したはず」と宣言。
- Phase 4 WP7：parity testがfake moduleを注入し、native対nativeの比較。
- Phase 4 WP8：gate 23がreplay結果同士を比較し、常に成功。

**対策：** 判定の両辺が同じ生成器から出ていないかを必ず確認する。片側を故意に壊すと不合格に
なる回帰テストを、合格の証跡と同時に用意する。

### 2. skipを合格に見せる

判定できない入力を`continue`／早期returnで飛ばすと、gateは緑になります。

- Phase 2：capacitorのnet電圧、SPICE解析導出、LED期待帯の`continue`。
- Phase 4 WP4：未宣言stageの外部process上限を0と解釈（宣言なしと0を同一視）。
- Phase 4 WP7：malformed shapeをwidth/height矩形へfallback。

**対策：** 「導出できない」は`unknown`として記録し、停止側へ集約する。宣言の欠如を既定値で
補完しない。

### 3. 失敗の帰属先の誤り

停止の記録先が誤ると、jidokaの再開条件も誤ります。

- Phase 2：`currentGate`を成功時だけ更新し、新gateの失敗が直前の合格gateとして記録された。
- Phase 4 WP3：failure attributionが`results.at(-1)`（直前のresult）を見ていた。

**対策：** 実行中のstageを入場時に宣言し、失敗はその宣言から取る。

### 4. CIが見ていない領域

- Phase 3：`scripts/*.mts`がどのtsconfig projectにも含まれず、typecheckをすり抜けた。
- Phase 4 WP6：run rootがgitignore対象で、fresh checkoutでは回帰がvacuousになる。

**対策：** CIが実際に読み込む入力をtrackedにする。**検査されていない領域は、検査されて
いないのと同じである。**

### 5. 外部toolの決定論性を仮定する

- Phase 1：SES hashの不一致。
- Phase 3：KiCadが`SOURCE_DATE_EPOCH`を尊重せず、Gerber／ERCのtimestampが実行時刻になる。
- Phase 4 WP3：KiCadのSES import/saveが同一入力で非決定（93本中52本のセグメント構成差）。

**対策：** 外部toolの保存バイト列を設計状態の権威にしない。正本はグラフに置き、外部toolは
出力側に置く。決定論性は説明ではなく停止条件として扱う。

### 6. 契約の二重管理

- Phase 1：runnerとdocsでgate番号・状態が乖離 → machine-readable gate matrixへ移行。
- Phase 1：ADR採番衝突（ADR-0010）。
- Phase 4 WP5：hash semanticsの用途未分離でEvidence hashが一斉変化。
- Phase 4 WP8：計画文書のheaderが節の記述と矛盾。

**対策：** 単一の機械可読な正本を置き、文書はそこから導く。表記が重複する箇所は、最も詳細な
記述を権威と定める。

### 7. 安全条件をpathの一致で書く

Phase 2の修復ループでは、保護対象そのものだけでなく祖先path（`/parts/11`や`/bom/0`の丸ごと
置換）も同じ理由で却下する必要がありました。**安全条件は完全一致ではなく、書き換わる部分木で
判断する。**

## 構造的な残債（フェーズ横断）

| #   | 残債                                                                                                                       | 影響                                                                | 提案する処置                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | KiCad overlay footprintがDRC／netlist exportで実際にロードされていない（overlayの`.kicad_mod`を壊してもDRCは0 violations） | Phase 3の完了条件の裏付けが弱い。overlay修正がDRCで検証されていない | WP9として最優先。Phase 5着手前に閉じる              |
| 2   | courtyard輪郭、mask expansion、pad shapeの正本データ供給経路が未完成                                                       | 幾何checkの3件が`unknown`のまま。表示も`unavailable`                | 独立した契約変更。供給経路を持つフェーズを明示する  |
| 3   | 冪等tool envelopeが既存の外部process呼び出し（`kicad-cli`／ngspice／freerouting）へ未適用                                  | 再試行の副作用防止とerror taxonomy分類が主要経路に及んでいない      | Phase 5でenvelope統合を完了させる                   |
| 4   | Gate 13（実機測定Evidence）が全フェーズで未充足                                                                            | 「実際に動いた」の裏付けがユーザーのhardware測定待ち                | contract-onlyを維持。simulated evidenceで代替しない |
| 5   | 入力が実fab reportではなくfixture、live sourcing／datasheet APIが未実装                                                    | 知識ループと部品選定が現実の入力で検証されていない                  | Phase 5の範囲として明示済み。adapterはWP9で扱う     |
| 6   | `fixtures/phase3/component-library.json`がprojectionの部品選定入力として消費されていない                                   | 部品ライブラリ整備の成果が設計経路に接続していない                  | Phase 5の部品選定と同時に接続する                   |
| 7   | event logがunknown event typeとevent種別ごとのpayload schemaを検証しない                                                   | 破損・未知イベントの検出が弱い                                      | 独立した契約変更として起票する                      |
| 8   | Gate 22で`applicability: unknown`のadopted knowledgeが適用対象に含まれ、`passed`に到達し得る                               | 「unknownをpassにしない」原則との整合が未確認                       | WP9で意味論を確認し、必要ならschema／gateを修正する |
| 9   | 可読性（回路図）は決定論的gateで判定できず、目視確認が残る                                                                 | 人手の確認が完了条件に残る                                          | 代理指標の検討をPhase 6の回路図逆生成と併せて行う   |
| 10  | 修復caseは注入した4件のみで、未知の故障への一般化が未評価                                                                  | repair loopの一般性が未測定                                         | Phase 5の実LLM経路と併せてcaseを拡張する            |

## 計画見直しの提案

READMEのフェーズ番号は変更しません。以下は内容と順序の調整案です。

1. **Phase 5着手前にWP9（残債#1、#8）を閉じる。** overlay footprintがDRCで検証されていない
   ことは、Phase 3の完了条件そのものの裏付けに関わります。Phase 5は自然言語要件からPhase 1〜4の
   全gateを通す完了条件を持つため、gate自体の妥当性を先に確定させる必要があります。
2. **Phase 5の範囲へ「冪等tool envelopeの統合」（残債#3）と「component libraryの消費」（残債#6）を
   明記する。** どちらも実LLMとsourcingを入れる前に整えるべき配管であり、現状はどのフェーズも
   所有していません。
3. **Phase 5の完了条件に、token／moneyの実計測とunknown境界の測定を明示する。** Phase 4で
   `unknown`のまま残した唯一の予算次元であり、Phase 7の自働発注の前提です。
4. **正本ジオメトリ（残債#2）の供給フェーズを決める。** 候補はPhase 6（回路図逆生成とFW連携で
   footprint情報を扱う）またはPhase 9直前の独立契約です。現状はどこにも属していません。
5. **Gate 13の扱いを明文化する。** 実機測定はユーザー側の作業であり、各フェーズの完了判定から
   Gate 13を分離した「実機Evidence待ち」状態として扱うことをREADMEに明記します。フェーズを
   実機測定で無期限にblockしないためです。

## 参照

- [`phase1-retrospective.md`](phase1-retrospective.md)
- [`phase2-retrospective.md`](phase2-retrospective.md)
- [`phase3-retrospective.md`](phase3-retrospective.md)
- [`phase4-retrospective.md`](phase4-retrospective.md)
- [`phase4-plan.md`](phase4-plan.md)
- [`gates.md`](gates.md)
- [`../README.md`](../README.md)
