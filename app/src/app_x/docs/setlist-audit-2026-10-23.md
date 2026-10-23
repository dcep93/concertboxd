# Setlist audit — 2026-10-23

Audited all 393 catalog concerts for dcep93 (385 visible), covering 1,990 artist/concert groups. This includes full festival schedules, not a claim that every scheduled act was attended. Hidden, cancelled, and future performances were classified and left unchanged.

Added **110 verified setlists with 1,374 song entries**. The cache now contains 1,026 performances and 13,580 song entries across 1,006 keys. Every pre-existing cache entry is unchanged.

## Method

Read a fresh public Firestore catalog snapshot. Checked existing coverage and researched every missing eligible artist/performance against public setlist.fm pages and complete festival directories. Existing entries were retained without claiming a new source fetch. Empty source pages are not inferred setlists. Artist, date, venue or exact festival backlink must match; repeated same-day performances require unique published timing or stage evidence. Song order, encores, notes, covers, and tape flags are preserved by the existing parser.

New entries have source URLs, capture metadata, content hashes, and immutable history. Raw catalog and page captures remain locally ignored under imports/setlist-audit-2026-10-23. No Firestore catalog or personal records were changed.

The 18 events without artist targets were checked separately. Hamilton, Illinoise, and The Phantom of the Opera already have musical programs. The remaining entries include an upcoming film performance, plays, conventions, parties, and an unidentified recital; their classifications are included in the audit report.

## Coverage of eligible past performances

| Scope | Scheduled artist performances | With songs before | With songs after | Added |
| --- | ---: | ---: | ---: | ---: |
| Ordinary concerts, including supporting acts | 472 | 260 | 303 | 43 |
| Outside Lands 2018 (8nhjof) | 93 | 49 | 50 | 1 |
| NOS Alive 2019 (37a4hj) | 34 | 15 | 15 | 0 |
| Outside Lands 2019 (brv1d9) | 92 | 37 | 37 | 0 |
| Sonoma Harvest Music Festival 2019 (81bzyp) | 11 | 9 | 9 | 0 |
| Lollapalooza 2021 (yyea3y) | 176 | 83 | 85 | 2 |
| BottleRock Napa Valley 2021 (c26k26) | 86 | 40 | 40 | 0 |
| Outside Lands 2021 (f3ysgl) | 122 | 0 | 43 | 43 |
| Lollapalooza 2023 (ub5qri) | 195 | 103 | 106 | 3 |
| Kilby Block Party 2024 (fuaiif) | 70 | 50 | 50 | 0 |
| Primavera Sound Barcelona 2024 (3s9mjj) | 259 | 120 | 127 | 7 |
| Governors Ball 2024 (cy53a8) | 68 | 42 | 42 | 0 |
| Governors Ball 2025 (7zj1wf) | 52 | 32 | 34 | 2 |
| All Things Go 2025 (65mer9) | 24 | 20 | 20 | 0 |
| Outside Lands 2026 (xuwdm1) | 147 | 51 | 60 | 9 |

## Remaining gaps and reviewed identities

The machine-readable report contains every artist/concert result and candidate URL. Status counts are artist/concert groups; a group may contain multiple scheduled performances or an existing sibling setlist.

| Status | Groups |
| --- | ---: |
| absent_from_directory | 249 |
| ambiguous | 12 |
| cached | 98 |
| cancelled | 101 |
| empty | 452 |
| existing | 891 |
| future | 45 |
| hidden | 11 |
| needs_review | 6 |
| no_match | 113 |
| partial | 12 |

- **Vulfpeck, November 12, 2023:** user confirmed the early 7 PM show. Added [the early performance](https://www.setlist.fm/setlist/vulfpeck/2023/the-great-hall-at-avant-gardner-brooklyn-ny-3a1d5db.html).
- **Lawrence, December 31, 2024:** user confirmed the late 10:30 PM show. The located page is the early 7 PM performance and was excluded. [The band advertised two different sets](https://lawrencetheband.com/nye-city-winery). No verified late-show list was found.
- **Victor Wooten, January 12, 2018:** matched the show-specific Victor Wooten Trio identity, corroborated by [an attendee recording archive](https://www.tedtoob.com/2018-ted-toob-archives).
- **Brit Floyd, June 27, 2017:** catalog/independent listings identify the Warfield; the located setlist page identifies Portland. Held for review.
- **Robert Glasper, November 4, 2023:** catalog venue differs from the located Blue Note sources. Held for review.
- **Marc E. Bassy, Outside Lands 2021:** source and scheduled dates differ. Held for review.
- **Law and ZOLA:** candidate artist/room identity does not match. No songs copied.

See [the complete audit](setlist-audit-2026-10-23.json), [source manifest](../data/setlist-sources.json), and [cache metadata](../data/cached.setlist.fm.meta.json).

## Validation

All original cache entries were compared structurally and preserved. Every added performance and song count reconciles with the audit receipts. App lint and 57 relevant TypeScript tests passed. All 31 Python cache/discovery tests passed. The production build and deployment are checked by the release workflow.
