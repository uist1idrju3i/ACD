# ADR-0022：知識のscope昇格と承認境界

**ステータス：Accepted（Phase 3 WP2／WP4の知識境界）**

## 背景

Phase 3では、fab指摘、検証結果、設計判断から生成したKnowledgeItemを次の設計へ再利用
します。READMEは無人実行を既定としていますが、`knowledge-base.md`はプロジェクト固有の
知識を同意なく`library-wide`へ昇格させないと定めています。scopeの昇格は複数プロジェクト
へ影響する永続的な変更であり、プロジェクト内の通常の自動適用と同じ扱いにはできません。

## 決定

`project-local` KnowledgeItemの生成、`candidate`から`adopted`までの遷移、および同じ
プロジェクトのrunへの適用は、READMEの既定どおり人間の介入なしに実行します。
`library-wide`へのscope昇格だけは、明示的なapproval IDを要求します。

1. `project-local`での採用と適用は、構造化されたprovenance、source event、再現条件、
   `appliesWhen`／`excludesWhen`を満たす限り、自動化できます。
2. `library-wide`への昇格には、対象KnowledgeItem、適用範囲、承認者、承認時刻、期限を
   参照するapproval IDが必要です。approval IDなしの昇格は停止します。
3. 昇格にはprovenance、再現条件、`appliesWhen`、`excludesWhen`を必須とします。条件外の
   設計へ再利用してはいけません。
4. KnowledgeItemをdeprecatedにした場合、その知識を参照した判断と`VerificationResult`
   を遡ってstaleにし、下流へ流しません。
5. 知識の内容を過去版へ黙って書き戻しません。変更は新しいKnowledgeItem revisionとして
   記録し、旧版とsource eventを参照可能にします。

## 代替案

- **完全に無人でlibrary-wideへ昇格する**：実行は軽くなるが、プロジェクト固有情報や
  誤ったfab条件を複数プロジェクトへ水平展開するため却下する。
- **adoptedを含む全ての採用に承認を要求する**：誤採用の抑制は強いが、READMEの無人実行
  既定と、同一プロジェクト内で閉じる知識ループの目的に反するため却下する。

## 結果とリスク

- 通常のproject-local knowledge loopは停止せずに閉じられ、library-wideへの不可逆な影響
  だけが明示的な承認境界で保護されます。
- approvalの期限切れ、scope外利用、provenance不足、再現条件不足はunknownまたは停止
  として扱い、承認を自動延長しません。
- deprecated knowledgeに依存するVerificationResultを遡及してstaleにするため、過去の
  合格結果が後から再検証対象になる可能性があります。これは古い誤知識を下流へ残さない
  ための意図した挙動です。
- 見直し条件：library-wideの利用範囲、共有主体、承認の有効期間を変更する場合、または
  organization-wide sharingを導入する場合。

## 参照

- [`../../README.md`](../../README.md)
- [`../phase3-plan.md`](../phase3-plan.md)
- [`../knowledge-base.md`](../knowledge-base.md)
- [`../event-log.md`](../event-log.md)
- [`../design-graph.md`](../design-graph.md)
- [`0003-deterministic-tools-first.md`](0003-deterministic-tools-first.md)
