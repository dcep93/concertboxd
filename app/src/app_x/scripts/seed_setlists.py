"""Resumable public-page discovery for an explicit saved app catalog."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
import unicodedata
from urllib.error import HTTPError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from refresh_setlists import source_key, DATA, cache_key, publish, read, save
from setlist_page import Tree, text, extract


def decode(value):
    if "mapValue" in value:
        return {k: decode(v) for k, v in value["mapValue"].get("fields", {}).items()}
    if "arrayValue" in value:
        return [decode(v) for v in value["arrayValue"].get("values", [])]
    return next(iter(value.values()))


def catalog(snapshot_root):
    raw = read(snapshot_root / "id-migration-2026-10-08/after.json", {})
    result = {name: {doc["name"].split("/")[-1]: {k: decode(v) for k, v in doc["fields"].items()} for doc in docs} for name, docs in raw.items()}
    for filename in ["import-corrections-2026-10-08/after.json", "event-time-research-2026-10-08/after-time-updates.json"]:
        for id, doc in read(snapshot_root / filename, {}).items():
            result["concerts"][id] = {k: decode(v) for k, v in doc["fields"].items()}
    return result


def norm(value):
    value = value.casefold().replace("&", "and")
    value = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))
    value = re.sub(r"[^a-z0-9]+", "", value)
    return value[3:] if value.startswith("the") else value


def identity(html):
    root = Tree(html).root
    info = root.first(lambda n: n.has("setlistInfo"))
    if not info:
        raise ValueError("No setlist identity")
    heading = info.first(lambda n: n.tag == "h1")
    links = heading.all(lambda n: n.tag == "a") if heading else []
    if len(links) not in (2, 3):
        raise ValueError("Unrecognized setlist identity")
    date = info.first(lambda n: n.has("date"))
    if not date:
        raise ValueError("No event date")
    date = " ".join(text(date.first(lambda n: n.has(part))) for part in ("month", "day", "year"))
    return {"artist": text(links[0]), "venue": ", ".join(text(n) for n in links[1:]), "event_date": datetime.strptime(date, "%b %d %Y").date().isoformat()}


def matches(actual, target):
    aliases = {
        "Greek Theatre – Berkeley": "William Randolph Hearst Greek Theatre",
        "Sphere": "Sphere at The Venetian Resort",
        "Kaufmann Concert Hall at 92NY": "Kaufmann Concert Hall",
        "Avant Gardner – Great Hall": "The Great Hall at Avant Gardner",
        "The UC Theatre": "The UC Theatre Taube Family Music Hall",
        "Davies Symphony Hall": "Louise M. Davies Symphony Hall",
        "Golden Gate Park": "Golden Gate Park Polo Field",
    }
    return (norm(actual["artist"]) == norm(target["artist"])
            and actual["event_date"] == target["event_date"]
            and bool(target["venue"])
            and norm(actual["venue"].split(",")[0]) == norm(aliases.get(target["venue"], target["venue"])))


class Blocked(Exception):
    pass


class Fetcher:
    def __init__(self, folder):
        self.folder = folder
        self.folder.mkdir(parents=True, exist_ok=True)
        self.last_request = 0
        self.requests = 0

    def get(self, url):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "www.setlist.fm" or not parsed.path.startswith(("/setlist/", "/search")):
            raise ValueError("Unexpected source URL")
        path = self.folder / (hashlib.sha256(url.encode()).hexdigest() + ".html")
        if path.exists():
            html = path.read_text()
            validate_public_page(html, url)
            return html
        time.sleep(max(0, 2 - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        self.requests += 1
        request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html", "Accept-Language": "en"})
        try:
            with urlopen(request, timeout=30) as response:
                if urlparse(response.url).netloc != "www.setlist.fm":
                    raise ValueError("Unexpected redirect")
                html = response.read().decode("utf-8")
        except HTTPError as error:
            if error.code in (403, 429):
                raise Blocked(f"HTTP {error.code} from {url}") from error
            raise
        validate_public_page(html, url)
        path.write_text(html, encoding="utf-8")
        return html


def validate_public_page(html, url):
    """A WAF library can exist on a valid page; require actual source content."""
    try:
        if urlparse(url).path.startswith('/setlist/'):
            identity(html)
        else:
            root = Tree(html).root
            links = [n for h in root.all(lambda n: n.tag == 'h2')
                     for n in h.all(lambda n: n.tag == 'a' and 'setlist/' in n.attrs.get('href', ''))]
            if not links and 'did not match any setlists' not in root.text():
                raise ValueError('Search page has no verified results or no-results message')
    except ValueError as error:
        if any(marker in html for marker in ('Just a moment...', 'Verify you are human', 'awsWafCookieDomainList', 'gokuProps')):
            raise Blocked(f'Access challenge from {url}') from error
        raise


def related(html, url):
    root = Tree(html).root
    section = root.first(lambda n: n.has("relatedVenueSetlists"))
    return [(text(n), urljoin(url, n.attrs["href"])) for n in section.all(lambda n: n.tag == "a" and "/setlist/" in n.attrs.get("href", ""))] if section else []


def search(fetcher, target):
    query = f'artist:({target["artist"]}) date:[{target["event_date"]} TO {target["event_date"]}]'
    url = "https://www.setlist.fm/search?" + urlencode({"query": query})
    html = fetcher.get(url)
    root = Tree(html).root
    links = [urljoin(url, n.attrs["href"]) for h in root.all(lambda n: n.tag == "h2") for n in h.all(lambda n: n.tag == "a" and "setlist/" in n.attrs.get("href", ""))]
    return list(dict.fromkeys(links)), url


def targets_for(data):
    targets, events = [], []
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    for concert_id, concert in data["concerts"].items():
        venue = data["venues"].get(concert.get("venue_id"), {})
        date = concert["date"][:10] if concert.get("date_precision") == "day" else datetime.fromisoformat(concert["date"].replace("Z", "+00:00")).astimezone(ZoneInfo(venue.get("timezone", "UTC"))).date().isoformat()
        ids = list(dict.fromkeys([concert.get("artist_id", ""), *concert.get("supporting_artist_ids", [])]))
        events.append({"concert_id": concert_id, "date": date, "name": concert.get("name") or data["artists"].get(concert.get("artist_id"), {}).get("name", ""), "missing_headliner": not concert.get("artist_id"), "future": date >= today})
        for artist_id in filter(None, ids):
            targets.append({"artist_id": artist_id, "concert_id": concert_id, "artist": data["artists"].get(artist_id, {}).get("name", artist_id), "venue": venue.get("name", ""), "event_date": date, "future": date >= today, "url": concert.get("setlist_fm_url", "") if artist_id == concert.get("artist_id") else ""})
    return sorted(targets, key=lambda t: (not bool(t["url"]), t["concert_id"], t["artist_id"])), events


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot_root", type=Path)
    parser.add_argument("--work", type=Path, required=True)
    args = parser.parse_args()
    targets, events = targets_for(catalog(args.snapshot_root))
    args.work.mkdir(parents=True, exist_ok=True)
    state = read(args.work / "progress.json", {"records": {}, "related": {}})
    state.update(total_targets=len(targets), total_events=len(events), events=events, catalog_source="Saved production snapshot plus correction/time overlays; live quota blocked")
    fetcher = Fetcher(args.work / "pages")
    sources = {source_key(x): x for x in read(DATA / "setlist-sources.json", [])}
    captures = []

    def checkpoint():
        nonlocal captures
        if captures:
            publish(captures)
            captures = []
        save(DATA / "setlist-sources.json", list(sources.values()))
        state["counts"] = dict(Counter(r["status"] for r in state["records"].values()))
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        save(args.work / "progress.json", state)
        save(DATA.parent / "docs/setlist-fetch-progress.json", state)
        print(json.dumps({"done": len(state["records"]), "total": len(targets), "counts": state["counts"], "requests_this_run": fetcher.requests, "blocked": state.get("blocked")}), flush=True)

    state.pop("blocked", None)
    try:
        for target in targets:
            key = cache_key(target["artist_id"], target["concert_id"])
            if key in state["records"]:
                continue
            result = {**target, "status": "pending"}
            if target["future"]:
                result["status"] = "future"
            else:
                urls = [target["url"]] if "/setlist/" in target["url"] else []
                urls += [u for name, u in state["related"].get(target["concert_id"], []) if norm(name) == norm(target["artist"])]
                searched = False
                matches_found = []
                tried = set()
                while True:
                    for url in dict.fromkeys(urls):
                        if url in tried:
                            continue
                        tried.add(url)
                        try:
                            html = fetcher.get(url)
                            actual = identity(html)
                            if matches(actual, target):
                                state["related"][target["concert_id"]] = related(html, url)
                                item = {"artist_id": target["artist_id"], "concert_id": target["concert_id"], "url": url, "expected": actual}
                                try:
                                    parsed = extract(html, url, actual)
                                    matches_found.append((item, html, parsed))
                                except ValueError as error:
                                    result.update(status="empty_or_parser_review", source_url=url, reason=str(error))
                            else:
                                result.setdefault("rejected_candidates", []).append({"url": url, "actual": actual})
                        except (HTTPError, ValueError, TimeoutError, OSError) as error:
                            result.setdefault("fetch_errors", []).append({"url": url, "reason": str(error)})
                    if matches_found or result["status"] == "empty_or_parser_review" or searched:
                        break
                    urls, search_url = search(fetcher, target)
                    result["search_url"] = search_url
                    searched = True
                    if len(urls) > 8:
                        result.update(status="ambiguous", reason=f"{len(urls)} search candidates")
                        break
                if len(matches_found) == 1:
                    item, html, parsed = matches_found[0]
                    sources[source_key(item)] = item
                    captures.append((item, html))
                    result.update(status="cached", source_url=item["url"], songs=sum(len(s["songs"]) for s in parsed["sets"]))
                elif len(matches_found) > 1:
                    result.update(status="ambiguous", reason="Multiple performances match artist/date/venue", candidates=[i[0]["url"] for i in matches_found])
                elif result["status"] == "pending":
                    result["status"] = "needs_review" if result.get("rejected_candidates") or result.get("fetch_errors") else "no_match"
            state["records"][key] = result
            if len(state["records"]) % 5 == 0:
                checkpoint()
    except Blocked as error:
        state["blocked"] = str(error)
    finally:
        checkpoint()


if __name__ == "__main__":
    main()
