# Chrome拡張

Chrome 116以降でページ本文を読み取ります。Desktop Viewerでは、記事の構成を見ながらPageとSpotsを切り替えられます。

## ビルド

```sh
mise run build:chrome
```

生成された`dist/`を、`chrome://extensions`の「パッケージ化されていない拡張機能を読み込む」から選択します。

## 構成

- `manifest.json`: Chrome拡張の権限、Service Worker、配布バージョン
- `src/service-worker.ts`: 拡張アイコンとページ本文抽出の起点
- `src/runtime.ts`: ReaderSession client、React View、Engine、Extractor、Desktop Viewerを単一bundleへまとめるentry point
- `session-host.html` / `src/session-host.ts`: WebサイトのCSPから独立したoffscreen documentでReaderSession Workerを管理する
- `src/session-worker.ts`: ReaderSession facade、WASM、読書タイマーを所有するWorker
- `src/viewer/viewer.ts`: Desktop Viewerの表示と操作

`dist/`にはesbuildでまとめたbrowser runtime、ReaderSessionのWASM、Defuddle、ライセンス情報が入ります。

## リリース

Chrome版とApple版は、日本時間を基準にした共通の`YYYY.M.RELEASE`形式のCalVerを使います。`RELEASE`は月内のリリース連番で、最初は`0`、以降は`1`ずつ増やします。Apple版のBuild番号はTestFlight用の連番として、共通バージョンとは別に管理します。

次のバージョンをChromeとAppleの設定へ反映し、変更理由を含むコミットとしてmainへ反映します。

```sh
mise run bump:release
```

mainへの反映後、次のタスクが共通バージョン、型検査、テスト、Chromeのzip、Appleのソーススナップショットを検証します。検証後、同じコミットへ`chrome-v<version>`と`apple-v<version>`を付け、二つのタグをまとめてpushします。

```sh
mise run release
```

`chrome-v<version>`タグを受け取ったGitHub Actionsが、zipとSHA-256チェックサムをChrome用のGitHub Releaseへ添付します。`apple-v<version>`タグからは、署名情報を含まないソーススナップショットとSHA-256チェックサムをApple用のGitHub Releaseへ添付します。Release本文には、前回の同じプラットフォームのタグから今回のタグまでのコミット題名、短いコミットハッシュ、コミットへのリンクが時系列で入ります。最初のApple Releaseだけは、直前のChromeタグを変更履歴の起点にします。
