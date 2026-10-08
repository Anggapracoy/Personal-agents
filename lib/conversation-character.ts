/** Fixed order: changing it would reassign existing conversations. */
export const CHARACTERS = [
  { name: "pebble", color: "#477BE0", path: "M10 32C7 30 11 23 15 17L22 9C26 5 29 9 32 15L37 29C40 37 32 37 24 36Z", eyes: [[20, 22], [28, 19]], mouth: "M22 28Q25 31 28 27", expression: "smile" },
  { name: "brick", color: "#E79850", path: "M8 14C10 10 33 10 36 14C39 18 39 30 35 33C30 36 13 36 9 32C6 29 6 18 8 14Z", eyes: [[18, 22], [27, 22]], mouth: "M19 27Q23 29 27 27Q27 32 23 32Q19 32 19 27Z", expression: "open" },
  { name: "capsule", color: "#78BA82", path: "M11 20C11 9 16 5 22 5C30 5 34 11 34 22C34 34 30 39 23 39C15 39 11 33 11 20Z", eyes: [[17, 21], [28, 21]], mouth: "M19 28Q23 32 27 28", expression: "wink" },
  { name: "cloud", color: "#B285DE", path: "M13 18C12 8 28 6 31 18C41 19 40 33 32 35C27 37 24 34 22 33C16 39 7 35 7 28C6 23 8 20 13 18Z", eyes: [[17, 23], [28, 23]], mouth: "M20 27Q23 30 26 27", expression: "closed" },
  { name: "bean", color: "#EDC454", path: "M13 23C17 20 16 13 23 9C32 3 39 14 35 23C32 31 25 37 17 37C6 37 6 28 13 23Z", eyes: [[20, 23], [28, 18]], mouth: "M23 28Q26 28 28 25Q29 30 26 31Q23 32 23 28Z", expression: "open" },
  { name: "star", color: "#56B8B8", path: "M19 9Q22 4 25 10L29 17L37 19Q41 20 37 24L31 29L32 36Q32 40 27 37L22 34L15 38Q11 40 12 34L13 28L7 23Q3 19 9 18L16 17Z", eyes: [[18, 24], [27, 24]], mouth: "M20 28Q23 31 26 28", expression: "smile" },
] as const;

/** One trusted vector source for animated UI and bundled notification artwork. */
export function characterSvgMarkup(index: number) {
  const c = CHARACTERS[index] ?? CHARACTERS[0];
  const eyes = c.eyes.map(([x, y], eye) => {
    if (c.expression === "closed" || (c.expression === "wink" && eye === 1)) {
      return `<path class="wd-character-closed-eye" d="M${x - 2.5} ${y}Q${x} ${y - 3.5} ${x + 2.5} ${y}" fill="none" stroke="#20232B" stroke-width="1.3" stroke-linecap="round"/>`;
    }
    return `<g class="wd-character-eye"><ellipse cx="${x}" cy="${y}" rx="2.8" ry="3.7" fill="#fff"/><ellipse class="wd-character-pupil" cx="${x + .1}" cy="${y + .6}" rx="1.3" ry="1.8" fill="#20232B"/></g>`;
  }).join('');
  const mouth = c.expression === "open"
    ? `<path d="${c.mouth}" fill="#20232B"/><ellipse cx="${c.name === 'bean' ? 26 : 23}" cy="${c.name === 'bean' ? 29.8 : 30.8}" rx="${c.name === 'bean' ? 1.4 : 1.9}" ry="${c.name === 'bean' ? .75 : 1.05}" fill="#F47C72"/>`
    : `<path d="${c.mouth}" fill="none" stroke="#20232B" stroke-width="1.3" stroke-linecap="round"/>`;
  return `<g transform="translate(22 22) scale(1.159) translate(-22 -22)"><path d="${c.path}" fill="${c.color}"/>${eyes}${mouth}</g>`;
}

/** Deterministic on every device; never use mutable titles, categories or status. */
export function characterIndexFor(conversationId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < conversationId.length; i++) hash = Math.imul(hash ^ conversationId.charCodeAt(i), 16777619);
  return (hash >>> 0) % CHARACTERS.length;
}

/** Keep a new manual chat's stable ID random without repeating the latest character. */
export function newManualConversationId(previousConversationKey?: string, randomId = crypto.randomUUID()): string {
  const base = `message-${randomId}`;
  if (!previousConversationKey) return base;
  const previousIndex = characterIndexFor(previousConversationKey);
  for (let suffix = 0; suffix < 100; suffix++) {
    const id = suffix ? `${base}-${suffix}` : base;
    if (characterIndexFor(`decision:${id}`) !== previousIndex) return id;
  }
  throw new Error("Could not assign a different conversation character.");
}
