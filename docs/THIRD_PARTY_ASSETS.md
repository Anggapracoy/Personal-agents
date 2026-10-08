# Third-party asset review

Reviewed October 8, 2026. The maintainer subsequently authorized replacing the copied Apple icons and restaurant photograph. The current source uses the licensed replacements listed below; earlier Git commits still contain the old files and must be cleaned before public release. The project's MIT license does not replace third-party licenses or grant trademark rights.

| Asset group | Evidence in this repository | Review outcome |
|---|---|---|
| Archivo, Spectral and IBM Plex Mono fonts | Embedded copyright/family metadata; [font notices](../public/fonts/README.md) | Added the corresponding upstream SIL OFL 1.1 notices. Keep these with the fonts. |
| Card-network SVGs | [Source attribution](../public/card-networks/README.md) and [Apache 2.0 license](../public/card-networks/LICENSE) | Code/artwork license notice retained. Network trademarks remain owned by their respective owners. |
| iPhone frame | [Source](landing-artwork.md) and [MIT notice](../public/landing/iphone-frame-LICENSE.txt) | Existing upstream notice retained. The software license does not itself resolve any separate trademark/design rights. |
| Cursor-motion code | [MIT attribution](licenses/cua-cursor-motion.txt) | Existing Cua copyright and license retained. |
| Source/capability icons, including native copies | [Pinned Lucide source, glyph mappings and complete license notices](../public/source-icons/README.md) | Replaced copied Apple app icons with generic Lucide symbols in Dash-colored tiles. ISC and applicable Feather MIT notices are retained. |
| Restaurant photograph in onboarding | [CHUTTERSNAP / Unsplash source and license record](../ios/DecisionFeed/Resources/OnboardingRestaurant-SOURCE.md) | Replaced the L’Artusi photo with a free Unsplash-licensed interior image. The example venue is fictional. Preserve the source/license record; the image is not re-licensed under the project's MIT license. |
| Project mascots, illustrations and other project-supplied artwork | Existing source assets and design documentation | No independent proof of authorship/assignment was established in this review. The maintainer should confirm ownership; do not infer rights from the presence of an asset alone. |

Dependency license metadata was inventoried from the clean macOS installation. It includes permissive licenses and LGPL (libvips), MPL (Lightning CSS) and CC-BY (caniuse-lite). No missing license field was found in that installed-platform inventory. That is not a legal compatibility determination. Preserve upstream notices and satisfy the applicable terms if distributing dependencies or built binaries; other platforms may install different optional binaries.
