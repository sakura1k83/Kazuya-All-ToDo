import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScheduleHtml } from './parse-schedule.mjs';

const FIXTURE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mykomon-viewweekly-sample.html'),
  'utf8',
);
const TODAY = '20260701';

test('自分の予定のみ抽出（member_block・ToDo・過去日は対象外）', () => {
  const items = parseScheduleHtml(FIXTURE, TODAY);
  assert.deepEqual(items.map((i) => i.sourceId), ['s10000001', 's10000002', 's10000003', 's10000004']);
});

test('時刻あり予定: 🗓+開始時刻のname・時間memo・dueはセル日付・実体参照復号', () => {
  const [a] = parseScheduleHtml(FIXTURE, TODAY);
  assert.deepEqual(a, {
    sourceId: 's10000001',
    name: '🗓 09:30 (株)ダミー商事 定例訪問 & 資料回収',
    due: '2026-07-01',
    memo: '時間: 09:30-10:30',
    tags: ['会計事務所', '予定'],
  });
});

test('0h00m（時刻なし）は時刻プレフィックスも時間memoも付けない', () => {
  const c = parseScheduleHtml(FIXTURE, TODAY).find((i) => i.sourceId === 's10000003');
  assert.equal(c.name, '🗓 午前 仮');
  assert.equal(c.memo, '');
});

test('複数日予定は最初の出現（開始日）だけ・開始時刻つき', () => {
  const items = parseScheduleHtml(FIXTURE, TODAY);
  const multi = items.filter((i) => i.sourceId === 's10000004');
  assert.equal(multi.length, 1);
  assert.equal(multi[0].due, '2026-07-02');
  assert.equal(multi[0].name, '🗓 10:00 巡回');
  assert.equal(multi[0].memo, '時間: 10:00-7/7');
});

test('todayYmd当日の予定は含む・前日は含まない（境界）', () => {
  const on = parseScheduleHtml(FIXTURE, '20260629');
  assert.ok(on.some((i) => i.sourceId === 's90000001'));
  const after = parseScheduleHtml(FIXTURE, '20260630');
  assert.ok(!after.some((i) => i.sourceId === 's90000001'));
});

test('sourceIdはtodoIdとID空間が分離される（s接頭辞）＋items形式互換', () => {
  for (const it of parseScheduleHtml(FIXTURE, TODAY)) {
    assert.match(it.sourceId, /^s\d+$/);
    assert.ok(it.name.startsWith('🗓 '));
    assert.match(it.due, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof it.memo, 'string');
    assert.deepEqual(it.tags, ['会計事務所', '予定']);
  }
});

test('myself_blockが無いHTMLは空配列（エラーにしない）', () => {
  assert.deepEqual(parseScheduleHtml('<html><body>ログイン</body></html>', TODAY), []);
});
