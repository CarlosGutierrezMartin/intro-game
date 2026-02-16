// ─── Spotify Web API Wrapper ───

const BASE_URL = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'SpotifyApiError';
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Low-level fetch wrapper for Spotify Web API.
 * Automatically injects auth token and handles errors.
 * Retries on 429 (Too Many Requests).
 */
export async function spotifyFetch<T>(
    endpoint: string,
    token: string,
    options?: RequestInit,
    retries = 3
): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...options?.headers,
        },
    });

    if (!response.ok) {
        // Handle Rate Limiting (429)
        if (response.status === 429 && retries > 0) {
            const retryAfterSec = parseInt(response.headers.get('Retry-After') || '1', 10);
            const waitMs = (retryAfterSec * 1000) + 500; // Wait extra 500ms

            console.warn(`[Intro] Spotify 429: Waiting ${waitMs}ms...`);
            await sleep(waitMs);
            return spotifyFetch<T>(endpoint, token, options, retries - 1);
        }

        const errorText = await response.text();
        let errorData: any = {};
        try { errorData = JSON.parse(errorText); } catch { /* raw text */ }
        console.error(`[Intro] Spotify API Error ${response.status}:`, errorText);
        throw new SpotifyApiError(
            response.status,
            errorData?.error?.message || `Spotify API error: ${response.status}`
        );
    }

    return response.json();
}

// ─── API Types (Spotify response shapes) ───

interface SpotifyImage {
    url: string;
    height: number | null;
    width: number | null;
}

interface SpotifyPlaylistItem {
    id: string;
    name: string;
    description: string;
    images: SpotifyImage[];
    tracks: { total: number };
    owner: { display_name: string };
}

interface SpotifyTrackItem {
    track: {
        id: string;
        name: string;
        artists: { name: string }[];
        album: {
            name: string;
            images: SpotifyImage[];
            release_date: string;
        };
        preview_url: string | null;
    } | null;
}

/** Shape returned by /me/tracks (Liked Songs) */
interface SpotifySavedTrack {
    track: {
        id: string;
        name: string;
        artists: { name: string }[];
        album: {
            name: string;
            images: SpotifyImage[];
            release_date: string;
        };
        preview_url: string | null;
    };
}

/** Shape returned by /me/top/tracks */
interface SpotifyTopTrack {
    id: string;
    name: string;
    artists: { name: string }[];
    album: {
        name: string;
        images: SpotifyImage[];
        release_date: string;
    };
    preview_url: string | null;
}

interface SpotifySearchTrack {
    id: string;
    name: string;
    artists: { name: string }[];
    album: {
        name: string;
        images: SpotifyImage[];
    };
    preview_url: string | null;
}

interface SpotifyUser {
    id: string;
    display_name: string;
    email: string;
    images: SpotifyImage[];
}

// ─── Helper: map raw track to our Track shape ───

function mapTrack(t: {
    id: string;
    name: string;
    artists: { name: string }[];
    album: { name: string; images: SpotifyImage[]; release_date?: string };
    preview_url: string | null;
}) {
    return {
        id: t.id,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        album: t.album.name,
        albumArt: t.album.images?.[0]?.url || '',
        previewUrl: t.preview_url,
        year: t.album.release_date?.split('-')[0] || '',
    };
}

// ─── Public API Functions ───

export async function fetchCurrentUser(token: string): Promise<SpotifyUser> {
    return spotifyFetch<SpotifyUser>('/me', token);
}

export async function fetchUserPlaylists(token: string, limit = 50) {
    const data = await spotifyFetch<{ items: (SpotifyPlaylistItem | null)[] }>(
        `/me/playlists?limit=${limit}`,
        token
    );
    return data.items
        .filter((p): p is SpotifyPlaylistItem => p !== null && p.id !== undefined)
        .map((p) => ({
            id: p.id,
            name: p.name || 'Untitled Playlist',
            description: p.description || '',
            coverUrl: p.images?.[0]?.url || '',
            trackCount: p.tracks?.total ?? 0,
            owner: p.owner?.display_name || '',
        }));
}

/**
 * Fetch playlist tracks — tries /playlists/{id}/tracks first,
 * falls back to /playlists/{id} (full object), and if both fail
 * in Development Mode, throws with a clear message.
 */
export async function fetchPlaylistTracks(token: string, playlistId: string) {
    // Strategy 1: Direct /tracks endpoint
    try {
        const data = await spotifyFetch<{ items: SpotifyTrackItem[] }>(
            `/playlists/${playlistId}/tracks?limit=100`,
            token
        );
        const tracks = data.items
            .filter((item) => item.track)
            .map((item) => mapTrack(item.track!));
        if (tracks.length > 0) return tracks;
    } catch (e: any) {
        console.warn('[Intro] /tracks endpoint blocked:', e.status);
    }

    // Strategy 2: Full playlist object
    try {
        const data = await spotifyFetch<any>(
            `/playlists/${playlistId}`,
            token
        );
        if (data.tracks?.items?.length > 0) {
            const tracks = data.tracks.items
                .filter((item: SpotifyTrackItem) => item.track)
                .map((item: SpotifyTrackItem) => mapTrack(item.track!));
            if (tracks.length > 0) return tracks;
        }
    } catch (e: any) {
        console.warn('[Intro] Full playlist endpoint also failed:', e.status);
    }

    throw new SpotifyApiError(
        403,
        'Spotify restricts playlist tracks in Development Mode. Try "Liked Songs" or "Top Tracks" instead!'
    );
}

/**
 * Fetch user's Liked Songs (/me/tracks) — works in Development Mode
 */
export async function fetchLikedSongs(token: string, limit = 50) {
    const data = await spotifyFetch<{ items: SpotifySavedTrack[]; total: number }>(
        `/me/tracks?limit=${limit}`,
        token
    );

    return data.items
        .filter((item) => item.track)
        .map((item) => mapTrack(item.track));
}

/**
 * Fetch user's Top Tracks (/me/top/tracks) — works in Development Mode
 */
export async function fetchTopTracks(token: string, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term', limit = 50) {
    const data = await spotifyFetch<{ items: SpotifyTopTrack[] }>(
        `/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
        token
    );

    return data.items
        .map((t) => mapTrack(t));
}

export async function searchTracks(token: string, query: string, limit = 10) {
    const encoded = encodeURIComponent(query);
    const data = await spotifyFetch<{ tracks: { items: SpotifySearchTrack[] } }>(
        `/search?q=${encoded}&type=track&limit=${limit}`,
        token
    );

    return data.tracks.items.map((t) => ({
        id: t.id,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        album: t.album.name,
        albumArt: t.album.images?.[0]?.url || '',
    }));
}
