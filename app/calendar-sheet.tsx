"use client";
import { NativeGlassButton } from "./native-glass-button";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSheetMotion } from "./sheet-motion";
import type { Decision } from "../lib/types";
import { hasNativeBridge, postNativeMessage } from "./native-bridge";
import { calendarDecisionDate, calendarSourceEvents, calendarTime, eventOnDay, normalizeDeviceCalendarEvent, proposedCalendarEvent, type CalendarDayEvent } from "./workspace-model";

const HOUR_HEIGHT = 64;

/** One day of the calendar around a scheduling decision: Google events, device events and the proposed slot on one timeline. */
export function CalendarSheet({ decision, initialDay, deviceEvents, googleConnected, onClose }: { decision: Decision; initialDay?: string; deviceEvents: Array<Record<string, unknown>>; googleConnected: boolean; onClose: () => void }) {
  const initialDate = useMemo(() => initialDay ? new Date(initialDay.length === 10 ? `${initialDay}T12:00:00` : initialDay) : calendarDecisionDate(decision) ?? new Date(), [initialDay, decision]);
  const [selectedDate, setSelectedDate] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate()));
  const [googleEvents, setGoogleEvents] = useState<CalendarDayEvent[]>([]);
  const [loading, setLoading] = useState(googleConnected);
  const [error, setError] = useState("");
  const { sheetRef, scrimRef, close } = useSheetMotion(onClose);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);
  const highlightedIds = useMemo(() => new Set(decision.executionContext?.sourceCalendar?.eventIds ?? []), [decision]);
  const dayStart = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()), [selectedDate]);
  const dayEnd = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1), [selectedDate]);
  const proposedEvent = useMemo(() => proposedCalendarEvent(decision), [decision]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (!googleConnected) { setGoogleEvents([]); return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });
    const connectionId = decision.executionContext?.sourceAccountId;
    if (connectionId) params.set("connectionId", connectionId);
    setLoading(true); setError("");
    void fetch(`/api/calendar/day?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { events?: CalendarDayEvent[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load this calendar day.");
        setGoogleEvents(payload.events ?? []);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load this calendar day."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dayStart, dayEnd, decision.executionContext?.sourceAccountId, googleConnected]);

  const events = useMemo(() => {
    const combined = [
      ...(!loading && proposedEvent ? [proposedEvent] : []),
      ...calendarSourceEvents(decision),
      ...deviceEvents.map(normalizeDeviceCalendarEvent).filter((event): event is CalendarDayEvent => Boolean(event)),
      ...googleEvents,
    ].filter((event) => eventOnDay(event, dayStart, dayEnd));
    const unique = new Map<string, CalendarDayEvent>();
    for (const event of combined) unique.set(`${event.sourceKind}:${event.id}`, event);
    return [...unique.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }, [decision, deviceEvents, googleEvents, dayStart, dayEnd, proposedEvent, loading]);
  const timedEvents = events.filter((event) => event.start.includes("T") && event.end.includes("T"));
  const allDayEvents = events.filter((event) => !event.start.includes("T") || !event.end.includes("T"));
  const proposedCount = events.filter((event) => event.proposed).length;
  const scheduledCount = events.length - proposedCount;
  const overlaps = timedEvents.flatMap((event, index) => timedEvents.slice(index + 1).filter((candidate) => Date.parse(candidate.start) < Date.parse(event.end) && Date.parse(candidate.end) > Date.parse(event.start)));
  const conflictAt = overlaps.length ? Math.min(...overlaps.map((event) => Date.parse(event.start))) : null;

  useLayoutEffect(() => {
    if (scrolledRef.current || !timelineRef.current || (proposedEvent && loading)) return;
    const relevantEvent = timedEvents.find((event) => highlightedIds.has(event.id)) ?? timedEvents.find((event) => event.proposed);
    const relevantTime = relevantEvent ? new Date(relevantEvent.start) : initialDay ? initialDate : calendarDecisionDate(decision);
    if (!relevantTime || relevantTime < dayStart || relevantTime >= dayEnd) return;
    const offsetHours = (relevantTime.getTime() - dayStart.getTime()) / 3_600_000;
    const durationHours = relevantEvent ? Math.max(.5, (Date.parse(relevantEvent.end) - Date.parse(relevantEvent.start)) / 3_600_000) : 0;
    const timeline = timelineRef.current;
    timeline.scrollTop = Math.min(timeline.scrollHeight - timeline.clientHeight, Math.max(0, offsetHours * HOUR_HEIGHT + durationHours * HOUR_HEIGHT / 2 - timeline.clientHeight / 2));
    scrolledRef.current = true;
  }, [decision, timedEvents, highlightedIds, dayStart, dayEnd, proposedEvent, loading, initialDay, initialDate]);

  const moveDay = (difference: number) => {
    if (googleConnected) setLoading(true);
    setSelectedDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + difference));
  };
  const openCalendar = () => {
    if (hasNativeBridge()) { postNativeMessage({ version: 1, action: "openCalendar", payload: { timestamp: dayStart.getTime() / 1000 } }); return; }
    window.open(`https://calendar.google.com/calendar/u/0/r/day/${dayStart.getFullYear()}/${dayStart.getMonth() + 1}/${dayStart.getDate()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="wd-sheet-root wd-calendar-root">
      <button ref={scrimRef} type="button" className="wd-sheet-scrim" aria-label="Close" onClick={close} />
      <section ref={sheetRef} className="wd-sheet is-full wd-calendar-sheet" role="dialog" aria-modal="true" aria-label="Your day">
        <header className="wd-sheet-head">
          <NativeGlassButton symbol="xmark" type="button" className="wd-round" aria-label="Close" onClick={close}><CloseIcon /></NativeGlassButton>
          <span>
            <strong>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(selectedDate)}</strong>
            <small>{scheduledCount} {scheduledCount === 1 ? "event" : "events"}{proposedCount ? ` · ${proposedCount} proposed` : ""}{overlaps.length ? ` · ${overlaps.length} ${overlaps.length === 1 ? "conflict" : "conflicts"}` : ""}</small>
          </span>
          <NativeGlassButton symbol="chevron.left" type="button" className="wd-round" aria-label="Previous day" onClick={() => moveDay(-1)}><ChevronIcon flip /></NativeGlassButton>
          <NativeGlassButton symbol="chevron.right" type="button" className="wd-round" aria-label="Next day" onClick={() => moveDay(1)}><ChevronIcon /></NativeGlassButton>
        </header>
        {allDayEvents.length > 0 && (
          <div className="wd-cal-allday"><span>All day</span>{allDayEvents.map((event) => <strong key={`${event.sourceKind}-${event.id}`}>{event.summary}</strong>)}</div>
        )}
        <div className="wd-cal-scroll" ref={timelineRef}>
          <div className="wd-cal" style={{ height: 24 * HOUR_HEIGHT }}>
            {Array.from({ length: 25 }, (_, hour) => (
              <div className="wd-cal-hour" key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                <time>{new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(new Date(2020, 0, 1, hour))}</time><i />
              </div>
            ))}
            {conflictAt !== null && <div className="wd-cal-conflict" style={{ top: ((conflictAt - dayStart.getTime()) / 3_600_000) * HOUR_HEIGHT }}><span>{calendarTime(new Date(conflictAt).toISOString())} conflict</span></div>}
            {timedEvents.map((event) => {
              const startOffset = (Date.parse(event.start) - dayStart.getTime()) / 3_600_000;
              const duration = Math.max(.5, (Date.parse(event.end) - Date.parse(event.start)) / 3_600_000);
              const highlighted = highlightedIds.has(event.id);
              return (
                <article key={`${event.sourceKind}-${event.id}`} className={`wd-cal-event${highlighted ? " is-highlighted" : ""}${event.proposed ? " is-proposed" : ""}`} style={{ top: startOffset * HOUR_HEIGHT, height: duration * HOUR_HEIGHT }}>
                  <strong>{event.summary}</strong>
                  <span>{event.proposed ? "Proposed · " : ""}{calendarTime(event.start)} – {calendarTime(event.end)}{event.sourceLabel ? ` · ${event.sourceLabel}` : ""}</span>
                </article>
              );
            })}
            {!loading && events.length === 0 && <p className="wd-cal-note" style={{ top: 12 * HOUR_HEIGHT }}>Nothing scheduled this day.</p>}
            {loading && <p className="wd-cal-note" style={{ top: 12 * HOUR_HEIGHT }}><span className="wd-spinner is-small" /> Loading calendars…</p>}
            {error && <p className="wd-cal-note is-error" style={{ top: 13 * HOUR_HEIGHT }}>{error}</p>}
          </div>
        </div>
        <footer className="wd-sheet-foot">
          <div className="wd-sheet-foot-row">
            <button type="button" className="wd-btn is-text" onClick={() => { if (googleConnected) setLoading(true); setSelectedDate(new Date()); }}>Today</button>
            <button type="button" className="wd-btn is-secondary" onClick={openCalendar}>Open in Calendar</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function CloseIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>; }
function ChevronIcon({ flip }: { flip?: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={flip ? "wd-flip" : undefined}><path d="m9 6 6 6-6 6" /></svg>; }
