import * as React from 'react';
import { useState, useEffect } from 'react';
import { useMultiplayerStore } from '../../stores/multiplayerStore';
import { useAuthStore } from '../../stores/authStore';
import { SpotifyProvider } from '../../providers/spotify/SpotifyProvider';
import { batchFetchPreviews } from '../../services/previewFetcher';
import { TrackData } from '../../../shared/events';
import { getSocket } from '../../services/socketService';
import { redirectToSpotifyLogin } from '../auth/spotifyAuth';

interface PlaylistOption {
    id: string;
    name: string;
    coverUrl: string;
    trackCount: number;
    tracks?: TrackData[]; // Optional pre-loaded tracks (for generic playlists)
}

export const WaitingRoom: React.FC = () => {
    const { sessionCode, isHost, me, opponent, selectTracks, leaveLobby, error } = useMultiplayerStore();
    const { checkAndRefresh, user } = useAuthStore();
    const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingPlaylist, setLoadingPlaylist] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Load playlists (User's or Generic)
    useEffect(() => {
        if (!isHost) return;

        const loadContent = async () => {
            setLoading(true);

            // If logged in, load user playlists
            if (user) {
                try {
                    const token = await checkAndRefresh();
                    if (!token) return;
                    const provider = new SpotifyProvider(() => token);
                    const data = await provider.getUserPlaylists();
                    setPlaylists(data.map((p: any) => ({
                        id: p.id,
                        name: p.name,
                        coverUrl: p.coverUrl,
                        trackCount: p.trackCount,
                    })));
                } catch (e) {
                    console.error('[WaitingRoom] Failed to load user playlists:', e);
                } finally {
                    setLoading(false);
                }
            } else {
                // If NOT logged in, request Generic Playlists from Server
                const socket = getSocket();

                const onGenericPlaylists = (data: { playlists: PlaylistOption[] }) => {
                    setPlaylists(data.playlists);
                    setLoading(false);
                };

                const onGenericError = (data: { message: string }) => {
                    console.error('[WaitingRoom] Generic playlist error:', data.message);
                    setLoading(false);
                };

                socket.on('generic_playlists', onGenericPlaylists);
                socket.on('generic_playlists_error', onGenericError);

                socket.emit('request_generic_playlists');

                return () => {
                    socket.off('generic_playlists', onGenericPlaylists);
                    socket.off('generic_playlists_error', onGenericError);
                };
            }
        };

        loadContent();
    }, [isHost, user]);

    const handleCopyCode = async () => {
        if (sessionCode) {
            await navigator.clipboard.writeText(sessionCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleSelectPlaylist = async (playlist: PlaylistOption) => {
        setLoadingPlaylist(playlist.id);
        try {
            let tracks: TrackData[] = [];

            // 1. Use pre-loaded tracks if available (Generic Playlists)
            if (playlist.tracks) {
                tracks = playlist.tracks;
            }
            // 2. Fetch from Spotify if logged in
            else {
                const token = await checkAndRefresh();
                if (!token) return;
                const provider = new SpotifyProvider(() => token);

                let rawTracks;
                if (playlist.id === 'liked-songs') {
                    rawTracks = await provider.getLikedSongs();
                } else {
                    rawTracks = await provider.getPlaylistTracks(playlist.id);
                }

                // Resolve preview URLs
                await batchFetchPreviews(rawTracks);

                // Filter playable & map to shared TrackData format
                tracks = rawTracks
                    .filter((t) => t.previewUrl)
                    .map((t) => ({
                        id: t.id,
                        title: t.title,
                        artist: t.artist,
                        album: t.album,
                        albumArt: t.albumArt,
                        previewUrl: t.previewUrl,
                    }));
            }

            if (tracks.length < 3) {
                alert(`Only ${tracks.length} playable tracks found. Need at least 3.`);
                setLoadingPlaylist(null);
                return;
            }

            selectTracks(tracks, playlist.name);
        } catch (e) {
            console.error('[WaitingRoom] Failed to load tracks:', e);
            alert('Failed to load tracks. Please try again.');
        } finally {
            setLoadingPlaylist(null);
        }
    };

    return (
        <div className="waiting-room slide-up">
            {/* ─── Header ─── */}
            <div className="game-header">
                <button className="game-header-btn" onClick={leaveLobby}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                </button>
                <div style={{ flex: 1 }} />
            </div>

            {/* ─── Session Code ─── */}
            <div className="session-code-section">
                <div className="session-code-label">Session Code</div>
                <button className="session-code-badge" onClick={handleCopyCode}>
                    <span className="session-code-text">{sessionCode}</span>
                    <span className="session-code-copy">
                        {copied ? '✓' : '📋'}
                    </span>
                </button>
                <p className="session-code-hint">
                    {copied ? 'Copied!' : 'Tap to copy — share with your friend'}
                </p>
            </div>

            {/* ─── Players ─── */}
            <div className="waiting-players">
                <div className="waiting-player">
                    {me?.avatarUrl ? (
                        <img className="waiting-player-avatar" src={me.avatarUrl} alt={me.displayName} />
                    ) : (
                        <div className="waiting-player-avatar waiting-player-avatar-placeholder">
                            {me?.displayName?.charAt(0) || '?'}
                        </div>
                    )}
                    <div className="waiting-player-name">{me?.displayName || 'You'}</div>
                    <div className="waiting-player-badge">
                        {isHost ? '👑 Host' : '🎮 Player'}
                    </div>
                </div>

                <div className="waiting-vs">VS</div>

                {opponent ? (
                    <div className="waiting-player">
                        {opponent.avatarUrl ? (
                            <img className="waiting-player-avatar" src={opponent.avatarUrl} alt={opponent.displayName} />
                        ) : (
                            <div className="waiting-player-avatar waiting-player-avatar-placeholder">
                                {opponent.displayName?.charAt(0) || '?'}
                            </div>
                        )}
                        <div className="waiting-player-name">{opponent.displayName}</div>
                        <div className="waiting-player-badge">🎮 Player</div>
                    </div>
                ) : (
                    <div className="waiting-player waiting-player-empty">
                        <div className="waiting-player-avatar waiting-player-avatar-placeholder waiting-pulse">?</div>
                        <div className="waiting-player-name" style={{ opacity: 0.5 }}>Waiting...</div>
                    </div>
                )}
            </div>

            {error && <div className="lobby-error">{error}</div>}

            {/* ─── Playlist Selection (Host Only) ─── */}
            {isHost && opponent && (
                <div className="waiting-playlist-section">
                    <h3 className="waiting-playlist-title">Choose a playlist</h3>

                    {/* Login Prompt for Guests */}
                    {!user && (
                        <div style={{ marginBottom: 24, textAlign: 'center' }}>
                            <p style={{ opacity: 0.7, marginBottom: 12, fontSize: '0.9rem' }}>
                                Want to play your own playlists?
                            </p>
                            <button
                                onClick={redirectToSpotifyLogin}
                                className="spotify-btn"
                                style={{ padding: '8px 24px', fontSize: '0.9rem' }}
                            >
                                Log in to Spotify
                            </button>
                        </div>
                    )}

                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
                            <div className="spinner" />
                        </div>
                    ) : (
                        <div className="waiting-playlist-grid">
                            {/* ─── Liked Songs Card (Logged In Only) ─── */}
                            {user && (
                                <button
                                    className="waiting-playlist-card"
                                    onClick={() => handleSelectPlaylist({ id: 'liked-songs', name: 'Liked Songs', coverUrl: '', trackCount: 0 })}
                                    disabled={loadingPlaylist !== null}
                                >
                                    <div className="waiting-playlist-art" style={{ background: 'linear-gradient(135deg, #450af5, #c4efd9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{ fontSize: '2rem' }}>💖</span>
                                    </div>
                                    <div className="waiting-playlist-info">
                                        <div className="waiting-playlist-name">Liked Songs</div>
                                        <div className="waiting-playlist-count">Your favorites</div>
                                    </div>
                                    {loadingPlaylist === 'liked-songs' && (
                                        <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                                    )}
                                </button>
                            )}

                            {playlists.map((pl) => (
                                <button
                                    key={pl.id}
                                    className="waiting-playlist-card"
                                    onClick={() => handleSelectPlaylist(pl)}
                                    disabled={loadingPlaylist !== null}
                                >
                                    <img
                                        className="waiting-playlist-art"
                                        src={pl.coverUrl || ''}
                                        alt={pl.name}
                                    />
                                    <div className="waiting-playlist-info">
                                        <div className="waiting-playlist-name">{pl.name}</div>
                                        <div className="waiting-playlist-count">{pl.trackCount} tracks</div>
                                    </div>
                                    {loadingPlaylist === pl.id && (
                                        <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ─── Guest Waiting Message ─── */}
            {!isHost && opponent && (
                <div className="waiting-guest-msg">
                    <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
                    <span>Waiting for host to pick a playlist...</span>
                </div>
            )}
        </div>
    );
};
