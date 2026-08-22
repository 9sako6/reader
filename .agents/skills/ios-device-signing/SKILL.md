---
name: ios-device-signing
description: このリポジトリのiOSアプリを実機向けにビルド・インストールするとき、Development Team、署名、プロビジョニング、No Account for Teamエラーを正しく扱う。
---

# iOS実機署名

- 利用者固有のDevelopment Teamはリポジトリへ保存せず、`xcodebuild`の`DEVELOPMENT_TEAM`へ一時的に渡す。
- `security find-identity -v -p codesigning`が表示する証明書名末尾の括弧内IDをTeam IDと決めつけない。証明書Subjectの`OU`またはプロビジョニングプロファイルの`TeamIdentifier`を使い、両者の一致を確認する。
- 誤ったTeam IDを渡した場合も`No Account for Team`は出る。このエラーだけでApple Accountが未ログインだと判断しない。
- 正しいTeam IDに対応する有効な証明書またはプロファイルがないと確認できた場合だけ、XcodeでのTeam選択やサインインを案内する。
- Team ID、メールアドレス、プロファイルUUID、端末ID、ローカルパスをリポジトリへ書き込まない。
- 実機へのインストールや起動は、ユーザーが実機反映を依頼した場合だけ行う。
