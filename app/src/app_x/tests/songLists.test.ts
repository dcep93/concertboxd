import assert from "node:assert/strict";
import test from "node:test";
import { artistSongLists, concertSongLists, groupScheduleDays, hasCachedConcertSource } from "../data/songLists";
import type { PerformanceSetlist, SongCaches, SpotifyTopTracks } from "../data/songLists";
import { buildConcertSearch, matchesConcertSearch, normalizeSearch } from "../data/concertSearch";
import { normalizeArtist, normalizeConcert, normalizeSchedule, normalizeVenue } from "../data/model";

const top: SpotifyTopTracks = { kind: "spotify_top_tracks", artist: "A", url: "https://open.spotify.com/embed/artist/example", songs: [{ name: "Popular" }] };
const performance: PerformanceSetlist = { kind: "setlist_fm", url: "https://www.setlist.fm/setlist/example", sets: [{ songs: [{ name: "Played" }] }] };
const caches: SongCaches = {
  spotify: { a: top, b: { ...top, artist: "B" }, c: { ...top, artist: "C" } },
  setlists: { "a:c": [performance], "b:c": [{ ...performance, url: "https://www.setlist.fm/setlist/support" }] },
  musicals: { musical: { kind: "musical_program", title: "Show", production: "Production", basis: "Published program", url: "https://example.org/program", sets: [{ songs: [{ name: "Number" }] }] } },
};

test("cached headliner sources replace concert footers; supporting sources only replace matching URLs", () => {
  const concert = { id: "c", artist_id: "a", supporting_artist_ids: ["b"], setlist_fm_url: performance.url };
  assert(hasCachedConcertSource(concert, caches.setlists));
  assert(hasCachedConcertSource({ ...concert, artist_id: "", supporting_artist_ids: ["a"] }, caches.setlists));
  assert(!hasCachedConcertSource(concert, {}));
  assert(!hasCachedConcertSource(concert, { "a:c": [{ ...performance, sets: [] }] }));
  assert(!hasCachedConcertSource(concert, { "a:c": [{ ...performance, sets: [{ songs: [] }] }] }));
  assert(!hasCachedConcertSource(concert, { "a:c": [{ ...performance, set_id: "scheduled" }] }));
  assert(hasCachedConcertSource({ ...concert, setlist_fm_url: "https://www.setlist.fm/other" }, caches.setlists));
  assert(!hasCachedConcertSource({ ...concert, artist_id: "missing", supporting_artist_ids: ["a"], setlist_fm_url: "https://www.setlist.fm/other" }, caches.setlists));
  assert(!hasCachedConcertSource({ ...concert, artist_id: "removed", supporting_artist_ids: [] }, caches.setlists));
  assert(hasCachedConcertSource({ ...concert, id: "c:d", artist_id: "a/b" }, { "a%2Fb:c%3Ad": [performance] }));
});

test("every supporting artist has independent setlists and Spotify tracks, with duplicate artist IDs removed", () => {
  const entries = concertSongLists({ id: "c", artist_id: "a", supporting_artist_ids: ["b", "c", "a"] }, [], caches);
  assert.deepEqual(entries.map(e => [e.title, e.value.kind]), [
    ["a", "setlist_fm"], ["a", "spotify_top_tracks"], ["b", "setlist_fm"], ["b", "spotify_top_tracks"], ["c", "spotify_top_tracks"],
  ]);
});

test("future and unreported concerts retain Spotify independently; musicals need no fake artist", () => {
  const future = concertSongLists({ id: "future", artist_id: "a", supporting_artist_ids: [] }, [], caches);
  assert.equal(future[0].value.kind, "spotify_top_tracks");
  assert.equal(future[0].label, "Top 1 · Spotify");
  assert.equal(concertSongLists({ id: "musical", artist_id: "", supporting_artist_ids: [] }, [], caches)[0].value.kind, "musical_program");
  assert.deepEqual(concertSongLists({ id: "unknown", artist_id: "missing", supporting_artist_ids: [] }, [], caches), []);
});

test("repeated festival appearances match exact schedule IDs, never another performance or an unassigned setlist", () => {
  const festival: SongCaches = { ...caches, setlists: { "a:festival": [
    { ...performance, set_id: "dayone", sets: [{ songs: [{ name: "First day" }] }] },
    { ...performance, set_id: "daytwo", sets: [{ songs: [{ name: "Second day" }] }] },
    performance,
  ] } };
  for (const [id, name] of [["dayone", "First day"], ["daytwo", "Second day"]]) {
    const entries = artistSongLists("festival", "a", "Artist", festival, id);
    assert.equal(entries.length, 2);
    const selected = entries[0].value as PerformanceSetlist;
    assert.equal(selected.set_id, id);
    assert.equal(selected.sets[0].songs[0].name, name);
  }
  assert.deepEqual(artistSongLists("festival", "a", "Artist", festival, "missing").map(e => e.value.kind), ["spotify_top_tracks"]);
  assert.equal((artistSongLists("festival", "a", "Artist", festival)[0].value as PerformanceSetlist).set_id, undefined);
});

