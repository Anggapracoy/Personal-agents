"use client";
import { createContext } from 'react';
import type { ConversationAction, ConversationSetting } from '../lib/conversation-settings';
export const ConversationDetailsContext = createContext<{ setting?: ConversationSetting; save: (action: Omit<Extract<ConversationAction, { action: 'identity' }>, 'key'> | Omit<Extract<ConversationAction, { action: 'checklist' }>, 'key'> | { action: 'resetIdentity' }) => Promise<boolean> } | null>(null);
