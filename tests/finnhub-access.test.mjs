import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
    fs.readFileSync('lib/actions/finnhub.actions.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
).outputText;

function loadDetails(status) {
    const errors = [];
    const exports = {};
    const dependencies = {
        '@/lib/utils': {}, '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
        react: { cache: fn => fn }, '../better-auth/auth': {},
        'next/headers': {}, 'next/navigation': { unstable_rethrow: () => {} }, './watchlist.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        fetch: async () => ({ ok: false, status, text: async () => 'Access denied' }),
        process: { env: { NEXT_PUBLIC_FINNHUB_API_KEY: 'test-key' } },
        console: { error: (...args) => errors.push(args) },
    });
    return { getStocksDetails: exports.getStocksDetails, errors };
}

test('403 leaves stock details unavailable without logging an application error', async () => {
    const { getStocksDetails, errors } = loadDetails(403);
    assert.equal(await getStocksDetails('APP.NE'), null);
    assert.equal(errors.length, 0);
});

test('unexpected Finnhub failures remain visible in the server log', async () => {
    const { getStocksDetails, errors } = loadDetails(500);
    assert.equal(await getStocksDetails('AAPL'), undefined);
    assert.equal(errors.length, 1);
});

test('a successful quote remains usable when profile and metrics are forbidden', async () => {
    const exports = {};
    const dependencies = {
        '@/lib/utils': {
            formatPrice: value => `$${value}`,
            formatChangePercent: value => `${value}%`,
            formatMarketCapValue: value => `$${value}M`,
        },
        '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
        react: { cache: fn => fn }, '../better-auth/auth': {},
        'next/headers': {}, 'next/navigation': { unstable_rethrow: () => {} }, './watchlist.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        fetch: async url => url.includes('/quote?')
            ? { ok: true, json: async () => ({ c: 100, dp: 2 }) }
            : { ok: false, status: 403, text: async () => 'Access denied' },
        process: { env: { NEXT_PUBLIC_FINNHUB_API_KEY: 'test-key' } },
        console: { error: () => {} },
    });

    const details = await exports.getStocksDetails('APP.NE', 'App Co');
    assert.equal(details.currentPrice, 100);
    assert.equal(details.company, 'App Co');
    assert.equal(details.peRatio, '-');
});

test('quote is requested before supplemental endpoints to preserve the price under rate limits', async () => {
    const exports = {};
    const calls = [];
    let releaseQuote;
    const quoteGate = new Promise(resolve => { releaseQuote = resolve; });
    const dependencies = {
        '@/lib/utils': {
            formatPrice: value => `$${value}`,
            formatChangePercent: value => `${value}%`,
            formatMarketCapValue: value => `$${value}M`,
        },
        '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
        react: { cache: fn => fn }, '../better-auth/auth': {},
        'next/headers': {}, 'next/navigation': { unstable_rethrow: () => {} }, './watchlist.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        fetch: async (url, options) => {
            calls.push({ url: String(url), cache: options.cache });
            if (url.includes('/quote?')) {
                await quoteGate;
                return { ok: true, json: async () => ({ c: 100, dp: 2 }) };
            }
            return { ok: true, json: async () => ({}) };
        },
        process: { env: { NEXT_PUBLIC_FINNHUB_API_KEY: 'test-key' } },
        console: { error: () => {} },
    });

    const details = exports.getStocksDetails('AAPL', 'Apple');
    assert.match(calls[0].url, /\/quote\?/);
    assert.equal(calls.length, 1);
    releaseQuote();
    await details;
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(call => call.cache), ['no-store', 'no-store', 'no-store']);
});

test('Finnhub market capitalization in millions is converted to dollars before formatting', async () => {
    const exports = {};
    let formattedValue;
    const dependencies = {
        '@/lib/utils': {
            formatPrice: value => `$${value}`,
            formatChangePercent: value => `${value}%`,
            formatMarketCapValue: value => { formattedValue = value; return `$${value}`; },
        },
        '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
        react: { cache: fn => fn }, '../better-auth/auth': {},
        'next/headers': {}, 'next/navigation': { unstable_rethrow: () => {} }, './watchlist.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        fetch: async url => ({ ok: true, json: async () => url.includes('/quote?')
            ? { c: 100, dp: 1 }
            : url.includes('/profile2?')
                ? { name: 'Apple', marketCapitalization: 4000000 }
                : { metric: { peNormalizedAnnual: 20 } } }),
        process: { env: { NEXT_PUBLIC_FINNHUB_API_KEY: 'test-key' } },
        console: { error: () => {} },
    });

    await exports.getStocksDetails('AAPL');
    assert.equal(formattedValue, 4_000_000_000_000);
});

