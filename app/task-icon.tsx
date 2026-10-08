import type { ConversationAvatar } from "../lib/conversation-settings";
import type { CSSProperties, Ref } from "react";
import { CHARACTERS, characterIndexFor, characterSvgMarkup } from "../lib/conversation-character";
import type { Category } from "../lib/types";

// Retained for saved decisions and static previews; not used to choose conversation avatars.
export type IconKind = "plane" | "doc" | "plate" | "tv" | "tag" | "wine" | "card" | "calendar" | "key" | "gift" | "shield" | "pin" | "cart" | "people";
export type IconState = "watch" | "need" | "live" | "done";

const CATEGORY_KIND: Record<Category, IconKind> = { travel: "plane", food: "plate", money: "card", family: "people", shopping: "cart", schedule: "calendar", social: "doc" };

/** Legacy category hints remain compatible with stored decisions. */
export function iconKindFor(category: Category): IconKind {
  return CATEGORY_KIND[category] ?? "doc";
}

export function TaskIcon({ conversationId, avatar, state = "watch", size = 44, animated = false, idleVisible, iconRef, className }: { conversationId: string; avatar?: ConversationAvatar; kind?: IconKind; state?: IconState; size?: number; animated?: boolean; idleVisible?: boolean; iconRef?: Ref<HTMLSpanElement>; className?: string }) {
  const index = avatar?.type === "character" ? avatar.index : characterIndexFor(conversationId);
  const character = CHARACTERS[index] ?? CHARACTERS[0];
  if (avatar?.type === "photo" || avatar?.type === "emoji") return <span ref={iconRef} className={`wd-icon wd-custom-avatar${className ? ` ${className}` : ""}`} style={{ width: size, height: size, fontSize: size * .62 }} aria-hidden="true">{avatar.type === "photo" ? <img src={avatar.value} alt="" /> : avatar.value}</span>;
  const phase = [...conversationId].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);

  return (
    <span ref={iconRef} data-idle-visible={idleVisible} className={`wd-icon${animated || state === "live" ? " is-alive" : ""}${className ? ` ${className}` : ""}`} style={{ width: size, height: size, color: character.color, "--avatar-phase": `${-(phase % 11000) / 1000}s` } as CSSProperties} aria-hidden="true" data-character={character.name}>
      <svg width={size} height={size} viewBox="0 0 44 44" dangerouslySetInnerHTML={{ __html: characterSvgMarkup(index) }} />
      {state === "need" && <span className="wd-icon-dot is-need" />}
    </span>
  );
}

const MASCOT_PATH = "M12 8.5C17 4 24 4 27.5 9c1.8 2.4 3.6 2.6 6.4 1.6 5.2-1.8 9.6 5.4 8.4 12.8-1.4 8.6-7.4 14.6-17 15.6C15.4 40 4.8 34.6 3.6 25.2 2.8 18.4 6.2 12.6 12 8.5Z";

/** Original Dash brand mascot; separate from conversation characters. */
export function Mascot({ size = 28, className, eyeColor = "var(--bg)" }: { size?: number; className?: string; eyeColor?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <path fill="currentColor" d={MASCOT_PATH} />
      <g className="wd-mascot-eyes"><ellipse cx="16.5" cy="23" rx="4.4" ry="5.2" fill={eyeColor} /><ellipse cx="29" cy="26" rx="5" ry="5.8" fill={eyeColor} />
      <g className="wd-mascot-pupils"><circle cx="17.5" cy="22" r="1.9" fill="currentColor" /><circle cx="30.4" cy="25" r="2.1" fill="currentColor" /></g></g>
    </svg>
  );
}
