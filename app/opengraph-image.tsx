import { ImageResponse } from "next/og";
import { Mascot } from "./task-icon";

export const alt = "Dash | Your assistant. Less on your plate.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "64px 76px", background: "#fff", color: "#111", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 38, fontSize: 34, fontWeight: 700 }}><Mascot size={64} eyeColor="#fff" /><span>Dash</span></div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 68, fontWeight: 700, letterSpacing: -4, lineHeight: 1.05 }}><span>Your assistant.</span><span>Less on your plate.</span></div>
      <div style={{ marginTop: 30, fontSize: 28, color: "#666", lineHeight: 1.4 }}>Text Dash a task. It notices what needs attention, too.</div>
    </div>,
    size,
  );
}
