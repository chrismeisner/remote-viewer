import SwiftUI

@main
struct RemoteViewerApp: App {
    @StateObject private var session = SessionManager()

    var body: some Scene {
        WindowGroup {
            Group {
                if let client = session.apiClient, session.isConnected {
                    PlayerView(apiClient: client)
                } else if let error = session.error {
                    retryView(error)
                } else {
                    loadingView
                }
            }
            .environmentObject(session)
            .task { await session.autoConnect() }
        }
    }

    private var loadingView: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 24) {
                ProgressView()
                Text("Connecting\u{2026}")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func retryView(_ message: String) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 30) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 60))
                    .foregroundStyle(.secondary)
                Text(message)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Button("Retry") {
                    Task { await session.autoConnect() }
                }
            }
        }
    }
}
