import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useApp } from "../data/store";
import { userConcertRows } from "../data/model";
import { concertPeriod } from "../data/time";
import { ConcertRow } from "../components/ConcertRow";
import { Empty } from "../components/ui";
import { buildConcertSearch, matchesConcertSearch, normalizeSearch } from "../data/concertSearch";
import { setlistCaches } from "../data/setlistCaches";
import { readFeedView, updateFeedView } from "../data/feedView";

export function UserPage({ username }: { username: string }) {
  const [showHidden, setShowHidden] = useState(() => readFeedView(username).showHidden);
  const [query, setQuery] = useState(() => readFeedView(username).query);
  const [searchSetlists, setSearchSetlists] = useState(() => readFeedView(username).searchSetlists);
  useEffect(() => {
    updateFeedView(username, { showHidden, query, searchSetlists });
  }, [username, showHidden, query, searchSetlists]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const { catalog, loading } = useApp();
  const search = useMemo(() => buildConcertSearch(catalog.concerts, catalog.artists, catalog.schedules, setlistCaches, catalog.venues),
    [catalog.concerts, catalog.artists, catalog.schedules, catalog.venues]);
  const profile = catalog.profiles.find((item) => item.username === username || item.id === username);
  const viewReady = !loading && !!profile;
  useLayoutEffect(() => {
    if (viewReady) window.scrollTo({ top: readFeedView(username).scrollY, left: 0, behavior: "instant" });
  }, [username, viewReady]);
  if (loading) return null;
  if (!profile) return <Empty title="User not found" />;
  const allRows = userConcertRows(catalog, profile.user_id, true).filter(({ concert }) =>
    matchesConcertSearch(concert ? search.get(concert.id) : undefined, query, searchSetlists));
  const hiddenCount = allRows.filter(({ log }) => log?.removed).length;
  const count = allRows.length - hiddenCount;
  const rows = allRows.filter(({ log }) => showHidden ? log?.removed === true : !log?.removed);
  const groups: Record<"upcoming" | "past" | "unknown", typeof rows> = { upcoming: [], past: [], unknown: [] };
  const timezones = new Map(catalog.venues.map((venue) => [venue.id, venue.timezone]));
  for (const row of rows) {
    const period = row.concert ? concertPeriod(row.concert, timezones.get(row.concert.venue_id) || "UTC", now) : "unknown";
    groups[period].push(row);
  }
  groups.upcoming.reverse();
  const renderRow = ({ log, concert }: typeof rows[number]) => concert ? (
    <ConcertRow key={concert.id} catalog={catalog} concert={concert} log={log ?? null} now={now} />
  ) : log ? (
    <div key={log.id} className={`rs-message${log.removed ? " rs-concert-hidden" : ""}`}>
      Concert unavailable{log.removed && <span className="rs-hidden-label">Hidden</span>}
    </div>
  ) : null;
  return (
    <>
      <section className="rs-user-heading">
        <div className="rs-log-search" role="search" aria-label="Concerts">
          <input type="search" aria-label="Search concerts" placeholder="Search artists, concerts, venues" value={query}
            onChange={event => setQuery(event.target.value)} autoComplete="off" />
          <label className="rs-check">
            <input type="checkbox" checked={searchSetlists} onChange={event => setSearchSetlists(event.target.checked)} />
            Search setlists
          </label>
        </div>
        <div className="rs-log-controls">
          <span className="rs-count">{count} {count === 1 ? "concert" : "concerts"}</span>
          <label className="rs-check">
            <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
            Show {hiddenCount} hidden
          </label>
        </div>
      </section>
      <section aria-label={`${username}’s concerts`}>
        {!!rows.length && <div className="rs-log-columns">
          {(["upcoming", "past"] as const).map((period) => (
            <section className="rs-log-column" key={period} aria-label={period === "upcoming" ? "Upcoming concerts" : "Past concerts"}>
              <h2>{period === "upcoming" ? "Upcoming" : "Past"}</h2>
              <div className="rs-concert-list">{groups[period].map(renderRow)}</div>
            </section>
          ))}
        </div>}
        {!!groups.unknown.length && <div className="rs-concert-list">{groups.unknown.map(renderRow)}</div>}
        {!rows.length && <Empty title={normalizeSearch(query) ? "No matches" : showHidden ? "No hidden concerts" : "No concerts"} />}
      </section>
    </>
  );
}
