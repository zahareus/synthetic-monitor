// GOAT — Vercel SPA + Telegram Mini App, Supabase behind it.
// Outside Telegram the app never loads data (no initData), so the PAGE proves almost nothing.
// The Supabase checks below are the real monitor here — that data layer is exactly what died
// silently on 14.08 (PostgREST down: 200 everywhere, every page empty).
const BASE = 'https://goatapp.club';

// The publishable key is read from the deployed app.js instead of a GH secret: it is public by
// design (it ships in that very file), storing it as a "secret" would only fake protection, and
// reading it live means the check follows a key rotation on its own — and proves app.js deployed.
let cached;
async function supabase() {
    if (cached) return cached;
    const js = await (await fetch(`${BASE}/app.js`, { signal: AbortSignal.timeout(20000) })).text();
    const url = (js.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
    const key = (js.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0];
    if (!url || !key) throw new Error('could not read Supabase url/key from deployed app.js');
    cached = { url, key };
    return cached;
}

export default {
    label: 'GOAT',
    baseUrl: BASE,
    checks: async () => {
        const { url, key } = await supabase();
        const rest = (t) => `${url}/rest/v1/${t}?select=*&limit=1`;
        const headers = { apikey: key, Authorization: `Bearer ${key}` };
        const rows = (t) => (d) => (Array.isArray(d) && d.length > 0 ? null : `${t} returned no rows`);
        return [
            // Landing is static markup, so this only proves Vercel served the file and JS did
            // not crash on boot. #web-landing is the one block that is genuinely visible here.
            { name: 'Landing', url: `${BASE}/`, expectNonEmpty: '#web-landing', expectText: 'Pick the best player' },
            { name: 'Terms', url: `${BASE}/terms.html`, softContent: true },
            { name: 'Privacy', url: `${BASE}/privacy.html`, softContent: true },
            { name: 'Supabase · gw_config', type: 'json', url: rest('gw_config'), headers, must: rows('gw_config') },
            { name: 'Supabase · fixtures', type: 'json', url: rest('fixtures'), headers, must: rows('fixtures') },
            { name: 'Supabase · players', type: 'json', url: rest('players'), headers, must: rows('players') }
        ];
    }
};
