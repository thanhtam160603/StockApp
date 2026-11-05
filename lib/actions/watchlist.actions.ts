'use server';

import { connectToDatabase } from "@/database/mongoose";
import { Watchlist, type WatchlistSnapshot } from "@/database/models/watchlist.model";
import { revalidatePath } from 'next/cache';
import { auth } from '../better-auth/auth';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getStocksDetails } from "./finnhub.actions";

// Lấy kiểu kết quả thành công của getStocksDetails, loại bỏ null và undefined.
type StockDetails = NonNullable<Awaited<ReturnType<typeof getStocksDetails>>>;

// Tạo các cột đã định dạng cho bảng. Response JSON đầy đủ được lưu riêng ở finnhubRaw.
function createSnapshot(stockData: StockDetails, previous?: WatchlistSnapshot): WatchlistSnapshot {
    return {
        currentPrice: stockData.currentPrice,
        changePercent: stockData.changePercent,
        priceFormatted: stockData.priceFormatted,
        changeFormatted: stockData.changeFormatted,
        // Nếu endpoint phụ không có dữ liệu, giữ giá trị từng lưu thay vì ghi dấu '-'.
        marketCap: stockData.marketCapFormatted !== '-'
            ? stockData.marketCapFormatted
            : previous?.marketCap || '-',
        peRatio: stockData.peRatio !== '-'
            ? stockData.peRatio
            : previous?.peRatio || '-',
    };
}

// Đưa snapshot ra các trường mà WatchlistTable đọc; giữ nguyên thông tin của document.
// Hàm này chỉ chuyển cấu trúc dữ liệu, không gọi API hay truy vấn MongoDB.
function snapshotRow<T extends { snapshot?: WatchlistSnapshot }>(item: T) {
    const snapshot = item.snapshot;
    if (!snapshot) return item;
    return {
        ...item,
        currentPrice: snapshot.currentPrice,
        changePercent: snapshot.changePercent,
        priceFormatted: snapshot.priceFormatted,
        changeFormatted: snapshot.changeFormatted,
        marketCap: snapshot.marketCap,
        peRatio: snapshot.peRatio,
        dataSource: 'cached' as const,
    };
}

// SearchCommand và tác vụ gửi tin tức chỉ cần danh sách symbol của người dùng.
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
        unstable_rethrow(error);
        console.error("Error fetching watchlist symbols by email:", error);
        return [];
    }
}

// Thêm mã vào watchlist của người đang đăng nhập, kèm dữ liệu Finnhub nếu lấy được.
export const addToWatchlist = async (
    symbol: string,
    company: string,
    exchange?: string,
    stockType?: string,
) => {
    try {
        // Cookie trong headers xác định người dùng; không nhận userId từ trình duyệt.
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        const cleanSymbol = symbol.trim().toUpperCase();

        // Tránh lưu trùng cùng một mã cho người dùng.
        const existingItem = await Watchlist.findOne({
            userId: session.user.id,
            symbol: cleanSymbol,
        })

        if (existingItem) { 
            return { success: false, error: 'Stock already exists in watchlist' };
        }

        // Finnhub lỗi vẫn cho phép lưu mã; các trường tài chính chỉ có khi lấy được giá.
        let stockData: Awaited<ReturnType<typeof getStocksDetails>>;
        try {
            stockData = await getStocksDetails(cleanSymbol, company);
        } catch (error) {
            unstable_rethrow(error);
            console.warn(`Could not cache stock details for ${cleanSymbol}:`, error);
        }

        // Chỉ tạo dữ liệu dự phòng khi Finnhub thật sự trả giá hợp lệ.
        const newItem = new Watchlist({
            userId: session.user.id,
            symbol: cleanSymbol,
            company: company.trim(),
            exchange: exchange?.trim(),
            stockType: stockType?.trim(),
            ...(stockData ? {
                snapshot: createSnapshot(stockData),
                finnhubRaw: stockData.finnhubRaw,
            } : {}),
        });

        // save() ghi MongoDB; revalidatePath yêu cầu dữ liệu trang watchlist được làm mới.
        await newItem.save();
        revalidatePath('/watchlist');

        return { success: true, message: 'Stock added to watchlist' };

    } catch (error) {
        unstable_rethrow(error);
        console.error('Error adding stock to watchlist:', error);
        throw new Error('Failed to add stock to watchlist');
    }
}

