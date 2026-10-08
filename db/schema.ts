import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DecisionEmailInput } from "../lib/agent";
import type { WorkspacePreferences, WorkspaceStateData } from "../lib/types";

export const sourceType = pgEnum("source_type", ["email", "calendar", "recurring", "manual", "proactive"]);
export const category = pgEnum("category", ["schedule", "money", "food", "family", "shopping", "travel", "social"]);
export const urgency = pgEnum("urgency", ["high", "medium", "low"]);
export const decisionStatus = pgEnum("decision_status", ["pending", "chosen", "dismissed", "expired"]);
export const taskStatus = pgEnum("task_status", ["running", "needs_approval", "completed", "cancelled", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  locationLat: numeric("location_lat"),
  locationLng: numeric("location_lng"),
  preferences: jsonb("preferences_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
});

export const connectedGoogleAccounts = pgTable("connected_google_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  googleSubject: text("google_subject").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  reconnectRequiredAt: timestamp("reconnect_required_at", { withTimezone: true }),
  scopes: text("scopes").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("connected_google_accounts_owner_subject_uidx").on(table.ownerEmail, table.googleSubject),
  uniqueIndex("connected_google_accounts_owner_email_uidx").on(table.ownerEmail, table.email),
  index("connected_google_accounts_owner_idx").on(table.ownerEmail, table.enabled),
]);

export const googleSourceWatches = pgTable("google_source_watches", {
  connectionId: uuid("connection_id").primaryKey().references(() => connectedGoogleAccounts.id, { onDelete: "cascade" }),
  ownerEmail: text("owner_email").notNull(),
  accountEmail: text("account_email").notNull(),
  gmailHistoryId: text("gmail_history_id"),
  gmailWatchVersion: integer("gmail_watch_version").notNull().default(1),
  gmailWatchExpiresAt: timestamp("gmail_watch_expires_at", { withTimezone: true }),
  calendarChannelId: text("calendar_channel_id"),
  calendarResourceId: text("calendar_resource_id"),
  calendarWatchExpiresAt: timestamp("calendar_watch_expires_at", { withTimezone: true }),
  lastGmailNotificationAt: timestamp("last_gmail_notification_at", { withTimezone: true }),
  lastCalendarNotificationAt: timestamp("last_calendar_notification_at", { withTimezone: true }),
  lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("google_source_watches_calendar_channel_uidx").on(table.calendarChannelId),
  index("google_source_watches_account_email_idx").on(table.accountEmail),
  index("google_source_watches_expiration_idx").on(table.gmailWatchExpiresAt, table.calendarWatchExpiresAt),
]);

