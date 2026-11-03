'use server';

import { connectToDatabase } from "@/database/mongoose";
import { Watchlist } from "@/database/models/watchlist.model";
import { revalidatePath } from 'next/cache';
import { auth } from '../better-auth/auth';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getStocksDetails } from "./finnhub.actions";

export async function getWatchlistSymbolsByEmail(email: string): Promise<string[]> { 
    if (!email) return [];

    try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) throw new Error("Database connection is not established.");

        // Better Auth lưu người dùng trong collection "user" với khóa MongoDB _id.
        const user = await db.collection('user').findOne({ email });
        
        if (!user) return [];
        
        // Adapter của Better Auth chuyển _id thành session.user.id dạng chuỗi.
        // Dùng cùng giá trị với addToWatchlist/removeFromWatchlist.
        const userId = user._id.toString();

        const items = await Watchlist.find({ userId }, { symbol: 1 }).lean();
        return items.map((i) => String(i.symbol));

    } catch (error) { 
        console.error("Error fetching watchlist symbols by email:", error);
        return [];
    }
}

//Add stock to watchlist
export const addToWatchlist = async (symbol: string, company: string) => {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        //Check if stock already exists in watchlist
        const existingItem = await Watchlist.findOne({
            userId: session.user.id,
            symbol: symbol.toUpperCase(),
        })

        if (existingItem) { 
            return { success: false, error: 'Stock already exists in watchlist' };
        }

        //Add to watchlist
        const newItem = new Watchlist({
            userId: session.user.id,
            symbol: symbol.toUpperCase(),
            company: company.trim(),
        });

        await newItem.save();
        revalidatePath('/watchlist');

        return { success: true, message: 'Stock added to watchlist' };

    } catch (error) {
        console.error('Error adding stock to watchlist:', error);
        throw new Error('Failed to add stock to watchlist');
    }
}

// Remove stock from watchlist
export const removeFromWatchlist = async (symbol: string) => {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        // Remove from watchlist
        await Watchlist.deleteOne({
            userId: session.user.id,
            symbol: symbol.toUpperCase(),
        });
        revalidatePath('/watchlist');

        return { success: true, message: 'Stock removed from watchlist' };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        throw new Error('Failed to remove stock from watchlist');
    }
};

//Get user's watchlist
export const getUserWatchlist = async () => { 
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        const watchlist = await Watchlist.find({ userId: session.user.id }).sort({ addedAt: -1 }).lean();
        return JSON.parse(JSON.stringify(watchlist));
    } catch(error) { 
        console.error('Error fetching user watchlist:', error);
        throw new Error('Failed to fetch user watchlist');
    }
}

// Get user's watchlist with stock data
export const getWatchlistWithData = async () => {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        const watchlist = await Watchlist.find({ userId: session.user.id }).sort({ addedAt: -1 }).lean();

        if (watchlist.length === 0) return [];

        const stocksWithData = await Promise.all(
            watchlist.map(async (item) => {
                const stockData = await getStocksDetails(item.symbol);

                if (stockData === null) return item;

                if (!stockData) {
                    console.warn(`Failed to fetch data for ${item.symbol}`);
                    return item;
                }

                return {
                    company: stockData.company,
                    symbol: stockData.symbol,
                    currentPrice: stockData.currentPrice,
                    priceFormatted: stockData.priceFormatted,
                    changeFormatted: stockData.changeFormatted,
                    changePercent: stockData.changePercent,
                    marketCap: stockData.marketCapFormatted,
                    peRatio: stockData.peRatio,
                };
            }),
        );

        return JSON.parse(JSON.stringify(stocksWithData));
    } catch (error) {
        unstable_rethrow(error);
        console.error('Error loading watchlist:', error);
        return [];
    }
};
