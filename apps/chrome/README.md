# Chrome拡張

Chrome 116以降で選択した文章やページ本文を読み取ります。Desktop Viewerでは、記事の構成を見ながら文章表示とRSVPを切り替えられます。

## ビルド

```sh
mise run build:chrome
```

生成された`dist/`を、`chrome://extensions`の「パッケージ化されていない拡張機能を読み込む」から選択します。

## 構成

- `manifest.json`: Chrome拡張の権限、Service Worker、配布バージョン
- `src/service-worker.ts`: コンテキストメニュー、拡張アイコン、ページ本文抽出の起点
- `src/runtime.ts`: ReaderSession client、React View、Engine、Extractor、Desktop Viewerを単一bundleへまとめるentry point
- `session-host.html` / `src/session-host.ts`: WebサイトのCSPから独立したoffscreen documentでReaderSession Workerを管理する
- `src/session-worker.ts`: ReaderSession facade、WASM、読書タイマーを所有するWorker
- `src/viewer/viewer.ts`: Desktop Viewerの表示と操作

`dist/`にはesbuildでまとめたbrowser runtime、ReaderSessionのWASM、Defuddle、ライセンス情報が入ります。

## リリース

Chrome版は日本時間を基準にした`YYYY.M.RELEASE`形式のCalVerを使います。`RELEASE`は月内のリリース連番で、最初は`0`、以降は`1`ずつ増やします。

次のバージョンを`manifest.json`へ反映し、変更理由を含むコミットとしてmainへ反映します。

```sh
mise run bump:chrome
```

mainへの反映後、次のタスクがバージョン、型検査、テスト、zip生成を検証し、タグを作成してpushします。

```sh
mise run release:chrome
```

`chrome-v<version>`タグを受け取ったGitHub Actionsが、zipとSHA-256チェックサムをGitHub Releaseへ添付します。Release本文には導入手順と、前回のChromeタグから今回のタグまでのコミット題名が時系列で入ります。Pull Requestの作成はリリースノート掲載の条件ではありません。
