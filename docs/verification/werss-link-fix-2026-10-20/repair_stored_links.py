"""Repair only WeRead-derived original URLs; run with /app/env_x86_64/bin/python3.

Retains stable article IDs. The sibling finish_repair.py can resume cache refresh
after a committed database repair without reapplying the database transaction.
"""

import hashlib
import io
import json
import re
import sqlite3
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from urllib.parse import urlsplit


DB_FILE = Path('/app/data/db.db')
BACKUP = Path('/app/data/backups/werss-link-fix-2026-10-20.before.sqlite3')


def fingerprint(rows, exclude=()):
    values = [{k: row[k] for k in row.keys() if k not in exclude} for row in rows]
    return hashlib.sha256(json.dumps(values, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()


def run(apply=False):
    db = sqlite3.connect(str(DB_FILE), timeout=20)
    db.row_factory = sqlite3.Row
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'articles', 'feeds', 'message_tasks'} <= tables:
        raise RuntimeError('Unexpected database schema')
    articles = db.execute('SELECT * FROM articles ORDER BY id').fetchall()
    feeds = db.execute('SELECT * FROM feeds ORDER BY id').fetchall()
    tasks = db.execute('SELECT * FROM message_tasks ORDER BY id').fetchall()
    repairs = []
    for row in articles:
        address = urlsplit(row['url'] or '')
        token = address.path.removeprefix('/s/')
        book_id = str(row['mp_id'] or '').removeprefix('MP_WXS_')
        stored_prefix = f'{book_id}-{book_id}_'
        if (address.scheme == 'https' and address.netloc == 'mp.weixin.qq.com'
                and not address.query and not address.fragment and address.path.startswith('/s/')
                and re.fullmatch(r'[A-Za-z0-9_~\-]{22}', token) and '~' in token
                and str(row['mp_id']).startswith('MP_WXS_')
                and row['id'] == stored_prefix + token):
            repairs.append({'id': row['id'], 'old_url': row['url'],
                            'new_url': 'https://mp.weixin.qq.com/s/' + token.replace('~', '_')})
    result = {'mode': 'apply' if apply else 'plan', 'articles': len(articles), 'feeds': len(feeds),
              'message_tasks': len(tasks), 'repairs': repairs}
    if not apply:
        db.close()
        return result
    if len(articles) != 6 or len(feeds) != 81 or len(repairs) != 4:
        raise RuntimeError('Database changed from the observed 6 articles / 81 feeds / 4 broken links')
    BACKUP.parent.mkdir(parents=True, exist_ok=True)
    if BACKUP.exists():
        raise RuntimeError('Backup exists; refusing to overwrite')
    with sqlite3.connect(str(BACKUP)) as backup:
        db.backup(backup)
    BACKUP.chmod(0o600)
    db.execute('BEGIN IMMEDIATE')
    try:
        for repair in repairs:
            changed = db.execute('UPDATE articles SET url=? WHERE id=? AND url=?',
                                 (repair['new_url'], repair['id'], repair['old_url'])).rowcount
            if changed != 1:
                raise RuntimeError('Article changed during URL repair')
        after = db.execute('SELECT * FROM articles ORDER BY id').fetchall()
        if fingerprint(articles, ('url',)) != fingerprint(after, ('url',)):
            raise RuntimeError('A non-URL article field changed')
        if fingerprint(feeds) != fingerprint(db.execute('SELECT * FROM feeds ORDER BY id').fetchall()):
            raise RuntimeError('A feed field changed')
        if fingerprint(tasks) != fingerprint(db.execute('SELECT * FROM message_tasks ORDER BY id').fetchall()):
            raise RuntimeError('A message task changed')
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.close()
    result.update(backup=str(BACKUP), non_url_article_fields_preserved=True,
                  feeds_preserved=True, message_tasks_preserved=True)
    # Keep cached original links consistent, without changing WeRead review IDs.
    updated_files = []
    for cache_dir in (Path('/app/data/cache/rss'), Path('/app/data/cache/content')):
        if not cache_dir.is_dir():
            continue
        for cache_file in cache_dir.iterdir():
            if not cache_file.is_file() or cache_file.is_symlink():
                continue
            try:
                before = cache_file.read_text(encoding='utf-8')
            except (UnicodeError, OSError):
                continue
            after = before
            for repair in repairs:
                after = after.replace(repair['old_url'], repair['new_url'])
            if after != before:
                cache_file.write_text(after, encoding='utf-8')
                updated_files.append(cache_file.name)
    result['updated_cache_files'] = updated_files
    # These are the same scoped cache keys invalidated by the application's
    # article write routes. Suppress application import logs (may contain config).
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        sys.path.insert(0, '/app')
        original_argv = sys.argv
        sys.argv = [sys.argv[0]]
        from core.cache import clear_cache_pattern
        cache_cleared = {name: clear_cache_pattern(name) for name in ('articles_list', 'article_detail')}
        sys.argv = original_argv
    result['cache_cleared'] = cache_cleared
    return result


if __name__ == '__main__':
    print(json.dumps(run('--apply' in sys.argv), ensure_ascii=False, indent=2))
