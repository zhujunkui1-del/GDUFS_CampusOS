"""History-list replacement, compiled into the owner's existing MP Tools module.

The chapter response is the directory authority. A cover is never a substitute
for a failed directory. Existing login headers and endpoint are preserved.
No activation, account rotation, alternate endpoint or credential refresh occurs.
"""


def _history_error_response(response, account_id):
    status = response.status_code
    try:
        data = response.json()
    except (ValueError, TypeError):
        data = None
    code = data.get("errcode", data.get("errCode", data.get("ret", 0))) if isinstance(data, dict) else 0
    failed_code = code not in (None, 0, "0", "")
    if status != 200 or failed_code:
        detail = "HTTP " + str(status) + ("，错误码 " + str(code) if failed_code else "")
        if status == 401 or code in (-2012, "-2012", 401, "401"):
            message = "微信读书登录已失效，请在账号池重新扫码（" + detail + "）"
        elif status in (429, 499) or code in (200013, -2013, -2014, -2041, "200013", "-2013", "-2014", "-2041"):
            message = "历史目录暂不可用，请等待冷却后重试（" + detail + "）"
        elif status == 403:
            message = "历史目录访问被拒绝，请检查账号授权（" + detail + "）"
        else:
            message = "历史目录请求失败（" + detail + "）"
        retry_after = 120.0
        try:
            raw = str(response.headers.get("Retry-After", "")).strip()
            if raw.isdigit():
                retry_after = max(retry_after, float(raw))
            elif raw:
                from email.utils import parsedate_to_datetime
                retry_after = max(retry_after, parsedate_to_datetime(raw).timestamp() - time.time())
        except (ValueError, TypeError, OverflowError):
            pass
        account_pool.report(account_id, status_code=status, ret=code, error_msg=message,
                            retry_after=retry_after)
        raise RuntimeError(message)
    if not isinstance(data, dict):
        raise RuntimeError("历史目录响应格式错误，未把当前文章当作完整目录")
    return data


def _history_request(session, url, headers, account_id):
    # One request only. An upstream refusal cannot trigger hidden retries,
    # session activation, a different account or a cover/list fallback.
    lock = getattr(session, "_campusos_history_lock", None)
    if lock is None:
        lock = threading.RLock()
        session._campusos_history_lock = lock
    with lock:
        last = getattr(session, "_campusos_history_request_at", 0.0)
        delay = max(0.0, 4.0 - (time.monotonic() - last))
        if delay:
            time.sleep(delay)
        session._campusos_history_request_at = time.monotonic()
        try:
            response = session.get(url, headers=headers, timeout=20)
        except Exception:
            raise RuntimeError("历史目录网络请求失败，请稍后重试；未判定为只有一篇文章") from None
    return _history_error_response(response, account_id)


