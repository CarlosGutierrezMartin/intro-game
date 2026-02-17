// ─── Spotify Web API Wrapper ───

import type { Track } from '../../types';

const BASE_URL = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'SpotifyApiError';
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Global Request Queue ───
// Serializes all Spotify API calls with a minimum gap between them.
// Prevents burst requests from multiple flows firing in parallel.
let lastRequestTime = 0;
const MIN_GAP_MS = 300;

async function waitForSlot(): Promise<void> {
    const now = Date.now();
    const gap = lastRequestTime + MIN_GAP_MS - now;
    if (gap > 0) {
        await sleep(gap);
    }
    lastRequestTime = Date.now();
}

// When a 429 is hit, pause the entire queue — not just the failing request
function pauseQueue(durationMs: number): void {
    lastRequestTime = Math.max(lastRequestTime, Date.now() + durationMs);
}

/**
 * Low-level fetch wrapper for Spotify Web API.
 * - Global serial queue with MIN_GAP_MS between requests
 * - Exponential backoff with jitter on 429
 * - Silent token refresh on 401
 * - Network error detection
 */
export async function spotifyFetch<T>(
    endpoint: string,
    token: string,
    options?: RequestInit,
    retries = 5
): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;

    // Wait for our slot in the global queue
    await waitForSlot();

    let response: Response;
    try {
        response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                ...options?.headers,
            },
        });
    } catch (e: any) {
        // Network error — offline, DNS failure, timeout
        if (e instanceof TypeError && e.message.includes('fetch')) {
            throw new SpotifyApiError(0, 'No internet connection. Check your network and try again.');
        }
        throw new SpotifyApiError(0, `Network error: ${e.message}`);
    }

    if (!response.ok) {
        // ─── Handle 429 (Rate Limiting) ───
        if (response.status === 429 && retries > 0) {
            const retryAfterSec = parseInt(response.headers.get('Retry-After') || '1', 10);
            const attempt = 5 - retries; // 0, 1, 2, 3, 4
            const backoff = Math.min(retryAfterSec * 1000 * Math.pow(2, attempt), 10000);
            const jitter = Math.random() * 500;
            const waitMs = backoff + jitter;

            console.warn(`[Intro] Spotify 429: Waiting ${Math.round(waitMs)}ms (attempt ${attempt + 1}/5)...`);
            pauseQueue(waitMs); // Block other requests too
            await sleep(waitMs);
            return spotifyFetch<T>(endpoint, token, options, retries - 1);
        }

        // ─── Handle 401 (Token Expired) ───
        if (response.status === 401 && retries > 0) {
            try {
                // Lazy import to avoid circular dependency
                const { useAuthStore } = await import('../../stores/authStore');
                const newToken = await useAuthStore.getState().checkAndRefresh();
                if (newToken && newToken !== token) {
                    console.log('[Intro] Token refreshed silently, retrying...');
                    return spotifyFetch<T>(endpoint, newToken, options, retries - 1);
                }
            } catch {
                // Refresh failed
            }
            throw new SpotifyApiError(401, 'Session expired. Please log in again.');
        }

        // ─── Handle 403 (Forbidden — Dev Mode restriction) ───
        if (response.status === 403) {
            throw new SpotifyApiError(
                403,
                'This content is restricted in Spotify Development Mode. Try Liked Songs or Top Tracks instead.'
            );
        }

        // ─── Other errors ───
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
}): Track {
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

// ─── Helper: Fisher-Yates shuffle ───
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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
 * Fetch playlist tracks — uses field filtering to reduce payload size.
 * Tries /playlists/{id}/tracks first, falls back to /playlists/{id}.
 * Shuffles results and returns up to `maxTracks` for game use.
 */
export async function fetchPlaylistTracks(token: string, playlistId: string, maxTracks = 20): Promise<Track[]> {
    const fields = 'items(track(id,name,artists(name),album(name,images,release_date),preview_url))';

    // Strategy 1: Direct /tracks endpoint with field filtering
    try {
        const data = await spotifyFetch<{ items: SpotifyTrackItem[] }>(
            `/playlists/${playlistId}/tracks?limit=50&fields=${encodeURIComponent(fields)}`,
            token
        );
        const tracks = data.items
            .filter((item) => item.track)
            .map((item) => mapTrack(item.track!));
        if (tracks.length > 0) return shuffle(tracks).slice(0, maxTracks);
    } catch (e: any) {
        console.warn('[Intro] /tracks endpoint blocked:', e.status || e.message);
    }

    // Strategy 2: Full playlist object (also with fields to reduce payload)
    try {
        const fullFields = `tracks.${fields}`;
        const data = await spotifyFetch<any>(
            `/playlists/${playlistId}?fields=${encodeURIComponent(fullFields)}`,
            token
        );
        if (data.tracks?.items?.length > 0) {
            const items = data.tracks.items as SpotifyTrackItem[];
            const tracks = items
                .filter((item) => item.track)
                .map((item) => mapTrack(item.track!));
            if (tracks.length > 0) return shuffle(tracks).slice(0, maxTracks);
        }
    } catch (e: any) {
        console.warn('[Intro] Full playlist endpoint also failed:', e.status || e.message);
    }

    throw new SpotifyApiError(
        403,
        'Spotify restricts playlist tracks in Development Mode. Try "Liked Songs" or "Top Tracks" instead!'
    );
}

/**
 * Fetch user's Liked Songs (/me/tracks) — works in Development Mode.
 * Returns shuffled tracks, limited to `limit` items.
 */
export async function fetchLikedSongs(token: string, limit = 20) {
    const data = await spotifyFetch<{ items: SpotifySavedTrack[]; total: number }>(
        `/me/tracks?limit=${limit}`,
        token
    );

    const tracks = data.items
        .filter((item) => item.track)
        .map((item) => mapTrack(item.track));
    return shuffle(tracks);
}

/**
 * Fetch user's Top Tracks (/me/top/tracks) — works in Development Mode.
 * Returns shuffled tracks, limited to `limit` items.
 */
export async function fetchTopTracks(token: string, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term', limit = 20) {
    const data = await spotifyFetch<{ items: SpotifyTopTrack[] }>(
        `/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
        token
    );

    return shuffle(data.items.map((t) => mapTrack(t)));
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
