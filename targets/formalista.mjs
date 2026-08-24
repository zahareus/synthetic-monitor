// formalista — Cloudflare Pages, static shell + client JS that renders a card from cards.json.
const BASE = 'https://formalista.org';

export default {
    label: 'Formalista',
    baseUrl: BASE,
    checks: async () => {
        // Slugs are derived from quote text and cards do get removed (cards_removed_old8_backup.json),
        // so a hardcoded article URL rots into a false alarm. Take a real one from the live feed —
        // that also makes it an end-to-end check: feed → the page that feed points at.
        let articlePath = null;
        try {
            const cards = await (await fetch(`${BASE}/cards.json`, { signal: AbortSignal.timeout(20000) })).json();
            const slug = cards.find((c) => c && c.slug)?.slug;
            if (slug) articlePath = `/p/${slug}.html`;
        } catch {
            // Swallowed on purpose: the cards.json check below reports this properly.
        }
        return [
            // The card is rendered client-side; #quote ships EMPTY in the static HTML, so only a
            // non-empty assertion distinguishes a working site from one whose feed failed to load.
            { name: 'Home (card renders)', url: `${BASE}/`, expectNonEmpty: '#quote' },
            { name: 'Home (attribution)', url: `${BASE}/`, expectNonEmpty: '#attr' },
            {
                name: 'cards.json feed',
                type: 'json',
                url: `${BASE}/cards.json`,
                must: (d) => {
                    if (!Array.isArray(d)) return 'cards.json is not an array';
                    if (d.length < 100) return `cards.json has only ${d.length} cards (expected 100+)`;
                    return null;
                }
            },
            articlePath
                ? { name: `Article page (${articlePath.slice(0, 40)}…)`, url: BASE + articlePath, expectNonEmpty: '#quote' }
                : { name: 'Article page', url: `${BASE}/`, softContent: true }
        ];
    }
};
