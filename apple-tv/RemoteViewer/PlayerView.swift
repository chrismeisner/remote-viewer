import AVKit
import SwiftUI

// MARK: - View

struct PlayerView: View {
    let apiClient: APIClient

    @StateObject private var vm: PlayerViewModel
    @FocusState private var focusedButton: ChannelButton?

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        _vm = StateObject(wrappedValue: PlayerViewModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TVPlayerRepresentable(
                player: vm.player,
                onSwipeUp:   { vm.showRemote() },
                onSwipeDown: { vm.hideRemote() }
            )
            .ignoresSafeArea()

            // Top-left: CRT channel info
            channelInfoOverlay
                .animation(.easeInOut(duration: 0.25), value: vm.channelOverlayVisible)

            // Bottom-center: horizontal CH▲ / CH▼ remote
            remoteOverlay
                .animation(.spring(response: 0.35, dampingFraction: 0.8), value: vm.remoteVisible)
        }
        .task { await vm.start() }
        .onDisappear { vm.stop() }
        .onChange(of: vm.pendingFocus) { _, target in
            if let target { focusedButton = target; vm.pendingFocus = nil }
        }
        .onChange(of: focusedButton) { _, _ in
            if vm.remoteVisible { vm.resetRemoteTimer() }
        }
    }

    // MARK: - CRT channel info (top-left)

    @ViewBuilder
    private var channelInfoOverlay: some View {
        if vm.channelOverlayVisible, let ch = vm.currentChannel {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(ch.id.paddedChannelNumber)
                        .font(.system(size: 48, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                    if let name = ch.shortName, !name.isEmpty {
                        Text(name)
                            .font(.system(size: 28, weight: .medium, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                if let np = vm.nowPlaying {
                    Text(np.title)
                        .font(.system(size: 22, weight: .regular, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.65))
                        .lineLimit(1)
                }
                if vm.isVideoLoading {
                    Text("\u{2588}")
                        .font(.system(size: 22, design: .monospaced))
                        .foregroundStyle(.white)
                        .blinkAnimation()
                }
            }
            .padding(24)
            .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(48)
            .transition(.opacity)
            .allowsHitTesting(false)
        }
    }

    // MARK: - Horizontal remote (bottom-center)

    @ViewBuilder
    private var remoteOverlay: some View {
        if vm.remoteVisible {
            VStack {
                Spacer()

                HStack(spacing: 2) {
                    channelButton(.up)
                    Divider()
                        .frame(width: 1, height: 60)
                        .background(.white.opacity(0.15))
                    channelButton(.down)
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .padding(.bottom, 60)
            }
            .transition(.asymmetric(
                insertion: .move(edge: .bottom).combined(with: .opacity),
                removal:   .move(edge: .bottom).combined(with: .opacity)
            ))
        }
    }

    private func channelButton(_ button: ChannelButton) -> some View {
        let isFocused = focusedButton == button
        return Button {
            switch button {
            case .up:   vm.channelUp()
            case .down: vm.channelDown()
            }
            vm.resetRemoteTimer()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: button == .up ? "chevron.up" : "chevron.down")
                    .font(.system(size: 28, weight: .semibold))
                Text(button == .up ? "CH  ▲" : "CH  ▼")
                    .font(.system(size: 22, weight: .semibold, design: .monospaced))
                    .tracking(1)
            }
            .frame(width: 200, height: 80)
            .foregroundStyle(isFocused ? .black : .white)
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(isFocused ? Color.white : Color.clear)
                    .padding(4)
            )
        }
        .buttonStyle(.plain)
        .focused($focusedButton, equals: button)
    }
}

// MARK: - Focus enum

enum ChannelButton: Hashable { case up, down }

// MARK: - Blink modifier

private struct BlinkModifier: ViewModifier {
    @State private var on = true
    func body(content: Content) -> some View {
        content
            .opacity(on ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                    on = false
                }
            }
    }
}

private extension View {
    func blinkAnimation() -> some View { modifier(BlinkModifier()) }
}

private extension String {
    var paddedChannelNumber: String {
        let digits = self.filter(\.isNumber)
        if digits.isEmpty { return self }
        return digits.count < 2 ? "0\(digits)" : digits
    }
}

// MARK: - ViewModel

@MainActor
final class PlayerViewModel: ObservableObject {
    let player = AVPlayer()

    @Published var channels: [Channel] = []
    @Published var currentChannel: Channel?
    @Published var nowPlaying: NowPlayingItem?
    @Published var channelOverlayVisible = false
    @Published var remoteVisible = false
    @Published var isVideoLoading = false
    @Published var error: String?
    @Published var pendingFocus: ChannelButton?

    private let apiClient: APIClient
    private var refreshTask: Task<Void, Never>?
    private var channelOverlayTask: Task<Void, Never>?
    private var remoteTask: Task<Void, Never>?

