import { NextResponse } from "next/server";
import { currentUserEmail } from '../../../lib/auth/session';
import { enforceApiQuota } from '../../../lib/api-quota';

export async function GET(request: Request) {
  const owner = await currentUserEmail();
  if (!owner) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const limited = await enforceApiQuota(owner, 'weather');
  if (limited) return limited;
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!url.searchParams.get('lat')?.trim() || !url.searchParams.get('lon')?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return NextResponse.json({ error: "Valid lat and lon are required" }, { status: 400 });
  if (!process.env.OPENWEATHER_API_KEY) return NextResponse.json({ error: "Weather connection is not configured." }, { status: 503 });
  const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${process.env.OPENWEATHER_API_KEY}`, { next: { revalidate: 900 }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return NextResponse.json({ error: "Weather provider unavailable" }, { status: 502 });
  const body = await response.json() as { main?: { temp?: number }; weather?: Array<{ description?: string }> };
  return NextResponse.json({ mode: "connected", summary: body.weather?.[0]?.description ?? "Local weather", temperatureF: body.main?.temp });
}
