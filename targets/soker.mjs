// soker — Cloudflare Worker + static assets + Durable Objects. Deployed by hand.
// soker.win is canonical; soker.tndr.win is the same worker on a second custom domain.
const BASE = 'https://soker.win';

export default {
    label: 'soker',
    baseUrl: BASE,
    checks: [
        // #lobby is the booted game shell — verified on prod it carries real text ("START HERE",
        // "Welcome to Soker") only after game.js runs. #newGameButton is NOT usable: it ships in
        // the static HTML as a hidden "Leave" button and is present even on a dead page.
        { name: 'Home (game boots)', url: `${BASE}/`, expectNonEmpty: '#lobby' },
        { name: 'Privacy', url: `${BASE}/privacy.html`, softContent: true },
        { name: 'Terms', url: `${BASE}/terms.html`, softContent: true },
        { name: 'Sounds', url: `${BASE}/sounds.html`, softContent: true },
        {
            name: 'API health',
            type: 'json',
            url: `${BASE}/api/health`,
            // Only `ok` is asserted. The endpoint also returns `matchmaker`, but that is
            // Boolean(env.MATCHMAKER) — a binding being configured, not the Durable Object being
            // alive — so treating it as a liveness signal would be a lie.
            must: (d) => (d.ok === true ? null : `health says ok=${JSON.stringify(d.ok)}`)
        },
        {
            name: 'API stats',
            type: 'json',
            url: `${BASE}/api/stats`,
            // ⚠️ Proves the worker routes and returns JSON — NOT that the matchmaker DO is alive:
            // worker.js returns {today:0} from a fallback branch when the binding is missing, and
            // 0 is also a normal value for a low-traffic day. Real DO liveness needs the worker to
            // mark the response source; that belongs to the кошик-2 задача, not here.
            must: (d) => (typeof d.today === 'number' ? null : 'stats payload has no numeric `today`')
        }
    ]
};
