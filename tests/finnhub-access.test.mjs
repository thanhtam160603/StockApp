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
        'next/headers': {}, 'next/navigation': {}, './watchlist.actions': {},
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
