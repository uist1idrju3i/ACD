# schematic readability（Phase 2 WP7）

**ステータス：Draft**

## 目的と範囲

Phase 1 WP6から繰延した「net label中心の回路図を読みやすくする」作業です。**electrical
semantics、netlist、ERC結果を変えず、幾何配置と非電気的な注記だけを変更します。**

実装は[`../packages/adapters/kicad/src/schematic-layout.ts`](../packages/adapters/kicad/src/schematic-layout.ts)
（純関数）で、投影は[`../packages/adapters/kicad/src/projection.ts`](../packages/adapters/kicad/src/projection.ts)
の`renderGoldenSchematic`が使います。

## 変更内容

1. **機能ブロック単位の配置**：従来は基板placement順の3列grid（`80 + (i % 3) * 70`）でした。
   現在はWP3の設計根拠（`rationale.appliesTo`の`block:<name>`と`part:<id>`）から
   part→functional blockの割当を導き、`requirement.functionalBlocks`の宣言順に
   ブロック単位で列へ流し込みます。ブロックは列をまたいで分割しません。
2. **実寸に基づく間隔**：symbol snapshotのpin座標から各symbolの外形を求め、縦方向に
   積み上げます。ESP32のような大きなsymbolと0603の受動部品が重なりません。
3. **ブロック見出し**：各ブロックの先頭に非電気的な`(text ...)`を配置します。
4. **title block**：要求名、schema version、fixture IDを`(title_block ...)`へ記録します。
   「グラフが正本で回路図は投影である」ことをsheet上にも残します。
5. **label justification**：net labelをsymbol本体の外側へ寄せます（pinのx offsetの符号で
   left／rightを選択）。

## 変えていないもの

- net、pin、symbol、footprint、reference、value、netlistの内容。
- ERC／DRCのルールと結果。Gate 7（netlist readback）とGate 8（ERC）で確認します。
- 部品の基板placement（`placeFixture`）と routing。回路図座標は基板座標と独立です。

## 安全確認：pinの重なり

eeschemaは**同一座標のpinを接続**します。読みやすさのための再配置が意図しない接続を
作らないよう、`assertNoPinOverlap`が異なるsymbol同士のpin重なりを検出して
`KicadProjectionError`で停止します。同一symbol内で座標が一致するpin（library由来の
stacked pin）は対象外です。

## 決定論

同じfixtureからは同じ座標が出ます。ブロック内のpartはreference順、ブロックは
`requirement.functionalBlocks`の宣言順で、いずれの順序も入力データだけで決まります。
どのブロックにも属さないpartは`Unassigned`ブロックへ回し、**配置漏れは停止**します。

## 範囲外

- wire中心の投影（net labelをwireとjunctionへ置き換える）は未実装です。現状は
  label中心のままで、配置と注記だけを改善しています。
- 階層シート分割、bus記法、power port symbolへの置換は行いません。いずれもnetlistや
  ERCの解釈に影響しうるため、必要になった時点で別途契約化します。
- smoke fixtureの回路図は固定座標のままです（4部品で可読性の問題がありません）。
