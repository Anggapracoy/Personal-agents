# Third-party asset review

Reviewed October 8, 2026. The maintainer explicitly chose to retain the existing Apple icons and restaurant photograph in the follow-up review; the unresolved rights below remain disclosed. The project's MIT license does not replace third-party licenses or grant trademark rights.

| Asset group | Evidence in this repository | Review outcome |
|---|---|---|
| Archivo, Spectral and IBM Plex Mono fonts | Embedded copyright/family metadata; [font notices](../public/fonts/README.md) | Added the corresponding upstream SIL OFL 1.1 notices. Keep these with the fonts. |
| Card-network SVGs | [Source attribution](../public/card-networks/README.md) and [Apache 2.0 license](../public/card-networks/LICENSE) | Code/artwork license notice retained. Network trademarks remain owned by their respective owners. |
| iPhone frame | [Source](landing-artwork.md) and [MIT notice](../public/landing/iphone-frame-LICENSE.txt) | Existing upstream notice retained. The software license does not itself resolve any separate trademark/design rights. |
| Cursor-motion code | [MIT attribution](licenses/cua-cursor-motion.txt) | Existing Cua copyright and license retained. |
| Apple app icons, including copies in native assets | [Download provenance](../public/apple-app-icons/README.md) | **Unresolved for redistribution.** Source URLs do not establish a license. Confirm permission covering this use or replace these with original capability icons. Apple's [third-party guidelines](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html) restrict use of Apple-owned graphic symbols/icons. |
| L'Artusi restaurant photograph in onboarding | [Source note](../ios/DecisionFeed/Resources/OnboardingRestaurant-SOURCE.md) | **Unresolved for redistribution.** The note identifies the restaurant website and source photograph but supplies no reuse license. Obtain permission or replace it with an image you own or can redistribute. |
| Project mascots, illustrations and other project-supplied artwork | Existing source assets and design documentation | No independent proof of authorship/assignment was established in this review. The maintainer should confirm ownership; do not infer rights from the presence of an asset alone. |

Dependency license metadata was inventoried from the clean macOS installation. It includes permissive licenses and LGPL (libvips), MPL (Lightning CSS) and CC-BY (caniuse-lite). No missing license field was found in that installed-platform inventory. That is not a legal compatibility determination. Preserve upstream notices and satisfy the applicable terms if distributing dependencies or built binaries; other platforms may install different optional binaries.
