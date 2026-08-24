// ledap — Cloudflare Worker, server-rendered (Hono/JSX), D1. Deployed BY HAND.
const BASE = 'https://ledap.win';

// Longest guaranteed heartbeat is epl_odds: cron.ts advances its tick every 3h and logs an
// event even on an empty/failed fetch ("pre-season it's empty"), so an event lands every ~3h
// year-round. 6h = 2x that — no false alarm, and a dead scheduler still surfaces same-day.
// ponytail: fixed 6h window; tighten only if we ever add a true every-minute heartbeat event.
const MAX_CRON_AGE_MS = 6 * 3600 * 1000;

export default {
    label: 'ledap',
    baseUrl: BASE,
    checks: [
        // The public face is the pre-launch splash: countdown + tagline, both server-rendered.
        // #signin-slot is NOT usable — verified on prod, it renders empty and hidden.
        { name: 'Home', url: `${BASE}/`, expectNonEmpty: '#countdown', expectText: 'FOOTBALL SCORE PREDICTIONS' },
        { name: 'Sign-in', url: `${BASE}/auth/signin`, expectNonEmpty: '#countdown' },
        { name: 'About', url: `${BASE}/about`, softContent: true },
        { name: 'Rules', url: `${BASE}/rules`, softContent: true },
        { name: 'Telegram guide', url: `${BASE}/telegram`, softContent: true },
        { name: 'Terms', url: `${BASE}/terms`, softContent: true },
        { name: 'Privacy', url: `${BASE}/privacy`, softContent: true },
        {
            // Dead-man switch on the scheduler. This is the check that matters: the site can
            // look perfect while the cron that syncs fixtures and scores predictions is dead.
            name: 'Health / cron heartbeat',
            type: 'json',
            url: `${BASE}/health`,
            must: (d) => {
                if (d.ok !== true) return `health says ok=${JSON.stringify(d.ok)}`;
                if (!d.lastCronEvent) return 'no cron event recorded at all';
                // 🔴 ts is milliseconds (Date.now()), lastCronEvent is SECONDS (unix created_at).
                // Subtracting them raw reads as ~56 years and alerts every single hour.
                // Compare against the server's own ts, not local time, so clock skew can't lie.
                const ageMs = d.ts - d.lastCronEvent * 1000;
                if (ageMs > MAX_CRON_AGE_MS) {
                    return `scheduler looks dead — last cron event ${Math.round(ageMs / 3600000)}h ago`;
                }
                return null;
            }
        }
    ]
};
