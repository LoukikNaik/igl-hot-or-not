#!/usr/bin/env node
// Voter breakdown from the LIVE D1 database (read-only), via wrangler.
// Needs wrangler auth (same account the Worker is deployed under).
//
// Usage:
//   node scripts/voters.js          print once
//   node scripts/voters.js -w       live view, refresh every 20s (D1 calls are slower)
//   node scripts/voters.js -w 30    every 30s   (Ctrl+C to stop)

const { execFileSync } = require('node:child_process');
const path = require('path');
const WORKER = path.join(__dirname, '..', 'worker');

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'igl-votes', '--remote', '--json', '--command', sql],
    { cwd: WORKER, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const start = out.indexOf('['); // strip any wrangler banner before the JSON
  return JSON.parse(out.slice(start))[0].results;
}

function snapshot() {
  const rows = d1(`SELECT voter_id, COUNT(*) AS v, MIN(created_at) AS f, MAX(created_at) AS l
                     FROM faceoffs GROUP BY voter_id ORDER BY v DESC`);
  const scores = d1(`SELECT COUNT(*) AS n FROM ratings`)[0].n;
  const totalVotes = rows.reduce((a, r) => a + r.v, 0);
  const unlocked = rows.filter(r => r.v >= 10).length;
  return { rows, totalVotes, unlocked, scores };
}

function render() {
  const { rows, totalVotes, unlocked, scores } = snapshot();
  const hm = t => (t || '').slice(11, 16);
  const out = [];
  out.push(`IGL voters (live D1)  ·  ${new Date().toLocaleString()}`);
  out.push('');
  out.push('   #  voter (anon id)             votes   active window');
  out.push('  ' + '-'.repeat(66));
  rows.forEach((r, i) => {
    const win = hm(r.f) === hm(r.l) ? hm(r.f) : `${hm(r.f)}-${hm(r.l)}`;
    out.push('  ' + String(i + 1).padStart(2) + '  ' + r.voter_id.padEnd(26) + ' ' + String(r.v).padStart(5) + '    ' + win);
  });
  out.push('  ' + '-'.repeat(66));
  const avg = rows.length ? (totalVotes / rows.length).toFixed(1) : '0';
  out.push(`  ${rows.length} voters · ${totalVotes} votes · avg ${avg} · ` +
           `${unlocked} unlocked the leaderboard (>=10)` + (scores ? ` · ${scores} judge scores` : ''));
  return out.join('\n');
}

const args = process.argv.slice(2);
const watch = args.includes('-w') || args.includes('--watch');
const secs = parseInt(args.find(a => /^\d+$/.test(a)), 10) || 20;

if (!watch) {
  console.log(render());
} else {
  const tick = () => { process.stdout.write('\x1b[2J\x1b[H'); console.log(render()); };
  tick();
  setInterval(tick, secs * 1000);
  console.log(`\n(refreshing every ${secs}s — Ctrl+C to stop)`);
}
