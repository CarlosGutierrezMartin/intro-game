import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { SpotifyProvider } from '../../providers/spotify/SpotifyProvider';
import { SearchResult } from '../../types';
import { getSocket } from '../../services/socketService';

interface SearchGuessProps {
    onSelect: (trackId: string) => void;
    disabled?: boolean;
}

export const SearchGuess: React.FC<SearchGuessProps> = ({ onSelect, disabled }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const { checkAndRefresh } = useAuthStore();

    // Debounced search — uses Spotify API directly if authenticated,
    // otherwise falls back to server-side socket proxy
    useEffect(() => {
        if (query.length < 2) {
            setResults([]);
            setIsOpen(false);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            try {
                const token = await checkAndRefresh();
                if (token) {
                    // ─── Authenticated: direct Spotify API ───
                    const provider = new SpotifyProvider(() => token);
                    const data = await provider.searchTracks(query, 8);
                    setResults(data);
                    setIsOpen(data.length > 0);
                } else {
                    // ─── Unauthenticated: server-side proxy via socket ───
                    await searchViaSocket(query, setResults, setIsOpen);
                }
            } catch (e) {
                console.error('Search failed:', e);
            } finally {
                setIsSearching(false);
            }
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [query]);

    const handleSelect = useCallback((trackId: string) => {
        onSelect(trackId);
        setQuery('');
        setResults([]);
        setIsOpen(false);
    }, [onSelect]);

    const handleClear = () => {
        setQuery('');
        setResults([]);
        setIsOpen(false);
        inputRef.current?.focus();
    };

    // Focus input when not disabled
    useEffect(() => {
        if (!disabled) {
            inputRef.current?.focus();
        }
    }, [disabled]);

    return (
        <div style={{ position: 'relative', width: '100%', maxWidth: '420px', margin: '0 auto', zIndex: 50 }}>
            <div className={`md-search-bar ${isOpen ? 'md-search-results-open' : ''}`}>
                <svg className="search-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>

                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Guess the song..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                />

                {isSearching && (
                    <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', flexShrink: 0 }} />
                )}

                {query && !isSearching && (
                    <button className="clear-btn" onClick={handleClear}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
                        </svg>
                    </button>
                )}
            </div>

            {isOpen && results.length > 0 && (
                <div className="md-search-results">
                    {results.map((track) => (
                        <button
                            key={track.id}
                            className="track-card"
                            onClick={() => handleSelect(track.id)}
                        >
                            <img src={track.albumArt} alt={track.album} />
                            <div className="track-info">
                                <div className="track-title">{track.title}</div>
                                <div className="track-artist">{track.artist}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * Search via server-side socket proxy.
 * Uses the existing socket connection to emit 'search_tracks' and
 * receives 'search_results' with tracks resolved via Client Credentials.
 */
function searchViaSocket(
    query: string,
    setResults: React.Dispatch<React.SetStateAction<SearchResult[]>>,
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
): Promise<void> {
    return new Promise((resolve) => {
        const socket = getSocket();
        if (!socket.connected) {
            console.warn('[SearchGuess] Socket not connected, cannot search');
            resolve();
            return;
        }

        // One-time listener for this specific search response
        const timeout = setTimeout(() => {
            socket.off('search_results', handleResults);
            resolve();
        }, 5000); // 5s timeout

        const handleResults = (data: { results: SearchResult[]; error?: string }) => {
            clearTimeout(timeout);
            socket.off('search_results', handleResults);
            if (data.error) {
                console.warn('[SearchGuess] Server search error:', data.error);
            }
            setResults(data.results || []);
            setIsOpen((data.results || []).length > 0);
            resolve();
        };

        socket.on('search_results', handleResults);
        socket.emit('search_tracks', { query });
    });
}