def _history_local_articles(fakeid, begin, count, keyword, reason):
    """Keep real local downloads visible without treating them as a directory."""
    import base64
    import html
    from urllib.parse import urlsplit
    registrations = load_json(DATA_DIR / "accounts.json", [])
    if isinstance(registrations, dict):
        registrations = registrations.get("accounts", [])
    registration = next((a for a in registrations if a.get("fakeid") == fakeid), None)
    if not registration:
        return {"articles": [], "total": 0, "count": 0, "can_msg_continue": 0,
                "list_origin": "local_downloads", "directory_complete": False,
                "warning": "历史目录未恢复，且本机没有该公众号的下载记录"}
    name = registration.get("nickname", "")
    try:
        account_id = "MP_WXS_" + base64.b64decode(fakeid).decode("ascii")
    except (ValueError, UnicodeError):
        account_id = ""
    found = {}

    def keep(meta, path):
        link = _restore_wechat_short_url(meta.get("url") or meta.get("link") or "")
        if urlsplit(link).hostname != "mp.weixin.qq.com" or not path.is_file():
            return
        title = meta.get("title") or ""
        if not title or keyword and keyword.lower() not in title.lower():
            return
        source_id = meta.get("account_id")
        if source_id and source_id != account_id:
            return
        try:
            published = int(meta.get("publish_time") or 0)
        except (TypeError, ValueError):
            published = 0
        found[link] = {"title": title, "link": link,
                       "cover": meta.get("cover_url") or "", "digest": meta.get("digest") or "",
                       "author": name, "update_time": published, "id": link,
                       "is_original": False, "item_show_type": 0, "downloaded": True}

    roots = dict.fromkeys([DATA_DIR.parent, DATA_DIR / "articles_full", Path(get_settings().get("download_dir") or DATA_DIR / "articles_full")])
    for root in roots:
        root = root.resolve()
        folder = (root / name).resolve()
        if folder.parent != root or not folder.is_dir():
            continue
        for directory in folder.iterdir():
            if not directory.is_dir() or directory.resolve().parent != folder:
                continue
            reading = directory / "reading.html"
            legacy = directory / "metadata.json"
            try:
                if reading.is_file():
                    with reading.open(encoding="utf-8-sig") as f:
                        head = f.read(65536)
                    match = re.search(r'<meta\s+name="campusos-article"\s+content="([^"]*)"', head)
                    if match:
                        keep(json.loads(html.unescape(match.group(1))), reading)
                elif legacy.is_file():
                    meta = json.loads(legacy.read_text(encoding="utf-8-sig"))
                    files = [p for p in directory.glob("*.html") if not p.name.endswith("_raw.html")]
                    if files:
                        keep(meta, files[0])
            except (OSError, ValueError, TypeError):
                continue
    articles = sorted(found.values(), key=lambda a: (a["update_time"], a["title"]), reverse=True)
    page = articles[begin:begin + count]
    return {"articles": page, "total": len(articles), "count": len(page), "begin": begin,
            "can_msg_continue": int(begin + count < len(articles)), "list_origin": "local_downloads",
            "directory_complete": False,
            "warning": "当前显示本机已下载 " + str(len(articles)) + " 篇；历史目录未恢复。" + str(reason)}


def _fetch_articles_page(fakeid: str, begin: int, count: int, keyword: str = "", account_name: str = "", from_article_id: str = "") -> tuple:
    book_id = biz_to_book_id(fakeid)
    if not book_id:
        raise RuntimeError("无效的公众号标识")
    if begin < 0 or not 1 <= count <= 100:
        raise ValueError("目录分页参数无效")
    account_id, _, _, headers = borrow_weread_session()
    session = get_weread_session()
    url = f"https://i.weread.qq.com/mp/chapters?bookId={book_id}&count={count}&offset={begin}&pf=android"
    data = _history_request(session, url, headers, account_id)
    raw_items = None
    for key in ("data", "chapters", "list"):
        if key in data:
            raw_items = data[key]
            break
    if isinstance(raw_items, dict):
        nested = raw_items
        raw_items = next((nested[k] for k in ("chapters", "list", "data") if k in nested), None)
    if not isinstance(raw_items, list):
        raise RuntimeError("历史目录缺少文章列表，未判定为已扫描全部文章")
    marker = data.get("hasMore", len(raw_items) >= count)
    if marker not in (True, False, 0, 1, "0", "1", "true", "false"):
        raise RuntimeError("历史目录分页标记无效")
    has_more = marker in (True, 1, "1", "true")
    if has_more and not raw_items:
        raise RuntimeError("历史目录返回空页但声明还有后续，未判定为已完成")
    articles = []
    seen = set()
    for item in raw_items:
        if not isinstance(item, dict):
            raise RuntimeError("历史目录条目格式错误")
        info = item.get("mpInfo") or {}
        title = info.get("title") or item.get("title") or ""
        review_id = item.get("reviewId") or ""
        short_id = _short_id_from_review_id(review_id)
        link = _restore_wechat_short_url("https://mp.weixin.qq.com/s/" + short_id) if short_id else _restore_wechat_short_url(info.get("doc_url", ""))
        if not link and review_id:
            link = _resolve_review_doc_url(review_id, headers)
        if not title or not link:
            raise RuntimeError("历史目录文章缺少标题或原文链接，未跳过后宣称完成")
        if keyword and keyword.lower() not in title.lower():
            continue
        if link in seen:
            continue
        seen.add(link)
        articles.append({"title": title, "link": link,
                         "cover": info.get("pic_url") or info.get("thumbUrl") or item.get("cover") or "",
                         "digest": info.get("digest", ""), "author": info.get("author") or account_name or "",
                         "update_time": item.get("createTime") or info.get("time") or 0,
                         "is_original": True, "item_show_type": 0, "id": review_id})
    account_pool.report(account_id, is_success=True)
    total_count = begin + len(raw_items) + (count if has_more else 0)
    return articles, total_count, int(has_more)


