/** Only visible final-response text counts as typing. Unknown phases stay quiet. */
export function advanceReplyTyping(current: boolean, event: string, phase: string | undefined, presented: boolean) {
  if (event === "text-delta") return phase === "final_answer" || (presented && phase !== "commentary");
  // Text-end precedes persistence. Keep typing until the message has been saved.
  if (["tool-input-start", "tool-call", "start-step", "reasoning-start"].includes(event)) return false;
  return current;
}
