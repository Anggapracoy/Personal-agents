import { messagePreview } from '../lib/message-preview';
export function QuotedReply({ role, text }: { role: 'user' | 'agent'; text: string }) {
 return <div className="wd-reply-context">
  <div className="wd-reply-caption"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4 2 11l8 7v-5c6 0 9 2 12 7-1-9-5-12-12-12V4Z" /></svg>You replied to {role === 'agent' ? 'Dash' : 'yourself'}</div>
  <div className="wd-quoted-reply"><span>{messagePreview(text)}</span></div>
 </div>;
}
