/** Shared product and tool contract. These are opt-in, on-device connections. */
export const appleSources = [
  { id: "reminders", name: "Reminders", detail: "Read lists and create, update or complete reminders. Changes appear in Apple Reminders." },
  { id: "contacts", name: "Contacts", detail: "Find people and create or update contact details. Changes appear in Apple Contacts." },
  { id: "files", name: "Files & iCloud Drive", detail: "Read text and PDFs, and save text files in a folder you choose. Saved files appear in that folder in Files; other folders stay private." },
  { id: "photos", name: "Photos", detail: "Find and read permitted photos, save images, and create or add to albums. Saved images and albums appear in Apple Photos." },
  { id: "health", name: "Apple Health", detail: "Use permitted sleep, steps and workouts for health and fitness answers in chat. Water you ask to log is saved in Apple Health." },
  { id: "home", name: "Apple Home", detail: "Read accessory status, change supported controls and run scenes. Changes affect your real accessories and are reflected in Apple Home." },
  { id: "music", name: "Apple Music", detail: "Find songs and manage your library and playlists in Apple Music. Play or pause music through Dash’s player; this does not control the Music app’s player." },
  { id: "location", name: "Location", detail: "Use your current location for answers in chat. If you allow Always, Dash can notice moments like arriving home or at the airport; your location history stays on your iPhone and is never shared through Find My." },
  { id: "maps", name: "Maps", detail: "Find places, directions and travel times in chat using Apple Maps. This does not start navigation or save places in the Maps app." },
  { id: "weather", name: "Weather", detail: "Get current conditions and forecasts in chat from Apple Weather. This does not add locations to the Weather app." },
  { id: "alarms", name: "Alarms & timers", detail: "Create alarms and timer alerts that ring on your iPhone, including its Lock Screen. Manage them through Dash; they do not appear in Apple Clock, and Dash cannot read or change your Clock alarms." },
  { id: "motion", name: "Motion & activity", detail: "Use your iPhone’s recorded steps, walking distance and activity for answers in chat. This reads activity; it does not log workouts or change Health or Fitness." },
] as const;
export type AppleSource = typeof appleSources[number]["id"];
export type AppleConnection = { id: AppleSource; enabled: boolean; status: "connected" | "limited" | "disconnected" | "denied" | "unavailable"; detail?: string };
export const appleOperations = [
  "reminders.lists", "reminders.list", "reminders.create", "reminders.update", "reminders.complete",
  "contacts.search", "contacts.create", "contacts.update",
  "files.list", "files.read", "files.write",
  "photos.list", "photos.read", "photos.albums", "photos.save", "photos.createAlbum", "photos.addToAlbum",
  "health.summary", "health.workouts", "health.logWater",
  "home.list", "home.read", "home.scene", "home.set",
  "music.search", "music.library", "music.createPlaylist", "music.addToLibrary", "music.addToPlaylist", "music.play", "music.pause",
  "location.current", "maps.search", "maps.directions", "weather.forecast",
  "alarms.list", "alarms.create", "alarms.timer", "alarms.cancel", "motion.summary",
] as const;
export type AppleOperation = typeof appleOperations[number];
const reads = new Set<AppleOperation>(["reminders.lists", "reminders.list", "contacts.search", "files.list", "files.read", "photos.list", "photos.read", "photos.albums", "health.summary", "health.workouts", "home.list", "home.read", "music.search", "music.library", "location.current", "maps.search", "maps.directions", "weather.forecast", "alarms.list", "motion.summary"]);
export function appleOperationIsRead(operation: string) { return reads.has(operation as AppleOperation); }
/** Reads iOS allows while Dash is in the background. Health data is locked with the phone; Home and location need the app open. */
const backgroundReads = new Set<AppleOperation>(["reminders.lists", "reminders.list", "contacts.search", "maps.search", "maps.directions", "weather.forecast", "motion.summary"]);
export function appleOperationRunsInBackground(operation: string) { return backgroundReads.has(operation as AppleOperation); }
