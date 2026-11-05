import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('popular suggestions remain available without Finnhub profile requests', async () => {
    const source = ts.transpileModule(
        fs.readFileSync('lib/actions/finnhub.actions.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
    ).outputText;
    const exports = {};
    let fetchCount = 0;
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'ORCL', 'CRM'];
    const dependencies = {
        '@/lib/utils': {},
        '@/lib/constants': { POPULAR_STOCK_SYMBOLS: symbols },
        react: { cache: fn => fn },
        '../better-auth/auth': { auth: { api: { getSession: async () => ({ user: { email: 'user@example.com' } }) } } },
        'next/headers': { headers: async () => ({}) },
        'next/navigation': { redirect: () => { throw new Error('Unexpected redirect'); } },
        './watchlist.actions': { getWatchlistSymbolsByEmail: async () => ['AAPL'] },
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        process: { env: { FINNHUB_API_KEY: 'test-key' } },
        fetch: async () => { fetchCount++; return { ok: false, status: 429, text: async () => 'Too many requests' }; },
        console: { error: () => {} },
    });

    const result = await exports.searchStocks();
    assert.equal(result.length, 10);
    assert.equal(result[0].symbol, 'AAPL');
    assert.equal(result[0].name, 'Apple Inc.');
    assert.equal(result[0].isInWatchlist, true);
    assert.equal(fetchCount, 0);
});
