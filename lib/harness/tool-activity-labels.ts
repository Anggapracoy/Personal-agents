import type { appleOperations } from "../apple/catalog";

/** Single source of truth for user-facing tool activity, following Kodo’s explicit map.
 * Add each new tool here; the registry coverage test rejects missing entries. */
export const APPLE_ACTIVITY_LABELS = {
  "reminders.lists": "Checking reminder lists",
  "reminders.list": "Checking your reminders",
  "reminders.create": "Creating a reminder",
  "reminders.update": "Updating a reminder",
  "reminders.complete": "Completing a reminder",
  "contacts.search": "Finding a contact",
  "contacts.create": "Saving a contact",
  "contacts.update": "Updating a contact",
  "files.list": "Finding your files",
  "files.read": "Reading a file",
  "files.write": "Saving a file",
  "photos.list": "Finding photos",
  "photos.read": "Looking at a photo",
  "photos.albums": "Checking photo albums",
  "photos.save": "Saving a photo",
  "photos.createAlbum": "Creating a photo album",
  "photos.addToAlbum": "Adding photos to an album",
  "health.summary": "Checking your health summary",
  "health.workouts": "Checking your workouts",
  "health.logWater": "Logging your water",
  "home.list": "Finding home accessories",
  "home.read": "Checking your home",
  "home.scene": "Running a home scene",
  "home.set": "Adjusting your home",
  "music.search": "Finding music",
  "music.library": "Checking your music library",
  "music.createPlaylist": "Creating a playlist",
  "music.addToLibrary": "Saving music to your library",
  "music.addToPlaylist": "Adding music to a playlist",
  "music.play": "Playing music",
  "music.pause": "Pausing music",
  "location.current": "Checking your location",
  "maps.search": "Finding places",
  "maps.directions": "Finding directions",
  "weather.forecast": "Checking the weather",
  "alarms.list": "Checking your alarms",
  "alarms.create": "Setting an alarm",
  "alarms.timer": "Setting a timer",
  "alarms.cancel": "Cancelling an alarm",
  "motion.summary": "Checking your activity"
} satisfies Record<typeof appleOperations[number], string>;

