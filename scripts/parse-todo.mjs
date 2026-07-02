// マイ顧問（www.mykomon.com）の /groupware/listTodo HTMLからToDo行を抽出する純関数。
// userscript（.claude/sync/userscript/mykomon-todo-sync.user.js）と同一ロジック。
// 変更時は両方を更新すること（userscriptはモジュールを読めないためコピーを内蔵している）。
//
// 実DOM構造（2026-07-02採取）:
//   <tr class="todo_row todo_unit" id="todo_<数字ID>">
//     <td class="state">…</td>
//     <td class="title"><a href="…refTodoView?todoId=…">タイトル</a>…</td>
//     <td class="… todo_date plan [date_YYYYMMDD]"><span>YYYY/MM/DD</span></td>   ← 予定日（空あり）
//     <td class="… todo_date limit [date_YYYYMMDD]"><span>YYYY/MM/DD</span></td>  ← 期限（空あり）
//     <td class="nowrap_center category">…</td>
//     <td class="nowrap_center"><div class="priority …"><span class="priority_label_…">高</span></div></td>
//     <td class="… complete_state"><span class="complete_status_view">未完了|完了</span><select>…</select></td>
//   </tr>
// due は「期限 → なければ予定日」（既存取込データと同じ規則）。「完了」行は取込まない
// （取込むと未着手タスクとして復活してしまうため）。

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

const textOf = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseTodoHtml(html) {
  const items = [];
  // ※マイ顧問のHTMLは属性クォートが混在（listTodo=ダブル・viewWeekly=シングル）。["']で両対応する
  const rowRe = /<tr[^>]*\bclass=["'][^"']*todo_row[^"']*["'][^>]*\bid=["']todo_(\d+)["'][^>]*>([\s\S]*?)<\/tr>/g;
  for (const m of String(html).matchAll(rowRe)) {
    const [, todoId, row] = m;
    const nameMatch = row.match(/<td[^>]*\bclass=["'][^"']*\btitle\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const name = nameMatch ? textOf(nameMatch[1]) : '';
    if (!name) continue;
    const state = (row.match(/complete_status_view[^>]*>([^<]*)</) || [, ''])[1].trim();
    if (state === '完了') continue;
    const dateIn = (cls) => {
      const cell = (row.match(new RegExp(`<td[^>]*\\bclass=["'][^"']*todo_date ${cls}[^"']*["'][^>]*>[\\s\\S]*?<\\/td>`)) || [''])[0];
      const d = cell.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      return d ? `${d[1]}-${d[2]}-${d[3]}` : null;
    };
    const catMatch = row.match(/<td[^>]*\bclass=["'][^"']*\bcategory\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/);
    const cat = catMatch ? textOf(catMatch[1]) : '';
    const pri = (row.match(/priority_label_\w+[^>]*>([^<]*)</) || [, ''])[1].trim();
    items.push({
      sourceId: todoId,
      name,
      due: dateIn('limit') ?? dateIn('plan'),
      memo: `カテゴリ:${cat || '－'} 優先度:${pri || '－'}`,
      tags: ['会計事務所'],
    });
  }
  return items;
}
