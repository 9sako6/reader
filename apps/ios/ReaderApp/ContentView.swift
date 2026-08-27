import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

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

                Spacer()

                Text("本文、URL、読書位置、表示設定は保存しません。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
}
