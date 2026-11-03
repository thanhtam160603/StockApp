import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ObjectId } from 'mongodb';

// Run the actual server action with database/Next boundaries replaced locally.
const source = ts.transpileModule(
    fs.readFileSync('lib/actions/watchlist.actions.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;

function loadAction(user, rows) {
    const exports = {};
    const dependencies = {
        '@/database/mongoose': { connectToDatabase: async () => ({
            connection: { db: { collection: () => ({ findOne: async () => user }) } },
        }) },
        '@/database/models/watchlist.model': { Watchlist: {
            find: ({ userId }) => ({ lean: async () => rows.filter(row => row.userId === userId) }),
        } },
        'next/cache': {}, '../better-auth/auth': {}, 'next/headers': {},
        'next/navigation': {}, './finnhub.actions': {},
    };
    vm.runInNewContext(source, { exports, require: name => {
        if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
    }, console });
    return exports.getWatchlistSymbolsByEmail;
}

test('returns only the symbols saved under the Better Auth Mongo user ID', async () => {
    const id = new ObjectId();
    const action = loadAction({ _id: id }, [
        { userId: id.toString(), symbol: 'AAPL' },
        { userId: new ObjectId().toString(), symbol: 'MSFT' },
    ]);
    assert.deepEqual(Array.from(await action('test@example.invalid')), ['AAPL']);
});

test('returns no symbols when the user does not exist', async () => {
    assert.deepEqual(Array.from(await loadAction(null, [])('missing@example.invalid')), []);
});
