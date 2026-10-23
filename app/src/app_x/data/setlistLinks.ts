import verifiedLinks from "./cached.setlist-links.json";
import type { SongCaches } from "./songLists";

export type SetlistLink = { url: string; set_id?: string };
export type SetlistLinks = Record<string, SetlistLink[]>;

/** A page can be useful before anybody has reported its songs. */
export function artistSetlistLinks(concertId: string, artistId: string, setlists: SongCaches["setlists"], setId?: string, links: SetlistLinks = verifiedLinks): SetlistLink[] {
  const key = `${encodeURIComponent(artistId)}:${encodeURIComponent(concertId)}`;
  const cached = (setlists[key] || []).filter(value => value.set_id === setId && value.sets.some(set => set.songs.length));
  // A later song-cache refresh already exposes the source in its disclosure.
  return (links[key] || []).filter(value => value.set_id === setId && !cached.some(list => list.url === value.url));
}
