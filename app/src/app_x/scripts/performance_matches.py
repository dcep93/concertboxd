"""Conservative one-to-one matching of public performances to scheduled sets."""
from datetime import datetime
from zoneinfo import ZoneInfo
from setlist_page import Tree, text


def source_times(html):
    """Read reported clock times only; doors and tour averages are not evidence."""
    root = Tree(html).root
    result = {}
    for field in ('scheduled', 'start'):
        values = set()
        for section in root.all(lambda n: n.has('setTimesTimeline')):
            for node in section.all(lambda n: n.has(field)):
                value = text(node.first(lambda n: n.tag == 'strong'))
                try:
                    values.add(datetime.strptime(value, '%I:%M %p').strftime('%H:%M'))
                except ValueError:
                    pass
        if len(values) == 1:
            result[field + '_time'] = values.pop()
    return result


def match_performances(sets, pages, timezone='UTC'):
    """Pages must already pass artist identity and exact festival membership.

    Include empty pages in this matching step: a missing song list is not a
    reason to assign a different performance to the slot.
    """
    choices = {}
    for page in pages:
        matching = []
        for item in sets:
            days = {item['day']} if item.get('day') else set()
            if item.get('start'):
                days.add(datetime.fromisoformat(item['start'].replace('Z', '+00:00')).astimezone(ZoneInfo(timezone)).date().isoformat())
            if page['event_date'] in days:
                matching.append(item['set_id'])
        # Public pages increasingly identify the stage as their venue. Use an
        # exact stage name when it is one of this artist's scheduled stages.
        venue_stage = page.get('venue', '').split(',')[0].strip().casefold().removesuffix(' stage')
        stage_matches = [item['set_id'] for item in sets if item['set_id'] in matching
                         and item.get('stage', '').strip().casefold().removesuffix(' stage') == venue_stage and venue_stage]
        if stage_matches:
            matching = stage_matches
        # Same-day repeat appearances need positive timing evidence. Prefer the
        # published scheduled time; never choose by which page contains songs.
        # Multiple source pages also need disambiguation when the catalog has
        # only one of that day's performances (for example, a main-stage set
        # plus an unscheduled acoustic appearance).
        competing_pages = sum(p['event_date'] == page['event_date'] for p in pages) > 1
        timed_single = len(matching) == 1 and any(item['set_id'] in matching and item.get('start') for item in sets)
        needs_time = len(matching) > 1 or (competing_pages and timed_single)
        if needs_time and page.get('scheduled_time'):
            matching = [item['set_id'] for item in sets if item['set_id'] in matching
                        and item.get('start') and datetime.fromisoformat(item['start'].replace('Z', '+00:00'))
                        .astimezone(ZoneInfo(timezone)).strftime('%H:%M') == page['scheduled_time']]
        elif needs_time and page.get('start_time'):
            # Only bounded, same-calendar-day slots qualify for an actual start.
            matching = [item['set_id'] for item in sets if item['set_id'] in matching
                        and item.get('start') and item.get('end')
                        and (start := datetime.fromisoformat(item['start'].replace('Z', '+00:00')).astimezone(ZoneInfo(timezone))).date()
                        == (end := datetime.fromisoformat(item['end'].replace('Z', '+00:00')).astimezone(ZoneInfo(timezone))).date()
                        and start.strftime('%H:%M') <= page['start_time'] < end.strftime('%H:%M')]
        choices[page['url']] = matching
    accepted = {}
    for url, ids in choices.items():
        if len(ids) == 1 and sum(ids[0] in candidates for candidates in choices.values()) == 1:
            accepted[url] = ids[0]
    return accepted
