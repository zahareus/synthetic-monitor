#!/usr/bin/env node
/**
 * Synthetic production monitor — one engine, many targets.
 *
 * Opens every key page of a LIVE site in a real (headless) browser and asserts it
 * actually works: not just HTTP 200, but the main content really rendered, no error
 * sentinel in the visible text, no critical console error. Client-rendered pages
 * return 200 while being completely dead, so a real browser is the only honest check.
 *
 * Beyond pages it also runs `json` checks — a direct fetch whose payload must satisfy
 * a predicate. For sites whose UI is auth-gated (GOAT outside Telegram) the data layer
 * is the ONLY thing worth checking; the page alone proves nothing.
 *
 * On ANY failure: ONE Telegram alert (@ksu_bot) + non-zero exit so the Actions
 * run goes red too. All-green = silent.
 *
 * Usage:  node monitor.mjs <target>        # target = file name in targets/
 * Env:    TELEGRAM_BOT_TOKEN (required to alert), TELEGRAM_CHAT_ID (default 292048)
 */

import * as pw from 'playwright';
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '292048';

// Sentinels that mean "this page rendered an error to the user".
const ERROR_TEXT = [
    'Initialization error',
    'cannot be loaded',
    'Cannot load',
    'Error: Cannot',
    'Access Denied', // only flagged where it shouldn't appear (see allowAccessDenied)
    'Something went wrong',
    'Failed to load',
    'Application error',           // Vercel's client-side crash page
    'There has been a critical error'
];

// Console error substrings that indicate real breakage — deliberately narrow, because
// third-party noise (blocked analytics beacons, CDN RUM) shows up on every site and
// must never page anyone. Verified against soker, which logs a blocked
// cloudflareinsights request on every load and matches none of these.
const CRITICAL_CONSOLE = [
    'failed to initialize',
    'is not defined',
    'is not a function',
    'Uncaught',
    'ReferenceError',
    'TypeError',
    'SyntaxError'
];

async function runPageCheck(browser, check) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

    const failures = [];
    try {
        const resp = await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        if (!resp || resp.status() >= 400) {
            failures.push(`HTTP ${resp ? resp.status() : 'no-response'}`);
        }
        // Let client JS run (init + first data fetch).
        await page.waitForTimeout(check.settle || 4000);

        const body = await page.evaluate(() => (document.body ? document.body.innerText : ''));

        for (const sentinel of ERROR_TEXT) {
            if (sentinel === 'Access Denied' && check.allowAccessDenied) continue;
            if (body.includes(sentinel)) failures.push(`page shows "${sentinel}"`);
        }

        const crit = consoleErrors.filter((e) => CRITICAL_CONSOLE.some((p) => e.includes(p)));
        if (crit.length) failures.push(`console: ${crit.slice(0, 2).join(' | ').slice(0, 200)}`);

        // Node merely present. Weak on purpose — use it only for structural pages.
        if (check.expect) {
            const found = await page.evaluate((sel) => !!document.querySelector(sel), check.expect);
            if (!found) failures.push(`missing expected node (${check.expect})`);
        }

        // Node present AND filled AND actually visible. This is the one that proves DATA
        // arrived: every one of these sites ships the empty container in its static HTML,
        // so `expect` alone stays green on a site whose data layer is dead.
        if (check.expectNonEmpty) {
            const state = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return 'absent';
                const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
                const text = (el.innerText || '').trim();
                if (!visible) return 'hidden';
                return text.length ? 'ok' : 'empty';
            }, check.expectNonEmpty);
            if (state !== 'ok') failures.push(`${check.expectNonEmpty} is ${state} — content did not render`);
        }

        if (check.expectText && !body.includes(check.expectText)) {
            failures.push(`missing expected text "${check.expectText}"`);
        }
        if (check.softContent && body.trim().length < 40) {
            failures.push('page is blank');
        }
    } catch (err) {
        failures.push('load error: ' + (err.message || String(err)).slice(0, 160));
    } finally {
        await page.close();
    }
    return failures;
}

async function runJsonCheck(check) {
    const failures = [];
    try {
        const r = await fetch(check.url, { headers: check.headers || {}, signal: AbortSignal.timeout(20000) });
        if (!r.ok) return [`HTTP ${r.status}`];
        let data;
        try {
            data = await r.json();
        } catch {
            return ['response is not valid JSON'];
        }
        const verdict = await check.must(data);
        if (verdict) failures.push(verdict);
    } catch (err) {
        failures.push('fetch error: ' + (err.message || String(err)).slice(0, 160));
    }
    return failures;
}

async function runCheck(browser, check) {
    const failures = check.type === 'json'
        ? await runJsonCheck(check)
        : await runPageCheck(browser, check);
    return { name: check.name, url: check.url, ok: failures.length === 0, failures };
}

async function sendTelegram(text) {
    if (!TG_TOKEN) {
        console.error('TELEGRAM_BOT_TOKEN not set — cannot send alert.');
        return;
    }
    const body = new URLSearchParams({
        chat_id: TG_CHAT,
        parse_mode: 'HTML',
        disable_web_page_preview: 'true',
        text
    });
    try {
        const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        if (!r.ok) console.error('Telegram send failed:', r.status, await r.text());
    } catch (e) {
        console.error('Telegram send exception:', e.message);
    }
}

export function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const targetName = process.argv[2];
if (!targetName) {
    console.error('usage: node monitor.mjs <target>');
    process.exit(2);
}

(async () => {
    const target = (await import(`./targets/${targetName}.mjs`)).default;
    console.log(`🔎 Synthetic monitor → ${target.label} (${target.baseUrl})`);

    // A target may build its checks at runtime (formalista derives a real article URL from
    // cards.json, so the check follows the content instead of rotting on a hardcoded slug).
    const checks = typeof target.checks === 'function' ? await target.checks() : target.checks;

    const browser = await chromium.launch();
    const results = [];
    for (const check of checks) {
        let failures = await runCheck(browser, check);
        // Retry once before declaring breakage — kills transient network/CDN blips so we
        // don't cry wolf, while still catching anything that actually stays broken.
        if (!failures.ok) {
            await new Promise((res) => setTimeout(res, 2500));
            failures = await runCheck(browser, check);
        }
        results.push(failures);
        console.log(`${failures.ok ? '✅' : '❌'} ${failures.name}${failures.ok ? '' : ' — ' + failures.failures.join('; ')}`);
    }
    await browser.close();

    const broken = results.filter((r) => !r.ok);
    if (broken.length === 0) {
        console.log(`\n✅ All ${results.length} checks passed.`);
        return;
    }

    const lines = broken.map((b) => `• <b>${escapeHtml(b.name)}</b>\n   ${b.failures.map(escapeHtml).join('\n   ')}`);
    const msg = `🚨 <b>${escapeHtml(target.label)} is broken</b> — ${broken.length}/${results.length} checks failing\n\n${lines.join('\n\n')}\n\n${target.baseUrl}`;
    console.error(`\n❌ ${broken.length}/${results.length} checks failed — sending Telegram alert.`);
    await sendTelegram(msg);
    process.exit(1);
})().catch(async (err) => {
    console.error('Monitor crashed:', err);
    await sendTelegram(`🚨 <b>Synthetic monitor crashed</b> (${escapeHtml(targetName)})\n${escapeHtml((err && err.message) || String(err))}`);
    process.exit(2);
});
