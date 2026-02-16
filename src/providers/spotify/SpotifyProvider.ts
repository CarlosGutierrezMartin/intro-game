import { MusicProvider } from '../types';
import { Playlist, Track, SearchResult } from '../../types';
import {
    fetchUserPlaylists,
    fetchPlaylistTracks,
    searchTracks as apiSearchTracks,
    fetchLikedSongs,
} from './spotifyApi';

/**
 * Spotify implementation of the MusicProvider interface.
 * Requires a valid access token from the auth store.
 */
export class SpotifyProvider implements MusicProvider {
    constructor(private getToken: () => string) { }

    async getUserPlaylists(): Promise<Playlist[]> {
        return fetchUserPlaylists(this.getToken());
    }

    async getPlaylistTracks(playlistId: string): Promise<Track[]> {
        return fetchPlaylistTracks(this.getToken(), playlistId);
    }

    async searchTracks(query: string, limit = 10): Promise<SearchResult[]> {
        return apiSearchTracks(this.getToken(), query, limit);
    }

    async getLikedSongs(): Promise<Track[]> {
        return fetchLikedSongs(this.getToken());
    }
}
