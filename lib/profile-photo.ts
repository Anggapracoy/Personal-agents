import sharp from "sharp";
import postgres from "postgres";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
let sql: ReturnType<typeof postgres> | undefined;
function database() {
  if (!process.env.DATABASE_URL) throw new Error("Photo storage is unavailable.");
  return sql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 20 });
}
export async function normalizeProfilePhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("Choose a photo smaller than 3 MB.");
  const photo = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
  const metadata = await photo.metadata();
  if (!["jpeg", "png", "webp", "heif", "avif"].includes(metadata.format ?? "")) throw new Error("Choose a JPEG, PNG, or WebP photo.");
  // Re-encoding strips EXIF/location data and prevents serving uploaded markup.
  const result = await photo.rotate().resize(256, 256, { fit: "cover" }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${result.toString("base64")}`;
}
export async function getProfilePhoto(email: string): Promise<string | null> {
  const [row] = await database()`select image from user_profile_photos where owner_email=${email.trim().toLowerCase()}`;
  return row?.image ?? null;
}
export async function saveProfilePhoto(email: string, image: string) {
  await database()`insert into user_profile_photos(owner_email,image) values(${email.trim().toLowerCase()},${image}) on conflict(owner_email) do update set image=excluded.image,updated_at=now()`;
}
