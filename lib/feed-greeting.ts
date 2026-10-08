/** Short, local-time greetings. Selection happens on feed entry, not while reading. */
export function feedGreetings(name: string | null | undefined, now: Date): string[] {
  const firstName = name?.trim().split(/\s+/)[0];
  const suffix = firstName ? `, ${firstName}` : "";
  const hour = now.getHours();
  const time = hour >= 5 && hour < 12 ? `Morning${suffix}`
    : hour >= 12 && hour < 17 ? `Good afternoon${suffix}`
    : hour >= 17 && hour < 22 ? `Evening${suffix}` : "A little late-night help?";
  const day = new Intl.DateTimeFormat("en", { weekday: "long" }).format(now);
  return [time, `Hey${suffix || " there"}`, `Welcome back${suffix}`, `Happy ${day}${suffix}`, "What’s on your list?"];
}

export function nextFeedGreeting(name: string | null | undefined, now: Date, previous = "", random = Math.random()): string {
  const choices = feedGreetings(name, now).filter(value => value !== previous);
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random * choices.length)))];
}
