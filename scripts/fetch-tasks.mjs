// tasks.json の正本（非公開repo）を取得して標準出力へ出す。
// 使い方: node scripts/fetch-tasks.mjs [--out <保存先パス>]
// 認証は import-external.mjs と同じ（git credential fill・トークン非出力）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'sakura1k83/Kazuya-All-ToDo-data';
const API = `https://api.github.com/repos/${REPO}/contents/tasks.json`;

function loadPat() {
  if (process.env.TODO_GH_PAT) return process.env.TODO_GH_PAT.trim();
  const file = process.env.TODO_GH_PAT_FILE || path.join(APP_ROOT, '.gh-pat.txt');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', cwd: APP_ROOT,
  });
  const m = r.status === 0 ? r.stdout.match(/^password=(.+)$/m) : null;
  if (m) return m[1].trim();
  throw new Error('GitHub認証が見つかりません');
}

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };

async function main() {
  const res = await fetch(API, {
    headers: { Authorization: `Bearer ${loadPat()}`, Accept: 'application/vnd.github+json', 'User-Agent': 'todo-fetch' },
  });
  if (!res.ok) { console.error(`GET tasks.json 失敗: HTTP ${res.status}`); process.exitCode = 1; return; }
  const json = await res.json();
  const text = Buffer.from(json.content, 'base64').toString('utf8');
  const out = arg('--out');
  if (out) { fs.writeFileSync(out, text); console.error(`保存: ${out}`); }
  else process.stdout.write(text);
}

main().catch((e) => { console.error(`エラー: ${e.message}`); process.exitCode = 1; });
