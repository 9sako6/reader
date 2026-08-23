# Extractor

ページまたは文字列から`ReaderContent`を作ります。EngineとViewerはこの形式で本文と記事構成を受け取ります。

## 入出力

`fromText`は文字列と読書情報を`ReaderContent`へ揃えます。`fromPage`はDefuddleでページ本文を抽出し、見出し、文章ブロック、セクション位置、画像、コードブロック、Mermaid図を組み立てます。

`ReaderContent`と`ReadingContext`の型は`src/types.d.ts`にあります。原文上の位置の単位はUTF-16コード単位です。
