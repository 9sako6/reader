# iOSアプリとSafari拡張

`reader`はSafari Web Extensionを内包するiOSアプリです。ホストアプリと拡張機能はXcodeGenで一つのXcodeプロジェクトとして管理します。

## プロジェクト生成

```sh
mise run build:ios
mise exec -- xcodegen generate --spec apps/ios/project.yml
```

`reader.xcodeproj`は生成済みです。Xcodeでビルドすると、Safari拡張のTypeScriptリソースも更新されます。

## iPhoneで試す

1. Xcodeで`reader.xcodeproj`を開く
2. `reader`と`reader-extension`のSigningで使用するTeamを選ぶ
3. Bundle Identifierが競合する場合は、両ターゲットを一意な値へ変更する
4. 接続したiPhoneを実行先に選び、`reader`を実行する
5. iPhoneの「設定」から「アプリ」→「Safari」→「拡張機能」→「reader」を開き、拡張機能とWebサイトへのアクセスを許可する
6. Safariで記事を開き、画面右端の取っ手を押す

無料のPersonal Teamで署名したアプリは有効期限が切れるため、その場合はXcodeから再度実行します。開発中の変更を実機へ反映するときはXcodeのProduct > Runを使い、完了後に対象のSafariページを再読み込みします。

## 構成

- [iOSホストアプリ](ReaderApp/README.md)
- [Safari Web Extension](ReaderExtension/README.md)
- `project.yml`: ターゲット、署名設定、リソース生成処理
- `reader.xcodeproj`: `project.yml`から生成して共有するXcodeプロジェクト
