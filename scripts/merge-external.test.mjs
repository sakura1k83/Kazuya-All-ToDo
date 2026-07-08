import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeExternal, externalId } from './merge-external.mjs';

const NOW = '2026-07-02T09:00:00.000Z';
const doc = () => ({ tasks: [
  { id: 'manual1', name: '手動タスク', status: '未着手', priority: '🟡 高', tags: ['eBay事業'],
    due: '2026-07-10', memo: '', itemType: 'task', isProject: false, subtasks: [],
    createdAt: NOW, completedAt: null, order: 3 },
]});
const ev = (over = {}) => ({ sourceId: 'ev1_20260703', name: '例会', due: '2026-07-03',
  time: '18:00', memo: '会場A', tags: ['予定'], ...over });

test('新規イベントは schedule として追加される（📅時刻プレフィックス・order採番）', () => {
  const r = mergeExternal(doc(), [ev()], 'gcal', NOW);
  assert.equal(r.added, 1);
  const t = r.doc.tasks.find((x) => x.id === externalId('gcal', 'ev1_20260703'));
  assert.equal(t.name, '📅 18:00 例会');
  assert.equal(t.due, '2026-07-03');
  assert.equal(t.status, '未着手');
  assert.equal(t.priority, '🟢 中');
  assert.deepEqual(t.tags, ['予定']);
  assert.equal(t.order, 4); // 既存max(3)+1
});

test('再実行しても件数が増えない（冪等）', () => {
  const first = mergeExternal(doc(), [ev()], 'gcal', NOW);
  const second = mergeExternal(first.doc, [ev()], 'gcal', NOW);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.doc.tasks.length, first.doc.tasks.length);
});

test('未完了の取込タスクは元データ側の値で更新される（優先度・タグ・状態は保持）', () => {
  const first = mergeExternal(doc(), [ev()], 'gcal', NOW);
  const t = first.doc.tasks.find((x) => x.id === externalId('gcal', 'ev1_20260703'));
  t.priority = '🔴 最優先'; // ユーザーが手で変えた想定
  const r = mergeExternal(first.doc, [ev({ time: '19:00', due: '2026-07-04' })], 'gcal', NOW);
  assert.equal(r.updated, 1);
  const t2 = r.doc.tasks.find((x) => x.id === externalId('gcal', 'ev1_20260703'));
  assert.equal(t2.name, '📅 19:00 例会');
  assert.equal(t2.due, '2026-07-04');
  assert.equal(t2.priority, '🔴 最優先'); // 保持
});

test('完了済みタスクは再取込で復活・変更されない', () => {
  const first = mergeExternal(doc(), [ev()], 'gcal', NOW);
  const t = first.doc.tasks.find((x) => x.id === externalId('gcal', 'ev1_20260703'));
  t.status = '完了'; t.completedAt = NOW;
  const r = mergeExternal(first.doc, [ev({ time: '19:00' })], 'gcal', NOW);
  assert.equal(r.updated, 0);
  const t2 = r.doc.tasks.find((x) => x.id === externalId('gcal', 'ev1_20260703'));
  assert.equal(t2.name, '📅 18:00 例会'); // 変わらない
  assert.equal(t2.status, '完了');
});

test('手動タスクには一切触れない', () => {
  const r = mergeExternal(doc(), [ev()], 'gcal', NOW);
  const m = r.doc.tasks.find((x) => x.id === 'manual1');
  assert.deepEqual(m, doc().tasks[0]);
});

test('不正アイテム（sourceId/name/due欠落）はスキップされる', () => {
  const r = mergeExternal(doc(), [ev({ sourceId: null }), ev({ name: '' }), ev({ due: null })], 'gcal', NOW);
  assert.equal(r.added, 0);
  assert.equal(r.skipped, 3);
});

test('mykomonソースは📅を付けない・タグはそのまま', () => {
  const r = mergeExternal(doc(), [ev({ sourceId: 'mk1', name: '月次監査 A社', time: null, tags: ['会計事務所'] })], 'mykomon', NOW);
  const t = r.doc.tasks.find((x) => x.id === externalId('mykomon', 'mk1'));
  assert.equal(t.name, '月次監査 A社');
  assert.deepEqual(t.tags, ['会計事務所']);
});

