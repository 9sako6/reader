# iOSアプリとSafari拡張

`Reader`はSafari Web Extensionを内包するiOSアプリです。ホストアプリと拡張機能はXcodeGenで一つのXcodeプロジェクトとして管理します。

## プロジェクト生成

```sh
mise run build:ios
mise exec -- xcodegen generate --spec apps/ios/project.yml
```

生成済みの`Reader.xcodeproj`を使うだけならXcodeGenの再実行は不要です。Xcodeビルド時にはSafari拡張のTypeScriptリソースも再生成されます。

## iPhoneで試す

1. Xcodeで`Reader.xcodeproj`を開く
2. `Reader`と`ReaderExtension`のSigningで使用するTeamを選ぶ
3. Bundle Identifierが競合する場合は、両ターゲットを一意な値へ変更する
4. 接続したiPhoneを実行先に選び、`Reader`を実行する
5. iPhoneの「設定」から「アプリ」→「Safari」→「拡張機能」→「Reader」を開き、拡張機能とWebサイトへのアクセスを許可する
6. Safariで記事を開き、画面右端の取っ手を押す

無料のPersonal Teamで署名したアプリは有効期限が切れるため、その場合はXcodeから再度実行します。開発中の変更を実機へ反映するときはXcodeのProduct > Runを使い、完了後に対象のSafariページを再読み込みします。

## 構成

- [ReaderApp](ReaderApp/README.md): iOSホストアプリ
- [ReaderExtension](ReaderExtension/README.md): Safari Web Extension
- `project.yml`: ターゲット、署名設定、リソース生成処理
- `Reader.xcodeproj`: `project.yml`から生成して共有するXcodeプロジェクト
