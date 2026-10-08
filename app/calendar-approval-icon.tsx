export function CalendarApprovalIcon({ kind = 'calendar' }: { kind?: 'calendar' | 'time' | 'location' | 'guests' | 'note' }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'calendar' ? <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/></> : kind === 'time' ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></> : kind === 'location' ? <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></> : kind === 'guests' ? <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/></> : <><path d="M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5"/></>}
  </svg>;
}