test("encoded artist/concert keys and empty song lists do not create missing-data disclosures", () => {
  const encoded: SongCaches = { setlists: { "a%2Fb:c%3Ad": [performance] }, musicals: {}, spotify: {} };
  assert.equal(artistSongLists("c:d", "a/b", "Artist", encoded).length, 1);
  assert.deepEqual(artistSongLists("c", "a", "A", { ...caches, setlists: { "a:c": [{ ...performance, sets: [] }] }, spotify: { a: { ...top, songs: [] } } }), []);
});

test("festival days show latest times first and untimed acts last, preserving after-midnight assignments", () => {
  const input = [
    { id: "later", artist_id: "a", day: "2026-07-01", start: "2026-07-02T00:30:00-04:00" },
    { id: "next", artist_id: "b", day: "2026-07-02", start: "2026-07-02T15:00:00-04:00" },
    { id: "unknown", artist_id: "c", day: "2026-07-01" },
    { id: "untimed", artist_id: "d", day: "2026-07-01" },
    { id: "no-day", artist_id: "e" },
    { id: "first", artist_id: "b", day: "2026-07-01", start: "2026-07-01T19:00:00-04:00" },
    { id: "inferred", artist_id: "a", start: "2026-07-02T01:00:00Z" },
  ];
  const before = structuredClone(input);
  assert.deepEqual(groupScheduleDays(input, "America/New_York").map(g => [g.day, g.sets.map(s => s.id)]), [
    ["2026-07-01", ["later", "inferred", "first", "untimed", "unknown"]], ["2026-07-02", ["next"]], ["", ["no-day"]],
  ]);
  assert.deepEqual(input, before, "grouping must not mutate source schedule");
});

test("search ignores case and special characters while preserving word spaces", () => {
  assert.equal(normalizeSearch("  AC/DC — R.E.M. & Beyoncé!  "), "acdc rem beyonce");
  assert.equal(normalizeSearch("Don't Stop"), normalizeSearch("DON’T STOP"));
  assert.notEqual(normalizeSearch("Big Thief"), normalizeSearch("BigThief"));
  assert.equal(normalizeSearch("!?%_"), "");
});

test("concert search includes titles and lineup; setlist text is opt-in and Spotify is excluded", () => {
  const artists = [normalizeArtist("a", { name: "AC/DC" }), normalizeArtist("b", { name: "Beyoncé" })];
  const concerts = [normalizeConcert("c", { artist_id: "a", supporting_artist_ids: ["b"], name: "Not an artist" })];
  const withNotes: SongCaches = { ...caches, setlists: { ...caches.setlists,
    "a:c": [{ ...performance, notes: "Performance note", sets: [{ name: "Encore", songs: [{ name: "Don't Stop", artists: "Cover artist", notes: "Song annotation", tape: true }] }] }],
  } };
  const before = JSON.stringify({ artists, concerts, withNotes });
  const entry = buildConcertSearch(concerts, artists, [], withNotes, []).get("c");
  for (const query of ["acdc", "AC/DC", "beyonce", "YONCÉ", "Not an artist"]) assert(matchesConcertSearch(entry, query));
  assert(!matchesConcertSearch(entry, "DONT STOP"));
  assert(matchesConcertSearch(entry, "DON’T STOP", true));
  assert(matchesConcertSearch(entry, "played", true), "supporting artist songs are searchable");
  for (const query of ["Performance note", "Song annotation", "Cover artist", "Encore", "Tape"]) {
    assert(!matchesConcertSearch(entry, query), query);
    assert(matchesConcertSearch(entry, query, true), query);
  }
  for (const query of ["Popular", "https"]) {
    assert(!matchesConcertSearch(entry, query, true), query);
  }
  assert.equal(JSON.stringify({ artists, concerts, withNotes }), before);
  assert(matchesConcertSearch(undefined, "  "));
  assert(matchesConcertSearch(undefined, "$%!?"));
  assert(!matchesConcertSearch(undefined, "anything", true));
});