// Xóa đúng mã thuộc người dùng hiện tại.
export const removeFromWatchlist = async (symbol: string) => {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        await Watchlist.deleteOne({
            userId: session.user.id,
            symbol: symbol.toUpperCase(),
        });
        revalidatePath('/watchlist');

        return { success: true, message: 'Stock removed from watchlist' };
    } catch (error) {
        unstable_rethrow(error);
        console.error('Error removing from watchlist:', error);
        throw new Error('Failed to remove stock from watchlist');
    }
};

// Trang chi tiết cổ phiếu dùng danh sách này để xác định trạng thái nút watchlist.
// Hàm chỉ đọc MongoDB, không lấy giá từ Finnhub.
export const getUserWatchlist = async () => { 
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        const watchlist = await Watchlist.find({ userId: session.user.id }).sort({ addedAt: -1 }).lean();
        return JSON.parse(JSON.stringify(watchlist));
    } catch(error) { 
        unstable_rethrow(error);
        console.error('Error fetching user watchlist:', error);
        throw new Error('Failed to fetch user watchlist');
    }
}

// Luồng của trang watchlist: đọc danh sách mã -> thử Finnhub -> lưu thành công hoặc dùng dự phòng.
export const getWatchlistWithData = async () => {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user) redirect('/sign-in');

        const watchlist = await Watchlist.find({ userId: session.user.id }).sort({ addedAt: -1 }).lean();

        const stocksWithData: unknown[] = [];
        // Mỗi lần tải trang đều thử Finnhub trước; gọi lần lượt để tránh dồn request.
        for (const item of watchlist) {
            let stockData: Awaited<ReturnType<typeof getStocksDetails>>;
            try {
                // Truyền response cũ để getStocksDetails dùng khi Finnhub lỗi.
                // Truyền tham số này không có nghĩa là ưu tiên MongoDB: hàm luôn thử API trước.
                stockData = await getStocksDetails(item.symbol, item.company, item.finnhubRaw);
            } catch (error) {
                unstable_rethrow(error);
                console.warn(`Failed to refresh data for ${item.symbol}:`, error);
            }

            if (!stockData) {
                if (stockData !== null) console.warn(`Failed to fetch data for ${item.symbol}`);
                // Bản ghi cũ có thể chỉ có snapshot, chưa có finnhubRaw.
                stocksWithData.push(snapshotRow(item));
                continue;
            }

            const snapshot = createSnapshot(stockData, item.snapshot);
            // Nếu đang dùng dữ liệu cũ, chỉ ghi snapshot khi document chưa có snapshot.
            // Nếu có dữ liệu mới từ Finnhub, cập nhật cả snapshot và finnhubRaw.
            if (stockData.dataSource !== 'cached' || !item.snapshot) {
                try {
                    await Watchlist.updateOne(
                        // Giới hạn cập nhật vào document thuộc người đang đăng nhập.
                        { _id: item._id, userId: session.user.id },
                        // Thành công: lưu cả JSON thô và các cột hiển thị.
                        // Dùng dữ liệu cũ: chỉ bổ sung snapshot còn thiếu.
                        { $set: stockData.dataSource === 'cached'
                            ? { snapshot }
                            : { snapshot, finnhubRaw: stockData.finnhubRaw } },
                    );
                } catch (error) {
                    unstable_rethrow(error);
                    console.warn(`Failed to save Finnhub data for ${item.symbol}:`, error);
                }
            }

            // Trả về cấu trúc thống nhất cho bảng, dù dữ liệu đến từ API hay MongoDB.
            stocksWithData.push({
                ...snapshotRow({ ...item, snapshot }),
                company: stockData.company || item.company,
                dataSource: stockData.dataSource === 'cached' ? 'cached' as const : 'live' as const,
            });
        }

        // Chuyển ObjectId/Date từ MongoDB sang dữ liệu có thể truyền cho Client Component.
        return JSON.parse(JSON.stringify(stocksWithData));
    } catch (error) {
        // Tín hiệu prerender/redirect phải trả về Next.js, không được đổi thành danh sách rỗng.
        unstable_rethrow(error);
        console.error('Error loading watchlist:', error);
        return [];
    }
};
