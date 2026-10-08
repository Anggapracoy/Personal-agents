import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { lifeFacts, mobileUserStates, userLifeProfiles } from "../db/schema";
import { personFromMemory, personMemorySchema, type PersonMemory, type PersonMemoryUpdate } from "./people-memory";

export const LIFE_PROFILE_VERSION = 1;
export const LIFE_GOALS = ["money", "travel", "schedule", "life_admin", "activities"] as const;
export const TRAVEL_MODES = ["drive", "transit", "walk", "bike"] as const;

export type LifeProfilePatch = {
  homeCity?: string | null;
  travelMode?: typeof TRAVEL_MODES[number] | null;
  travelBufferMinutes?: number | null;
  goals?: typeof LIFE_GOALS[number][];
  customGoal?: string | null;
  customInstructions?: string | null;
};

type GeocodedHome = {
  city: string;
  country: string | null;
  latitude: number;
  longitude: number;
  timeZone: string | null;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function cleanOptional(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const cleaned = value.trim();
  return cleaned || null;
}

async function geocodeHome(city: string): Promise<GeocodedHome | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const payload = await response.json() as {
    results?: Array<{
      name?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
      timezone?: string;
    }>;
  };
  const result = payload.results?.[0];
  if (!result || typeof result.latitude !== "number" || typeof result.longitude !== "number") return null;
  return {
    city: result.name?.trim() || city,
    country: result.country?.trim() || null,
    latitude: result.latitude,
    longitude: result.longitude,
    timeZone: result.timezone?.trim() || null,
  };
}

export async function getLifeProfile(ownerEmailInput: string, database = getDb()) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [[profile], facts] = await Promise.all([
    database.select().from(userLifeProfiles)
      .where(eq(userLifeProfiles.ownerEmail, ownerEmail)).limit(1),
    database.select().from(lifeFacts)
      .where(and(eq(lifeFacts.ownerEmail, ownerEmail), isNull(lifeFacts.supersededAt)))
      .orderBy(desc(lifeFacts.lastConfirmedAt), desc(lifeFacts.updatedAt)),
  ]);
  return {
    requiredVersion: LIFE_PROFILE_VERSION,
    profile: profile ? {
      customInstructions: String(facts.find((fact) => fact.stableKey === "profile:custom_instructions")?.value.content ?? ""),
      homeCity: profile.homeCity,
      homeCountry: profile.homeCountry,
      homeLat: profile.homeLat === null ? null : Number(profile.homeLat),
      homeLng: profile.homeLng === null ? null : Number(profile.homeLng),
      timeZone: profile.timeZone,
      travelMode: profile.travelMode,
      travelBufferMinutes: profile.travelBufferMinutes,
      goals: profile.goals,
      customGoal: profile.customGoal,
      profileVersion: profile.profileVersion,
      updatedAt: profile.updatedAt.toISOString(),
    } : null,
    facts: facts.filter((fact) => fact.kind !== "decision_preference" && fact.kind !== "custom_instructions").map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      stableKey: fact.stableKey,
      value: fact.value,
      source: fact.source,
      evidence: fact.evidence,
      confidence: Number(fact.confidence),
      observedAt: fact.observedAt.toISOString(),
      lastConfirmedAt: fact.lastConfirmedAt?.toISOString() ?? null,
      updatedAt: fact.updatedAt.toISOString(),
    })),
  };
}

export type LifeMemory = Awaited<ReturnType<typeof getLifeProfile>>;

async function writeFact(input: {
  ownerEmail: string;
  kind: string;
  stableKey: string;
  value: Record<string, unknown> | null;
  source: string;
  evidence: Record<string, unknown>;
}, database = getDb()) {
  const now = new Date();
  if (!input.value) {
    await database.update(lifeFacts).set({ supersededAt: now, updatedAt: now })
      .where(and(eq(lifeFacts.ownerEmail, input.ownerEmail), eq(lifeFacts.stableKey, input.stableKey)));
    return;
  }
  await database.insert(lifeFacts).values({
    ownerEmail: input.ownerEmail,
    kind: input.kind,
    stableKey: input.stableKey,
    value: input.value,
    source: input.source,
    evidence: input.evidence,
    confidence: "1",
    observedAt: now,
    lastConfirmedAt: now,
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [lifeFacts.ownerEmail, lifeFacts.stableKey],
    set: {
      kind: input.kind,
      value: input.value,
      source: input.source,
      evidence: input.evidence,
      confidence: "1",
      observedAt: now,
      lastConfirmedAt: now,
      supersededAt: null,
      updatedAt: now,
    },
  });
}

