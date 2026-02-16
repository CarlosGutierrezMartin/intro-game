import { Playlist, Track, SearchResult } from '../types';

/**
 * Provider-agnostic interface for music services.
 * Implement this to add Spotify, Apple Music, YouTube Music, etc.
 */
export interface MusicProvider {
    /** Get the authenticated user's playlists */
    getUserPlaylists(): Promise<Playlist[]>;

    /** Load tracks for a specific playlist */
    getPlaylistTracks(playlistId: string): Promise<Track[]>;

    /** Search the provider's global track database */
    searchTracks(query: string, limit?: number): Promise<SearchResult[]>;
}
