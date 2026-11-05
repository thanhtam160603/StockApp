"use client";
import { useEffect, useState } from "react";
import { useRouter } from 'next/navigation';
import { Star, Trash2 } from 'lucide-react';
import { toast } from "sonner";
import { addToWatchlist, removeFromWatchlist } from "@/lib/actions/watchlist.actions";

const WatchlistButton = ({
    symbol,
    company,
    exchange,
    stockType,
    isInWatchlist,
    showTrashIcon = false,
    type = "button",
}: WatchlistButtonProps) => {
    const [addedOverride, setAddedOverride] = useState<boolean | null>(null);
    const added = addedOverride ?? isInWatchlist;
    const [pending, setPending] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const onWatchlistChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ symbol: string; isAdded: boolean }>).detail;
            if (detail.symbol === symbol) setAddedOverride(detail.isAdded);
        };
        window.addEventListener('watchlist:changed', onWatchlistChanged);
        return () => window.removeEventListener('watchlist:changed', onWatchlistChanged);
    }, [symbol]);

    const label = added ? "Remove from Watchlist" : "Add to Watchlist";

    // Handle adding/removing stocks from watchlist
    const toggleWatchlist = async () => {
        setPending(true);
        const wasAdded = added;

        try {
            const result = wasAdded
                ? await removeFromWatchlist(symbol)
                : await addToWatchlist(symbol, company, exchange, stockType);

            if (!result?.success) {
                toast.error(result && 'error' in result ? result.error : 'Could not update watchlist');
                return;
            }

            const isAdded = !wasAdded;
            setAddedOverride(isAdded);
            window.dispatchEvent(new CustomEvent('watchlist:changed', {
                detail: { symbol, isAdded },
            }));
            router.refresh();
            toast.success(wasAdded ? 'Removed from watchlist' : 'Added to watchlist');
        } catch {
            toast.error('Could not update watchlist');
        } finally {
            setPending(false);
        }
    };

    // Click handler that provides optimistic UI updates
    const handleClick = (e: React.MouseEvent) => {
        // Prevent event bubbling and default behavior
        e.stopPropagation();
        e.preventDefault();

        void toggleWatchlist();
    };

    if (type === "icon") {
        return (
            <button
                title={added
                    ? `Remove ${symbol} from watchlist `
                    : `Add ${symbol} to watchlist`
                }
                aria-label={
                    added
                        ? `Remove ${symbol} from watchlist`
                        : `Add ${symbol} to watchlist`
                }
                className={`watchlist-icon-btn ${added ? 'watchlist-icon-added' : ''}`}
                onClick={handleClick}
                disabled={pending}
            >
                <Star fill={added ? 'currentColor' : 'none'} />

            </button>
        );
    }

    return (
        <button
            className={`watchlist-btn ${added ? "watchlist-remove" : ""}`}
            onClick={handleClick}
            disabled={pending}
        >
            {showTrashIcon && added ? <Trash2 /> : null}
            <span>{label}</span>
        </button>
    );
};

export default WatchlistButton;
