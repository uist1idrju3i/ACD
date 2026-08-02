# ADR-0023：ライブラリの版管理モデル（公式snapshot + overlay patch）

**ステータス：Accepted（Phase 3 WP3／WP6のlibrary境界）**

## 背景

Phase 1では、固定KiCad containerから抽出した公式symbol／footprint snapshotを、content
hash、container digest、license、NOTICEとともに保持しています。Phase 3ではfab指摘から
footprint修正を反映し、2次試作以降の設計で再利用する必要があります。公式データを直接
書き換えると上流の出所、hash、ライセンス帰属が失われ、設計グラフだけに修正を保存すると
別プロジェクトで再利用できません。

## 決定

公式KiCad library snapshotは不変の上流として保持します。ACDのfootprint修正は、出所を
持つoverlay patchとして保存し、patch固有のlibrary revisionを発行します。

1. 公式snapshotのcontent hash、container digest、license、NOTICE、source metadataは
   修正適用後も変更しません。
2. overlay patchは対象snapshot、対象footprint、作成元のfab finding／KnowledgeItem／
   event、patch内容、検証結果、作成者、版、content hashを参照します。
3. projectionは暗黙の最新版ではなく、明示的なlibrary revisionを参照します。採用した
   revisionは生成物とEvidenceへ記録します。
4. patchは幾何検査、KiCad reopen、DRC/DFMなどの決定論的検証を通過するまで採用しません。
   不合格patchは保存して失敗根拠を残しても、下流projectionの入力にはしません。
5. project-local patchの採用と、library-wideへの昇格は分離します。後者は
   [`0022-knowledge-scope-promotion-approval-boundary.md`](0022-knowledge-scope-promotion-approval-boundary.md)
   のapproval ID境界に従います。

## 代替案

- **公式snapshotをその場で変更する**：単純だが上流のprovenance、content hash、license
  attributionを破壊するため却下する。
- **公式library全体をforkする**：独立管理はできるが、不要な差分と保守負担が増え、
  symbol／footprint全体の帰属管理も複雑になるため却下する。
- **修正をdesign graph内部だけに保存する**：当該設計では追跡できるが、別プロジェクトで
  再利用できず、Phase 3の知識ループ完了条件を満たさないため却下する。

## 結果とリスク

- 公式snapshotの再現性とライセンス帰属を保ったまま、ACD固有の修正を版管理できます。
- projectionとEvidenceが明示的なlibrary revisionを持つため、どの修正が生成物へ影響したか
  を追跡できます。
- overlay patchの競合、KiCad format drift、patchの適用順序を管理する必要があります。
  競合や未知constructは停止し、公式snapshotを変更して解決してはいけません。
- overlayをlibrary-wideへ昇格する場合、同じpatchが適用条件外の部品、fab profile、材料へ
  拡大されないよう、provenanceと適用・除外条件を再検証します。
- 見直し条件：KiCadの公式library配布境界、snapshotの版管理方式、または個人libraryの
  scope定義を変更する場合。

## 参照

- [`../../README.md`](../../README.md)
- [`../phase3-plan.md`](../phase3-plan.md)
- [`../kicad-interop.md`](../kicad-interop.md)
- [`../knowledge-base.md`](../knowledge-base.md)
- [`../gates.md`](../gates.md)
- [`0018-golden-routing-technology.md`](0018-golden-routing-technology.md)
- [`0022-knowledge-scope-promotion-approval-boundary.md`](0022-knowledge-scope-promotion-approval-boundary.md)
