import { DateTime } from "luxon";
import { LogControls } from "./LogControls";
import type { LogEditing } from "../forms/useLogEditor";
import type { Catalog, Concert } from "../data/model";
import { setLabel } from "../data/schedules";
import { artistSongLists, groupScheduleDays, hasCachedConcertSource } from "../data/songLists";
import { setlistCaches } from "../data/setlistCaches";
import { artistSetlistLinks } from "../data/setlistLinks";
import { ConcertSetlists } from "./ConcertSetlists";
import { useSongCaches } from "./useSongCaches";
import { Link } from "./navigation";
import { entityPath } from "./routing";
import { Picture } from "./ui";

export function ConcertLineup({ catalog, concert, editor }: { catalog: Catalog; concert: Concert; editor?: LogEditing }) {
  const caches = useSongCaches();
  const artists = new Map(catalog.artists.map(artist => [artist.id, artist]));
  const schedule = catalog.schedules.find(item => item.id === concert.id);
  const scheduled = new Set(schedule?.sets.map(set => set.artist_id));
  const timezone = catalog.venues.find(venue => venue.id === concert.venue_id)?.timezone || "UTC";
  const ids = [...new Set([concert.artist_id, ...concert.supporting_artist_ids].filter(Boolean))];
  const program = caches?.musicals[concert.id];
  const row = (artistId: string, detail: string, setId?: string) => {
    const artist = artists.get(artistId);
    const name = artist?.name || artistId;
    const selectable = editor && (setId || (!schedule?.sets.length && artistId !== concert.artist_id));
    const set = setId ? schedule?.sets.find(item => item.id === setId) : undefined;
    const checked = !!editor && (setId ? editor.seen.includes(setId) : editor.selected.includes(artistId));
    return <div className="rs-performance" key={setId || artistId}>
      <div className="rs-performance-heading">
        {selectable && <label className="rs-lineup-check">
          <input type="checkbox" aria-label={set ? `Seen ${setLabel(set, catalog, concert)}` : `Seen ${name}`} checked={checked} disabled={editor.readOnly || editor.busy} onChange={event => {
            const values = setId ? editor.seen : editor.selected;
            const id = setId || artistId;
            const next = event.target.checked ? [...values, id] : values.filter(value => value !== id);
            void editor.persist(setId ? { seen_set_ids: next } : { supporting_artist_ids: next }, "controls");
          }} />
        </label>}
      {artist ? <Link className="rs-lineup-item" href={entityPath("artist", artist.id, name)}>
        {!setId && <Picture src={artist.image} name={name} />}
        <span>{name}{detail && <small>{detail}</small>}</span>
      </Link> : <p className="rs-message">Artist unavailable ({artistId}){detail && <small>{detail}</small>}</p>}
      </div>
      <ConcertSetlists entries={caches ? artistSongLists(concert.id, artistId, name, caches, setId) : []} />
      {artistSetlistLinks(concert.id, artistId, caches.setlists, setId).map(source => <a className="rs-song-source" key={source.url} href={source.url} target="_blank" rel="noreferrer" aria-label={`${name} · setlist.fm`}>setlist.fm ↗</a>)}
    </div>;
  };
  return <section className="rs-panel rs-lineup">
    {(editor || schedule?.sets.length || ids.length > 0) && <div className="rs-log-toolbar">
      <h2>{schedule?.sets.length ? "Schedule" : "Lineup"}</h2>
      {editor && <LogControls editor={editor} />}
    </div>}
    {!!schedule?.sets.length && <>
      {groupScheduleDays(schedule.sets, timezone).map(group => <details className="rs-schedule-day" key={group.day} open>
        <summary><h3>{group.day ? DateTime.fromISO(group.day, { zone: "UTC" }).toFormat("ccc, LLL d") : "Date unknown"}</h3></summary>
        {group.sets.map(set => row(set.artist_id, [
          set.start && DateTime.fromISO(set.start).setZone(timezone).toFormat("h:mm a"),
          set.stage,
        ].filter(Boolean).join(" · "), set.id))}
      </details>)}
    </>}
    {ids.filter(id => !scheduled.has(id)).map(id => row(id, id === concert.artist_id ? "Headliner" : concert.artist_id ? "Supporting" : ""))}
    {program?.sets.some(set => set.songs.length) && <ConcertSetlists entries={[{ key: `musical:${concert.id}`, title: program.title, label: "Musical program", value: program }]} />}
    {!schedule?.sets.length && !hasCachedConcertSource(concert, setlistCaches.setlists) && !ids.some(id => artistSetlistLinks(concert.id, id, caches.setlists).some(source => source.url === concert.setlist_fm_url)) && /^https:\/\/(www\.)?setlist\.fm\//i.test(concert.setlist_fm_url) && <a className="rs-outbound" href={concert.setlist_fm_url} target="_blank" rel="noreferrer">Setlist.fm</a>}
  </section>;
}
