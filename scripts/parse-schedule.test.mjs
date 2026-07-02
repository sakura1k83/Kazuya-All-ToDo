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

test('自分の予定のみ抽出（member_block・ToDo・終了済み予定は対象外）', () => {
  const items = parseScheduleHtml(FIXTURE, TODAY);
  assert.deepEqual(items.map((i) => i.sourceId), ['s10000001', 's10000002', 's10000005', 's10000003', 's10000004']);
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

test('進行中の複数日予定（開始が過去）は今日以降の最初のセルで取込む（Codex R1回帰）', () => {
  // 6/29開始・7/3終了の予定。今日=7/1なら継続セル（7/1）でdue=今日側として取込む。
  // 開始日を落とす厳密スキップにすると進行中の案件が朝会から消えるため、これは仕様。
  const items = parseScheduleHtml(FIXTURE, '20260701');
  const ongoing = items.filter((i) => i.sourceId === 's10000005');
  assert.equal(ongoing.length, 1);
  assert.equal(ongoing[0].due, '2026-07-01');
  assert.equal(ongoing[0].name, '🗓 監査ウィーク'); // 継続セルは時刻レンジでなく日付レンジ→時刻プレフィックスなし
  assert.equal(ongoing[0].memo, '時間: 6/29-7/3');
});

test('同じ複数日予定でも開始日が今日以降なら開始日セル（開始時刻つき）で取込む', () => {
  const items = parseScheduleHtml(FIXTURE, '20260629');
  const fromStart = items.filter((i) => i.sourceId === 's10000005');
  assert.equal(fromStart.length, 1);
  assert.equal(fromStart[0].due, '2026-06-29');
  assert.equal(fromStart[0].name, '🗓 15:30 監査ウィーク');
  assert.equal(fromStart[0].memo, '時間: 15:30-7/3');
});

test('全セルが過去の予定は取込まない（終了済みスキップ）', () => {
  const items = parseScheduleHtml(FIXTURE, '20260704');
  assert.ok(!items.some((i) => i.sourceId === 's90000001'));
  assert.ok(!items.some((i) => i.sourceId === 's10000005')); // 7/3終了→7/4時点で対象外
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

test('userNoガード: 行の持ち主が一致すれば全件・不一致なら0件（fail-closed）', () => {
  const ok = parseScheduleHtml(FIXTURE, TODAY, '0000000000000000');
  assert.equal(ok.length, 5);
  const ng = parseScheduleHtml(FIXTURE, TODAY, '1111111111111111');
  assert.deepEqual(ng, []);
});

test('userNoガード第2層: data-user-noが他人・欠落の予定単位はどちらも拒否（fail-closed）', () => {
  const html = `
<table class='calendar gw_parts myself_block'>
  <tr class='calendar_row user_0000000000000000 tr_user_0000000000000000'>
    <td class='sche_todo_block date_20260710 '>
      <div class='job_unit'><div class='job_time'>10:00-11:00</div>
        <div class='job_title'><a data-user-no='0000000000000000' href='refScheduleView?scheduleId=50000001'>本人の予定</a></div></div>
      <div class='job_unit'><div class='job_time'>13:00-14:00</div>
        <div class='job_title'><a data-user-no='9999999999999999' href='refScheduleView?scheduleId=50000002'>他人の予定</a></div></div>
      <div class='job_unit'><div class='job_time'>15:00-16:00</div>
        <div class='job_title'><a href='refScheduleView?scheduleId=50000003'>属性欠落（構造変化のシグナル＝拒否）</a></div></div>
    </td>
  </tr>
</table>`;
  const items = parseScheduleHtml(html, '20260701', '0000000000000000');
  assert.deepEqual(items.map((i) => i.sourceId), ['s50000001']);
  // userNo未指定なら従来どおり全件（ガードはopt-in・userscriptは常に指定する）
  assert.equal(parseScheduleHtml(html, '20260701').length, 3);
});
