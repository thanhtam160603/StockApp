"use client";
import { useMemo, useState } from "react";
import { useDebounce } from "@/hook/useDebounce";
import { Star, StarIcon, Stars, Trash2 } from 'lucide-react';
import { toast } from "sonner";
import { addToWatchlist, removeFromWatchlist } from "@/lib/actions/watchlist.actions";

const WatchlistButton = ({
    symbol,
    company,
    isInWatchlist,
    showTrashIcon = false,
    type = "button",
    onWatchlistChange,
}: WatchlistButtonProps) => {
    const [added, setAdded] = useState<boolean>(!!isInWatchlist);

    const label = useMemo(() => {
        if (type === "icon") return added ? "" : "";
        return added ? "Remove from Watchlist" : "Add to Watchlist";
    }, [added, type]);

    // Handle adding/removing stocks from watchlist
    const toggleWatchlist = async () => {
        const result = added
            ? await removeFromWatchlist(symbol)
            : await addToWatchlist(symbol, company);

        if (result?.success) {
            toast.success(added ? "Removed from watchlist" : "Added to watchlist", {
                description: `${company} ${added ? "removed from" : "added to"
                    } your watchlist.`,
            });

            // Notify parent component of watchlist change for state synchronization
            onWatchlistChange?.(symbol, !added);
        }
    }

    // Debounce the toggle function to prevent rapid API calls (300ms delay)
    const debouncedToggle = useDebounce(toggleWatchlist, 300);

    // Click handler that provides optimistic UI updates
    const handleClick = (e: React.MouseEvent) => {
        // Prevent event bubbling and default behavior
        e.stopPropagation();
        e.preventDefault();

        setAdded(!added);
        debouncedToggle();
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
            >
                <Star fill={added ? 'currentColor' : 'none'} />

            </button>
        );
    }

    return (
        <button
            className={`watchlist-btn ${added ? "watchlist-remove" : ""}`}
            onClick={handleClick}
        >
            {showTrashIcon && added ? <Trash2 /> : null}
            <span>{label}</span>
        </button>
    );
};

export default WatchlistButton;