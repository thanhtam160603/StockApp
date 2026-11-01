'use client';

import { useState, useEffect } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { useDebounce } from "@/hook/useDebounce";

export default function SearchCommand({ renderAs = 'button', label = 'Add stock', initialStocks }: SearchCommandProps) { 
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [stocks, setStocks] = useState<StockWithWatchlistStatus[]>(initialStocks);

    const isSearchMode = !!searchTerm.trim();
    const displayStocks = isSearchMode ? stocks : stocks.slice(0, 10); // Show only the first 10 stocks when not searching

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { 
            if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='k') {
                e.preventDefault();
                setOpen((open) => !open);
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        }
    }, []);

    const handleSearch = async () => {
        if (!isSearchMode) return setStocks(initialStocks); // Reset to initial stocks if search term is empty
        
        setLoading(true);

        try {
            const results = await searchStocks(searchTerm.trim());
            setStocks(results);
        } catch (e) {
            setStocks([]);
        }
        finally {
            setLoading(false);
        }

    }

    const debouncedSearch = useDebounce(handleSearch, 300);

    useEffect(() => { 
        debouncedSearch();
    }, [searchTerm]);



    const handleSelectStock = (value: string) => {
        setOpen(false);
        setSearchTerm('');
        setStocks(initialStocks); // Reset to initial stocks after selection
    }
    return (
        <>
            {renderAs === 'text' ? (
                <span onClick={() => setOpen(true)} className="search-text">
                    {label}
                </span>
            ) : (
                    <Button onClick={() => setOpen(true)} className="search-btn">
                        {label}
                    </Button>
            )}
            <CommandDialog open={open} onOpenChange={setOpen} className="search-dialog">
                <Command>
                    <div className="search-field">
                        <CommandInput value={searchTerm} onValueChange={setSearchTerm} placeholder="Search stocks..." />
                        {loading && <Loader2 className="search-loader" />}
                    </div>
                    <CommandList className="search-list">
                        {loading ? (
                            <CommandEmpty className="search-list-empty">Loading stocks...</CommandEmpty>
                        ) : displayStocks?.length === 0 ? (
                            <div className="search-list-indicator">
                                {isSearchMode ? 'No results found' : 'No stocks available'}
                            </div>
                            ) : (
                                    <ul>
                                        <div className="search-count">
                                            {isSearchMode ? 'Search results' : 'Popular stocks'}
                                            {` `}({displayStocks.length || 0})
                                        </div>
                                        {displayStocks.map((stock, i) => (
                                            <li key={stock.symbol} className="search-item">
                                                <Link
                                                    href={`/stocks/${stock.symbol}`}
                                                    onClick={() => handleSelectStock(stock.symbol)}
                                                    className="search-item-link"
                                                >
                                                    <TrendingUp className="h-4 w-4 text-gray-500" />
                                                    <div className="flex-1">
                                                        <div className="search-item-name">
                                                            {stock.name}
                                                        </div>
                                                        <div className="text-sm text-gray-500">
                                                            {stock.symbol} | {stock.exchange} | {stock.type}
                                                        </div>
                                                    </div>
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                        )}
                    </CommandList>
                </Command>
                
            </CommandDialog>
        </>
    )
}