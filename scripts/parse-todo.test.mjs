import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTodoHtml } from './parse-todo.mjs';

const FIXTURE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mykomon-listtodo-sample.html'),
  'utf8',
);

test('fixtureから未完了2件を抽出する（完了行はスキップ）', () => {
  const items = parseTodoHtml(FIXTURE);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.sourceId), ['11111111', '22222222']);
});

test('日付なし行: due=null・優先度をmemoへ・タグは会計事務所', () => {
  const [a] = parseTodoHtml(FIXTURE);
  assert.deepEqual(a, {
    sourceId: '11111111',
    name: '(株)ダミー商事／単発相談',
    due: null,
    memo: 'カテゴリ:－ 優先度:高',
    tags: ['会計事務所'],
  });
});

test('期限と予定日の両方がある行は期限を優先し、YYYY-MM-DDに正規化・実体参照を復号', () => {
  const [, b] = parseTodoHtml(FIXTURE);
  assert.equal(b.due, '2026-07-10');
  assert.equal(b.name, '(株)サンプル製作所／月次監査 & 資料回収');
  assert.equal(b.memo, 'カテゴリ:月次 優先度:－');
});

test('期限が空で予定日のみの行は予定日をdueにする', () => {
  const html = FIXTURE.replace('id="todo_33333333"', 'id="todo_33333333"')
    .replace('<span class="complete_status_view">完了</span>', '<span class="complete_status_view">未完了</span>');
  const c = parseTodoHtml(html).find((i) => i.sourceId === '33333333');
  assert.equal(c.due, '2026-06-01');
});

test('todo_row以外のtrやタイトル空行は無視する', () => {
  assert.deepEqual(parseTodoHtml('<table><tr><td>関係ない行</td></tr></table>'), []);
  const noName = '<tr class="todo_row" id="todo_44444444"><td class="title"><a>  </a></td></tr>';
  assert.deepEqual(parseTodoHtml(noName), []);
});

test('import-externalのitems形式（sourceId/name/due/memo/tags）と互換', () => {
  for (const it of parseTodoHtml(FIXTURE)) {
    assert.equal(typeof it.sourceId, 'string');
    assert.ok(it.name.length > 0);
    assert.ok(it.due === null || /^\d{4}-\d{2}-\d{2}$/.test(it.due));
    assert.equal(typeof it.memo, 'string');
    assert.deepEqual(it.tags, ['会計事務所']);
  }
});
