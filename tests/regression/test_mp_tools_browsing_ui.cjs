// Owner-authorized offline checks of the actual staged/installed frontend.
// Only the HTTP and DOM boundaries are replaced; no app data or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const file = process.argv[2];
if (!file) throw new Error('Pass the staged or installed articles.js path');
const source = fs.readFileSync(file, 'utf8');

function fixture(list) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, innerHTML: '', textContent: '' });
    return elements.get(id);
  };
  const context = vm.createContext({
    Set, Map, console,
    document: { getElementById: element },
    API: { articles: { list } },
    fetch: () => { throw new Error('No real networking allowed'); },
  });
  vm.runInContext(source, context, { filename: file });
  const page = vm.runInContext('ArticlesPage', context);
  page.currentFakeid = 'offline-source';
  page.renderArticles = () => {};
  page.updatePagination = () => {};
  page.updateSelectedCount = () => {};
  return { page, element };
}

(async () => {
  const calls = [];
  const { page } = fixture(async (id, begin, count) => {
    calls.push({ id, begin, count });
    return { articles: Array.from({ length: 20 }, (_, i) => ({ id: begin + i })),
      total: 40, can_msg_continue: begin === 0 ? 1 : 0 };
  });
  await page.loadArticles();
  assert.equal(page.articles.length, 20);
  assert.equal(page.canMsgContinue, 1);
  page.currentPage = 1;
  await page.loadArticles();
  assert.equal(page.articles[0].id, 20);
  assert.equal(page.canMsgContinue, 0);
  assert.equal(page.loadedArticlesMap.size, 40);
  page.currentPage = 0;
  await page.loadArticles();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.begin), [0, 20]);
  console.log('PASS: two real UI pages, offsets and cache');

  const failed = fixture(async () => ({ error: 'HTTP 499 / -2014', articles: [{ title: 'cover only' }] }));
  await failed.page.loadArticles();
  assert.equal(Object.keys(failed.page.pageCache).length, 0);
  assert.equal(failed.element('article-directory-error').textContent, 'HTTP 499 / -2014');
  assert.equal(failed.element('articles-pagination').style.display, 'none');
  console.log('PASS: error payload is never cached as one complete article');

  const unsafe = fixture(async () => { throw new Error('<img src=x onerror=bad()>'); });
  await unsafe.page.loadArticles();
  assert.equal(unsafe.element('article-directory-error').textContent, '<img src=x onerror=bad()>');
  assert.ok(!unsafe.element('articles-list').innerHTML.includes('onerror'));
  console.log('PASS: error text is displayed as text');

  let resolveOld;
  const race = fixture(id => id === 'old' ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ articles: [{ id: 'new' }], total: 1, can_msg_continue: 0 }));
  race.page.currentFakeid = 'old';
  const older = race.page.loadArticles();
  race.page.currentFakeid = 'new';
  await race.page.loadArticles();
  resolveOld({ articles: [{ id: 'old' }], total: 1, can_msg_continue: 0 });
  await older;
  assert.equal(race.page.articles[0].id, 'new');
  console.log('PASS: old account response cannot overwrite the selected account');
})().catch(error => { console.error(error); process.exitCode = 1; });
