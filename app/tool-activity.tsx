import { ACTIVITY_ICONS, type ActivityIconName } from '../lib/harness/tool-activity-icons';

/** The native shell supplies the same SF Symbol artwork used by its chat header. */
export function ToolActivityIndicator({ label, icon = 'thinking', announce = false }: { label: string; icon?: ActivityIconName; announce?: boolean }) {
  return <span className="wd-tool-activity" role={announce ? 'status' : undefined}>
    {icon !== 'thinking' && icon !== 'typing' && <span className="wd-tool-activity-icon" data-activity-icon={icon} data-activity-symbol={ACTIVITY_ICONS[icon].symbol} aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ACTIVITY_ICONS[icon].path} /></svg>
    </span>}
    <span className="wd-chat-activity">{label}</span>
  </span>;
}
