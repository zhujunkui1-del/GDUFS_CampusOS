"""Keep local-download visibility labelled in the owner's native UI."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(r"D:\WeChat MP Tools")
OUT = ROOT / "data/patches/history-directory-2026-10-22"
LIVE = ROOT / "_internal/frontend/js/components/articles.js"


def main():
    backup = OUT / "articles.before-history-ui.js"
    original = backup.read_bytes() if backup.exists() else LIVE.read_bytes()
    source = original.decode("utf-8-sig").replace("\r\n", "\n")
    before = LIVE.read_bytes()
    previous = OUT / "frontend-report.json"
    if before != original and (not previous.exists() or json.loads(previous.read_text(encoding="utf-8"))["patchedSha256"] != hashlib.sha256(before).hexdigest()):
        raise RuntimeError("Frontend changed outside this repair; stopped")
    anchor = "    async loadArticles() {"
    if source.count(anchor) != 1:
        raise RuntimeError("Article UI load boundary changed")
    method = '''    _setDirectoryStatus(message) {
        const container = document.getElementById('articles-list');
        if (!container) return;
        let status = document.getElementById('articles-directory-status');
        if (!status) {
            status = document.createElement('div');
            status.id = 'articles-directory-status';
            status.style.cssText = 'padding:12px 16px;margin-bottom:12px;border-radius:8px;background:#fff4dc;color:#704b00;line-height:1.6;';
            container.before(status);
        }
        status.textContent = message || '';
        status.hidden = !message;
    },

'''
    source = source.replace(anchor, method + anchor)
    anchor = "            this.articles = cached.articles;"
    if source.count(anchor) != 1:
        raise RuntimeError("Cached page boundary changed")
    source = source.replace(anchor, "            this._setDirectoryStatus(cached.warning || '');\n" + anchor)
    anchor = "            this.articles = data.articles || [];"
    if source.count(anchor) != 1:
        raise RuntimeError("Directory result boundary changed")
    source = source.replace(anchor, "            this._setDirectoryStatus(data.warning || '');\n" + anchor)
    anchor = "                canMsgContinue: this.canMsgContinue"
    if source.count(anchor) != 1:
        raise RuntimeError("Page-cache metadata boundary changed")
    source = source.replace(anchor, anchor + ",\n                warning: data.warning || ''")
    anchor = "            this.renderArticles();\n            this.updatePagination();\n            this.updateSelectedCount();\n        } catch (err) {"
    if source.count(anchor) != 1:
        raise RuntimeError("Directory rendering boundary changed")
    source = source.replace(anchor, "            this.renderArticles();\n            if (data.list_origin === 'local_downloads' && this.articles.length === 0) {\n                container.textContent = '本机尚未下载该公众号的文章，历史目录暂不可用。';\n            }\n            this.updatePagination();\n            this.updateSelectedCount();\n        } catch (err) {")
    output = source.encode("utf-8")
    staged = OUT / "articles.history-ui.js"
    staged.write_bytes(output)
    report = {"originalSha256": hashlib.sha256(original).hexdigest(), "patchedSha256": hashlib.sha256(output).hexdigest(),
              "installed": False}
    if "--apply" in sys.argv:
        if not backup.exists():
            backup.write_bytes(original)
        LIVE.write_bytes(output)
        report["installed"] = True
    (OUT / ("frontend-report.json" if report["installed"] else "frontend-staged-report.json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
