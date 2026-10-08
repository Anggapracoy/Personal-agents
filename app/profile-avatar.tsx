"use client";
import { useState } from "react";

/** Google account photo, with initials when absent or unavailable. */
export function ProfileAvatar({ image, initial }: { image?: string | null; initial: string }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return image && image !== failedImage
    ? <img className="wd-avatar-image" src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
    : <>{initial}</>;
}