def history_pool_acquire(self):
    """A cooling account is unavailable until its real deadline passes."""
    now = time.time()
    with self._lock:
        accounts = self._load()
        changed = False
        for account in accounts:
            if account.get("status") == "cooldown" and now >= account.get("cooldown_until", 0):
                account["status"] = "active"
                account["cooldown_until"] = 0
                changed = True
        active = [a for a in accounts if a.get("status") == "active"]
        if not active:
            if changed:
                self._save(accounts)
            return None
        active.sort(key=lambda a: (a.get("failures", 0), a.get("last_used", 0)))
        selected = active[0]
        selected["last_used"] = now
        self._save(accounts)
        return dict(selected)


def history_pool_report(self, account_id: str, *, ret=None, status_code=None, is_success=None, error_msg=None, need_refresh=False, retry_after=120.0):
    now = time.time()
    with self._lock:
        accounts = self._load()
        account = next((a for a in accounts if a.get("id") == account_id), None)
        if not account:
            return
        if is_success:
            if account.get("status") == "active":
                account["failures"] = 0
                account["last_error"] = None
                self._save(accounts)
            return
        account["last_http_status"] = status_code
        account["last_ret"] = ret
        if status_code == 401 or ret in (401, -2012, "401", "-2012") or need_refresh:
            account["status"] = "invalid"
            account["last_error"] = error_msg or "登录已失效，请在账号池重新扫码"
        elif status_code in (429, 403, 499) or ret in (200013, -2013, -2014, -2041, "200013", "-2013", "-2014", "-2041"):
            account["status"] = "cooldown"
            account["cooldown_until"] = max(account.get("cooldown_until", 0), now + max(120.0, retry_after))
            account["last_error"] = error_msg or "请求需冷却，请稍后重试"
        else:
            account["failures"] = account.get("failures", 0) + 1
            account["last_error"] = error_msg or "请求失败，请稍后重试"
            if account["failures"] >= 3:
                account["status"] = "invalid"
        self._save(accounts)


def history_borrow_weread_session() -> tuple:
    account = account_pool.acquire()
    if not account:
        cooling = [a for a in account_pool._load() if a.get("status") == "cooldown"]
        if cooling:
            remaining = max(1, int(min(a.get("cooldown_until", 0) for a in cooling) - time.time()) + 1)
            raise RuntimeError("微信读书账号冷却中，请在 " + str(remaining) + " 秒后重试")
        raise RuntimeError("微信读书暂无可用登录，请在账号池重新扫码")
    account_id = account["id"]
    vid = str(account.get("vid", ""))
    token = account.get("accessToken") or account.get("token", "")
    skey = account.get("skey") or token
    # Preserve the installed client's existing headers; do not forge a new device.
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
               "Content-Type": "application/json; charset=UTF-8", "vid": vid, "accessToken": token,
               "skey": skey, "Cookie": f"wr_vid={vid}; wr_skey={skey}"}
    from backend.waterwall import get_captcha_headers
    headers.update(get_captcha_headers())
    return account_id, vid, token, headers
