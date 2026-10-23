import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from audit_user_setlists import verified_empty_links
from test_setlist_cache import HTML, URL

EMPTY = {'url': URL, 'reason': 'No reported songs; retain previous data and review this page'}
TARGET = {'artist': 'Example', 'venue': 'Venue', 'event_date': '2024-09-21',
          'status': 'empty', 'empty': [EMPTY]}


class SetlistLinkTests(unittest.TestCase):
    def test_only_verified_single_show_pages_become_fallbacks(self):
        self.assertEqual(verified_empty_links({'a:c': TARGET}, lambda _: HTML), {'a:c': [{'url': URL}]})
        for change in [{'artist': 'Other'}, {'venue': 'Elsewhere'}, {'event_date': '2024-09-22'},
                       {'status': 'needs_review'}, {'status': 'ambiguous'}, {'status': 'hidden'},
                       {'status': 'cancelled'}, {'status': 'future'}, {'errors': ['Unavailable candidate']},
                       {'empty': [EMPTY, {**EMPTY, 'url': URL + '?second'}]},
                       {'source_urls': ['different-full-setlist']},
                       {'empty': [{**EMPTY, 'reason': 'Unrecognized markup'}]}]:
            with self.subTest(change=change):
                self.assertEqual(verified_empty_links({'a:c': {**TARGET, **change}}, lambda _: HTML), {})

    def test_all_competing_pages_participate_in_festival_matching(self):
        directory = 'https://www.setlist.fm/festival/2024/example.html'
        html = HTML + f'<a href="{directory}">Festival</a>'
        target = {**TARGET, 'sets': [{'set_id': 'early', 'day': '2024-09-21', 'stage': 'Venue'}],
                  'dates': ['2024-09-21'], 'candidate_urls': [URL], 'directory_url': directory, 'timezone': 'UTC'}
        self.assertEqual(verified_empty_links({'a:c': target}, lambda _: html), {'a:c': [{'url': URL, 'set_id': 'early'}]})
        self.assertEqual(verified_empty_links({'a:c': target}, lambda _: HTML), {}, 'festival membership is required')
        # Even a page containing songs must compete with the empty page.
        self.assertEqual(verified_empty_links({'a:c': {**target, 'candidate_urls': [URL, URL + '?second']}}, lambda _: html), {})
        self.assertEqual(verified_empty_links({'a:c': {**target, 'sets': [*target['sets'], {'set_id': 'late', 'day': '2024-09-21', 'stage': 'Venue'}]}}, lambda _: html), {})

    def test_shipped_links_have_audit_evidence_and_valid_schedule_assignments(self):
        root = Path(__file__).resolve().parents[1]
        links = json.loads((root / 'data/cached.setlist-links.json').read_text())
        records = json.loads((root / 'docs/setlist-audit-2026-10-23.json').read_text())['records']
        self.assertNotIn('lawrence:oaapht', links)
        self.assertNotIn('vulfpeck:e5bfv9', links)
        for key, entries in links.items():
            record = records[key]
            self.assertNotIn(record['status'], ['hidden', 'cancelled', 'future', 'needs_review'])
            self.assertEqual(len(entries), len({v.get('set_id') for v in entries}))
            for entry in entries:
                self.assertRegex(entry['url'], r'^https://www\.setlist\.fm/setlist/.+\.html$')
                self.assertIn(entry['url'], [v['url'] for v in record['empty']])
                if record.get('sets'):
                    self.assertIn(entry['set_id'], [s['set_id'] for s in record['sets']])
                else:
                    self.assertNotIn('set_id', entry)


if __name__ == '__main__':
    unittest.main()