export async function updateLifeProfile(ownerEmailInput: string, patch: LifeProfilePatch, source = "settings", database = getDb()) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [current] = await database.select().from(userLifeProfiles)
    .where(eq(userLifeProfiles.ownerEmail, ownerEmail)).limit(1);
  const now = new Date();
  const requestedCity = cleanOptional(patch.homeCity);
  let geocoded: GeocodedHome | null | undefined;
  if (typeof requestedCity === "string") {
    geocoded = await geocodeHome(requestedCity).catch(() => null);
  } else if (requestedCity === null) {
    geocoded = null;
  }

  const homeCity = requestedCity === undefined ? current?.homeCity ?? null : geocoded?.city ?? requestedCity;
  const homeCountry = requestedCity === undefined ? current?.homeCountry ?? null : geocoded?.country ?? null;
  const homeLat = requestedCity === undefined ? current?.homeLat ?? null : geocoded ? String(geocoded.latitude) : null;
  const homeLng = requestedCity === undefined ? current?.homeLng ?? null : geocoded ? String(geocoded.longitude) : null;
  const timeZone = requestedCity === undefined ? current?.timeZone ?? null : geocoded?.timeZone ?? null;
  const travelMode = patch.travelMode === undefined ? current?.travelMode ?? null : patch.travelMode;
  const travelBufferMinutes = patch.travelBufferMinutes === undefined
    ? current?.travelBufferMinutes ?? null
    : patch.travelBufferMinutes;
  const goals = patch.goals === undefined ? current?.goals ?? [] : [...new Set(patch.goals)];
  const requestedCustomGoal = cleanOptional(patch.customGoal);
  const customGoal = requestedCustomGoal === undefined ? current?.customGoal ?? null : requestedCustomGoal;

  await database.insert(userLifeProfiles).values({
    ownerEmail,
    homeCity,
    homeCountry,
    homeLat,
    homeLng,
    timeZone,
    travelMode,
    travelBufferMinutes,
    goals,
    customGoal,
    profileVersion: LIFE_PROFILE_VERSION,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: userLifeProfiles.ownerEmail,
    set: {
      homeCity,
      homeCountry,
      homeLat,
      homeLng,
      timeZone,
      travelMode,
      travelBufferMinutes,
      goals,
      customGoal,
      profileVersion: LIFE_PROFILE_VERSION,
      updatedAt: now,
    },
  });

  await database.insert(mobileUserStates).values({
    ownerEmail,
    onboardingProfileVersion: LIFE_PROFILE_VERSION,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: mobileUserStates.ownerEmail,
    set: { onboardingProfileVersion: LIFE_PROFILE_VERSION, updatedAt: now },
  });

  if (requestedCity !== undefined) {
    await writeFact({
      ownerEmail,
      kind: "home_base",
      stableKey: "profile:home_base",
      value: homeCity ? { city: homeCity, country: homeCountry, latitude: homeLat && Number(homeLat), longitude: homeLng && Number(homeLng), timeZone } : null,
      source,
      evidence: { answer: requestedCity, confirmedByUser: true },
    }, database);
  }
  if (patch.travelMode !== undefined || patch.travelBufferMinutes !== undefined) {
    await writeFact({
      ownerEmail,
      kind: "travel_preference",
      stableKey: "profile:travel_preference",
      value: travelMode || travelBufferMinutes ? { mode: travelMode, bufferMinutes: travelBufferMinutes } : null,
      source,
      evidence: { confirmedByUser: true },
    }, database);
  }
  if (patch.goals !== undefined || requestedCustomGoal !== undefined) {
    await writeFact({
      ownerEmail,
      kind: "goals",
      stableKey: "profile:goals",
      value: goals.length || customGoal ? { areas: goals, customGoal } : null,
      source,
      evidence: { confirmedByUser: true },
    }, database);
  }
  if (patch.customInstructions !== undefined) {
    await writeFact({ ownerEmail, kind: "custom_instructions", stableKey: "profile:custom_instructions", value: patch.customInstructions?.trim() ? { content: patch.customInstructions.trim() } : null, source: "settings", evidence: { confirmedByUser: true } }, database);
  }
  return getLifeProfile(ownerEmail, database);
}

export async function deleteLifeFact(ownerEmailInput: string, factId: string, database = getDb()) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const deleted = await database.delete(lifeFacts)
    .where(and(eq(lifeFacts.ownerEmail, ownerEmail), eq(lifeFacts.id, factId)))
    .returning({ id: lifeFacts.id });
  return Boolean(deleted[0]);
}

