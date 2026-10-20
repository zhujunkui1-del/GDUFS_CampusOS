"""Extract an uploaded WeChat album HTML without executing JS or using network."""

import argparse
import base64
import hashlib
import html
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup


def canonical_article_url(raw):
    parsed = urlsplit(html.unescape(raw or ''))
    if parsed.hostname != 'mp.weixin.qq.com':
        raise ValueError('Article URL does not belong to mp.weixin.qq.com')
    if re.fullmatch(r'/s/[A-Za-z0-9_-]+', parsed.path):
        return urlunsplit(('https', 'mp.weixin.qq.com', parsed.path, '', ''))
    if parsed.path != '/s':
        raise ValueError('Unexpected article URL path')
    params = dict(parse_qsl(parsed.query, keep_blank_values=False))
    fields = ('__biz', 'mid', 'idx', 'sn')
    if not all(params.get(key) for key in fields):
        raise ValueError('Article identity is incomplete')
    return urlunsplit(('https', 'mp.weixin.qq.com', '/s',
                       urlencode([(key, params[key]) for key in fields]), ''))


def scalar(script, key):
    match = re.search(r'(?<!\w)' + re.escape(key) + r"\s*:\s*'([^'\\]*)'", script)
    return match.group(1) if match else None


def markdown(value):
    return str(value).replace('\\', '\\\\').replace('|', '\\|').replace('\n', ' ')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--published-from', default='2026-07-01')
    parser.add_argument('--account-id', default='MP_WXS_3293703638')
    parser.add_argument('--account-name', default='广外就业中心')
    args = parser.parse_args()
    local_time = timezone(timedelta(hours=8))
    cutoff = datetime.fromisoformat(args.published_from).replace(tzinfo=local_time)
    raw = args.input.read_bytes()
    soup = BeautifulSoup(raw.decode('utf-8-sig'), 'html.parser')
    scripts = [tag.string or tag.get_text() for tag in soup.find_all('script')]
    directories = [script for script in scripts if 'articleList:' in script]
    if len(directories) != 1:
        raise ValueError('Expected one static album directory')
    directory = directories[0]
    prefix = directory.split('articleList:', 1)[0]
    album_id = scalar(prefix, 'albumId')
    album_title = scalar(prefix, 'title')
    count = scalar(prefix, 'article_count')
    declared_count = int(count) if count and count.isdigit() else None
    continue_flag = scalar(directory, 'continue_flag')
    reverse_continue_flag = scalar(directory, 'reverse_continue_flag')
    articles = []
    seen = set()
    account_biz = None
    for node in soup.select('[data-msgid]'):
        address = canonical_article_url(node.get('data-link') or node.get('data-url'))
        params = dict(parse_qsl(urlsplit(address).query))
        biz = params.get('__biz')
        if not biz or 'MP_WXS_' + base64.b64decode(biz).decode('ascii') != args.account_id:
            raise ValueError('Article publisher does not match the selected account')
        if account_biz and account_biz != biz:
            raise ValueError('Album contains inconsistent publisher identities')
        account_biz = biz
        identity = (biz, params['mid'], params['idx'])
        if identity in seen:
            continue
        seen.add(identity)
        title = html.unescape(node.get('data-title') or '').strip()
        if not title:
            raise ValueError('Article title is missing')
        date_node = node.select_one('.js_article_create_time')
        raw_date = date_node.get_text(strip=True) if date_node else ''
        published = datetime.fromtimestamp(int(raw_date), local_time) if raw_date.isdigit() else None
        articles.append({
            'title': title, 'url': address, 'biz': biz, 'mid': params['mid'], 'idx': params['idx'],
            'album_position': int(node.get('data-pos_num')) if str(node.get('data-pos_num')).isdigit() else None,
            'published_at': published.isoformat() if published else None,
            'published_timestamp': int(raw_date) if raw_date.isdigit() else None,
            'date_evidence': 'uploaded HTML .js_article_create_time',
            'date_in_scope': published >= cutoff if published else None,
            'body_status': 'not_provided',
        })
    if not articles or not album_id or not account_biz:
        raise ValueError('No complete album identity or article directory found')
    script_count = len(re.findall(r'(?<!\w)create_time\s*:', directory))
    completeness = (declared_count == len(articles) == script_count
                    and continue_flag == '0' and reverse_continue_flag == '0')
    selected = [article for article in articles if article['date_in_scope'] is True]
    excluded = [article for article in articles if article['date_in_scope'] is False]
    unknown = [article for article in articles if article['date_in_scope'] is None]
    data = {
        'schema': 'uploaded-wechat-album-directory/v1',
        'account_id': args.account_id, 'account_name': args.account_name,
        'album_id': album_id, 'album_title': album_title,
        'album_url': 'https://mp.weixin.qq.com/mp/appmsgalbum?' + urlencode({
            '__biz': account_biz, 'action': 'getalbum', 'album_id': album_id}),
        'source': 'user_uploaded_html', 'source_sha256': hashlib.sha256(raw).hexdigest(),
        'published_from_inclusive': cutoff.isoformat(),
        'declared_article_count': declared_count, 'dom_unique_article_count': len(articles),
        'script_article_count': script_count, 'continue_flag': continue_flag,
        'reverse_continue_flag': reverse_continue_flag,
        'uploaded_album_directory_matches_declared_total': completeness,
        'entire_account_history_coverage': 'not_established',
        'selected_count': len(selected), 'before_cutoff_count': len(excluded),
        'unknown_date_count': len(unknown), 'network_requests': 0,
        'werss_writes': 0, 'articles': articles,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    catalog = args.output_dir / ('album-' + album_id + '.json')
    selected_file = args.output_dir / ('since-' + args.published_from + '.json')
    report = args.output_dir / ('album-' + album_id + '.md')
    catalog.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    subset = {key: value for key, value in data.items() if key != 'articles'}
    subset['articles'] = selected
    selected_file.write_text(json.dumps(subset, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# ' + args.account_name + '：“' + album_title + '”合集目录', '',
             '- 依据：用户上传页面，离线解析；未联网读取微信页面。',
             f'- 页面声明 {declared_count} 篇，DOM 提取 {len(articles)} 篇，脚本目录 {script_count} 篇。',
             f'- 前向/反向继续标志：{continue_flag}/{reverse_continue_flag}。',
             f'- 自 {args.published_from} 起（北京时间，含当天）：**{len(selected)} 篇**；此前 {len(excluded)} 篇；日期未知 {len(unknown)} 篇。',
             '- 目录项包含原链接和页面时间戳，未提供文章正文；没有将目录解析记为正文抓取成功。',
             '- 这只对应该合集；公众号全部历史的覆盖范围仍未知。', '',
             '## 符合日期范围的文章', '', '| 发布时间（北京时间） | 标题 | 原文 |', '|---|---|---|']
    for article in selected:
        lines.append('| ' + article['published_at'] + ' | ' + markdown(article['title'])
                     + ' | [查看原文](' + article['url'] + ') |')
    lines += ['', '## 早于起始日期的文章', '', '| 发布时间（北京时间） | 标题 |', '|---|---|']
    for article in excluded:
        lines.append('| ' + article['published_at'] + ' | ' + markdown(article['title']) + ' |')
    lines += ['', '## 数据文件', '', '- 完整目录：[' + catalog.name + '](' + catalog.name + ')',
              '- 日期筛选结果：[' + selected_file.name + '](' + selected_file.name + ')', '',
              '## 覆盖限制', '',
              '页面声明数、已保存 DOM 和静态脚本目录相符且继续标志为 0，只能证明上传页面按自身声明展示了整个合集。'
              '合集主题为“招聘会”，不能代表该号其他主题文章，也不能证明 7 月以来全号只有一篇。',
              '原始页面可能包含会话参数，未复制进结果；文章链接仅保留 __biz、mid、idx、sn。未执行页面脚本、加载外部资源或写入 WeRSS。', '']
    report.write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'report': str(report.resolve()), 'catalog': str(catalog.resolve()),
                      'selected': str(selected_file.resolve()), 'album_title': album_title,
                      'declared_count': declared_count, 'extracted_count': len(articles),
                      'since_cutoff_count': len(selected), 'before_cutoff_count': len(excluded),
                      'unknown_date_count': len(unknown), 'directory_complete_in_uploaded_page': completeness,
                      'selected_articles': selected}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
