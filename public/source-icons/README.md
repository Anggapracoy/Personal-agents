# Capability icons

Generic source/capability glyphs from Lucide, drawn in Dash-colored rounded tiles. These are not Apple app logos.

Upstream: https://github.com/lucide-icons/lucide/tree/a04f228cd01185e09c188b7227b9600c08c565ec/icons
Pinned commit: `a04f228cd01185e09c188b7227b9600c08c565ec`
License: [ISC and applicable Feather MIT notices](LICENSE). Keep this complete notice with the assets and derivatives.

The SVGs are the canonical source. Native `Source-*` PNGs are rasterized copies of these same SVGs. Native and web display a 30 pt/px tile without extra transparent padding.

- `calendar`: `calendar-days.svg`, tile `#C65D53`
- `reminders`: `list-checks.svg`, tile `#8070C5`
- `contacts`: `contact-round.svg`, tile `#348E92`
- `files`: `folder.svg`, tile `#4684C8`
- `photos`: `images.svg`, tile `#AD812A`
- `health`: `heart-pulse.svg`, tile `#C85B7D`
- `home`: `house.svg`, tile `#BF7C40`
- `music`: `music-2.svg`, tile `#9963AD`
- `maps`: `map.svg`, tile `#508D6B`
- `weather`: `cloud-sun.svg`, tile `#4D88B5`
- `passwords`: `key-round.svg`, tile `#6D60B5`

Regenerate native copies from the repository root with `node scripts/generate-source-icons.mjs`. The complete notices also ship in `ios/DecisionFeed/Resources/SourceIcons-LICENSE.txt`.
