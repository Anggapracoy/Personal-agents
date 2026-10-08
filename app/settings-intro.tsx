import type { ComponentProps } from "react";
import { SettingsGlyph } from "./settings-glyph";

/** Shared introduction for Settings destinations and their detail pages. */
export function SettingsIntro({ icon, title, description }: { icon: ComponentProps<typeof SettingsGlyph>["name"]; title: string; description: string }) {
  return <div className="wd-settings-intro"><SettingsGlyph name={icon} /><h2>{title}</h2><p>{description}</p></div>;
}