test("festival search matches partial titles, schedule artists, and replacement notes with setlist search enabled", () => {
  const artists = [normalizeArtist("highwomen", { name: "The Highwomen" }), normalizeArtist("stapleton", { name: "Chris Stapleton" })];
  const concert = normalizeConcert("bottlerock", { name: "BottleRock Napa Valley" });
  const schedule = normalizeSchedule(concert.id, { sets: { friday: { artist_id: "highwomen" } } });
  const input: SongCaches = { setlists: { "highwomen:bottlerock": [{ ...performance, set_id: "friday", notes: "Day of replacement for headliner Chris Stapleton" }] }, musicals: {}, spotify: { highwomen: top } };
  const entry = buildConcertSearch([concert], artists, [schedule], input, []).get(concert.id);
  for (const query of ["bottle", "BOTTLE", "Bottle-Rock", "highwomen"]) assert(matchesConcertSearch(entry, query), query);
  assert(!matchesConcertSearch(entry, "stapleton"));
  assert(matchesConcertSearch(entry, "STAPLETON", true));
  assert(!matchesConcertSearch(entry, "Popular", true));
  assert(!matchesConcertSearch(entry, "Played"));
  assert(matchesConcertSearch(entry, "Played", true));
});

test("setlist search respects encoded concert identities, all scheduled sets, and musical programs", () => {
  const makePerformance = (name: string, set_id?: string): PerformanceSetlist => ({ ...performance, ...(set_id ? { set_id } : {}), sets: [{ songs: [{ name }] }] });
  const input: SongCaches = { ...caches, setlists: {
    "a%2Fb:fest%3Aone": [makePerformance("First night", "first1"), makePerformance("Second night", "second"), makePerformance("Unassigned"), makePerformance("Stale set", "stale1")],
    "a%2Fb:other": [makePerformance("Other concert", "first1")],
    "removed:fest%3Aone": [makePerformance("Removed artist", "first1")],
  } };
  const concerts = [normalizeConcert("fest:one", { supporting_artist_ids: ["a/b"] }), normalizeConcert("musical", {})];
  const schedules = [normalizeSchedule("fest:one", { sets: { first1: { artist_id: "a/b" }, second: { artist_id: "a/b" } } })];
  const index = buildConcertSearch(concerts, [normalizeArtist("a/b", { name: "A / B" })], schedules, input, []);
  const entry = index.get("fest:one");
  assert(matchesConcertSearch(entry, "a b"));
  assert(matchesConcertSearch(entry, "first night", true));
  assert(matchesConcertSearch(entry, "second night", true));
  for (const query of ["Unassigned", "Stale set", "Other concert", "Removed artist"]) assert(!matchesConcertSearch(entry, query, true), query);
  assert(!matchesConcertSearch(index.get("musical"), "Number"));
  assert(matchesConcertSearch(index.get("musical"), "Number", true));
  const noSongs = buildConcertSearch(concerts, [normalizeArtist("a/b", { name: "A / B" })], schedules, { setlists: {}, musicals: {} }, []);
  assert(matchesConcertSearch(noSongs.get("fest:one"), "a b", true));
});

test("venue names and locations are searchable without setlists, using the concert's current venue", () => {
  const venues = [
    normalizeVenue("berkeley", { name: "Greek Theatre – Berkeley", location: "Berkeley, CA" }),
    normalizeVenue("la", { name: "Greek Theatre – Los Angeles", location: "Los Angeles, CA" }),
    normalizeVenue("babys", { name: "Baby’s All Right", location: "Brooklyn, NY" }),
  ];
  const concerts = [normalizeConcert("tash", { venue_id: "berkeley" }), normalizeConcert("cherry", { venue_id: "babys" }), normalizeConcert("unknown", { venue_id: "missing" })];
  const index = buildConcertSearch(concerts, [], [], caches, venues);
  for (const query of ["GREEK", "Greek Theatre", "Berkeley, CA"]) assert(matchesConcertSearch(index.get("tash"), query));
  assert(!matchesConcertSearch(index.get("tash"), "Los Angeles"));
  for (const query of ["Baby's All Right", "babys", "brooklyn"]) assert(matchesConcertSearch(index.get("cherry"), query));
  assert(!matchesConcertSearch(index.get("unknown"), "Greek"));
  const updated = buildConcertSearch(concerts, [], [], caches, venues.map(venue => venue.id === "babys" ? { ...venue, name: "Renamed Hall" } : venue));
  assert(matchesConcertSearch(updated.get("cherry"), "renamed"));
  assert(!matchesConcertSearch(updated.get("cherry"), "babys"));
});