    init(apiClient: APIClient) { self.apiClient = apiClient }

    // MARK: - Lifecycle

    func start() async {
        do {
            channels = try await apiClient.fetchChannels()
            guard let first = channels.first else { error = "No channels available"; return }
            await switchToChannel(first)
        } catch {
            self.error = "Failed to load channels: \(error.localizedDescription)"
        }
    }

    func stop() {
        refreshTask?.cancel()
        channelOverlayTask?.cancel()
        remoteTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
    }

    // MARK: - Channel switching

    func channelUp() {
        guard !channels.isEmpty else { return }
        let idx = channels.firstIndex(of: currentChannel ?? channels[0]) ?? 0
        Task { await switchToChannel(channels[(idx + 1) % channels.count]) }
    }

    func channelDown() {
        guard !channels.isEmpty else { return }
        let idx = channels.firstIndex(of: currentChannel ?? channels[0]) ?? 0
        Task { await switchToChannel(channels[(idx - 1 + channels.count) % channels.count]) }
    }

    private func switchToChannel(_ channel: Channel) async {
        currentChannel = channel
        isVideoLoading = true
        flashChannelOverlay()
        do {
            guard let np = try await apiClient.fetchNowPlaying(channel: channel.id) else {
                nowPlaying = nil; isVideoLoading = false
                scheduleRefresh(retrySeconds: 5)
                return
            }
            await playItem(np)
        } catch {
            self.error = "Playback error: \(error.localizedDescription)"
            isVideoLoading = false
        }
    }

    // MARK: - Playback

    private func playItem(_ np: NowPlayingItem) async {
        nowPlaying = np
        let url = apiClient.directMediaURL(relPath: np.relPath)
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        let seekTime = CMTime(seconds: np.startOffsetSeconds, preferredTimescale: 600)
        await player.seek(to: seekTime, toleranceBefore: .zero, toleranceAfter: .zero)
        player.play()
        isVideoLoading = false
        scheduleRefreshForEnd(of: np)
    }

    // MARK: - Auto-advance

    private func scheduleRefreshForEnd(of np: NowPlayingItem) {
        refreshTask?.cancel()
        let delay = max((np.endsAt - Date().timeIntervalSince1970 * 1000) / 1000.0, 2.0)
        refreshTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.advanceToNextProgram()
        }
    }

    private func scheduleRefresh(retrySeconds: Double) {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(retrySeconds))
            guard !Task.isCancelled else { return }
            await self?.advanceToNextProgram()
        }
    }

    private func advanceToNextProgram() async {
        guard let channel = currentChannel else { return }
        do {
            guard let np = try await apiClient.fetchNowPlaying(channel: channel.id) else {
                scheduleRefresh(retrySeconds: 5); return
            }
            if np == nowPlaying { scheduleRefreshForEnd(of: np); return }
            await playItem(np)
        } catch {
            scheduleRefresh(retrySeconds: 10)
        }
    }

    // MARK: - Overlays

    private func flashChannelOverlay() {
        channelOverlayTask?.cancel()
        channelOverlayVisible = true
    }

    func scheduleChannelOverlayHide() {
        channelOverlayTask?.cancel()
        channelOverlayTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            self?.channelOverlayVisible = false
        }
    }

    func showRemote() {
        if remoteVisible {
            resetRemoteTimer()
            return
        }
        remoteVisible = true
        pendingFocus = .up
        channelOverlayTask?.cancel()
        channelOverlayVisible = true
        resetRemoteTimer()
    }

    func hideRemote() {
        guard remoteVisible else { return }
        remoteTask?.cancel()
        remoteVisible = false
        scheduleChannelOverlayHide()
    }

    func resetRemoteTimer() {
        remoteTask?.cancel()
        remoteTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.hideRemote()
        }
    }
}

// MARK: - AVPlayerViewController wrapper

private struct TVPlayerRepresentable: UIViewControllerRepresentable {
    let player: AVPlayer
    let onSwipeUp: () -> Void
    let onSwipeDown: () -> Void

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.showsPlaybackControls = false

        let swipeUp = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.swipedUp))
        swipeUp.direction = .up
        vc.view.addGestureRecognizer(swipeUp)

        let swipeDown = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.swipedDown))
        swipeDown.direction = .down
        vc.view.addGestureRecognizer(swipeDown)

        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player { vc.player = player }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onSwipeUp: onSwipeUp, onSwipeDown: onSwipeDown)
    }

    final class Coordinator: NSObject {
        let onSwipeUp: () -> Void
        let onSwipeDown: () -> Void
        init(onSwipeUp: @escaping () -> Void, onSwipeDown: @escaping () -> Void) {
            self.onSwipeUp = onSwipeUp
            self.onSwipeDown = onSwipeDown
        }
        @objc func swipedUp()   { onSwipeUp() }
        @objc func swipedDown() { onSwipeDown() }
    }
}
