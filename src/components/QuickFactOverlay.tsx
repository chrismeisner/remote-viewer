interface QuickFactOverlayProps {
  showQuickFact: boolean;
  quickFactDisplay: string;
  quickFactText: string;
  quickFactLoading: boolean;
  /** Max width of the overlay box as a vw value (default 80) */
  widthVw?: number;
  /** Additional condition that forces the overlay hidden (e.g. another overlay is showing) */
  hideWhen?: boolean;
  /** Render a solid black background behind each line of text */
  textBackground?: boolean;
}

const TEXT_STYLE: React.CSSProperties = {
  fontSize: 20,
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
};

export function QuickFactOverlay({
  showQuickFact,
  quickFactDisplay,
  quickFactText,
  quickFactLoading,
  widthVw = 80,
  hideWhen = false,
  textBackground = false,
}: QuickFactOverlayProps) {
  const visible = showQuickFact && !hideWhen;

  const textBgStyle: React.CSSProperties = textBackground
    ? {
        background: "#000",
        padding: "2px 6px",
        borderRadius: 2,
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      }
    : {};

  return (
    <div
      className={`absolute top-4 left-4 right-4 z-10 transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div
        className="channel-overlay font-mono"
        style={{
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 0,
          maxWidth: `${widthVw}vw`,
        }}
      >
        {quickFactLoading && !quickFactDisplay ? (
          // Loading state: just the blinking cursor, no sizer needed
          <span className="channel-name" style={{ ...TEXT_STYLE, ...textBgStyle }}>
            <span className="channel-cursor">▌</span>
          </span>
        ) : (
          /*
           * Stable-height typewriter wrapper.
           * The invisible "sizer" span holds the full final text so the
           * container claims its full eventual height before typing begins.
           * The visible typed text is absolutely positioned on top, which
           * means no layout reflows (and no line-jump) as text wraps.
           */
          <div style={{ position: "relative" }}>
            {/* Invisible sizer — reserves space for the full text */}
            <span
              className="channel-name"
              style={{ ...TEXT_STYLE, visibility: "hidden", display: "block" }}
              aria-hidden="true"
            >
              {quickFactText || "\u00A0"}
            </span>
            {/* Visible typed text — rides on top of the sizer */}
            <span
              className="channel-name"
              style={{
                ...TEXT_STYLE,
                ...textBgStyle,
                position: "absolute",
                top: 0,
                left: 0,
              }}
            >
              {quickFactDisplay}
              {quickFactDisplay.length < quickFactText.length && (
                <span className="channel-cursor">▌</span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
