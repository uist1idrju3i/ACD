# ADR-0035: ブラウザread-only observerの契約

## 状態

accepted

## 文脈

長時間実行をworkerが所有したまま、ブラウザから台帳、検証結果、checkpoint、停止記録、
Evidence、投影ジオメトリ、revision差分を観測する必要がある。ブラウザ切断はworkerの
停止を意味せず、表示値は正本artifactまたはEvidenceへ辿れなければならない。

## 決定

- `apps/worker`をHTTP/SSEのcomposition root、`apps/web`をread-only clientとする。
- `GET /events?from=N`は検証済みraw `EventEnvelope`を配信する。`N`は0-based event countで、
  SSE `id`はevent position、payload内の`eventId`はcanonical identityとする。
- `Last-Event-ID`がquery cursorより優先される。cursorがlog長を超える場合、またはlogの
  検証に失敗した場合は`event-replay-failure`として停止し、SSEを成功扱いで継続しない。
- `/state`はraw eventと分離されたtyped read model、`/projection`はmm単位のcanonical DTO、
  `/diff`はfrom/to revisionとpatch/event provenanceを含むsemantic diffとする。
- courtyardとmaskはcanonical geometryが提供されるまで
  `status: unavailable`、`reason: canonical-data-not-provided`として表示し、推定しない。
- entityは`entity.id`、placementは`componentId`、padは`componentId + pad.number`を
  identityとする。track/viaはcanonical geometry keyを使い、重複時だけ決定論的序数を付ける。
- projectionのrevisionは描画snapshotのrevisionであり、worker stateやrun recordのrevisionとは
  別の値である。patch適用後snapshotへの追従描画はWP6の範囲外とする。
- screenshotはcanonical evidenceではない。DOM/accessibility、geometry DTO、SSE cursorの
  正規化JSONをcanonical evidenceとする。
- HTTP transportの失敗は`error.category: transport`と
  `method-not-allowed`／`route-not-found`／`snapshot-unavailable`で表現し、
  graph error codeと混同しない。cursor不正やevent検証失敗だけが
  `event-replay-failure`となる。
- web clientの通常の再接続はEventSource標準の`Last-Event-ID`送信に委ね、
  受信済みSSE `id`をclient側で重複排除する。明示的な`from`指定は初回接続と
  canonical cursor検証に限定する。

## 責務境界

workerは与えられたrun rootを読む。現runnerの`artifacts/`出力は受入証跡exportであり、
ADR-0024が定める`.acd/runs/<runId>/`の正規worker persistenceをこのADRで再編しない。
webはfilesystem、worker ownership、graph mutationを持たない。
