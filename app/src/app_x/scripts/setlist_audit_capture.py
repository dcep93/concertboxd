"""Loopback form bridge for ordinary browser captures requested by the audit."""
import argparse
import hashlib
import json
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from urllib.parse import parse_qs
from datetime import datetime, timezone

import audit_user_setlists as runner
from seed_setlists import Blocked, validate_public_page
from festival_setlists import candidate_links, targets_for, artist_norm
from refresh_setlists import read

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
condition = threading.Condition()
pending = None
finished = False
catalog = read(work / 'catalog.json', {})
targets = sorted(targets_for(catalog), key=lambda t: (t['concert_id'] != 'f3ysgl', t['concert_id'], t['artist']))


def next_sources(progress, limit=6):
    urls = [pending] if pending else []
    cache = read(runner.DATA / 'cached.setlist.fm.json', {})
    for target in targets:
        if target['key'] in progress.get('records', {}) or target['excluded']:
            continue
        existing = {p.get('set_id') for p in cache.get(target['key'], [])}
        if all(s['set_id'] in existing for s in target['sets']):
            continue
        directory = progress.get('directories', {}).get(target['concert_id'], {})
        for link in directory.get('links', []):
            url = link['url']
            if artist_norm(link['artist']) == artist_norm(target['artist']) and url not in urls and not (work / 'pages' / (hashlib.sha256(url.encode()).hexdigest() + '.html')).exists():
                urls.append(url)
                if len(urls) >= limit:
                    return urls
    return urls


def browser_capture(url, folder):
    global pending
    path = folder / (hashlib.sha256(url.encode()).hexdigest() + '.html')
    with condition:
        pending = url
        condition.notify_all()
        condition.wait_for(lambda: pending is None)
    return path.read_text(encoding='utf8')


class Ordinary(runner.Fetcher):
    def get(self, url):
        path = self.folder / (hashlib.sha256(url.encode()).hexdigest() + '.html')
        if not path.exists():
            return browser_capture(url, self.folder)
        try:
            return super().get(url)
        except Blocked:
            return browser_capture(url, self.folder)


class Festival(runner.FestivalFetcher):
    def get(self, url):
        path = self.folder / (hashlib.sha256(url.encode()).hexdigest() + '.html')
        if not path.exists():
            html = browser_capture(url, self.folder)
            self.capture_times[url] = datetime.now(timezone.utc).isoformat()
            return html
        try:
            return super().get(url)
        except Blocked:
            html = browser_capture(url, self.folder)
            self.capture_times[url] = datetime.now(timezone.utc).isoformat()
            return html


runner.Fetcher = Ordinary
runner.FestivalFetcher = Festival


def run():
    global finished
    try:
        runner.audit(work / 'catalog.json', 'dcep93', work,
                     runner.DATA.parent / 'docs/setlist-audit-2026-10-23.json')
    finally:
        with condition:
            finished = True
            condition.notify_all()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with condition:
            condition.wait_for(lambda: pending or finished, timeout=15)
            url = pending
        progress = read(work / 'progress.json', {})
        body = '<!doctype html><title>Setlist audit capture</title><h1>Setlist audit</h1>'
        body += '<p>' + escape(str(progress.get('counts', {}))) + '</p>'
        if self.path == '/batch' and not finished:
            for index, source in enumerate(next_sources(progress)):
                body += f'<p><a href="{escape(source)}">Capture source {index + 1}</a></p>'
            body += '<form method="post" action="/batch"><label for="bundle">Captured pages JSON</label><textarea id="bundle" name="bundle"></textarea><button>Save captures</button></form>'
        elif url:
            body += f'<a id="source" href="{escape(url)}">Source</a><form method="post"><input type="hidden" name="url" value="{escape(url)}"><label for="capture">Page HTML</label><textarea id="capture" name="html"></textarea><button>Save capture</button></form>'
        else:
            body += '<p>' + ('Finished' if finished else 'Processing source pages') + '</p>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(body.encode())

    def do_POST(self):
        global pending
        if self.headers.get('Origin') != 'http://127.0.0.1:8778':
            self.send_error(403)
            return
        try:
            values = parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode())
            captures = json.loads(values['bundle'][0]) if 'bundle' in values else [{'url': values['url'][0], 'html': values['html'][0]}]
            with condition:
                progress = read(work / 'progress.json', {})
                known = {link['url'] for directory in progress.get('directories', {}).values() for link in directory['links']}
                for capture in captures:
                    url, html = capture['url'], capture['html']
                    if url != pending and (self.path != '/batch' or url not in known):
                        raise ValueError('Not a reviewed source URL')
                    if '/festival/' in url:
                        candidate_links(html, url)
                    else:
                        validate_public_page(html, url)
                for capture in captures:
                    path = work / 'pages' / (hashlib.sha256(capture['url'].encode()).hexdigest() + '.html')
                    path.write_text(capture['html'], encoding='utf8')
                if any(capture['url'] == pending for capture in captures):
                    pending = None
                    condition.notify_all()
            if self.path == '/batch':
                body = '<!doctype html><title>Capture saved</title><p>Capture saved</p><a href="/batch">Next sources</a>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(body.encode())
            else:
                self.send_response(303)
                self.send_header('Location', '/')
                self.end_headers()
        except Exception as error:
            self.send_error(400, str(error))

    def log_message(self, *_):
        pass


threading.Thread(target=run, daemon=True).start()
print('Capture bridge http://127.0.0.1:8778', flush=True)
ThreadingHTTPServer(('127.0.0.1', 8778), Handler).serve_forever()
