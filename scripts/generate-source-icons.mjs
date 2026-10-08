import { readdirSync } from 'node:fs';
import sharp from 'sharp';

// The licensed SVGs are canonical; keep native artwork synchronized with them.
for (const file of readdirSync('public/source-icons').filter(file => file.endsWith('.svg'))) {
  const name = file.slice(0, -4);
  await sharp(`public/source-icons/${file}`).png().toFile(`ios/DecisionFeed/Resources/Assets.xcassets/Source-${name}.imageset/${name}.png`);
}
