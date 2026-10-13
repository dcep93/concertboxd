import type { Artist, Concert, Schedule, Venue } from "./model";
import type { SongCaches, SongSet } from "./songLists";

export type ConcertSearchEntry = { title: string; artists: string[]; venue: string; setlistText: string[] };
export type SetlistCaches = Pick<SongCaches, "setlists" | "musicals">;

export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/ +/g, " ").trim();
}

/** Build once per catalog change; neither building nor matching performs I/O. */
export function buildConcertSearch(concerts: Concert[], artists: Artist[], schedules: Schedule[], caches: SetlistCaches, venues: Venue[]): Map<string, ConcertSearchEntry> {
  const names = new Map(artists.map(artist => [artist.id, normalizeSearch(artist.name)]));
  const places = new Map(venues.map(venue => [venue.id, normalizeSearch(`${venue.name} ${venue.location}`)]));
  const performances = new Map(schedules.map(schedule => [schedule.id, schedule.sets]));
  return new Map(concerts.map(concert => {
    const scheduled = performances.get(concert.id) || [];
    const ids = [...new Set([concert.artist_id, ...concert.supporting_artist_ids, ...scheduled.map(set => set.artist_id)].filter(Boolean))];
    const setlistText = new Set<string>();
    const addText = (...values: (string | undefined)[]) => {
      for (const value of values) {
        const text = normalizeSearch(value || "");
        if (text) setlistText.add(text);
      }
    };
    const addSets = (sets: SongSet[]) => {
      for (const set of sets) {
        addText(set.name || (set.encore ? "Encore" : ""));
        for (const song of set.songs) {
          addText(song.name, song.artists, song.notes, song.tape ? "Tape" : undefined, song.explicit ? "Explicit" : undefined);
        }
      }
    };
    for (const id of ids) {
      const key = `${encodeURIComponent(id)}:${encodeURIComponent(concert.id)}`;
      for (const value of caches.setlists[key] || []) {
        if (value.kind !== "setlist_fm") continue;
        const matched = scheduled.length
          ? scheduled.some(set => set.id === value.set_id && set.artist_id === id)
          : value.set_id === undefined;
        if (matched && value.sets.some(set => set.songs.length)) {
          addSets(value.sets);
          addText(value.notes);
        }
      }
    }
    const program = caches.musicals[concert.id];
    if (program?.kind === "musical_program" && program.sets.some(set => set.songs.length)) {
      addSets(program.sets);
      addText(program.title, program.production, program.basis, program.notes);
    }
    return [concert.id, { title: normalizeSearch(concert.name || ""), artists: ids.map(id => names.get(id) || "").filter(Boolean), venue: places.get(concert.venue_id) || "", setlistText: [...setlistText] }];
  }));
}

export function matchesConcertSearch(entry: ConcertSearchEntry | undefined, query: string, searchSetlists = false): boolean {
  const term = normalizeSearch(query);
  return !term || !!entry && (entry.title.includes(term) || entry.artists.some(name => name.includes(term)) || entry.venue.includes(term)
    || searchSetlists && entry.setlistText.some(text => text.includes(term)));
}
