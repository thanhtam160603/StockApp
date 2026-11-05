import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import mongoose from 'mongoose';

test('Mongoose retains the financial snapshot in a watchlist document', () => {
    const source = ts.transpileModule(
        fs.readFileSync('database/models/watchlist.model.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
    ).outputText;
    const exports = {};
    vm.runInNewContext(source, { exports, require: () => mongoose });

    const document = new exports.Watchlist({
        userId: 'user-1', symbol: 'AAPL', company: 'Apple',
        finnhubRaw: {
            quote: { c: 100, h: 105, l: 95, pc: 99 },
            profile: { name: 'Apple', customField: { nested: true } },
            financials: { metric: { peNormalizedAnnual: 20, '52WeekHigh': 120 }, series: { annual: [{ year: 2025 }] } },
            updatedAt: new Date('2026-11-03T00:00:00.000Z'),
        },
        snapshot: {
            currentPrice: 100, changePercent: 1, priceFormatted: '$100',
            changeFormatted: '+1%', marketCap: '$1T', peRatio: '20',
            updatedAt: new Date('2026-11-03T00:00:00.000Z'),
        },
    }).toObject();
    assert.equal(document.snapshot.currentPrice, 100);
    assert.equal(document.snapshot.marketCap, '$1T');
    assert.equal(document.finnhubRaw.quote.h, 105);
    assert.equal(document.finnhubRaw.profile.customField.nested, true);
    assert.equal(document.finnhubRaw.financials.series.annual[0].year, 2025);
});

test('watchlist rows keep stored fields whether Finnhub succeeds or fails', async () => {
    const source = ts.transpileModule(
        fs.readFileSync('lib/actions/watchlist.actions.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
    ).outputText;
    const exports = {};
    const updates = [];
    const fetched = [];
    const fetchEvents = [];
    const stored = [
        {
            userId: 'user-1', symbol: 'AAPL', company: 'Apple', addedAt: '2026-11-03', _id: 'one',
            finnhubRaw: { quote: { c: 90, h: 92 }, profile: { name: 'Apple' }, updatedAt: '2026-11-01T00:00:00.000Z' },
            snapshot: { currentPrice: 90, priceFormatted: '$90', changePercent: 1, changeFormatted: '+1%', marketCap: '$900B', peRatio: '25', updatedAt: '2026-11-01T00:00:00.000Z' },
        },
        {
            userId: 'user-1', symbol: 'APP.NE', company: 'App Company', addedAt: '2026-11-02', _id: 'two',
            snapshot: { currentPrice: 50, priceFormatted: '$50', changePercent: -1, changeFormatted: '-1%', marketCap: '$2B', peRatio: '15', updatedAt: '2026-11-02T00:00:00.000Z' },
        },
        {
            userId: 'user-1', symbol: 'MSFT', company: 'Microsoft', addedAt: '2026-11-03', _id: 'three',
            snapshot: { currentPrice: 200, priceFormatted: '$200', changePercent: 1, changeFormatted: '+1%', marketCap: '$2T', peRatio: '30', updatedAt: new Date().toISOString() },
        },
        {
            userId: 'user-1', symbol: 'TSLA', company: 'Tesla', addedAt: '2026-11-03', _id: 'four',
            finnhubRaw: { quote: { c: 250, dp: -2, h: 260 }, profile: { name: 'Tesla' }, financials: { metric: { peNormalizedAnnual: 40 } }, updatedAt: '2026-11-01T00:00:00.000Z' },
        },
    ];
    const dependencies = {
        '@/database/mongoose': { connectToDatabase: async () => ({}) },
        '@/database/models/watchlist.model': {
            Watchlist: {
                find: () => ({ sort: () => ({ lean: async () => stored }) }),
                updateOne: async (...args) => { updates.push(args); },
            },
        },
        'next/cache': { revalidatePath: () => {} },
        '../better-auth/auth': { auth: { api: { getSession: async () => ({ user: { id: 'user-1' } }) } } },
        'next/headers': { headers: async () => ({}) },
        'next/navigation': { unstable_rethrow: () => {}, redirect: () => { throw new Error('Unexpected redirect'); } },
        './finnhub.actions': {
            getStocksDetails: async (symbol, _company, cachedRaw) => {
                fetched.push(symbol);
                fetchEvents.push(`start:${symbol}`);
                await Promise.resolve();
                fetchEvents.push(`end:${symbol}`);
                if (symbol === 'AAPL') assert.equal(cachedRaw.quote.h, 92);
                if (symbol === 'TSLA') {
                    assert.equal(cachedRaw.quote.h, 260);
                    return { symbol, company: 'Tesla', currentPrice: 250, priceFormatted: '$250', changePercent: -2, changeFormatted: '-2%', marketCapFormatted: '$1T', peRatio: '40.0', finnhubRaw: cachedRaw, dataSource: 'cached' };
                }
                if (symbol === 'MSFT') {
                    return { symbol, company: 'Microsoft', currentPrice: 210, priceFormatted: '$210', changePercent: 2, changeFormatted: '+2%', marketCapFormatted: '$2T', peRatio: '30', finnhubRaw: { quote: { c: 210 }, updatedAt: new Date() }, dataSource: 'live' };
                }
                return symbol === 'AAPL'
                    ? { symbol, company: 'Apple Inc.', currentPrice: 100, priceFormatted: '$100', changePercent: 1, changeFormatted: '+1%', marketCapFormatted: '-', peRatio: '-', finnhubRaw: { quote: { c: 100, h: 110 }, profile: cachedRaw.profile, updatedAt: new Date() } }
                    : null;
            },
        },
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        console,
        JSON,
    });

    const rows = await exports.getWatchlistWithData();
    assert.equal(rows.length, 4);
    assert.equal(rows[0].userId, 'user-1');
    assert.equal(rows[0].addedAt, '2026-11-03');
    assert.equal(rows[0].priceFormatted, '$100');
    assert.equal(rows[0].dataSource, 'live');
    assert.equal(updates.length, 3);
    assert.equal(updates[0][1].$set.snapshot.currentPrice, 100);
    assert.equal(updates[0][1].$set.snapshot.marketCap, '$900B');
    assert.equal(updates[0][1].$set.snapshot.peRatio, '25');
    assert.equal(updates[0][1].$set.finnhubRaw.quote.h, 110);
    assert.equal(rows[1].userId, 'user-1');
    assert.equal(rows[1].company, 'App Company');
    assert.equal(rows[1].priceFormatted, '$50');
    assert.equal(rows[1].dataSource, 'cached');
    assert.equal(rows[2].priceFormatted, '$210');
    assert.equal(rows[2].dataSource, 'live');
    assert.equal(fetched.includes('MSFT'), true);
    assert.equal(rows[3].priceFormatted, '$250');
    assert.equal(rows[3].dataSource, 'cached');
    assert.equal(updates[2][1].$set.finnhubRaw, undefined);
    assert.deepEqual(fetchEvents, ['start:AAPL', 'end:AAPL', 'start:APP.NE', 'end:APP.NE', 'start:MSFT', 'end:MSFT', 'start:TSLA', 'end:TSLA']);
});

test('adding a search result saves metadata and any available snapshot', async () => {
    const source = ts.transpileModule(
        fs.readFileSync('lib/actions/watchlist.actions.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
    ).outputText;
    const exports = {};
    let saved;
    let detailsResult = {
        company: 'Apple Inc.', currentPrice: 100, priceFormatted: '$100',
        changePercent: 1, changeFormatted: '+1%', marketCapFormatted: '$1T', peRatio: '20',
        finnhubRaw: { quote: { c: 100, h: 105 }, profile: { name: 'Apple' }, financials: { metric: { peNormalizedAnnual: 20 } }, updatedAt: new Date() },
    };
    class Watchlist {
        constructor(data) { saved = data; }
        async save() {}
        static async findOne() { return null; }
    }
    const dependencies = {
        '@/database/mongoose': { connectToDatabase: async () => ({}) },
        '@/database/models/watchlist.model': { Watchlist },
        'next/cache': { revalidatePath: () => {} },
        '../better-auth/auth': { auth: { api: { getSession: async () => ({ user: { id: 'user-1' } }) } } },
        'next/headers': { headers: async () => ({}) },
        'next/navigation': { unstable_rethrow: () => {}, redirect: () => { throw new Error('Unexpected redirect'); } },
        './finnhub.actions': { getStocksDetails: async () => detailsResult },
    };
    vm.runInNewContext(source, {
        exports,
        require: name => dependencies[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
        console,
    });

    const result = await exports.addToWatchlist('aapl', 'Apple Inc.', 'NASDAQ', 'Common Stock');
    assert.equal(result.success, true);
    assert.equal(saved.symbol, 'AAPL');
    assert.equal(saved.company, 'Apple Inc.');
    assert.equal(saved.exchange, 'NASDAQ');
    assert.equal(saved.stockType, 'Common Stock');
    assert.equal(saved.snapshot.currentPrice, 100);
    assert.equal(saved.snapshot.priceFormatted, '$100');
    assert.equal(saved.finnhubRaw.quote.h, 105);

    detailsResult = null;
    const unavailable = await exports.addToWatchlist('APP.NE', 'App Company');
    assert.equal(unavailable.success, true);
    assert.equal(saved.company, 'App Company');
    assert.equal(saved.snapshot, undefined);
});

test('watchlist session interruption is rethrown rather than converted to empty data', async () => {
    const signal = new Error('prerender interruption');
    const exports = {};
    const dependencies = {
        '@/database/mongoose': {}, '@/database/models/watchlist.model': {},
        'next/cache': {}, './finnhub.actions': {},
        '../better-auth/auth': { auth: { api: { getSession: async () => { throw signal; } } } },
        'next/headers': { headers: async () => ({}) },
        'next/navigation': { unstable_rethrow: error => { if (error === signal) throw error; } },
    };
    const source = ts.transpileModule(
        fs.readFileSync('lib/actions/watchlist.actions.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
    ).outputText;
    vm.runInNewContext(source, { exports, require: name => dependencies[name], console });
    await assert.rejects(exports.getWatchlistWithData(), error => error === signal);
});
