/** A new user turn has no tool activity until that turn actually calls a tool. */
export const newTurnActivityMetadata = {
  taskWorkStarted: false,
  browserUsed: false,
  toolActivity: null,
  currentActivityActionId: null,
  toolActivityMessageId: null,
  replyTyping: false,
} as const;
