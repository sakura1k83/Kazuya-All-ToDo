// 使い方: node scripts/import-external.mjs --source <gcal|mykomon> --file <items.json> [--dry-run]
// todo-app と同一機構（GitHub contents API＋既存PAT）で tasks.json にマージする。
// items.json 形式: {"items":[{"sourceId","name","due","time","memo","tags":[]}]}
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeExternal } from './merge-external.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// タスクデータは非公開リポジトリに置く（公開側はアプリ本体のみ・2026-07-02の機密対応）
const REPO = 'sakura1k83/Kazuya-All-ToDo-data';
const API = `https://api.github.com/repos/${REPO}/contents/tasks.json`;
// 同期設定・状態の置き場（WS/.claude/sync ＝ git外・Dropbox内）
const SYNC_DIR = process.env.TODO_SYNC_DIR
  || path.resolve(APP_ROOT, '..', '..', '..', '.claude', 'sync');

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const has = (name) => process.argv.includes(name);

function loadPat() {
  // 優先順: 環境変数 → ファイル指定 → .gh-pat.txt → Git資格情報マネージャー（git pull/pushと同じ認証）
  // ※トークンはログ・例外メッセージに一切含めないこと。
  if (process.env.TODO_GH_PAT) return process.env.TODO_GH_PAT.trim();
  const file = process.env.TODO_GH_PAT_FILE || path.join(APP_ROOT, '.gh-pat.txt');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', cwd: APP_ROOT,
  });
  const m = r.status === 0 ? r.stdout.match(/^password=(.+)$/m) : null;
  if (m) return m[1].trim();
  throw new Error('GitHub認証が見つかりません（TODO_GH_PAT / TODO_GH_PAT_FILE / .gh-pat.txt / git credential のいずれか）');
}

const headers = (pat) => ({
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'todo-import',
});

async function ghGet(pat) {
  const res = await fetch(API, { headers: headers(pat) });
  if (!res.ok) throw new Error(`GET tasks.json 失敗: HTTP ${res.status}`);
  const json = await res.json();
  return { doc: JSON.parse(Buffer.from(json.content, 'base64').toString('utf8')), sha: json.sha };
}

async function ghPut(pat, doc, sha, message) {
  return fetch(API, {
    method: 'PUT',
    headers: { ...headers(pat), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, content: Buffer.from(JSON.stringify(doc, null, 2)).toString('base64') }),
  });
}

// ※ process.exit() は使わない（Node 25 Windows で終了時アサーション落ちし、exit codeが化けるため）。
//   異常時は process.exitCode を立てて自然終了させる。
async function main() {
  const SOURCES = ['gcal', 'gmail', 'mykomon'];
  const source = (arg('--source') || '').trim();
  const file = (arg('--file') || '').trim();
  if (!source || !file || !SOURCES.includes(source)) {
    console.error(`使い方: node scripts/import-external.mjs --source <${SOURCES.join('|')}> --file <items.json> [--dry-run]`);
    process.exitCode = 1;
    return;
  }

  // 同期設定でOFFのソースは取り込まない（設定はtodo-appの同期画面から変更）
  const cfgPath = path.join(SYNC_DIR, 'sync-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg[source] === false) { console.log(`${source}: OFF設定のためスキップ`); return; }
    } catch { /* 設定破損時は取込を止めない */ }
  }

  const items = JSON.parse(fs.readFileSync(file, 'utf8')).items;
  const pat = loadPat();

  let { doc, sha } = await ghGet(pat);
  let r = mergeExternal(doc, items, source, new Date().toISOString());
  console.log(`${source}: 追加 ${r.added} / 更新 ${r.updated} / スキップ ${r.skipped}`);

  if (has('--dry-run')) { console.log('(dry-run: 書き込みなし)'); return; }
  if (r.added + r.updated === 0) { console.log('変更なし。'); writeStatus(source, r); return; }

  let res = await ghPut(pat, r.doc, sha, `import: ${source} ${r.added}件追加/${r.updated}件更新`);
  if (res.status === 409 || res.status === 422) {
    // アプリ側の同時保存とのSHA競合: 1回だけ取り直して再マージ。
    // 再取得後の doc にはユーザーの保存内容（他タスク・status/priority/tags・完了）が
    // 全て含まれ、merge はそれらに触れない。取込タスクの name/due/memo だけは
    // 「元システムが正」の契約（設計書§4b）により元データ側の値になる。
    ({ doc, sha } = await ghGet(pat));
    r = mergeExternal(doc, items, source, new Date().toISOString());
    res = await ghPut(pat, r.doc, sha, `import: ${source} ${r.added}件追加/${r.updated}件更新 (retry)`);
  }
  if (!res.ok) { console.error(`PUT 失敗: HTTP ${res.status} ${await res.text()}`); process.exitCode = 1; return; }
  console.log('tasks.json 更新完了（todo-app側は「↻ 同期」ボタンで反映）');
  writeStatus(source, r);
}

// 同期状態を記録する（todo-app同期画面と朝会ブリーフが参照）
function writeStatus(source, r) {
  try {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
    const stPath = path.join(SYNC_DIR, 'sync-status.json');
    const st = fs.existsSync(stPath) ? JSON.parse(fs.readFileSync(stPath, 'utf8')) : {};
    st[source] = { lastRun: new Date().toISOString(), added: r.added, updated: r.updated };
    fs.writeFileSync(stPath, JSON.stringify(st, null, 2));
  } catch { /* 状態記録の失敗で取込自体は失敗させない */ }
}

main().catch((e) => { console.error(`エラー: ${e.message}`); process.exitCode = 1; });
