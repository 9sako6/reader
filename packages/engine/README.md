# Engine

入力元と表示先に依存しない文章処理を所有します。DOM、Chrome API、Safari APIには依存しません。

## 入出力

Engineは文字列を`ReaderUnit[]`へ分割し、各単位の原文、文番号、種類、開始位置、終了位置を返します。位置はJavaScript文字列と同じUTF-16コード単位です。

このほか、表示時間、前の文、見出し現在地、読書進捗、原文位置と表示単位の対応を計算します。共有する型と公開APIは`src/contracts.d.ts`の`ReaderEngine`が定義します。

## 不変条件

- 原文の文字列と順序を変更しない
- すべての表示単位に原文上の開始位置と終了位置を持たせる
- DOMやViewerの状態を受け取らない
- 同じ入力とロケールから同じ結果を返す

テストは`test/core.test.js`と`test/session.test.js`にあります。
