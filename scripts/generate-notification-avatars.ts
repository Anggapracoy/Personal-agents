/** Run with node --import tsx scripts/generate-notification-avatars.ts after changing character artwork. */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { CHARACTERS, characterSvgMarkup } from '../lib/conversation-character';
const require = createRequire(import.meta.url);
// Reuse Next's image pipeline dependency without adding an application dependency.
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const directory = new URL('../ios/DecisionFeedNotificationService/Avatars/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const index of CHARACTERS.keys()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="#fff"/>${characterSvgMarkup(index)}</svg>`;
  await sharp(Buffer.from(svg)).resize(264, 264).png().toFile(new URL(`agent-${index}.png`, directory).pathname);
}
