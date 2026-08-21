# Extractor

ページまたは文字列を、EngineとViewerが共通して扱う`ReaderContent`へ変換します。

## 入出力

`fromText`は文字列と任意の読書コンテキストを正規化します。`fromPage`はDefuddleでページ本文を抽出し、見出し、文章ブロック、セクション位置、本文から参照される図表を組み立てます。

出力契約は`src/contracts.d.ts`の`ReaderContent`と`ReadingContext`が定義します。原文上の位置はJavaScript文字列と同じUTF-16コード単位です。

Extractorは抽出結果を保存せず、Viewerの表示状態も持ちません。テストは`test/page-extractor.test.js`と各アプリのExtractorテストにあります。
