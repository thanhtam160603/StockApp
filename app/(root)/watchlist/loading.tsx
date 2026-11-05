import { Skeleton } from '@/components/ui/skeleton';

// Next.js đặt Suspense quanh page.tsx và hiển thị phần này khi đang đọc session/Finnhub.
export default function LoadingWatchlist() {
    return (
        <section className="watchlist" aria-busy="true" aria-label="Loading watchlist">
            <h2 className="watchlist-title">Watchlist</h2>
            <p role="status" className="sr-only">Loading watchlist...</p>
            <div className="mt-6 space-y-3" aria-hidden="true">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        </section>
    );
}
