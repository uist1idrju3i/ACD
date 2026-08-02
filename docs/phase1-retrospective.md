# Phase 1レトロスペクティブ

**対象：** PR #12、#14、#17、#19、#21で実装したPhase 1

## 事実と教訓

- **電気設計の後段発見：** レビューでUSB-C CC終端欠落、LED電流不足、レギュレータ
  bulk容量欠落、footprint／MPN不整合が発見された。KiCad ERCだけではfixtureの電気設計
  妥当性を閉じられない。Phase 2では電源系、終端、電流計算を含む決定論的な
  topology-level electrical lintをGate化する。
- **merge regression：** stacked PRのforward-mergeとmain mergeでantenna keepout導出
  ロジックが巻き戻った。生成物と導出ロジックをunit testで固定し、merge後は全gateを
  再実行する。
- **決定論性：** SES hashの不一致は記録だけでなく`throw`して停止する。決定論性を
  evidenceの説明ではなくjidoka条件として扱う。
- **gate契約の一元化：** runnerとdocsでgate番号・状態が乖離した。Phase 2候補として
  `docs/phase1-gates.md`のmatrixをrunnerが参照できるmachine-readable single sourceへ
  移行する。
- **snapshot衛生：** fixture-scoped symbol抽出とmanifest逆方向検証により、必要な
  symbolだけを埋め込み、manifest外のsnapshot orphanを停止できた。
- **ADR採番：** ADR-0010が設計profileとgolden routingで衝突したため、golden routingを
  ADR-0018へrenameした。今後は`docs/adr/README.md`を採番台帳として確認し、既存番号の
  再利用を禁止する。
- **Gate 12/13境界：** Gate 12はBOM、価格、予算、artifact hash、unknownを検査し、
  合格値はcomponentsとfabrication quoteを含む**17.25 USD / 50 USD cap**だった。
  unitPrice未設定を0円扱いする抜け穴はレビューで塞いだ。Gate 13はpending／simulated
  evidenceを拒否し、実機測定を代替しない契約として機能した。

## 測定済み完了状態

- smoke：Gate 1〜11、ERC 0、unrouted 0、DRC 0
- golden：Gate 1〜12、unrouted 0、DRC 0/0/0
- Gate 12：`ready-for-order, approval required`
- Gate 13：contract実装済み、physical evidenceはユーザーのhardware測定待ち

## Phase 2候補

- AI要件からtyped fixtureを生成する入力entry
- topology-level electrical lint gate
- fixture限定から一般化されたrouting boundaryへの移行条件
- live sourcing APIのprovenance／unknown boundary
- WP6 schematic readability
- gate matrixのmachine-readable single source

## 関連文書

- [`phase1-plan.md`](phase1-plan.md)
- [`phase1-gates.md`](phase1-gates.md)
- [`testing.md`](testing.md)
- [`golden-tasks.md`](golden-tasks.md)
