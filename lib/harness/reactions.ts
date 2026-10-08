import { z } from "zod";
import type { ModelMessage } from "ai";

/** One emoji grapheme, including joined families, flags and skin tones. */
export function isReactionEmoji(value: string) {
  return value.length <= 32 && [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)].length === 1
    && /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(value);
}
export const reactionInputSchema = z.object({
  eventId: z.string().uuid(), messageId: z.string().min(1).max(160),
  emoji: z.string().refine(isReactionEmoji, "Choose one emoji.").nullable(),
});
export type ReactionInput = z.infer<typeof reactionInputSchema>;
export const messageReactionSchema = z.object({ actor: z.enum(["user", "agent"]), emoji: z.string().refine(isReactionEmoji), createdAt: z.string().max(64) });
export type MessageReaction = z.infer<typeof messageReactionSchema>;
export function reactionOf(message: ModelMessage) {
  const parsed = reactionInputSchema.safeParse(message.providerOptions?.wdyt?.reaction);
  return parsed.success ? parsed.data : null;
}
export function reactionMessage(input: ReactionInput, actor: "user" | "agent", targetText: string): ModelMessage {
  return {
    role: actor === "user" ? "user" : "assistant",
    content: `[runtime] ${actor === "user" ? "The user" : "You"} ${input.emoji ? `reacted ${input.emoji} to` : "removed their reaction from"} message ${input.messageId}: ${JSON.stringify(targetText)}. This is a reaction to that specific message, not a new text message.`,
    providerOptions: { wdyt: { reaction: input } },
  };
}
export const conversationResponseInstructions = `Finish with text, an appropriate tool-based reaction, or silence. Never use emojis in message text. Use react_to_message only for a small social acknowledgment, never instead of a substantive answer or requested work. Explicit requests for silence and quiet scheduled-check rules take precedence over ordinary opening and final-reply instructions. Reply in words when the user invites a response, including a playful conversational reply. Use finish_without_reply to deliberately end without a chat message when asked not to respond, or when the conversation has naturally finished. Honor requests not to respond: do not send an acknowledgment, reaction, completion summary, or explanation of your silence. If work is also requested, do the authorized work first, then finish quietly. When a scheduled result has notify=true, finish with a concise chat message explaining the outcome, including failures or unanswered calls; report_check records the outcome but does not replace that reply. Never use finish_without_reply for a result marked notify=true.
User reaction events are real conversation input. Interpret the emoji in the context of the exact target message and subsequent conversation. A thumbs-up to a clear current offer to do something means yes: carry out that offered task. A thumbs-up to a completed result is just acknowledgment. Do not invent authorization from an ambiguous emoji or a stale offer that newer instructions supersede; ask briefly when needed. Removing a reaction does not undo completed work. Reactions do not bypass the existing explicit email-send or purchase review controls. Never replay completed actions.`;

export const replyContextSchema = z.object({ messageId: z.string().min(1).max(160), text: z.string(), role: z.enum(["user", "agent"]) });
export type ReplyContext = z.infer<typeof replyContextSchema>;
export function replyContextOf(message: ModelMessage) {
  const parsed = replyContextSchema.safeParse(message.providerOptions?.wdyt?.replyTo);
  return parsed.success ? parsed.data : undefined;
}