test('unchanged quote still has a nonempty change label for snapshot validation', async () => {
    const exports = {};
    const dependencies = {
        '@/lib/utils': {
            formatPrice: value => `$${value}`,
            formatChangePercent: () => '',
            formatMarketCapValue: value => `$${value}`,
        },
        '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
        react: { cache: fn => fn }, '../better-auth/auth': {},
        'next/headers': {}, 'next/navigation': { unstable_rethrow: () => {} }, './watchlist.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        fetch: async url => ({ ok: true, json: async () => url.includes('/quote?')
            ? { c: 100, dp: 0 }
            : {} }),
        process: { env: { NEXT_PUBLIC_FINNHUB_API_KEY: 'test-key' } },
        console: { error: () => {} },
    });
    const result = await exports.getStocksDetails('AAPL');
    assert.equal(result.changeFormatted, '0.00%');
});

test('successful endpoints keep every raw Finnhub field and preserve prior data after a partial failure', async () => {
    const exports = {};
    const dependencies = {
        '@/lib/utils': {
            formatPrice: value => `$${value}`,
            formatChangePercent: value => `${value}%`,
            formatMarketCapValue: value => `$${value}`,
        },
        '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
        react: { cache: fn => fn }, '../better-auth/auth': {},
        'next/headers': {}, 'next/navigation': { unstable_rethrow: () => {} }, './watchlist.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        fetch: async url => url.includes('/quote?')
            ? { ok: true, json: async () => ({ c: 100, dp: 2, h: 110, l: 90, pc: 98 }) }
            : url.includes('/profile2?')
                ? { ok: false, status: 429, text: async () => 'Too many requests' }
                : { ok: true, json: async () => ({ metric: { peNormalizedAnnual: 20, '52WeekHigh': 120 }, series: { annual: [{ year: 2025 }] } }) },
        process: { env: { NEXT_PUBLIC_FINNHUB_API_KEY: 'test-key' } },
        console: { error: () => {} },
    });
    const prior = { quote: { c: 90 }, profile: { name: 'Previous company', custom: { retained: true } }, financials: { metric: { peNormalizedAnnual: 18 } }, updatedAt: new Date() };
    const details = await exports.getStocksDetails('AAPL', 'Fallback', prior);
    assert.equal(details.finnhubRaw.quote.h, 110);
    assert.equal(details.finnhubRaw.quote.pc, 98);
    assert.equal(details.finnhubRaw.profile.custom.retained, true);
    assert.equal(details.finnhubRaw.financials.series.annual[0].year, 2025);
    assert.equal(details.company, 'Previous company');
});

test('429 quote uses the complete raw response saved earlier in MongoDB', async () => {
    const exports = {};
    const dependencies = {
        '@/lib/utils': {
            formatPrice: value => `$${value}`,
            formatChangePercent: value => `${value}%`,
            formatMarketCapValue: value => `$${value}`,
        },
        '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
        react: { cache: fn => fn }, '../better-auth/auth': {},
        'next/headers': {}, 'next/navigation': { unstable_rethrow: () => {} }, './watchlist.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        fetch: async () => ({ ok: false, status: 429, text: async () => 'Too many requests' }),
        process: { env: { NEXT_PUBLIC_FINNHUB_API_KEY: 'test-key' } },
        console: { error: () => {} },
    });
    const prior = { quote: { c: 95, dp: -1, h: 99 }, profile: { name: 'Cached company', marketCapitalization: 4000000 }, financials: { metric: { peNormalizedAnnual: 20 } }, updatedAt: new Date() };
    const details = await exports.getStocksDetails('AAPL', 'Fallback', prior);
    assert.equal(details.currentPrice, 95);
    assert.equal(details.company, 'Cached company');
    assert.equal(details.peRatio, '20.0');
    assert.equal(details.finnhubRaw.quote.h, 99);
    assert.equal(details.dataSource, 'cached');
});

for (const endpoint of ['/quote?', '/stock/profile2?']) {
    test('Next.js interruption escapes instead of using Mongo fallback: ' + endpoint, async () => {
        const signal = new Error('prerender interruption');
        const exports = {};
        const dependencies = {
            '@/lib/utils': {}, '@/lib/constants': { POPULAR_STOCK_SYMBOLS: [] },
            react: { cache: fn => fn }, '../better-auth/auth': {},
            'next/headers': {}, './watchlist.actions': {},
            'next/navigation': { unstable_rethrow: error => { if (error === signal) throw error; } },
        };
        vm.runInNewContext(source, {
            exports, require: name => dependencies[name],
            fetch: async url => {
                if (url.includes(endpoint)) throw signal;
                return { ok: true, json: async () => ({ c: 100, dp: 1 }) };
            },
            process: { env: { FINNHUB_API_KEY: 'test-key' } },
            console: { error: () => {} },
        });
        await assert.rejects(
            exports.getStocksDetails('AAPL', 'Apple', { quote: { c: 90 }, updatedAt: new Date() }),
            error => error === signal,
        );
    });
}
