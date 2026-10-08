import { z } from 'zod';
import { messageReactionSchema } from './reactions';

// These fields describe user input. They never carry runtime state or authorize actions.
export const clientRunMetadataSchema = z.object({
  chosenOption: z.string().max(16_000).optional(),
  actionType: z.enum(['approval', 'research', 'instant']).optional(),
  customInstruction: z.string().max(16_000).optional(),
  userMessage: z.string().max(16_000).optional(),
  originalContext: z.string().max(200_000).optional(),
  sourceType: z.string().max(100).optional(),
  executionContext: z.record(z.string(), z.unknown()).optional(),
  retryDecision: z.record(z.string(), z.unknown()).optional(),
  userTimeZone: z.string().max(100).optional(),
  initialReaction: z.string().max(20).optional(),
  generateConversationIdentity: z.boolean().optional(),
  previousConversation: z.array(z.object({ role: z.enum(['assistant', 'user']), text: z.string().max(200_000), reactions: z.array(messageReactionSchema).max(2).optional() })).max(20).optional(),
});
