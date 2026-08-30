import SwiftUI

struct ContentView: View {
    private let release = AppRelease.current

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("reader")
                            .font(.largeTitle.bold())
                        Text("Safariで開いている文章を、その場で読みやすい表示へ切り替えます。")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 18) {
                        instruction("1", "設定を開く", "アプリ › Safari › 拡張機能へ進みます。")
                        instruction("2", "readerを許可", "readerをオンにして、Webサイトへのアクセスを許可します。")
                        instruction("3", "Safariで読む", "ページ右端の青い取っ手を押します。")
                    }

                    Spacer(minLength: 28)

                    VStack(alignment: .leading, spacing: 18) {
                        Text("本文、URL、読書位置、表示設定は保存しません。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        VStack(alignment: .leading, spacing: 6) {
                            metadata("Version", release.version)
                            metadata("Build", release.build)
                            linkedMetadata("Commit", release.commit, destination: release.commitURL)
                        }
                        .font(.subheadline.monospaced())

                        Link("GitHub Release", destination: release.url)
                            .font(.headline)
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .foregroundStyle(Color.white)
        }
        .preferredColorScheme(.dark)
    }

    private func instruction(_ number: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(number)
                .font(.headline)
                .frame(width: 34, height: 34)
                .background(Color.white.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func metadata(_ label: String, _ value: String) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .textSelection(.enabled)
        }
    }

    private func linkedMetadata(_ label: String, _ value: String, destination: URL) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 80, alignment: .leading)
            Link(value, destination: destination)
        }
    }
}

private struct AppRelease {
    let version: String
    let build: String
    let commit: String

    var tag: String {
        "apple-v\(version)"
    }

    var url: URL {
        URL(string: "https://github.com/9sako6/reader/releases/tag/\(tag)")!
    }

    var commitURL: URL {
        let revision = commit.replacingOccurrences(of: "-dirty", with: "")
        return URL(string: "https://github.com/9sako6/reader/commit/\(revision)")!
    }

    static let current = AppRelease(
        version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
        build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
        commit: Bundle.main.object(forInfoDictionaryKey: "ReaderCommit") as? String ?? "unknown"
    )
}