test('externalIdは全単射（a b ≠ a_b、エスケープ形と識別形の値域が交わらない）', () => {
  assert.notEqual(externalId('gcal', 'a b'), externalId('gcal', 'a_b'));
  // エスケープ形は必ず "gcal-." 始まり／識別形（\w+）に "." は現れ得ない
  assert.ok(externalId('gcal', 'a b').startsWith('gcal-.'));
  assert.ok(!externalId('gcal', 'a_b').includes('.'));
  // Codex指摘の攻撃形: 変換後の見た目を元から持つIDとも衝突しない
  const transformed = externalId('gcal', 'a b'); // gcal-.a.20.b
  const literalTail = transformed.slice('gcal-'.length); // ".a.20.b" をsourceIdとして持つ場合
  assert.notEqual(externalId('gcal', literalTail), transformed);
});

test('externalIdは語構成文字のみのID（Google ID等）を変えない（後方互換）', () => {
  // Googleイベント ID と同形式のダミー（実IDは公開リポジトリに置かない）
  const gid = '_0example0id0same0shape0as0google0calendar0event0id0000000000';
  assert.equal(externalId('gcal', gid), `gcal-${gid}`);
});

test('入力docを破壊しない（純関数）', () => {
  const input = doc();
  const snapshot = structuredClone(input);
  mergeExternal(input, [ev()], 'gcal', NOW);
  assert.deepEqual(input, snapshot);
});

test('gmailソースは📧プレフィックス・dueなしを許容する', () => {
  const r = mergeExternal(doc(), [{ sourceId: 'th_abc', name: '請求書の件', memo: '差出人: x@y.jp', tags: ['メール'] }], 'gmail', NOW);
  assert.equal(r.added, 1);
  const t = r.doc.tasks.find((x) => x.id === externalId('gmail', 'th_abc'));
  assert.equal(t.name, '📧 請求書の件');
  assert.equal(t.due, null);
});

test('gcalは引き続きdue必須（欠落はスキップ）', () => {
  const r = mergeExternal(doc(), [ev({ due: null })], 'gcal', NOW);
  assert.equal(r.added, 0);
  assert.equal(r.skipped, 1);
});

test('mykomonはdue任意・プレフィックスなし', () => {
  const r = mergeExternal(doc(), [{ sourceId: '12345678', name: '(株)サンプル製作所／決算資料準備', tags: ['会計事務所'], memo: '優先度:高' }], 'mykomon', NOW);
  const t = r.doc.tasks.find((x) => x.id === externalId('mykomon', '12345678'));
  assert.equal(t.name, '(株)サンプル製作所／決算資料準備');
  assert.equal(t.due, null);
});

test('nameとmemoはtrimされ、空白のみのnameはスキップされる', () => {
  const r = mergeExternal(doc(), [ev({ name: '  例会  ', memo: ' 会場A ' }), ev({ sourceId: 'ev2', name: '   ' })], 'gcal', NOW);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 1);
  const t = r.doc.tasks.find((x) => x.id === externalId('gcal', 'ev1_20260703'));
  assert.equal(t.name, '📅 18:00 例会');
  assert.equal(t.memo, '会場A');
});

test('予定タグ付き新規は itemType:schedule で追加される', () => {
  const r = mergeExternal(doc(), [ev()], 'gcal', NOW); // ev() は tags:['予定']
  const t = r.doc.tasks.find((x) => x.id === externalId('gcal', 'ev1_20260703'));
  assert.equal(t.itemType, 'schedule');
});

test('予定タグを持たない取込は itemType:task のまま', () => {
  const r = mergeExternal(doc(), [{ sourceId: 'mk9', name: '月次監査', tags: ['会計事務所'] }], 'mykomon', NOW);
  const t = r.doc.tasks.find((x) => x.id === externalId('mykomon', 'mk9'));
  assert.equal(t.itemType, 'task');
});

test('既存が task の予定アイテムは再取込で itemType:schedule に再分類される（updated）', () => {
  const id = externalId('gcal', 'ev1_20260703');
  const legacy = { id, name: '📅 18:00 例会', status: '未着手', priority: '🟢 中',
    tags: ['予定'], due: '2026-07-03', memo: '会場A', itemType: 'task', isProject: false,
    subtasks: [], createdAt: NOW, completedAt: null, order: 1 };
  const r = mergeExternal({ tasks: [legacy] }, [ev()], 'gcal', NOW);
  const t = r.doc.tasks.find((x) => x.id === id);
  assert.equal(t.itemType, 'schedule');
  assert.equal(r.updated, 1);
});
