"""Audit a fresh catalog and fill missing, uniquely verified public setlists.

Raw catalog/captures stay in --work; the report omits personal notes and user IDs.
Run one writer only. Existing cache entries and ambiguous performances survive.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import json
import hashlib

from refresh_setlists import DATA, cache_key, publish, read, save, source_key
from seed_setlists import (Fetcher, Blocked, identity, matches, norm, related,
                          search, targets_for as ordinary_targets)
from festival_setlists import (DIRECTORIES, Fetcher as FestivalFetcher,
                              artist_norm, candidate_links, matches_target,
                              targets_for as festival_targets)
from performance_matches import match_performances, source_times
from setlist_page import extract

# The user confirmed the early (7 PM) performance on 2026-10-23.
REVIEWED_SOURCES = {
    'vulfpeck:e5bfv9': 'https://www.setlist.fm/setlist/vulfpeck/2023/the-great-hall-at-avant-gardner-brooklyn-ny-3a1d5db.html',
}

# Reviewed against source stage/venue text and the exact catalog schedule row.
REVIEWED_PERFORMANCES = {
    'aly-aj:yyea3y': {
        'url': 'https://www.setlist.fm/setlist/aly-and-aj/2021/grant-park-chicago-il-usa-238f244f.html',
        'set_id': 'ogps0c', 'reason': 'Source scheduled and actual starts are 13:00, exactly matching the catalog. The competing page explicitly identifies the second set at Toyota Music Den.'},
    'jessia:yyea3y': {
        'url': 'https://www.setlist.fm/setlist/jessia/2021/grant-park-chicago-il-usa-5b8afb28.html',
        'set_id': 'vcwp6e', 'reason': 'Source explicitly identifies the first show and gives scheduled and actual starts of 13:00, exactly matching this catalog row. The other page has no songs or timing evidence.'},
    'death-cab-for-cutie:xuwdm1': {
        'url': 'https://www.setlist.fm/setlist/death-cab-for-cutie/2026/golden-gate-park-san-francisco-ca-usa-3349a4e1.html',
        'set_id': '6c9iap', 'reason': 'Source is the Sutro evening show, scheduled 20:45 within the catalog evening slot 20:25-21:40. The separate daytime show is scheduled 12:40 and already matched.'},
    'bandalos-chinos:xuwdm1': {
        'url': 'https://www.setlist.fm/setlist/bandalos-chinos/2026/golden-gate-park-san-francisco-ca-usa-2349a407.html',
        'set_id': 'f4tnny', 'reason': 'Source explicitly names Lands End and a 12:10 scheduled start, matching this row rather than the separate Duboce Triangle appearance.'},
    'usted-senalemelo:ub5qri': {
        'url': 'https://www.setlist.fm/setlist/usted-senalemelo/2023/grant-park-chicago-il-usa-73a40e6d.html',
        'set_id': 'ppt9ul', 'reason': 'Source venue Bacardi Stage matches the schedule. The other page explicitly identifies a second show at Toyota Stage.'},
    'michelle:ub5qri': {
        'url': 'https://www.setlist.fm/setlist/michelle/2023/grant-park-chicago-il-usa-3ba4000c.html',
        'set_id': 'uxq6ip', 'reason': 'Source venue is Bacardi Stage, matching the scheduled Bacardi appearance; the other page is BMI Stage.'},
    'model-actriz:3s9mjj': {
        'url': 'https://www.setlist.fm/setlist/modelactriz/2024/sala-apolo-barcelona-spain-4ba8ebb2.html',
        'set_id': 'zff1xg', 'reason': 'Source venue Sala Apolo matches this schedule row; the other performance is at Parc del Forum / Plenitude.'},
    'the-beaches:7zj1wf': {
        'url': 'https://www.setlist.fm/setlist/the-beaches/2025/flushing-meadows-corona-park-queens-ny-usa-435ddf47.html',
        'set_id': '9rs6b5', 'reason': 'Source reports a 17:00 actual start within the 16:45-17:30 scheduled slot. The other page explicitly identifies the separate 15:00 Kona Big Wave set.'},
}


def ordinary_match(actual, target):
    # The current catalog uses the venue's short name; setlist.fm retains its
    # former/full name. Keep these explicit, never fuzzy-match venues.
    aliases = {'The Masonic': 'Masonic Auditorium', 'Oakland Arena': 'Oracle Arena'}
    # The attendee recording identifies Victor Wooten, Dennis Chambers and Bob
    # Franceschini at the Regency on 2018-01-12. This exception is show-specific.
    # https://www.tedtoob.com/2018-ted-toob-archives
    if (target.get('artist_id'), target.get('concert_id')) == ('victor-wooten', 'e171as'):
        target = {**target, 'artist': 'Victor Wooten Trio'}
    return matches(actual, {**target, 'venue': aliases.get(target['venue'], target['venue'])}) or matches(actual, target)


def audit(catalog, username, work, report):
    cat = read(catalog, {})
    profile = cat['users'][username]
    logs = {v['concert_id']: v for v in cat['user_concerts'].values() if v['user_id'] == profile['user_id']}
    cache = read(DATA / 'cached.setlist.fm.json', {})
    sources = {source_key(v): v for v in read(DATA / 'setlist-sources.json', [])}
    sources_dirty = False
    old = read(DATA.parent / 'docs/setlist-fetch-progress.json', {}).get('records', {})
    state = read(work / 'progress.json', {'records': {}, 'directories': {}, 'related': {}, 'added': []})
    state.pop('blocked', None)
    state.update(username=username, catalog_fetched_date='2026-10-23', catalog_events=len(cat['concerts']),
                 visible_events=sum(not logs.get(cid, {}).get('removed') for cid in cat['concerts']),
                 methodology='Audit current cache for every catalog performance; recheck missing visible, noncancelled performances against public pages. Existing songs are retained without claiming a fresh source fetch.')
    fetcher = Fetcher(work / 'pages')
    festival_fetcher = FestivalFetcher(work)
    ordinary, events = ordinary_targets(cat)
    ordinary = [t for t in ordinary if t['concert_id'] not in cat['schedules']]
    festivals = festival_targets(cat)
    state['events_without_performance_targets'] = [e for e in events if e['missing_headliner'] and e['concert_id'] not in cat['schedules'] and not cat['concerts'][e['concert_id']].get('supporting_artist_ids')]
    musicals = read(DATA / 'cached.musicals.json', {})
    for event in state['events_without_performance_targets']:
        log = logs.get(event['concert_id'], {})
        event['status'] = ('hidden' if log.get('removed') else 'cancelled' if log.get('ticket_status') == 'cancelled'
                           else 'future' if event['future'] else 'existing_musical_program' if event['concert_id'] in musicals
                           else 'no_identified_performer')
    state['total_artist_concert_targets'] = len(ordinary) + len(festivals)

    def checkpoint():
        nonlocal sources_dirty
        state['updated_at'] = datetime.now(timezone.utc).isoformat()
        state['counts'] = dict(Counter(v['status'] for v in state['records'].values()))
        save(work / 'progress.json', state)
        save(report, {k: v for k, v in state.items() if k not in ('related', 'directories')})
        if sources_dirty:
            save(DATA / 'setlist-sources.json', list(sources.values()))
            sources_dirty = False

    def accept(items):
        nonlocal sources_dirty
        if not items:
            return
        capture_times = {item['url']: datetime.fromtimestamp((work / 'pages' / (hashlib.sha256(item['url'].encode()).hexdigest() + '.html')).stat().st_mtime, timezone.utc).isoformat() for item, _ in items}
        publish(items, capture_times=capture_times)
        for item, html in items:
            sources[source_key(item)] = item
            sources_dirty = True
            state['added'].append({'key': source_key(item), 'url': item['url'],
                                   'songs': sum(len(s['songs']) for s in extract(html, item['url'], item['expected'])['sets'])})

    def excluded(target):
        log = logs.get(target['concert_id'], {})
        return 'hidden' if log.get('removed') else 'cancelled' if log.get('ticket_status') == 'cancelled' or target.get('excluded') else None

    def record(key, target, status, **extra):
        state['records'][key] = {**target, 'status': status, **extra}
        if status not in ('existing', 'future', 'hidden', 'cancelled', 'absent_from_directory') or len(state['records']) % 30 == 0:
            checkpoint()
        print(json.dumps({'done': len(state['records']), 'total': state['total_artist_concert_targets'],
                          'artist': target['artist'], 'status': status, 'added': len(state['added'])}, ensure_ascii=False), flush=True)

    # Prioritize new shows and corrected venue identities, then revisit every gap.
    ordinary.sort(key=lambda t: (old.get(cache_key(t['artist_id'], t['concert_id']), {}).get('status', 'new') not in ('new', 'needs_review', 'future'), t['concert_id'], t['artist_id']))
    try:
        for target in ordinary:
            key = cache_key(target['artist_id'], target['concert_id'])
            if key in state['records']:
                continue
            existing = [v for v in cache.get(key, []) if not v.get('set_id') and any(s['songs'] for s in v['sets'])]
            status = excluded(target) or ('future' if target['future'] else None)
            if existing or status:
                record(key, target, status or 'existing', performances=len(existing))
                continue
            prior = old.get(key, {})
            urls = [target['url']] if '/setlist/' in target['url'] else []
            urls += [prior['source_url']] if prior.get('source_url') else []
            urls += prior.get('candidates', [])
            urls += [v['url'] for v in prior.get('rejected_candidates', [])]
            urls += [u for name, u in state['related'].get(target['concert_id'], []) if norm(name) == norm(target['artist'])]
            if key in REVIEWED_SOURCES:
                urls = [REVIEWED_SOURCES[key]]
            found, empty, rejected, errors, seen = [], [], [], [], set()
            searched = False
            search_url = None
            while True:
                for url in dict.fromkeys(urls):
                    if url in seen or not isinstance(url, str):
                        continue
                    seen.add(url)
                    try:
                        html = fetcher.get(url)
                        actual = identity(html)
                        if not ordinary_match(actual, target):
                            rejected.append({'url': url, 'actual': actual})
                            continue
                        state['related'][target['concert_id']] = related(html, url)
                        item = {'artist_id': target['artist_id'], 'concert_id': target['concert_id'], 'url': url, 'expected': actual}
                        try:
                            extract(html, url, actual)
                            found.append((item, html))
                        except ValueError as error:
                            empty.append({'url': url, 'reason': str(error)})
                    except (ValueError, OSError) as error:
                        errors.append({'url': url, 'reason': str(error)})
                if found or empty or searched:
                    break
                urls, search_url = search(fetcher, target)
                searched = True
                if len(urls) > 8:
                    errors.append({'reason': 'More than eight candidates; manual review needed', 'urls': urls})
                    break
            status = 'cached' if len(found) == 1 and not empty and not errors else 'ambiguous' if len(found) > 1 or (found and empty) else 'empty' if empty else 'needs_review' if rejected or errors else 'no_match'
            if key == 'lawrence:oaapht':
                # User attended the 10:30 PM show. The only located page is
                # explicitly 7 PM; the band advertised different sets.
                # https://lawrencetheband.com/nye-city-winery
                status = 'needs_review'
            if status == 'cached':
                accept(found)
            record(key, target, status, source_urls=[v[0]['url'] for v in found], empty=empty, rejected=rejected, errors=errors, search_url=search_url, search_verified=searched,
                   **({'match_basis': 'User confirmed the early (7 PM) show on 2026-10-23'} if key in REVIEWED_SOURCES else {}),
                   **({'match_basis': 'User confirmed the late (10:30 PM) show on 2026-10-23; the available 7 PM setlist was excluded', 'corroboration_url': 'https://lawrencetheband.com/nye-city-winery'} if key == 'lawrence:oaapht' else {}))

        # Fetch complete festival directories to discover new and previously absent pages.
        for cid, suffix in DIRECTORIES.items():
            if cid not in cat['schedules'] or excluded({'concert_id': cid}):
                continue
            if cid not in state['directories']:
                url = 'https://www.setlist.fm/festival/' + suffix
                links = candidate_links(festival_fetcher.get(url), url)
                state['directories'][cid] = {'url': url, 'links': links}
                checkpoint()
        festivals.sort(key=lambda t: (t['concert_id'] != 'f3ysgl', t['concert_id'], t['artist']))
        for target in festivals:
            key = target['key']
            if key in state['records']:
                continue
            existing = [v for v in cache.get(key, []) if any(s['songs'] for s in v['sets'])]
            existing_ids = {v.get('set_id') for v in existing}
            status = excluded(target)
            if status or all(s['set_id'] in existing_ids for s in target['sets']):
                record(key, target, status or 'existing', performances=len(existing))
                continue
            directory = state['directories'].get(target['concert_id'])
            if not directory:
                record(key, target, 'needs_review', reason='No verified festival directory')
                continue
            candidates = [v for v in directory['links'] if artist_norm(v['artist']) == artist_norm(target['artist'])]
            found, empty, rejected, pages = [], [], [], []
            for candidate in candidates:
                url = candidate['url']
                html = festival_fetcher.get(url)
                actual = identity(html)
                if not matches_target(actual, target, html, directory['url']):
                    rejected.append({'url': url, 'actual': actual})
                    continue
                pages.append({'url': url, **actual, **source_times(html)})
                item = {'artist_id': target['artist_id'], 'concert_id': target['concert_id'], 'url': url, 'expected': actual}
                try:
                    extract(html, url, actual)
                    found.append((item, html))
                except ValueError as error:
                    empty.append({'url': url, 'reason': str(error)})
            bindings = match_performances(target['sets'], pages, target['timezone'])
            reviewed = REVIEWED_PERFORMANCES.get(key)
            if reviewed and any(p['url'] == reviewed['url'] for p in pages) and any(s['set_id'] == reviewed['set_id'] for s in target['sets']):
                bindings[reviewed['url']] = reviewed['set_id']
            accepted = [({**item, 'set_id': bindings[item['url']]}, html) for item, html in found if item['url'] in bindings and bindings[item['url']] not in existing_ids]
            accept(accepted)
            held = [v['url'] for v in pages if v['url'] not in bindings]
            status = ('cached' if len(accepted) + len(existing_ids) == len(target['sets']) else 'partial') if accepted else 'ambiguous' if held else 'empty' if empty else 'needs_review' if rejected else 'absent_from_directory'
            gap_status = status
            if existing and status != 'cached':
                status = 'partial'
            record(key, target, status, added_performances=len(accepted), existing_performances=len(existing), candidate_urls=[v['url'] for v in candidates], held_urls=held, empty=empty, rejected=rejected, directory_url=directory['url'], **({'remaining_gap_status': gap_status} if status == 'partial' else {}), **({'match_basis': reviewed['reason']} if reviewed else {}))
        state['complete'] = len(state['records']) == state['total_artist_concert_targets']
        state.pop('blocked', None)
    except (Blocked, ValueError, OSError) as error:
        state['blocked'] = str(error)
        print('STOPPED: ' + str(error), flush=True)
    finally:
        checkpoint()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--username', required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    audit(args.catalog, args.username, args.work, args.report)