export const TOOL_ACTIVITY_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  connector_request_connection: () => "Connecting an app",
  connector_search: () => "Finding app actions",
  connector_schema: () => "Checking app actions",
  connector_execute: input => connectorUsageLabel(input.toolSlug),
  chat_history: input => input.mode === "read" ? "Reading a previous chat" : "Searching your chats",
  read_tool_result: () => "Reading previous task details",
  pause: () => "Setting up a wait",
  schedule_create: () => "Saving the schedule",
  schedule_update: (input) => input.status === "cancelled" ? "Cancelling the schedule" : input.status === "paused" ? "Pausing the schedule" : "Updating the schedule",
  browser_solve_captcha: () => "Checking the website challenge",
  browser_open: (input) => `Opening ${hostOf(input.url)}`,
  browser_query: () => 'Reading the website',
  browser_evaluate: () => 'Reading the website',
  browser_forward: () => 'Navigating the website',
  browser_reload: () => 'Reloading the website',
  browser_tabs_list: () => 'Checking browser tabs',
  browser_tabs_new: () => 'Opening a browser tab',
  browser_tabs_select: () => 'Switching browser tabs',
  browser_tabs_close: () => 'Closing a browser tab',
  browser_dialog: () => 'Using the website',
  browser_logs: () => 'Checking the website',
  browser_clipboard_read: () => 'Using the website',
  browser_clipboard_write: () => 'Using the website',
  browser_upload: () => 'Uploading a file',
  browser_download: () => 'Downloading a file',
  browser_run: () => "Using the website",
  browser_click: () => "Using the website",
  browser_type: () => "Filling in details",
  browser_keyboard_type: () => "Typing on the page",
  browser_keyboard_press: () => "Typing on the page",
  browser_inspect: () => "Reading the page",
  browser_wait: () => "Waiting for the page",
  browser_screenshot: () => "Taking a screenshot",
  browser_fill_login: () => "Filling the saved login",
  browser_fill_card: () => "Filling the saved card",
  browser_request_signin: (input) => `Asking you to sign in to ${hostOf(input.pageUrl)}`,
  browser_request_takeover: (input) => input.mode === "wait_for_user" ? "Waiting for your step" : "Asking you to take over the browser",
  gmail_search: () => "Searching Gmail",
  gmail_read: () => "Reading email",
  gmail_send_draft: () => "Sending email",
  gmail_create_draft: () => "Drafting email",
  calendar_search: () => "Checking your calendar",
  calendar_create_event: () => "Adding a calendar event",
  inspect_artifact: () => "Inspecting an image",
  sandbox_run: () => "Writing and running code",
  exa_answer: () => "Searching the web",
  vault_list: () => "Checking saved logins and cards",
  vault_request_item: () => "Asking for a saved login or card",
  ask_questions: () => "Asking you a question",
  gmail_search_messages: () => "Searching your email",
  gmail_read_message: () => "Reading email",
  icloud_list_accounts: () => "Checking your email accounts",
  icloud_search_messages: () => "Searching your email",
  icloud_read_message: () => "Reading email",
  icloud_send_email: () => "Sending email",
  read_thread: () => "Reading an email thread",
  gmail_download_attachment: () => "Opening an attachment",
  calendar_search_events: () => "Checking your calendar",
  calendar_get_event: () => "Reading event details",
  calendar_update_event: () => "Updating your calendar",
  calendar_delete_event: () => "Removing a calendar event",
  web_search_exa: () => "Searching the web",
  web_fetch_exa: () => "Reading a webpage",
  api_fetch: () => "Looking up information",
  external_api_action: () => "Updating the connected service",
  browser_press: () => "Using the website",
  browser_hover: () => "Exploring the page",
  browser_scroll: () => "Reading the page",
  browser_select: () => "Choosing an option",
  browser_check: () => "Selecting an option",
  browser_follow_link: () => "Following a webpage link",
  weather_lookup: () => "Checking the weather",
  browser_back: () => "Returning to the previous page",
  browser_wait_for: () => "Waiting for a page element",
  browser_fill_question_answer: () => "Filling in your answer",
  vault_fill_login: () => "Signing you in",
  vault_fill_payment: () => "Filling in payment details",
  check_current_time: () => "Checking the time",
  phone_call: () => "Making a phone call",
  phone_call_result: () => "Checking the call outcome",
  send_attachments: () => "Preparing attachments",
  schedule_list: () => "Checking your reminders",
  report_check: () => "Checking the result",
  remember: () => "Remembering your preferences",
  apple_device: (input) => typeof input.operation === "string" && Object.hasOwn(APPLE_ACTIVITY_LABELS, input.operation) ? APPLE_ACTIVITY_LABELS[input.operation as keyof typeof APPLE_ACTIVITY_LABELS] : "Using your iPhone",
  remember_fact: () => "Remembering your preferences",
  present_result: () => "Preparing your answer",
  show_options: () => "Preparing your options",
  finish_without_reply: () => "Finishing up",
  react_to_message: () => "Reacting to your message",
  confetti: () => Math.random() < 0.5 ? "Activating superpowers" : "Making it rain",
  easteregg: (input) => input.effect === "67" ? "Doing something sixcessful" : input.effect === "disco" ? "Taking the dance floor" : input.effect === "snow" ? "Changing the forecast" : input.effect === "flip" ? "Attempting something unnecessary" : Math.random() < 0.5 ? "Activating superpowers" : "Making it rain",
};

export function activityLabel(tool: string, input: Record<string, unknown> = {}) {
  return Object.hasOwn(TOOL_ACTIVITY_LABELS, tool) ? TOOL_ACTIVITY_LABELS[tool](input) : connectedToolLabel(tool);
}

function hostOf(value: unknown) {
  if (typeof value !== "string") return "a website";
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "a website"; }
}

/** Only derive the app from the tool identifier, never its private arguments. */
function connectorUsageLabel(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9_]+$/i.test(value)) return "Using a connected app";
  const slug = value.toLowerCase();
  const names: Record<string, string> = {
    twitter: "X", x: "X", notion: "Notion", slack: "Slack", github: "GitHub",
    gmail: "Gmail", googlecalendar: "Google Calendar", google_calendar: "Google Calendar",
    googledrive: "Google Drive", google_drive: "Google Drive", googlesheets: "Google Sheets",
    googledocs: "Google Docs", youtube: "YouTube", linkedin: "LinkedIn", hubspot: "HubSpot",
    airtable: "Airtable", todoist: "Todoist", dropbox: "Dropbox", reddit: "Reddit",
  };
  const known = Object.keys(names).sort((a, b) => b.length - a.length).find(key => slug.startsWith(`${key}_`));
  const app = slug.split("_")[0];
  if (!app || !slug.includes("_")) return "Using a connected app";
  return `Using ${known ? names[known] : app[0].toUpperCase() + app.slice(1)}`;
}

function connectedToolLabel(tool: string) {
  return tool.startsWith("composio__") ? connectorUsageLabel(tool.slice("composio__".length)) : "Working on it";
}
