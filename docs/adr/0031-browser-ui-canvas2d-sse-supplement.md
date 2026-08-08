# ADR-0031：ブラウザUI技術とworker伝送

**ステータス：Accepted（ADR-0027追補、Phase 4 WP6）**

## 文脈

ADR-0027はread-only 2Dビューアの受入範囲を定めたが、UIフレームワークを未決定としていた。
Phase 4では依存を最小にし、workerの状態を再接続可能な形で表示する必要がある。

## 決定

1. `apps/web`をpnpm workspaceへ追加し、Viteでビルドする。
2. UIは依存なしの素TypeScriptとCanvas2Dで実装する。入力の正本はACD投影ジオメトリ
   とし、KiCad基板成果物やGerberを描画入力の正本にしない。
3. workerとブラウザの伝送はローカルHTTPとSSEとする。再接続時はイベント位置から再送する。
   WebSocketは採用しない。
4. ブラウザ強制終了後の回帰はPlaywright Chromiumに限定する。

## 代替案

- KiCanvasまたは`@tscircuit/pcb-viewer`を依存する：Phase 4の依存なし方針と入力正本を
  独自に管理する要件に反するため採用しない。
- UIフレームワークを導入する：read-only投影の最小実装に対して依存と境界が過大なため採用しない。
- WebSocketを使う：イベント位置からの再送契約を明示しにくいため採用しない。

## 結果とリスク

依存を抑えたCanvas2D実装とSSE再送により、表示とworker-owned stateを分離する。
UIが正の設計データを変更しないこと、SSE再接続がイベント位置から再現できることを
Playwright Chromiumと決定論的テストで検証する。

## 参照

- [`0027-browser-ui-scope-and-technology.md`](0027-browser-ui-scope-and-technology.md)
- [`0024-long-running-run-ownership-and-persistence.md`](0024-long-running-run-ownership-and-persistence.md)
- [`../phase4-plan.md`](../phase4-plan.md)
