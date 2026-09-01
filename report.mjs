#!/usr/bin/env node
/**
 * Quality report on the monitor itself — "is this thing actually doing its job?"
 *
 * A monitor that stays silent is indistinguishable from a monitor that stopped running.
 * This reads the run history and answers the three questions that matter:
 *   1. Did it actually run every hour, or are there gaps (cron drift, disabled schedule)?
 *   2. What failed, when, and for which target?
 *   3. How long do runs take (creeping duration = a site getting slower, or a flaky check)?
 *
 * Per-check detail and flake records live in each run's GitHub summary page — this report
 * links you to the runs worth opening rather than downloading a thousand logs.
 *
 * Usage:  node report.mjs [days]     # default 30. Needs the `gh` CLI, authenticated.
 */

import { execFileSync } from 'node:child_process';

const REPO = 'zahareus/synthetic-monitor';
const DAYS = Number(process.argv[2] || 30);
const EXPECTED_GAP_MIN = 60;
// GitHub's scheduler drifts 0-15 min under load, so anything under ~1h40m is normal jitter,
// not a missed run. Flagging honest jitter as an outage would make this report as untrustworthy
// as a monitor that cries wolf.
const GAP_ALERT_MIN = 100;

function gh(args) {
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

const since = new Date(Date.now() - DAYS * 86400000);
const runs = gh([
    'api', '--paginate',
    `/repos/${REPO}/actions/workflows/monitor.yml/runs?per_page=100&created=>=${since.toISOString().slice(0, 10)}`,
    '--jq', '[.workflow_runs[] | {id, status, conclusion, created_at, run_started_at, updated_at}]'
].flat()).flat?.() ?? [];

const done = runs.filter((r) => r.status === 'completed')
    .sort((a, b) => new Date(a.run_started_at) - new Date(b.run_started_at));

if (!done.length) {
    console.log(`No completed runs in the last ${DAYS} days. That is itself the finding.`);
    process.exit(0);
}

const first = new Date(done[0].run_started_at);
const last = new Date(done[done.length - 1].run_started_at);
const hoursCovered = (last - first) / 3600000;
const expected = Math.floor(hoursCovered / (EXPECTED_GAP_MIN / 60)) + 1;

console.log(`\n📊 Synthetic monitor — quality report (last ${DAYS} days)`);
console.log(`   window : ${first.toISOString().slice(0, 16)} → ${last.toISOString().slice(0, 16)}`);
console.log(`   runs   : ${done.length} completed, ~${expected} expected at hourly cadence`);

// ── Coverage gaps ────────────────────────────────────────────────────────────
const gaps = [];
for (let i = 1; i < done.length; i++) {
    const prev = new Date(done[i - 1].run_started_at);
    const cur = new Date(done[i].run_started_at);
    const mins = Math.round((cur - prev) / 60000);
    if (mins > GAP_ALERT_MIN) gaps.push({ from: prev.toISOString().slice(0, 16), to: cur.toISOString().slice(0, 16), mins });
}
console.log(`\n⏱  Coverage`);
if (!gaps.length) {
    console.log(`   No gap longer than ${GAP_ALERT_MIN} min — the schedule held.`);
} else {
    console.log(`   ${gaps.length} gap(s) longer than ${GAP_ALERT_MIN} min:`);
    for (const g of gaps) console.log(`   • ${g.from} → ${g.to}  (${Math.round(g.mins / 60 * 10) / 10}h of blind time)`);
    console.log(`   Gaps mean the monitor was not watching. Check for a disabled schedule or Actions outage.`);
}

// ── Failures per target ──────────────────────────────────────────────────────
console.log(`\n🎯 Results per target`);
const failedRuns = done.filter((r) => r.conclusion !== 'success');
const perTarget = {};
for (const r of failedRuns) {
    const jobs = gh(['api', `/repos/${REPO}/actions/runs/${r.id}/jobs`, '--jq',
        '[.jobs[] | select(.conclusion != "success") | {name, conclusion, html_url}]']);
    for (const j of jobs) {
        const t = (j.name.match(/\(([^)]+)\)/) || [, j.name])[1];
        (perTarget[t] ||= []).push({ at: r.run_started_at.slice(0, 16), url: j.html_url });
    }
}
const targets = ['ledap', 'soker', 'formalista'];
for (const t of targets) {
    const f = perTarget[t] || [];
    const rate = done.length ? ((1 - f.length / done.length) * 100).toFixed(1) : '—';
    console.log(`   ${f.length ? '❌' : '✅'} ${t.padEnd(11)} ${String(f.length).padStart(3)} failed run(s)   ${rate}% green`);
    for (const x of f.slice(0, 8)) console.log(`        ${x.at}  ${x.url}`);
    if (f.length > 8) console.log(`        …and ${f.length - 8} more`);
}

// ── Duration trend ───────────────────────────────────────────────────────────
const durs = done.map((r) => (new Date(r.updated_at) - new Date(r.run_started_at)) / 1000).filter((d) => d > 0).sort((a, b) => a - b);
const pick = (p) => Math.round(durs[Math.floor(durs.length * p)] || 0);
console.log(`\n⚡ Run duration: median ${pick(0.5)}s · p90 ${pick(0.9)}s · slowest ${Math.round(durs[durs.length - 1])}s`);

console.log(`\n💡 Per-check detail and flake records ("passed on retry") are in each run's summary page.`);
console.log(`   Open a failed run above, or browse: https://github.com/${REPO}/actions/workflows/monitor.yml\n`);