export const discoveryScanStates = pgTable("discovery_scan_states", {
  userKey: text("user_key").primaryKey(),
  gmailHistoryId: text("gmail_history_id"),
  reviewedMessageIds: jsonb("reviewed_message_ids_json").$type<string[]>().notNull().default([]),
  recentEmails: jsonb("recent_emails_json").$type<DecisionEmailInput[]>().notNull().default([]),
  initializedAt: timestamp("initialized_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DecisionOptionRecord = {
  id: string;
  label: string;
  sublabel?: string;
  actionType: string;
  actionUrl?: string;
  isRecommended?: boolean;
};

export const decisions = pgTable("decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  sourceType: sourceType("source_type").notNull(),
  sourceId: text("source_id"),
  category: category("category").notNull(),
  urgency: urgency("urgency").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  options: jsonb("options_json").$type<DecisionOptionRecord[]>().notNull(),
  dismissLabel: text("dismiss_label").notNull().default("Not now"),
  status: decisionStatus("status").notNull().default("pending"),
  chosenOptionId: text("chosen_option_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export type TaskStepRecord = { label: string; detail: string; status: "done" | "active" | "pending" | "approval" };

export const runningTasks = pgTable("running_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  decisionId: uuid("decision_id").references(() => decisions.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  steps: jsonb("steps_json").$type<TaskStepRecord[]>().notNull(),
  currentStep: integer("current_step").notNull().default(0),
  draftContent: text("draft_content"),
  status: taskStatus("status").notNull().default("running"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const history = pgTable("history", {
  id: uuid("id").defaultRandom().primaryKey(),
  decisionId: uuid("decision_id").references(() => decisions.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  originalContext: text("original_context").notNull(),
  chosenOptionLabel: text("chosen_option_label").notNull(),
  stepsTaken: jsonb("steps_taken").$type<string[]>().notNull(),
  draftSent: text("draft_sent"),
  outcomeSummary: text("outcome_summary").notNull(),
  moneySavedCents: integer("money_saved_cents").notNull().default(0),
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mobileAuthHandoffs = pgTable("mobile_auth_handoffs", {
  codeHash: text("code_hash").primaryKey(),
  codeChallenge: text("code_challenge"),
  encryptedSessionToken: text("encrypted_session_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceStates = pgTable("workspace_states", {
  ownerEmail: text("owner_email").primaryKey(),
  state: jsonb("state_json").$type<WorkspaceStateData>().notNull(),
  preferences: jsonb("preferences_json").$type<WorkspacePreferences>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentApprovalPreferences = pgTable("agent_approval_preferences", {
  ownerEmail: text("owner_email").notNull(),
  category: text("category").notNull(),
  alwaysApprove: boolean("always_approve").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_approval_preferences_owner_category_uidx").on(table.ownerEmail, table.category),
]);

export const mobileUserStates = pgTable("mobile_user_states", {
  ownerEmail: text("owner_email").primaryKey(),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  onboardingProfileVersion: integer("onboarding_profile_version").notNull().default(0),
  initialScanRequestedAt: timestamp("initial_scan_requested_at", { withTimezone: true }),
  initialScanStartedAt: timestamp("initial_scan_started_at", { withTimezone: true }),
  initialScanCompletedAt: timestamp("initial_scan_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userLifeProfiles = pgTable("user_life_profiles", {
  ownerEmail: text("owner_email").primaryKey(),
  homeCity: text("home_city"),
  homeCountry: text("home_country"),
  homeLat: numeric("home_lat"),
  homeLng: numeric("home_lng"),
  timeZone: text("time_zone"),
  travelMode: text("travel_mode"),
  travelBufferMinutes: integer("travel_buffer_minutes"),
  goals: jsonb("goals_json").$type<string[]>().notNull().default([]),
  customGoal: text("custom_goal"),
  profileVersion: integer("profile_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const lifeFacts = pgTable("life_facts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  kind: text("kind").notNull(),
  stableKey: text("stable_key").notNull(),
  value: jsonb("value_json").$type<Record<string, unknown>>().notNull(),
  source: text("source").notNull(),
  evidence: jsonb("evidence_json").$type<Record<string, unknown>>().notNull().default({}),
  confidence: numeric("confidence").notNull().default("1"),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("life_facts_owner_stable_key_uidx").on(table.ownerEmail, table.stableKey),
  index("life_facts_owner_active_idx").on(table.ownerEmail, table.supersededAt),
]);

export const manualScanJobs = pgTable("manual_scan_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  status: text("status").notNull().default("queued"),
  activeKey: text("active_key"),
  forceFullScan: boolean("force_full_scan").notNull().default(false),
  userTimeZone: text("user_time_zone").notNull().default("UTC"),
  deviceCalendarEvents: jsonb("device_calendar_events_json").$type<Record<string, unknown>[]>().notNull().default([]),
  result: jsonb("result_json").$type<Record<string, unknown>>(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("manual_scan_jobs_active_key_uidx").on(table.activeKey),
  index("manual_scan_jobs_owner_created_idx").on(table.ownerEmail, table.createdAt),
]);

export const pushDeviceTokens = pgTable("push_device_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  token: text("token").notNull(),
  environment: text("environment").notNull().default("production"),
  enabled: boolean("enabled").notNull().default(true),
  lastRegisteredAt: timestamp("last_registered_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("push_device_tokens_token_uidx").on(table.token),
  index("push_device_tokens_owner_enabled_idx").on(table.ownerEmail, table.enabled),
]);

export const pushNotificationJobs = pgTable("push_notification_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  decisionId: text("decision_id").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("push_notification_jobs_owner_decision_uidx").on(table.ownerEmail, table.decisionId),
  index("push_notification_jobs_status_updated_idx").on(table.status, table.updatedAt),
]);

export const sharedIntakes = pgTable("shared_intakes", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  sourceApp: text("source_app").notNull().default("manual"),
  textContent: text("text_content").notNull().default(""),
  sourceUrl: text("source_url"),
  files: jsonb("files_json").$type<Array<{ name: string; mimeType: string; size: number; dataBase64: string }>>().notNull().default([]),
  analysis: jsonb("analysis_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("shared_intakes_owner_created_idx").on(table.ownerEmail, table.createdAt),
]);

export const consumerVaultItems = pgTable("consumer_vault_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  siteHost: text("site_host"),
  usernameHint: text("username_hint"),
  cardBrand: text("card_brand"),
  cardLast4: text("card_last4"),
  // Secrets live in the user's iOS Keychain. This legacy column remains
  // nullable only so existing installations can migrate without rebuilding
  // the table; new code never writes a credential into it.
  encryptedPayload: text("encrypted_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("consumer_vault_items_owner_kind_idx").on(table.ownerEmail, table.kind),
  index("consumer_vault_items_owner_host_idx").on(table.ownerEmail, table.siteHost),
]);

export const scheduledTasks = pgTable("scheduled_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  runId: uuid("run_id").notNull(),
  definition: jsonb("definition").$type<import("../lib/schedules/timing").ScheduleDefinition>().notNull(),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastObservation: text("last_observation"),
  lastNotifiedObservation: text("last_notified_observation"),
  creationKey: text("creation_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("scheduled_tasks_owner_creation_uidx").on(table.ownerEmail, table.creationKey), index("scheduled_tasks_owner_idx").on(table.ownerEmail, table.runId)]);

export const scheduledOccurrences = pgTable("scheduled_occurrences", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduleId: uuid("schedule_id").notNull().references(() => scheduledTasks.id, { onDelete: "cascade" }),
  scheduleVersion: integer("schedule_version").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("queued"),
  previousRunState: jsonb("previous_run_state"),
  checkResult: jsonb("check_result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [uniqueIndex("scheduled_occurrences_schedule_version_due_uidx").on(table.scheduleId, table.scheduleVersion, table.dueAt)]);

export const agentPauses = pgTable("agent_pauses", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  creationKey: text("creation_key").notNull(),
  definition: jsonb("definition").$type<import("../lib/pauses/definition").PauseDefinition>().notNull(),
  baseline: jsonb("baseline").$type<import("../lib/pauses/definition").EventBaseline>(),
  connectionId: uuid("connection_id"),
  wakeAt: timestamp("wake_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  wakeReason: jsonb("wake_reason"),
  checkFailures: integer("check_failures").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("agent_pauses_creation_uidx").on(table.creationKey)]);

export const userProfilePhotos = pgTable("user_profile_photos", {
  ownerEmail: text("owner_email").primaryKey(),
  image: text("image").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
