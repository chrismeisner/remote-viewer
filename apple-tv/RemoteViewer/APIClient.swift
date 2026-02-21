import Foundation

enum APIClientError: LocalizedError {
    case invalidResponse
    case authFailed
    case serverError(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid server response"
        case .authFailed:
            return "Authentication failed"
        case .serverError(let code, let message):
            return message ?? "Server error (\(code))"
        }
    }
}

final class APIClient: @unchecked Sendable {
    let baseURL: URL
    private let session: URLSession

    /// CDN base URL fetched from /api/tvos/config — used for direct media streaming.
    /// Falls back to constructing proxy URLs if not yet fetched.
    private(set) var mediaBase: URL?

    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 15
        self.session = URLSession(configuration: config)
    }

    // MARK: - Config

    /// Fetch the CDN base URL from the server. Call once after auth succeeds.
    func fetchConfig() async {
        let url = baseURL.appending(path: "api/tvos/config")
        guard let (data, _) = try? await session.data(from: url),
              let json = try? JSONDecoder().decode([String: String].self, from: data),
              let base = json["mediaBase"],
              let baseURL = URL(string: base) else { return }
        mediaBase = baseURL
    }

    /// Build a direct CDN URL from a relPath (e.g. "The Simpsons/S01E01.mp4").
    /// This lets AVPlayer stream directly from the CDN, bypassing the Next.js proxy.
    func directMediaURL(relPath: String) -> URL {
        let base = mediaBase ?? URL(string: "https://chrismeisner.com/media/")!
        // Percent-encode each path component individually to handle spaces and slashes
        let encoded = relPath
            .split(separator: "/", omittingEmptySubsequences: false)
            .map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
            .joined(separator: "/")
        return URL(string: encoded, relativeTo: base)?.absoluteURL ?? base
    }

    // MARK: - Auth

    /// Check whether the server requires a viewer password.
    func checkAuth() async throws -> AuthCheckResponse {
        let url = baseURL.appending(path: "api/auth/verify")
        let (data, _) = try await session.data(from: url)
        return try JSONDecoder().decode(AuthCheckResponse.self, from: data)
    }

    /// Authenticate with the viewer password.
    /// URLSession automatically stores the returned HTTP-only cookie.
    func authenticate(password: String) async throws -> Bool {
        let url = baseURL.appending(path: "api/auth/verify")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(AuthVerifyRequest(password: password))

        let (data, response) = try await session.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if http.statusCode == 200 {
            let body = try JSONDecoder().decode(AuthVerifyResponse.self, from: data)
            return body.success
        }

        return false
    }

    // MARK: - Channels

    func fetchChannels() async throws -> [Channel] {
        var components = URLComponents(url: baseURL.appending(path: "api/channels"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "source", value: "remote")]

        let (data, response) = try await session.data(from: components.url!)
        try checkHTTP(response)

        let body = try JSONDecoder().decode(ChannelsResponse.self, from: data)
        return body.channels.filter(\.isActive)
    }

    // MARK: - Now Playing

    func fetchNowPlaying(channel: String) async throws -> NowPlayingItem? {
        var components = URLComponents(url: baseURL.appending(path: "api/now-playing"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "source", value: "remote"),
            URLQueryItem(name: "channel", value: channel),
        ]

        let (data, response) = try await session.data(from: components.url!)
        try checkHTTP(response)

        let body = try JSONDecoder().decode(NowPlayingResponse.self, from: data)
        return body.nowPlaying
    }

    // MARK: - URL Helpers

    /// Convert the relative `src` path from a now-playing response into a full URL.
    /// The server returns paths like `/api/media?file=…&source=remote` which proxy
    /// through to the CDN — AVPlayer can stream from them with range-request support.
    func mediaURL(from src: String) -> URL {
        if src.hasPrefix("/") {
            var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
            let parts = src.split(separator: "?", maxSplits: 1)
            components.path = String(parts[0])
            if parts.count > 1 {
                components.query = String(parts[1])
            }
            return components.url ?? baseURL
        }
        return URL(string: src) ?? baseURL
    }

    // MARK: - Internal

    private func checkHTTP(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIClientError.serverError(http.statusCode, nil)
        }
    }
}
