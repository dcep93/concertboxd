"""Refresh explicitly matched public pages; no API, credentials or database writes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
from setlist_page import extract, compact

DATA = Path(__file__).resolve().parents[1] / "data"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def cache_key(artist_id, concert_id):
    # Same safe characters as JavaScript encodeURIComponent.
    return ":".join(quote(v, safe="~()*!.'-") for v in (artist_id, concert_id))


def read(path, fallback):
    return json.loads(path.read_text()) if path.exists() else fallback


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(canonical(value), encoding="utf-8")
    # Windows can briefly deny replacement while a report reader has the old
    # file open. Retry the atomic rename; never truncate the destination.
    for attempt in range(8):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.025 * 2 ** attempt)


def source_key(item):
    return cache_key(item['artist_id'], item['concert_id']) + (':' + item['set_id'] if item.get('set_id') else '')


def publish(captures, output=DATA, fetched_at=None, set_ids=None, capture_times=None):
    """Upsert reviewed performances; optional bindings migrate existing festival rows.

    Schema 4 hashes the complete performance array. Old immutable revisions are
    retained, while per-source fetch provenance stays separate from processing.
    """
    fetched_at = fetched_at or datetime.now(timezone.utc).isoformat()
    capture_times = capture_times or {}
    set_ids = set_ids or {}
    cache_path = output / 'cached.setlist.fm.json'
    metadata_path = output / 'cached.setlist.fm.meta.json'
    cache = read(cache_path, {})
    meta = read(metadata_path, {'schema_version': 4, 'parser_version': 3, 'entries': {}})
    changed = set()
    if meta['schema_version'] in (1, 2, 3):
        cache = {key: [compact(value) if meta['schema_version'] < 3 else value] for key, value in cache.items()}
        for key, values in cache.items():
            entry = meta['entries'][key]
            old_hash = entry.pop('source_html_sha256', None)
            entry['sources'] = {values[0]['url']: {
                **({'html_sha256': old_hash} if old_hash else {}),
                'last_fetched_at': entry['last_fetched_at'],
            }}
        changed.update(cache)
        meta.update(schema_version=4, parser_version=3)
    if meta['schema_version'] != 4 or meta['parser_version'] != 3:
        raise ValueError('Unsupported cache format; migrate explicitly')
    for key, sid in set_ids.items():
        if key not in cache or len(cache[key]) != 1:
            raise ValueError('Festival binding requires exactly one existing performance: ' + key)
        previous = cache[key][0].get('set_id')
        if previous and previous != sid:
            raise ValueError('Cannot reassign an existing performance: ' + key)
        if not previous:
            cache[key][0]['set_id'] = sid
            changed.add(key)
    seen = set()
    for item, html in captures:
        key = cache_key(item['artist_id'], item['concert_id'])
        sid = item.get('set_id')
        identity_key = (key, sid)
        if identity_key in seen:
            raise ValueError(f'Duplicate manifest performance: {identity_key}')
        seen.add(identity_key)
        parsed = extract(html, item['url'], item['expected'])
        if sid:
            import re
            if not re.fullmatch('[a-z0-9]{6}', sid):
                raise ValueError('Invalid schedule set_id')
            parsed['set_id'] = sid
        existing = cache.setdefault(key, [])
        if any(bool(value.get('set_id')) != bool(sid) for value in existing):
            raise ValueError('Cannot mix scheduled and ordinary performances: ' + key)
        if any(value['url'] == item['url'] and value.get('set_id') != sid for value in existing):
            raise ValueError('One source URL cannot represent multiple scheduled sets')
        index = next((i for i, value in enumerate(existing) if value.get('set_id') == sid), None)
        if index is None:
            existing.append(parsed)
        else:
            existing[index] = parsed
        existing.sort(key=lambda value: (value.get('set_id', ''), value['url']))
        captured_at = capture_times.get(item['url'], fetched_at)
        entry = meta['entries'].setdefault(key, {'first_fetched_at': captured_at, 'revisions': [], 'sources': {}})
        entry.setdefault('sources', {})[item['url']] = {'html_sha256': digest(html.encode()), 'last_fetched_at': captured_at}
        entry['last_fetched_at'] = (max((source['last_fetched_at'] for source in entry['sources'].values()), key=datetime.fromisoformat)
                                    if capture_times else fetched_at)
        changed.add(key)
    archives = []
    for key in changed:
        content_hash = digest(canonical(cache[key]).encode())
        entry = meta['entries'][key]
        entry.update(content_sha256=content_hash, last_processed_at=fetched_at)
        if not any(r['sha256'] == content_hash for r in entry['revisions']):
            entry['revisions'].append({'sha256': content_hash, 'first_seen_at': fetched_at})
        path = output / 'setlist-history' / (content_hash + '.json')
        if path.exists() and path.read_text() != canonical(cache[key]):
            raise ValueError('Archived revision content does not match its hash')
        archives.append((path, cache[key]))
    # Finish all parsing, matching and archive verification before publishing.
    for path, value in archives:
        if not path.exists():
            save(path, value)
    save(metadata_path, meta)
    save(cache_path, cache)
    return {key: sum(len(s['songs']) for p in cache[key] for s in p['sets']) for key in sorted({key for key, _ in seen})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--html-dir", type=Path, help="Use captured <artist_id>[-<set_id>].html files offline")
    args = parser.parse_args()
    captures = []
    capture_times = {}
    for item in read(args.manifest, []):
        if args.html_dir:
            path = args.html_dir / (item["artist_id"] + ("-" + item["set_id"] if item.get("set_id") else "") + ".html")
            html = path.read_text()
            capture_times[item['url']] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
        else:
            # Only explicit public page URLs; never arbitrary manifest destinations.
            if not item["url"].startswith("https://www.setlist.fm/setlist/"):
                raise ValueError("Only public setlist.fm pages are supported")
            if captures:
                time.sleep(2)
            request = Request(item["url"], headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html", "Accept-Language": "en"})
            with urlopen(request, timeout=30) as response:
                if not response.url.startswith("https://www.setlist.fm/setlist/"):
                    raise ValueError("Unexpected redirect; stop and review")
                html = response.read().decode("utf-8")
        captures.append((item, html))
    print(json.dumps(publish(captures, capture_times=capture_times), indent=2))


if __name__ == "__main__":
    main()
