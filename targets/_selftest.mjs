// Temporary: proves the CI alert path (GH secret -> Telegram). Removed in the next commit.
const BASE = 'https://formalista.org';
export default {
    label: 'TEST (ignore) — CI alert path',
    baseUrl: BASE,
    checks: [
        { name: 'Deliberately broken check', url: `${BASE}/definitely-not-a-real-page-xyz`, expectNonEmpty: '#quote' }
    ]
};
