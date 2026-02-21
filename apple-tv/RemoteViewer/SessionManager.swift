import SwiftUI
import Security

/// Manages connection state, credentials, and the shared API client.
@MainActor
final class SessionManager: ObservableObject {

    // MARK: - Published state

    @Published var isConnected = false
    @Published var isConnecting = false
    @Published var error: String?

    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: Keys.serverURL) }
    }

    /// The active API client — nil until a successful connection.
    private(set) var apiClient: APIClient?

    // MARK: - Init

    init() {
        self.serverURL = UserDefaults.standard.string(forKey: Keys.serverURL) ?? "http://localhost:3000"
    }

    // MARK: - Connection

    /// Auto-connect to the hardcoded server with no interaction required.
    func autoConnect() async {
        guard !isConnected, !isConnecting else { return }

        guard let url = Self.normalizedURL(from: serverURL) else {
            error = "Invalid server URL"
            return
        }

        isConnecting = true
        error = nil

        let client = APIClient(baseURL: url)

        do {
            // Authenticate if the server requires a password
            let authCheck = try await client.checkAuth()
            if authCheck.passwordRequired {
                let saved = Keychain.load(for: serverURL) ?? ""
                if !saved.isEmpty {
                    _ = try await client.authenticate(password: saved)
                }
            }

            // Verify the server is reachable by fetching channels
            _ = try await client.fetchChannels()

            // Fetch CDN base URL so AVPlayer can stream directly
            await client.fetchConfig()

            apiClient = client
            isConnected = true
        } catch {
            self.error = error.localizedDescription
        }

        isConnecting = false
    }

    func disconnect() {
        isConnected = false
        apiClient = nil
        error = nil
    }

    // MARK: - URL helpers

    static func normalizedURL(from raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") { s = "https://\(s)" }
        if s.last == "/" { s.removeLast() }
        return URL(string: s)
    }

    // MARK: - Constants

    private enum Keys {
        static let serverURL = "rv_serverURL"
    }
}

// MARK: - Lightweight Keychain wrapper

private enum Keychain {
    private static let service = "com.remoteviewer.tvos"

    static func save(_ value: String, for account: String) {
        guard let data = value.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        // Remove any existing item first
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func load(for account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
