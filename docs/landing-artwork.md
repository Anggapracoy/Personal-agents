# Landing artwork

The coastal closing scene was created with the built-in image generation tool on September 19, 2026. It is original promotional artwork, not a photo of a Dash customer or a representation of a booked destination.

Retired exploration asset (not rendered): `public/landing/coastal-morning.webp` (1672 × 941). Converted from the generated PNG to WebP at quality 88 without changing the composition. The page renders all text, controls, and approved character vectors separately in HTML/CSS/SVG.

## Final generation prompt

> Use case: photorealistic-natural. Asset type: cinematic full-width website closing banner, wide 16:9. Create a refined editorial landscape photograph evoking a little more time to enjoy life: a quiet grassy coastal hillside above an expansive calm ocean at early morning, subtle sea haze and rolling distant headlands. Lush soft sage grass in the foreground, a gentle winding footpath entering from the lower right and disappearing around a hill. Muted pale blue sky occupies the top half with soft delicate warm morning sunlight. Natural film grain, subtle color, atmospheric depth, exceptional photographic realism, no dramatic artificial saturation, no illustration. Composition leaves a large clean uncluttered central area in the sky for dark website typography. No text, no letters, no logos, no people, no animals, no buildings. Calm, premium, understated. Bottom edge has deep charcoal-green shadowed vegetation that can blend smoothly into a charcoal webpage footer. This is original art for the Dash personal assistant website.

The initial image mockup was for direction only. Production uses the existing six conversation characters from `lib/conversation-character.ts` and the approved Dash brand mascot, not the mockup's invented illustrations.

## iPhone hardware frame

All phone previews use `public/landing/iphone-16-pro-black-hires.png`, an unmodified 1508 × 3279 px transparent asset from [Blaine Miller’s Monkr project](https://github.com/blaineam/Monkr/blob/main/static/devices/iphone-16-pro/black-titanium.png). The repository’s MIT license is preserved as `public/landing/iphone-frame-LICENSE.txt`. This replaces the earlier 450 px frame, which blurred at Retina display sizes.

CSS excludes the transparent outer padding with background-size 111.703704% × 118.804348% and centered positioning. This maps the 1350 × 2760 device region onto the established 450:920 layout without changing the screen content or scroll geometry. The screen begins at source (151, 328), matching the existing logical (24, 23) inset after accounting for the source padding and 3× resolution.

The coastal landscape is retired from the landing page. The closing section now uses live typography and the approved vector character family on white, with no photographic background or fade.
