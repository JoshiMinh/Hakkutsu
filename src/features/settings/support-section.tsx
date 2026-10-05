const kofiSvg = "/assets/logo/kofi.png";

export function SupportSection() {
  return (
    <section
      className="hk-settings-card"
      style={{
        border: "1px solid rgba(255, 94, 91, 0.3)",
        background: "rgba(255, 94, 91, 0.06)",
      }}
    >
      <div
        style={{
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: "14px",
              fontWeight: 700,
              color: "#ff5e5b",
            }}
          >
            Support Hakkutsu Development
          </h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "12px",
              color: "var(--hk-text-muted)",
            }}
          >
            If you enjoy using Hakkutsu, consider buying me a coffee on Ko-fi!
          </p>
        </div>
        <a
          href="https://ko-fi.com/joshiminh"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            borderRadius: "8px",
            background: "#ff5e5b",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "12px",
            textDecoration: "none",
            flexShrink: 0,
            boxShadow: "0 4px 12px rgba(255, 94, 91, 0.3)",
          }}
        >
          <img
            src={kofiSvg}
            alt="Ko-fi"
            style={{ width: 16, height: 16, objectFit: "contain" }}
          />
          Support on Ko-fi
        </a>
      </div>
    </section>
  );
}
