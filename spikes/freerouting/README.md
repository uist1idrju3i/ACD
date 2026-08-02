# Freerouting DSN/SES spike

このspikeは、公式Freerouting containerを外部processとして実行し、Specctra
DSN入力からSES出力までの最小round-tripを確認するためのものです。Freerouting
はGPLのため、ACDへjar、container、サンプルDSNをvendorまたは再配布しません。

実行：

```sh
bash spikes/freerouting/run.sh
```

使用するcontainer digest、入力fixtureのsource、結果は実行時に表示します。
