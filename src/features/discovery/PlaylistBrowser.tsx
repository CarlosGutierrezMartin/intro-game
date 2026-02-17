import * as React from 'react';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { useThemeStore } from '../../stores/themeStore';
import { SpotifyProvider } from '../../providers/spotify/SpotifyProvider';
import { fetchLikedSongs, fetchTopTracks, fetchPlaylistTracks } from '../../providers/spotify/spotifyApi';
import { Playlist, Track } from '../../types';
import { useMultiplayerStore } from '../../stores/multiplayerStore';
import { redirectToSpotifyLogin } from '../auth/spotifyAuth';

export const PlaylistBrowser: React.FC = () => {
    const { user, logout, checkAndRefresh } = useAuthStore();
    const { startGame } = useGameStore();
    const { applyPlaylistTheme } = useThemeStore();

    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadPlaylists();
    }, []);

    const getToken = async (): Promise<string | null> => {
        let token = await checkAndRefresh();
        if (!token) token = useAuthStore.getState().accessToken;
        return token;
    };

    // ─── Playlists ───
    const loadPlaylists = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getToken();
            if (!token) {
                // Verified Guest or just no token -> limited mode
                setPlaylists([]);
                return;
            }
            const provider = new SpotifyProvider(() => token);
            const data = await provider.getUserPlaylists();
            setPlaylists(data);
        } catch (e: any) {
            setError(e.message || 'Failed to load playlists');
        } finally {
            setLoading(false);
        }
    };

    // ─── Start game from tracks ───
    const launchGame = async (id: string, name: string, coverUrl: string, tracks: Track[]) => {
        if (tracks.length === 0) {
            setError('No tracks found in this collection.');
            setLoadingId(null);
            return;
        }

        // Fetch missing preview URLs from Spotify embed pages
        setError(null);
        const { batchFetchPreviews } = await import('../../services/previewFetcher');
        await batchFetchPreviews(tracks);

        // Filter to only tracks that have audio
        const playable = tracks.filter((t) => t.previewUrl);
        if (playable.length === 0) {
            setError(`Found ${tracks.length} tracks but none have audio previews available. Spotify has restricted preview access.`);
            setLoadingId(null);
            return;
        }

        if (coverUrl) applyPlaylistTheme(coverUrl);

        const playlist: Playlist = {
            id,
            name,
            description: '',
            coverUrl,
            trackCount: playable.length,
            owner: user?.displayName || '',
        };

        startGame(playlist, playable);
    };

    const requireLogin = () => {
        setError('Please log in with Spotify to access your library.');
    };

    // ─── Liked Songs ───
    const handleLikedSongs = async () => {
        if (!user) return requireLogin();
        if (loadingId) return;
        setLoadingId('liked');
        setError(null);
        try {
            const token = await getToken();
            if (!token) return;
            const tracks = await fetchLikedSongs(token, 50);
            await launchGame('liked', '💚 Liked Songs', '', tracks);
        } catch (e: any) {
            setError(e.message || 'Failed to load liked songs');
        } finally {
            setLoadingId(null);
        }
    };

    // ─── Top Tracks ───
    const handleTopTracks = async (range: 'short_term' | 'medium_term' | 'long_term', label: string) => {
        if (!user) return requireLogin();
        const id = `top-${range}`;
        if (loadingId) return;
        setLoadingId(id);
        setError(null);
        try {
            const token = await getToken();
            if (!token) return;
            const tracks = await fetchTopTracks(token, range, 50);
            await launchGame(id, label, '', tracks);
        } catch (e: any) {
            setError(e.message || 'Failed to load top tracks');
        } finally {
            setLoadingId(null);
        }
    };

    // ─── Playlist ───
    const handleSelectPlaylist = async (playlist: Playlist) => {
        if (loadingId) return;
        setLoadingId(playlist.id);
        setError(null);
        try {
            const token = await getToken();
            if (!token) return;
            const tracks = await fetchPlaylistTracks(token, playlist.id);
            await launchGame(playlist.id, playlist.name, playlist.coverUrl, tracks);
        } catch (e: any) {
            setError(e.message || 'Failed to load tracks');
        } finally {
            setLoadingId(null);
        }
    };

    // ─── Built-in quick-play cards ───
    const quickPlayCards = [
        { id: 'liked', label: '💚 Liked Songs', sub: 'Your saved songs', onClick: handleLikedSongs },
        { id: 'top-short_term', label: '🔥 Recent Hits', sub: 'Last 4 weeks', onClick: () => handleTopTracks('short_term', '🔥 Recent Hits') },
        { id: 'top-medium_term', label: '⭐ Top Tracks', sub: 'Last 6 months', onClick: () => handleTopTracks('medium_term', '⭐ Top Tracks') },
        { id: 'top-long_term', label: '👑 All-Time Faves', sub: 'All time', onClick: () => handleTopTracks('long_term', '👑 All-Time Faves') },
    ];

    return (
        <div className="discovery-container slide-up">
            {/* Header */}
            <div className="discovery-header">
                <div className="discovery-logo">Intro</div>
                <p className="discovery-subtitle">Pick a vibe. Guess the track. Beat the clock.</p>
                <button
                    className="md-btn md-btn-tonal"
                    onClick={() => useMultiplayerStore.getState().enterLobby()}
                    style={{ marginTop: '16px' }}
                >
                    Challenge a Friend
                </button>
            </div>

            {/* User info */}
            {user ? (
                <div className="discovery-user">
                    <div className="discovery-avatar">
                        {user.avatarUrl ? (
                            <img
                                src={user.avatarUrl}
                                alt={user.displayName}
                                style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                            />
                        ) : (
                            user.displayName.charAt(0).toUpperCase()
                        )}
                    </div>
                    <div>
                        <div className="discovery-user-name">{user.displayName}</div>
                        {user.email && <div className="discovery-user-email">{user.email}</div>}
                    </div>
                    <button className="discovery-logout" onClick={logout} title="Logout">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            ) : (
                <button
                    className="md-btn md-btn-outlined"
                    onClick={() => redirectToSpotifyLogin()}
                    style={{ position: 'absolute', top: 20, right: 20, borderColor: 'var(--md-outline)' }}
                >
                    Login to Spotify
                </button>
            )}

            {/* Error */}
            {error && (
                <div style={{
                    padding: '12px 16px',
                    borderRadius: 'var(--md-shape-lg)',
                    backgroundColor: 'var(--md-error-container)',
                    color: 'var(--md-on-error-container)',
                    marginBottom: '16px',
                    fontSize: '0.875rem',
                }}>
                    {error}
                    <button
                        onClick={() => setError(null)}
                        style={{ float: 'right', opacity: 0.7, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                    >✕</button>
                </div>
            )}

            {/* Quick Play — always available */}
            <div className="discovery-section-title">Quick Play</div>
            <div className="quick-play-grid">
                {quickPlayCards.map((card) => (
                    <button
                        key={card.id}
                        className="quick-play-card"
                        onClick={card.onClick}
                        disabled={!!loadingId}
                    >
                        <div className="quick-play-label">{card.label}</div>
                        <div className="quick-play-sub">
                            {loadingId === card.id ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />
                                    Loading...
                                </span>
                            ) : card.sub}
                        </div>
                    </button>
                ))}
            </div>

            {/* Playlists */}
            {loading ? (
                <div className="empty-state">
                    <div className="spinner" />
                    <p style={{ marginTop: '16px' }}>Loading your playlists...</p>
                </div>
            ) : playlists.length > 0 && (
                <>
                    <div className="discovery-section-title" style={{ marginTop: '24px' }}>Your Playlists</div>
                    <div className="playlist-grid">
                        {playlists.map((playlist) => (
                            <button
                                key={playlist.id}
                                className="playlist-card"
                                onClick={() => handleSelectPlaylist(playlist)}
                                disabled={!!loadingId}
                                style={{ textAlign: 'left', border: 'none', width: '100%' }}
                            >
                                {playlist.coverUrl ? (
                                    <img
                                        className="playlist-art"
                                        src={playlist.coverUrl}
                                        alt={playlist.name}
                                        loading="lazy"
                                    />
                                ) : (
                                    <div
                                        className="playlist-art"
                                        style={{
                                            aspectRatio: '1',
                                            backgroundColor: 'var(--md-surface-container-high)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                                            <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
                                        </svg>
                                    </div>
                                )}
                                <div className="playlist-overlay">
                                    <div className="playlist-name">{playlist.name}</div>
                                    {playlist.description && (
                                        <div className="playlist-desc">{playlist.description.substring(0, 60)}</div>
                                    )}
                                    <div className="playlist-tracks">
                                        {loadingId === playlist.id ? (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />
                                                Loading...
                                            </span>
                                        ) : (
                                            `${playlist.trackCount} tracks`
                                        )}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
