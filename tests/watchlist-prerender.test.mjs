import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
    fs.readFileSync('lib/actions/watchlist.actions.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
).outputText;

test('prerender cancellation reaches Next.js instead of becoming an empty watchlist', async () => {
    const prerenderError = Object.assign(new Error('Prerender complete'), {
        digest: 'HANGING_PROMISE_REJECTION',
    });
    const errors = [];
    const exports = {};
    const dependencies = {
        '@/database/mongoose': {},
        '@/database/models/watchlist.model': {},
        'next/cache': {},
        '../better-auth/auth': { auth: { api: { getSession: async () => ({ user: {} }) } } },
        'next/headers': { headers: async () => { throw prerenderError; } },
        'next/navigation': {
            unstable_rethrow: error => {
                if (error.digest === 'HANGING_PROMISE_REJECTION') throw error;
            },
        },
        './finnhub.actions': {},
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        console: { error: (...args) => errors.push(args) },
    });

    await assert.rejects(exports.getWatchlistWithData(), error => error === prerenderError);
    assert.equal(errors.length, 0);
});
