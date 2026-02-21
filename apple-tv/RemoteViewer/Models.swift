import Foundation

// MARK: - Auth

struct AuthCheckResponse: Codable {
    let passwordRequired: Bool
    let isAuthenticated: Bool
}

struct AuthVerifyRequest: Encodable {
    let password: String
}

struct AuthVerifyResponse: Codable {
    let success: Bool
    let error: String?
}

// MARK: - Channels

struct ChannelsResponse: Codable {
    let channels: [Channel]
    let source: String?
    let error: String?
}

struct Channel: Codable, Identifiable, Hashable {
    let id: String
    let shortName: String?
    let active: Bool?
    let scheduledCount: Int?
    let type: String?

    var displayName: String {
        shortName ?? "Channel \(id)"
    }

    var isActive: Bool {
        active ?? true
    }

    var scheduleLabel: String {
        switch type {
        case "looping": return "Looping"
        default: return "24-Hour"
        }
    }
}

// MARK: - Now Playing

struct NowPlayingResponse: Codable {
    let nowPlaying: NowPlayingItem?
    let serverTimeMs: Int?
}

struct NowPlayingItem: Codable, Equatable {
    let title: String
    let relPath: String
    let durationSeconds: Double
    let startOffsetSeconds: Double
    let endsAt: Double
    let src: String
}
