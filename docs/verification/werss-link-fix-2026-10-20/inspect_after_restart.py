"""Read-only comparison with the repair backup; never print secret values."""

import json
import sqlite3


before = sqlite3.connect('file:/app/data/backups/werss-link-fix-2026-10-20.before.sqlite3?mode=ro', uri=True)
after = sqlite3.connect('file:/app/data/db.db?mode=ro', uri=True)
before.row_factory = after.row_factory = sqlite3.Row
result = {}
for table in ('articles', 'feeds', 'message_tasks', 'users'):
    old = {r['id']: dict(r) for r in before.execute('SELECT * FROM ' + table)}
    new = {r['id']: dict(r) for r in after.execute('SELECT * FROM ' + table)}
    changed = []
    for key in sorted(old.keys() & new.keys()):
        columns = [name for name in old[key] if old[key][name] != new[key].get(name)]
        if columns:
            change = {'id': key, 'changed_columns': columns}
            if table == 'articles':
                change['content_metadata'] = {
                    label: {'has_content': row.get('has_content'), 'fix_fail_count': row.get('fix_fail_count'),
                            'content_length': len(row.get('content') or ''),
                            'content_html_length': len(row.get('content_html') or ''),
                            'description_length': len(row.get('description') or '')}
                    for label, row in (('before', old[key]), ('after', new[key]))
                }
            changed.append(change)
    result[table] = {'before_count': len(old), 'after_count': len(new),
                     'same_ids': old.keys() == new.keys(), 'changes': changed}
before.close()
after.close()
print(json.dumps(result, ensure_ascii=False, indent=2))
