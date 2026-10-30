# Concert enrichment — October 29, 2026

Added two setlists (36 reported songs) and corrected two supporting-act bills.
The catalog changes were saved through the signed-in production editor and
verified by a fresh read of the public catalog.

## Setlists added

| Performance | Catalog key | Songs | Source |
| --- | --- | ---: | --- |
| billy woods, Forest Hills Stadium, October 3, 2026 | `billy-woods:1xsvzl` | 11 | [setlist.fm](https://www.setlist.fm/setlist/billy-woods/2026/forest-hills-stadium-queens-ny-2b7f789a.html) |
| Lawrence, Brooklyn Paramount, October 29, 2026 | `lawrence:k40frl` | 25 | [setlist.fm](https://www.setlist.fm/setlist/lawrence/2026/brooklyn-paramount-brooklyn-ny-1b7dad78.html) |

The billy woods source explicitly says the setlist is incomplete; that note is
preserved. Lawrence's page identified the concert as finished when captured
late on October 29 in New York. Encore grouping, covers and guest notes are
retained. Artist, venue and local event date were checked against the current
catalog before publishing. Source hashes, capture times and immutable cache
revisions are recorded by the existing publishing pipeline.

## Supporting acts added

| Concert | Supporting act | Evidence |
| --- | --- | --- |
| Geese, Forest Hills Stadium, October 3, 2026 (`1xsvzl`) | billy woods (`billy-woods`) | [Venue event page](https://www.foresthillsstadium.com/events/detail/?event_id=1428055) lists Geese and billy woods for this date. |
| Samantha Fish, Brooklyn Bowl, November 15, 2026 (`uyorju`) | Sgt. Splendor (`l9p9u9`, new artist record) | [Venue event page](https://brooklyn.brooklynbowl.com/events/detail/samantha-fish-k7vgf_cty3dd7) lists Samantha Fish and Sgt. Splendor. |

Only these two concert records and the new Sgt. Splendor artist record changed.
The editor also normalized absent optional concert fields to empty strings.
Dates, venues, headliners and existing artists were preserved. A readback at
2026-10-30 03:58 UTC verified that venues, schedules, users and personal concert
records were unchanged.

## Research coverage and remaining gaps

The October 29 catalog snapshot contained 401 events. The ordinary-concert
pass accounted for all 559 artist/concert targets: 303 already cached, 53
future, 14 hidden, 20 cancelled, 51 empty source pages, 113 without a matching
source and 5 needing identity or performance review. Thus all 169 eligible
ordinary-concert gaps were revisited. Existing song caches were preserved;
their sources were not represented as freshly fetched.

The follow-on festival pass read 14 edition directories and accounted for
another 166 artist/concert targets before browser timeouts interrupted the
pass. The combined saved audit covers 725 of 2,001 targets; **the festival
recheck is partial**. It found no additional publishable songs in that portion.
The earlier verified festival caches and empty-page links were retained.
The two additions above were separately verified after the catalog audit:
billy woods was newly added to the bill, and Lawrence had just finished.

Upcoming support checks also covered Blu DeTiger, Dave Matthews Band, Cherry
Bomb, The Flaming Lips, CHVRCHES, Sammy Rae & The Friends, Daniel Donato, Ruby
Waters and John Mayer. No additional named support was found in the checked
announcements. This is an unresolved information gap, not evidence that those
shows have no opener. Representative official sources:

- [Blu DeTiger / AXS](https://www.axs.com/events/1566329/blu-detiger-tickets)
- [Dave Matthews Band / MSG](https://www.msg.com/events-tickets/dave-matthews-band-madison-square-garden-november-2026/3B0064F8E6F49510)
- [The Flaming Lips / Ticketmaster](https://www.ticketmaster.com/the-flaming-lips-new-york-new-york-01-27-2027/event/000065572E7FF767)
- [CHVRCHES / AXS](https://www.axs.com/events/1669973/chvrches-tickets)
- [Sammy Rae & The Friends / Bowery Presents](https://bowerypresents.com/events/detail/?event_id=1621886)
- [Daniel Donato / MSG](https://www.msg.com/events-tickets/daniel-donato-beacon-theatre-february-2027/3B00654FF1B36AB2)
- [Ruby Waters / Ticketmaster](https://www.ticketmaster.com/ruby-waters-suppreions-north-america-tour-new-york-new-york-02-27-2027/event/0000654FD31766AF)
- [John Mayer / Sphere](https://www.sphereentertainmentco.com/john-mayer-live-at-sphere/)

Historical leads were held where they conflicted with the recorded bill or
described a band member instead of a separate opening act. Earlier decisions
about multiple shows on the same day were preserved. No attendance, ratings,
notes or hidden/cancelled selections were changed.

## Validation

- All 34 Python cache/parser tests and 13 TypeScript song-list tests passed.
- Oxlint, TypeScript project checking and the Vite production build passed.
- A structural comparison confirmed that every pre-existing cached performance
  remained unchanged; only the two intended cache keys were added.
- Production catalog readback verified both supporting-act assignments and
  preserved personal records.
