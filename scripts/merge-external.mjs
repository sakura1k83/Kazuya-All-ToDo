// 外部アイテム（正規化済み）を tasks.json ドキュメントへマージする純関数。
// 入力 doc は破壊しない（structuredClone）。決定的（now は引数で受ける）。
// ルール正本: docs/superpowers/specs/2026-07-02-todo集約ハブ-外部取込-design.md §4b
// 重複防止の要: タスクidを `<source>-<sourceId>` にする（idはアプリの保存で必ず保持される）。

export function externalId(source, sourceId) {
  const raw = String(sourceId);
  // 識別形: 語構成文字（\w＝英数字と_）のみのIDはそのまま。
  // GoogleイベントID等はこの形＝本番取込済みタスクのIDと後方互換。
  if (/^\w+$/.test(raw)) return `${source}-${raw}`;
  // エスケープ形: 英数字以外を `.hex.` に置換し、先頭に `.` を付ける（全単射）。
  // 識別形には `.` が現れ得ないため両者の値域は交わらず、衝突は構造的に不可能。
  // エスケープ形同士も `.hex.` 区切りで一意に復号できるため衝突しない。
  const encoded = raw.replace(/[^A-Za-z0-9]/g, (c) => `.${c.codePointAt(0).toString(16)}.`);
  return `${source}-.${encoded}`;
}

// ソース別の表示プレフィックスと、due（期限/予定日）が必須のソース
const PREFIX = { gcal: '📅', gmail: '📧' };
const DUE_REQUIRED = new Set(['gcal']);

export function mergeExternal(doc, items, source, nowIso) {
  const base = structuredClone(doc ?? {});
  const tasks = Array.isArray(base.tasks) ? base.tasks : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let maxOrder = tasks.reduce((m, t) => (typeof t.order === 'number' && t.order > m ? t.order : m), 0);
  const result = { added: 0, updated: 0, skipped: 0 };

  for (const item of items ?? []) {
    const rawName = typeof item?.name === 'string' ? item.name.trim() : '';
    const due = item?.due ?? null;
    if (!item || !item.sourceId || !rawName) { result.skipped++; continue; }
    if (DUE_REQUIRED.has(source) && !due) { result.skipped++; continue; }
    const id = externalId(source, item.sourceId);
    const prefix = PREFIX[source];
    const name = prefix
      ? `${prefix} ${item.time ? item.time + ' ' : ''}${rawName}`
      : rawName;
    const memo = String(item.memo ?? '').trim();
    const itemType = (Array.isArray(item.tags) && item.tags.includes('予定')) ? 'schedule' : 'task';
    const existing = byId.get(id);

    if (!existing) {
      maxOrder += 1;
      const task = {
        id, name,
        status: '未着手',
        priority: '🟢 中',
        tags: Array.isArray(item.tags) ? [...item.tags] : [],
        due,
        memo,
        itemType, isProject: false, subtasks: [],
        createdAt: nowIso, completedAt: null,
        order: maxOrder,
      };
      tasks.push(task); byId.set(id, task); result.added++;
    } else if (existing.completedAt || existing.status === '完了') {
      result.skipped++; // 完了済みは復活・変更させない
    } else {
      // 契約: 取込タスクの name/due/memo は元システム（カレンダー等）が正であり、
      // 取込のたびに元データ側の値で更新する。status/priority/tags/subtasks 等の
      // ユーザー操作フィールドには触れない（競合リトライ時も同じ規則が適用される）。
      const changed = existing.name !== name || existing.due !== due
        || (existing.memo ?? '') !== memo || existing.itemType !== itemType;
      if (changed) {
        existing.name = name; existing.due = due; existing.memo = memo;
        existing.itemType = itemType;
        result.updated++;
      } else {
        result.skipped++;
      }
    }
  }
  return { doc: { ...base, tasks }, ...result };
}
