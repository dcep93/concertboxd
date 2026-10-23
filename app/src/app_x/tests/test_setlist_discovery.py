import sys
import unittest
import tempfile
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from seed_setlists import Blocked, validate_public_page
from audit_user_setlists import ordinary_match
from performance_matches import match_performances, source_times
from test_setlist_cache import HTML, URL
from refresh_setlists import save


class PublicPageValidationTests(unittest.TestCase):
    def test_explicit_source_stages_distinguish_same_day_appearances(self):
        slots = [{'set_id':'main','day':'2026-08-09','stage':'Sutro'}, {'set_id':'small','day':'2026-08-09','stage':'Duboce Triangle'}]
        pages = [{'url':'main-page','event_date':'2026-08-09','venue':'Sutro, Golden Gate Park, San Francisco, CA, USA'},
                 {'url':'small-page','event_date':'2026-08-09','venue':'Duboce Triangle, Golden Gate Park, San Francisco, CA, USA'}]
        self.assertEqual(match_performances(slots, pages), {'main-page':'main','small-page':'small'})
        self.assertEqual(match_performances(slots, [{**pages[0],'venue':'Golden Gate Park'}]), {})

    def test_multiple_source_pages_for_one_scheduled_performance(self):
        slot = {'set_id': 'main', 'day': '2025-06-07', 'start': '2025-06-07T18:15:00-04:00', 'end': '2025-06-07T19:00:00-04:00'}
        pages = [{'url': 'main-page', 'event_date': '2025-06-07', 'scheduled_time': '18:15'},
                 {'url': 'acoustic-page', 'event_date': '2025-06-07', 'scheduled_time': '20:15'}]
        self.assertEqual(match_performances([slot], pages, 'America/New_York'), {'main-page': 'main'})
        self.assertEqual(match_performances([{k:v for k,v in slot.items() if k not in ('start','end')}], pages, 'America/New_York'), {})

    def test_reviewed_ensemble_identity_is_scoped_to_one_show(self):
        target = {'artist_id': 'victor-wooten', 'concert_id': 'e171as', 'artist': 'Victor Wooten', 'event_date': '2018-01-12', 'venue': 'The Regency Ballroom'}
        actual = {**target, 'artist': 'Victor Wooten Trio', 'venue': 'The Regency Ballroom, San Francisco, CA, USA'}
        self.assertTrue(ordinary_match(actual, target))
        self.assertFalse(ordinary_match(actual, {**target, 'concert_id': 'other'}))

    def test_transient_windows_reader_lock_preserves_atomic_save(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / 'report.json'
            destination.write_text('old')
            replace = Path.replace
            attempts = []
            def locked_once(source, target):
                attempts.append(source)
                if len(attempts) == 1:
                    self.assertEqual(destination.read_text(), 'old')
                    raise PermissionError('reader still open')
                return replace(source, target)
            with patch.object(Path, 'replace', locked_once), patch('refresh_setlists.time.sleep'):
                save(destination, {'new': True})
            self.assertIn('true', destination.read_text())
            self.assertEqual(len(attempts), 2)

    def test_repeat_slots_require_unambiguous_time_evidence(self):
        sets = [{'set_id': 'early', 'day': '2021-10-29', 'start': '2021-10-29T13:25:00-07:00', 'end': '2021-10-29T14:10:00-07:00'},
                {'set_id': 'late', 'day': '2021-10-29', 'start': '2021-10-29T16:25:00-07:00', 'end': '2021-10-29T16:55:00-07:00'}]
        page = {'url': 'source', 'event_date': '2021-10-29'}
        self.assertEqual(match_performances(sets, [page], 'America/Los_Angeles'), {})
        self.assertEqual(match_performances(sets, [{**page, 'scheduled_time': '13:25'}], 'America/Los_Angeles'), {'source': 'early'})
        self.assertEqual(match_performances(sets, [{**page, 'start_time': '16:30'}], 'America/Los_Angeles'), {'source': 'late'})
        self.assertEqual(match_performances(sets, [{**page, 'scheduled_time': '12:00', 'start_time': '16:30'}], 'America/Los_Angeles'), {})
        self.assertEqual(match_performances(sets, [{**page, 'scheduled_time': '13:25'}, {**page, 'url': 'second'}], 'America/Los_Angeles'), {})

    def test_source_times_ignore_doors_and_conflicting_duplicates(self):
        html = '<div class="setTimesTimeline"><div class="doors"><strong>11:00 AM</strong></div><div class="scheduled"><strong>1:25 PM</strong></div></div>'
        self.assertEqual(source_times(html), {'scheduled_time': '13:25'})
        self.assertEqual(source_times(html + html.replace('1:25 PM', '4:25 PM')), {})

    def test_normal_setlist_with_security_library_is_not_blocked(self):
        validate_public_page(HTML + '<script>const awsWafCookieDomainList = [];</script>', URL)

    def test_real_challenge_stops_discovery(self):
        with self.assertRaises(Blocked):
            validate_public_page('<script>gokuProps = {};</script><h1>Verify you are human</h1>', URL)

    def test_search_requires_results_or_explicit_absence(self):
        url = 'https://www.setlist.fm/search?query=example'
        for href in ('setlist/a/2024/a-123.html', '/setlist/a/2024/a-123.html'):
            validate_public_page(f'<h2><a href="{href}">Artist at Venue</a></h2>', url)
        validate_public_page('<p>Your search did not match any setlists.</p>', url)
        with self.assertRaises(ValueError):
            validate_public_page('<h1>Search</h1><p>Loading</p>', url)

    def test_alias_does_not_relax_artist_date_or_other_venue(self):
        target = {'artist': 'Rise Against', 'event_date': '2021-08-22', 'venue': 'The Masonic'}
        actual = {**target, 'venue': 'Masonic Auditorium, San Francisco, CA, USA'}
        self.assertTrue(ordinary_match(actual, target))
        self.assertFalse(ordinary_match({**actual, 'artist': 'Other Artist'}, target))
        self.assertFalse(ordinary_match({**actual, 'event_date': '2021-08-23'}, target))
        self.assertFalse(ordinary_match({**actual, 'venue': 'Bill Graham Civic Auditorium'}, target))


if __name__ == '__main__':
    unittest.main()
