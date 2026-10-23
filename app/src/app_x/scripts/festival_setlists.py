"""Resumable festival public-page research; preserve the artist:concert cache contract.

Directories are explicit reviewed URLs. HTTP challenges halt the whole pass.
Repeated artists publish only when each source maps uniquely to one schedule set. No API, authentication, database writes, or challenge bypass is used.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from refresh_setlists import source_key, DATA, cache_key, publish, read, save
from seed_setlists import Blocked, identity, norm
from setlist_page import Tree, text, extract
from performance_matches import match_performances

DIRECTORIES = {
    'f3ysgl': '2021/outside-lands-music-and-arts-festival-2021-2bd48ce2.html',
    '8nhjof': '2018/outside-lands-music-and-arts-festival-2018-3bd7f034.html',
    'brv1d9': '2019/outside-lands-music-and-arts-festival-2019-63d726d7.html',
    'xuwdm1': '2026/outside-lands-music-and-arts-festival-2026-5bd503b8.html',
    'c26k26': '2021/bottlerock-napa-valley-2021-3bd49898.html',
    '37a4hj': '2019/nos-alive-2019-53d72fe1.html',
    '3s9mjj': '2024/primavera-sound-2024-73d4465d.html',
    'ub5qri': '2023/lollapalooza-2023-bd4017e.html',
    'yyea3y': '2021/lollapalooza-2021-23d4a017.html',
    'fuaiif': '2024/kilby-block-party-2024-23d44883.html',
    '81bzyp': '2019/sonoma-harvest-music-festival-2019-weekend-2-6bd71a46.html',
    'cy53a8': '2024/governors-ball-2024-bd44936.html',
    '7zj1wf': '2025/governors-ball-2025-73d5fa4d.html',
    '65mer9': '2025/all-things-go-nyc-2025-23d540d3.html',
}


# Reviewed name variants only. No fuzzy matching or broad suffix stripping.
ARTIST_ALIASES = {
    'AJNA (US)': 'Ajna',
    'Altin Gün': 'Altın Gün',
    'Full Moonalice': 'Moonalice',
    'JD Twitch (Optimo)': 'JD Twitch',
    'Luttrell': 'Eric Luttrell',
    'Mob Rich': 'Moby Rich',
    'Petey': 'Petey USA',
    'TAGABOW': 'They Are Gutting a Body of Water',
    'SF Gay Men’s Chorus': 'San Francisco Gay Men’s Chorus',
    'ODD MOB & OMNOM present HYPERBEAM': 'HYPERBEAM',
    'Subtronics and GRiZ present GRIZTRONICS': 'GRiZ & Subtronics',
    'Yousuke Yukimatsu (¥ØU$UK€ ¥UK1MAT$U)': '¥ØU$UK€ ¥UK1MAT$U',
}


def artist_norm(value):
    aliases = {norm(k): norm(v) for k, v in ARTIST_ALIASES.items()}
    return aliases.get(norm(value), norm(value))


def targets_for(catalog):
    targets = []
    for cid, schedule in catalog['schedules'].items():
        concert = catalog['concerts'][cid]
        venue = catalog['venues'].get(concert.get('venue_id'), {})
        groups = defaultdict(list)
        for sid, item in schedule['sets'].items():
            groups[item['artist_id']].append({'set_id': sid, **item})
        for aid, sets in groups.items():
            dates = set()
            for item in sets:
                if item.get('day'):
                    dates.add(item['day'])
                if item.get('start'):
                    dates.add(datetime.fromisoformat(item['start'].replace('Z', '+00:00')).astimezone(ZoneInfo(venue.get('timezone', 'UTC'))).date().isoformat())
            targets.append({'key': cache_key(aid, cid), 'artist_id': aid, 'concert_id': cid,
                'artist': catalog['artists'][aid]['name'], 'festival': concert['name'],
                'sets': sets, 'dates': sorted(dates), 'start_date': concert['date'][:10],
                'end_date': concert.get('end_date', concert['date'][:10]),
                'timezone': venue.get('timezone', 'UTC'), 'repeated': len(sets) > 1, 'excluded': cid == 'hwtzpg'})
    return targets


def candidate_links(html, url):
    root = Tree(html).root
    if not root.first(lambda n: n.tag == 'h1' and 'Setlists' in text(n)):
        raise ValueError('Festival directory heading missing')
    links = {}
    for node in root.all(lambda n: n.tag == 'a' and '/setlist/' in n.attrs.get('href', '')):
        link = urljoin(url, node.attrs['href'])
        links[link] = {'artist': text(node), 'url': link}
    declared = re.search(r'Showing\s*(\d+)\s*setlists', root.text())
    if declared and len(links) != int(declared.group(1)):
        raise ValueError(f'Incomplete directory DOM: {len(links)} of {declared.group(1)} setlists rendered')
    if not links:
        raise ValueError('Festival directory has no setlist links; review instead of claiming absence')
    return list(links.values())


def matches_target(actual, target, html, directory):
    if artist_norm(actual['artist']) != artist_norm(target['artist']):
        return False
    dates = target['dates']
    if dates and actual['event_date'] not in dates:
        return False
    if not dates and not target['start_date'] <= actual['event_date'] <= target['end_date']:
        return False
    # Exact festival backlink grounds stage and satellite-venue membership.
    path = urlparse(directory).path
    return any(urlparse(urljoin(directory, n.attrs.get('href', ''))).path == path
               for n in Tree(html).root.all(lambda n: n.tag == 'a'))


class Fetcher:
    def __init__(self, work):
        self.work = work
        self.folder = work / 'pages'
        self.folder.mkdir(parents=True, exist_ok=True)
        self.last = 0
        self.capture_times = {}

    def get(self, url):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != 'www.setlist.fm' or not parsed.path.startswith(('/festival/', '/setlist/')):
            raise ValueError('Unexpected public source URL')
        path = self.folder / (hashlib.sha256(url.encode()).hexdigest() + '.html')
        if path.exists():
            html = path.read_text()
        else:
            time.sleep(max(0, 2 - (time.monotonic() - self.last)))
            self.last = time.monotonic()
            try:
                request = Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'en'})
                with urlopen(request, timeout=30) as response:
                    if urlparse(response.url).netloc != parsed.netloc:
                        raise ValueError('Unexpected redirect')
                    html = response.read().decode()
            except HTTPError as error:
                if error.code in (403, 429):
                    raise Blocked(f'HTTP {error.code}: {url}') from error
                raise
        # WAF library names also occur in normal rendered pages. Require the
        # real source structure, instead of treating a library script as a gate.
        try:
            candidate_links(html, url) if parsed.path.startswith('/festival/') else identity(html)
        except ValueError as error:
            if any(s in html for s in ('awsWafCookieDomainList', 'gokuProps', 'Just a moment...', 'Verify you are human')):
                raise Blocked(f'Access challenge: {url}') from error
            raise
        if not path.exists():
            path.write_text(html)
        self.capture_times[url] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
        return html


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--offline', action='store_true', help='Analyze saved captures only, without new requests')
    args = parser.parse_args()
    targets = targets_for(read(args.catalog, {}))
    args.work.mkdir(parents=True, exist_ok=True)
    state = read(args.work / 'progress.json', {'directories': {}, 'pages': {}, 'records': {}})
    if args.offline and state.get('blocked', '').startswith('Access challenge:'):
        state['http_access_block'] = state.pop('blocked')
    current_keys = {t['key'] for t in targets}
    state['records'] = {k: v for k, v in state['records'].items() if k in current_keys and not (v.get('status') == 'absent_from_directory' and v.get('artist') in ARTIST_ALIASES)}
    state.update(total_schedule_rows=sum(len(t['sets']) for t in targets), total_artist_concert_pairs=len(targets),
                 retrieval='Ordinary public HTML; no music API; stop on access challenge')
    fetcher = Fetcher(args.work)
    sources = {source_key(s): s for s in read(DATA / 'setlist-sources.json', [])}

    def checkpoint():
        state['counts'] = dict(Counter(r['status'] for r in state['records'].values()))
        state['updated_at'] = datetime.now(timezone.utc).isoformat()
        save(args.work / 'progress.json', state)
        save(DATA.parent / 'docs/festival-setlist-progress.json', state)
        save(DATA / 'setlist-sources.json', list(sources.values()))
        print(json.dumps({'counts': state['counts'], 'directories': len(state['directories']), 'visited_pages': len(state['pages']), 'blocked': state.get('blocked')}), flush=True)

    def get(url):
        if args.offline and not (fetcher.folder / (hashlib.sha256(url.encode()).hexdigest() + '.html')).exists():
            raise Blocked('Offline capture unavailable: ' + url)
        return fetcher.get(url)

    try:
        # Discover every edition before fetching individual performances.
        for cid, suffix in DIRECTORIES.items():
            if cid not in state['directories']:
                url = 'https://www.setlist.fm/festival/' + suffix
                links = candidate_links(get(url), url)
                state['directories'][cid] = {'url': url, 'links': links}
                checkpoint()
        for target in targets:
            key = target['key']
            if state['records'].get(key, {}).get('status') not in (None, 'unvisited', 'blocked'):
                continue
            if target['excluded']:
                state['records'][key] = {**target, 'status': 'excluded_cancelled'}
                continue
            directory = state['directories'][target['concert_id']]
            candidates = [x for x in directory['links'] if artist_norm(x['artist']) == artist_norm(target['artist'])]
            unavailable = [x['url'] for x in candidates if not (fetcher.folder / (hashlib.sha256(x['url'].encode()).hexdigest() + '.html')).exists()]
            if args.offline and unavailable:
                state['records'][key] = {**target, 'status': 'unvisited', 'candidate_urls': [x['url'] for x in candidates], 'remaining_urls': unavailable}
                continue
            found, empty, rejected = [], [], []
            for candidate in candidates:
                url = candidate['url']
                html = get(url)
                actual = identity(html)
                state['pages'][url] = {'identity': actual}
                if not matches_target(actual, target, html, directory['url']):
                    rejected.append({'url': url, 'actual': actual})
                    continue
                item = {'artist_id': target['artist_id'], 'concert_id': target['concert_id'], 'url': url, 'expected': actual}
                try:
                    parsed = extract(html, url, actual)
                    found.append((item, html, parsed))
                except ValueError as error:
                    empty.append({'url': url, 'reason': str(error)})
            result = {**target, 'directory_url': directory['url'], 'candidate_urls': [x['url'] for x in candidates]}
            if rejected:
                result['rejected'] = rejected
            if empty:
                result['empty_or_parser_review'] = empty
            matched_pages = [{'url': item['url'], **item['expected']} for item, _, _ in found]
            matched_pages += [{'url': entry['url'], **state['pages'][entry['url']]['identity']} for entry in empty]
            bindings = match_performances(target['sets'], matched_pages, target['timezone'])
            accepted = [({**item, 'set_id': bindings[item['url']]}, html, parsed)
                        for item, html, parsed in found if item['url'] in bindings]
            if accepted:
                publish([(item, html) for item, html, _ in accepted], capture_times=fetcher.capture_times)
                for item, _, _ in accepted:
                    sources[source_key(item)] = item
                result.update(status='cached' if len(accepted) == len(target['sets']) else 'partial',
                              performances=[{'set_id': item['set_id'], 'url': item['url']} for item, _, _ in accepted],
                              songs=sum(len(s['songs']) for _, _, parsed in accepted for s in parsed['sets']))
            elif any(page['url'] not in bindings for page in matched_pages):
                result.update(status='ambiguous', reason='No unique schedule-set/source match', matched_urls=[x[0]['url'] for x in found])
            elif empty:
                result['status'] = 'empty_or_parser_review'
            elif rejected:
                result['status'] = 'identity_review'
            else:
                result['status'] = 'absent_from_directory'
            if matched_pages:
                result['held_urls'] = [page['url'] for page in matched_pages if page['url'] not in bindings]
            state['records'][key] = result
            checkpoint()
    except Blocked as error:
        state['blocked'] = str(error)
    except (ValueError, OSError) as error:
        state['error'] = str(error)
    finally:
        for target in targets:
            state['records'].setdefault(target['key'], {**target, 'status': 'excluded_cancelled' if target['excluded'] else 'unvisited'})
        checkpoint()


if __name__ == '__main__':
    main()
