# Home photography

Full-colour photographs, downloaded and licence pages checked on **2026-09-02**. These are third-party copyrighted works used under the licences below, not public-domain assets.

| Asset prefix | Photographer | Photo/source | Full-resolution download | WebP variants (width × height) | Licence |
| --- | --- | --- | --- | --- | --- |
| `plaza-mayor` | Luis Quintero | [Pexels 14363705](https://www.pexels.com/photo/people-walking-on-street-near-brown-concrete-building-14363705/) | 5270 × 3513 | 768 × 333; 1280 × 555; 1920 × 832 | [Pexels License](https://www.pexels.com/license/) |
| `valencia` | Northleg Official | [Unsplash kzxAhfNsm_4](https://unsplash.com/photos/a-crowd-of-people-in-a-large-building-with-signs-kzxAhfNsm_4) | 6000 × 4000 | 480 × 320; 768 × 512; 1024 × 683 | [Unsplash License](https://unsplash.com/license) |
| `bilbao` | Guerrero De la Luz | [Pexels 14264400](https://www.pexels.com/photo/people-walking-on-the-street-14264400/) | 5095 × 3312 | 480 × 312; 768 × 500; 1024 × 666 | [Pexels License](https://www.pexels.com/license/) |
| `sevilla` | Timur Seyfelmlyukov | [Unsplash UPBNmZQqI-o](https://unsplash.com/photos/seville-street-with-historic-buildings-parked-scooters-and-giralda-tower-UPBNmZQqI-o) | 4240 × 2832 | 480 × 321; 768 × 513; 1024 × 684 | [Unsplash License](https://unsplash.com/license) |
| `oviedo` | Vitalii Kyktov | [Unsplash ImwipaeWZcA](https://unsplash.com/photos/wet-street-lined-with-trees-and-shops-after-rain-ImwipaeWZcA) | 4241 × 2829 | 480 × 356; 768 × 569; 1024 × 759 | [Unsplash License](https://unsplash.com/license) |

Both licences permit free commercial website use and modification without mandatory attribution. Their restrictions still apply: do not imply endorsement, sell unaltered stock copies, or redistribute the collection as a competing stock service. [Rights involving identifiable people, brands and property are separate from copyright licensing](https://help.unsplash.com/en/articles/2612329-releases-and-trademarks); no individual release has been independently verified. The people shown are not presented as students or endorsers.

Processing: only automatic orientation, the mechanical crops described below, proportional downsampling, conversion to sRGB and WebP compression (quality 83; Bilbao 80; Valencia and Oviedo 78). No generated content, retouching, colour grading or baked-in monochrome effect. Final framing and monochrome-to-colour interaction are handled by the website. The full-resolution downloads are retained intact locally in `output/home-photography/originals/`, outside runtime assets and ignored by Git.

Valencia shows the Central Market and retains the complete source composition in every variant. The partially visible red sign at the left edge is part of the original photograph; CSS anchors this photo at `0% 75%` to preserve that edge across screen sizes. Its source file is `valencia-mercado-northleg-original.jpg`. The replaced terrace source remains locally as `valencia.jpg`, but is not used by the home.

Permanent mechanical crops in the runtime variants:

- Oviedo: retain the left 3816 × 2829 pixels of the 4241 × 2829 source, excluding the rightmost 425 pixels (approximately 10%). This excludes the small adult-shop sign at the extreme right edge without retouching. Other incidental commercial signs remain part of the real street scene.
- Plaza Mayor: retain the full width and bottom 2283 pixels, starting at y=1230 (5270 × 2283 crop). Approximately 35% of the source height is removed from the sky while preserving the facade, statue and people.
