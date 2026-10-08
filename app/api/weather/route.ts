import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  if (!process.env.OPENWEATHER_API_KEY) return NextResponse.json({ error: "Weather connection is not configured." }, { status: 503 });
  const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${process.env.OPENWEATHER_API_KEY}`, { next: { revalidate: 900 } });
  if (!response.ok) return NextResponse.json({ error: "Weather provider unavailable" }, { status: 502 });
  const body = await response.json() as { main?: { temp?: number }; weather?: Array<{ description?: string }> };
  return NextResponse.json({ mode: "connected", summary: body.weather?.[0]?.description ?? "Local weather", temperatureF: body.main?.temp });
}
