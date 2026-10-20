"""Confirm the stored URL repair and refresh only affected derived caches."""

import hashlib
import io
import json
import sqlite3
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


def digest(rows, excluded=()):
    data = [{k: row[k] for k in row.keys() if k not in excluded} for row in rows]
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()


before = sqlite3.connect('file:/app/data/backups/werss-link-fix-2026-10-20.before.sqlite3?mode=ro', uri=True)
after = sqlite3.connect('file:/app/data/db.db?mode=ro', uri=True)
before.row_factory = after.row_factory = sqlite3.Row
old_rows = before.execute('SELECT * FROM articles ORDER BY id').fetchall()
new_rows = after.execute('SELECT * FROM articles ORDER BY id').fetchall()
if len(old_rows) != 6 or len(new_rows) != 6 or digest(old_rows, ('url',)) != digest(new_rows, ('url',)):
    raise RuntimeError('Unexpected article count or non-URL field changes')
repairs = []
for old, new in zip(old_rows, new_rows):
    if old['url'] != new['url']:
        if new['url'] != old['url'].replace('~', '_'):
            raise RuntimeError('Unexpected URL change')
        repairs.append({'id': old['id'], 'old_url': old['url'], 'new_url': new['url']})
if len(repairs) != 4:
    raise RuntimeError('Expected exactly four repaired original URLs')
preserved = {}
for table in ('feeds', 'message_tasks', 'users'):
    old = before.execute('SELECT * FROM ' + table + ' ORDER BY id').fetchall()
    new = after.execute('SELECT * FROM ' + table + ' ORDER BY id').fetchall()
    preserved[table] = {'count': len(new), 'all_fields_preserved': digest(old) == digest(new)}
    if not preserved[table]['all_fields_preserved']:
        raise RuntimeError('Unexpected change in ' + table)
before.close()
after.close()
updated_cache_files = []
for directory in (Path('/app/data/cache/rss'), Path('/app/data/cache/content')):
    if not directory.is_dir():
        continue
    for path in directory.iterdir():
        if not path.is_file() or path.is_symlink():
            continue
        try:
            original = path.read_text(encoding='utf-8')
        except (UnicodeError, OSError):
            continue
        corrected = original
        for row in repairs:
            corrected = corrected.replace(row['old_url'], row['new_url'])
        if original != corrected:
            path.write_text(corrected, encoding='utf-8')
            updated_cache_files.append(path.name)
with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
    sys.path.insert(0, '/app')
    from core.cache import clear_cache_pattern
    cache_cleared = {name: clear_cache_pattern(name) for name in ('articles_list', 'article_detail')}
print(json.dumps({'articles': 6, 'repaired_count': len(repairs), 'repairs': repairs,
                  'non_url_article_fields_preserved': True, 'preserved': preserved,
                  'cache_cleared': cache_cleared, 'updated_cache_files': updated_cache_files},
                 ensure_ascii=False, indent=2))
