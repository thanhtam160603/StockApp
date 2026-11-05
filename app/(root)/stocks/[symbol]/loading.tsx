import { Skeleton } from '@/components/ui/skeleton';

export default function LoadingStockDetails() {
    return (
        <section className="watchlist" aria-busy="true" aria-label="Loading watchlist">
            <p role="status" className="sr-only">Loading data...</p>
            <div className="grid grid-cols-2 mt-6 gap-6 space-y-3" aria-hidden="true">
                <div className="flex flex-col gap-6">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-60 w-full" />
                    <Skeleton className="h-60 w-full" />
                </div>
                <div className="flex flex-col gap-6">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-60 w-full" />
                    <Skeleton className="h-50 w-full" />
                </div>
            </div>
        </section>
    )
}