// マイ顧問（www.mykomon.com）の /groupware/viewWeekly HTMLから「自分の予定」を抽出する純関数。
// userscript（.claude/sync/userscript/mykomon-todo-sync.user.js）と同一ロジック。
// 変更時は両方を更新すること（userscriptはモジュールを読めないためコピーを内蔵している）。
//
// 実DOM構造（2026-07-02採取）:
//   <table class="calendar gw_parts myself_block">   ← 自分の予定（member_block=他人・対象外）
//     <td class="sche_todo_block date_YYYYMMDD …">   ← 日付セル（クラスに日付）
//       <div class="job_unit …">
//         <div class="job_time">11:00-12:00</div>    ← 時刻。"0h00m"=時刻なし・"10:00-7/7"=複数日開始・"7/2-7/7"=複数日中間
//         <div class="job_title"><a href="…refScheduleView?scheduleId=数字ID">件名</a></div>
//       </div>
//   複数日予定は毎日のセルに同じscheduleIdで現れる → 最初の出現（開始側）だけ残す。
// 方針: 過去の予定は取込まない（朝会の優先度づけに不要）。todayYmd（"YYYYMMDD"）より前のセルはスキップ。
// sourceIdは "s"+scheduleId（listTodoのtodoIdとID空間を分離し、mykomonソース1本で共存させる）。

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

const textOf = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseScheduleHtml(html, todayYmd) {
  const items = [];
  const seen = new Set();
  // ※マイ顧問のHTMLは属性クォートが混在（viewWeekly=シングル・listTodo=ダブル）。["']で両対応する
  const tableMatch = String(html).match(/<table[^>]*\bclass=["'][^"']*\bmyself_block\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return items;
  const cellRe = /<td[^>]*\bclass=["'][^"']*\bsche_todo_block\b[^"']*\bdate_(\d{8})[^"']*["'][^>]*>([\s\S]*?)<\/td>/g;
  for (const cm of tableMatch[1].matchAll(cellRe)) {
    const [, ymd, cell] = cm;
    if (todayYmd && ymd < String(todayYmd)) continue; // 過去日
    // job_unit境界で分割（unit内は入れ子divのため終了タグでは切れない）
    const segments = cell.split(/(?=<div[^>]*\bjob_unit\b)/).slice(1);
    for (const seg of segments) {
      const idMatch = seg.match(/refScheduleView\?scheduleId=(\d+)[^>]*>([\s\S]*?)<\/a>/);
      if (!idMatch) continue; // ToDoチェックボックス等・予定以外
      const sourceId = `s${idMatch[1]}`;
      if (seen.has(sourceId)) continue; // 複数日予定は最初の出現（開始日側）のみ
      const name = textOf(idMatch[2]);
      if (!name) continue;
      const rawTime = textOf((seg.match(/\bjob_time\b[^>]*>([\s\S]*?)<\/div>/) || [, ''])[1]);
      const hasTime = /^\d{2}:\d{2}/.test(rawTime); // "0h00m"や"7/2-7/7"は時刻なし扱い
      const startTime = hasTime ? rawTime.slice(0, 5) : null;
      seen.add(sourceId);
      items.push({
        sourceId,
        name: `🗓 ${startTime ? startTime + ' ' : ''}${name}`,
        due: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
        memo: rawTime && rawTime !== '0h00m' ? `時間: ${rawTime}` : '',
        tags: ['会計事務所', '予定'],
      });
    }
  }
  return items;
}
