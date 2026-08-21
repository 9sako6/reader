# Chrome拡張

Chromeで選択した文章やページ本文を読み取ります。Desktop Viewerでは、記事の構成を見ながら文章表示とRSVPを切り替えられます。

## ビルド

```sh
mise run build:chrome
```

生成された`dist/`を、`chrome://extensions`の「パッケージ化されていない拡張機能を読み込む」から選択します。

## 構成

- `manifest.json`: Chrome拡張の権限、Service Worker、配布バージョン
- `src/service-worker.ts`: コンテキストメニュー、拡張アイコン、ページ本文抽出の起点
- `src/viewer/viewer.ts`: Desktop Viewerの表示と操作

`dist/`にはEngine、Extractor、Defuddle、Desktop Viewerが入ります。

## リリース

Chrome版のバージョンは`manifest.json`で管理します。mainへ変更を反映したあと、次のタスクが型検査、テスト、zip生成、タグ作成、タグのpushを順に行います。

```sh
mise run release:chrome
```

`chrome-v<version>`タグを受け取ったGitHub Actionsが、zipとSHA-256チェックサムをGitHub Releaseへ添付します。Release本文には導入手順と変更一覧が入ります。