/** People use the same account-owned memory storage, with dedicated editable fields. */
export async function saveLifePerson(ownerEmailInput: string, person: PersonMemory, factId?: string, database = getDb()) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const value = personMemorySchema.parse(person);
  if (factId) {
    const now = new Date();
    const updated = await database.update(lifeFacts).set({
      value, source: "settings", evidence: { confirmedByUser: true }, confidence: "1",
      lastConfirmedAt: now, updatedAt: now,
    }).where(and(eq(lifeFacts.ownerEmail, ownerEmail), eq(lifeFacts.id, factId), eq(lifeFacts.kind, "person"), isNull(lifeFacts.supersededAt)))
      .returning({ id: lifeFacts.id });
    return updated.length > 0;
  }
  await writeFact({ ownerEmail, kind: "person", stableKey: `person:${crypto.randomUUID()}`, value,
    source: "settings", evidence: { confirmedByUser: true } }, database);
  return true;
}

export async function rememberLifeFact(ownerEmailInput: string, input: {
  key: string; content: string; category: string; sourceRunId: string; quote: string;
}, database = getDb()) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  await writeFact({ ownerEmail, kind: input.category, stableKey: `remember:${input.key}`,
    value: { content: input.content }, source: "conversation",
    evidence: { sourceRunId: input.sourceRunId, quote: input.quote, confirmedByUser: true } }, database);
  return { saved: true, key: input.key, content: input.content };
}

export async function rememberLifePerson(ownerEmailInput: string, input: {
  key: string; person: PersonMemoryUpdate; sourceRunId: string; quote: string;
}, database = getDb()) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const stableKey = `person:remember:${input.key}`;
  if (input.person.operation === "remove" && !input.person.id) throw new Error("Removing a person requires their saved person ID.");
  return database.transaction(async transaction => {
    const [existing] = await transaction.select().from(lifeFacts).where(and(
      eq(lifeFacts.ownerEmail, ownerEmail), eq(lifeFacts.kind, "person"), isNull(lifeFacts.supersededAt),
      input.person.id ? eq(lifeFacts.id, input.person.id) : eq(lifeFacts.stableKey, stableKey),
    )).limit(1).for("update");
    if (input.person.id && !existing) throw new Error("Saved person not found for this account. Do not recreate a deleted person or guess a different ID.");
    if (input.person.operation === "remove") {
      await transaction.delete(lifeFacts).where(and(eq(lifeFacts.ownerEmail, ownerEmail), eq(lifeFacts.id, existing!.id), eq(lifeFacts.kind, "person")));
      return { removed: true, id: existing!.id };
    }
    const current = existing ? personFromMemory(existing.value) : null;
    const value = personMemorySchema.parse({
      name: input.person.name ?? current?.name ?? "",
      role: input.person.role ?? current?.role ?? "",
      email: input.person.email ?? current?.email ?? "",
      phone: input.person.phone ?? current?.phone ?? "",
    });
    if (!input.person.id && existing) {
      if (JSON.stringify(current) !== JSON.stringify(value)) throw new Error(`That person memory key already exists. Edit the saved person using id ${existing.id}; use a different key only for a different person.`);
      return { saved: true, id: existing.id, person: value };
    }
    const now = new Date();
    const evidence = { sourceRunId: input.sourceRunId, quote: input.quote, confirmedByUser: true };
    if (existing) {
      await transaction.update(lifeFacts).set({ value, source: "conversation", evidence, confidence: "1", lastConfirmedAt: now, updatedAt: now })
        .where(and(eq(lifeFacts.ownerEmail, ownerEmail), eq(lifeFacts.id, existing.id)));
      return { saved: true, id: existing.id, person: value };
    }
    const [created] = await transaction.insert(lifeFacts).values({ ownerEmail, kind: "person", stableKey, value,
      source: "conversation", evidence, confidence: "1", lastConfirmedAt: now, observedAt: now, updatedAt: now })
      .onConflictDoNothing({ target: [lifeFacts.ownerEmail, lifeFacts.stableKey] }).returning({ id: lifeFacts.id });
    if (!created) throw new Error("That person memory was saved concurrently. Check the current saved people before editing it.");
    return { saved: true, id: created.id, person: value };
  });
}

export async function listProactiveProfileOwners(limit = 500) {
  const rows = await getDb().select({ ownerEmail: userLifeProfiles.ownerEmail })
    .from(userLifeProfiles).limit(Math.max(1, Math.min(limit, 2_000)));
  return rows.map((row) => row.ownerEmail);
}
