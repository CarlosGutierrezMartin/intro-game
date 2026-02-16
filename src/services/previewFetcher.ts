// ─── Preview URL Fetcher ───
// Spotify deprecated preview_url in API responses (Nov 2024).
// This module extracts preview audio from Spotify embed pages,
// routed through the Vite dev server proxy to bypass CORS.

// Requests go to /api/spotify-embed/track/{id} which Vite proxies
// to https://open.spotify.com/embed/track/{id}
const EMBED_BASE = '/api/spotify-embed/track';

// In-memory cache to avoid re-fetching
const previewCache = new Map<string, string | null>();

/**
 * Attempt to get a preview URL for a Spotify track.
 * Strategy: fetch the Spotify embed page HTML which still contains
 * an audioPreview URL in its embedded JSON data.
 */
export async function getPreviewUrl(trackId: string): Promise<string | null> {
    // Check cache first
    if (previewCache.has(trackId)) {
        return previewCache.get(trackId)!;
    }

    try {
        const response = await fetch(`${EMBED_BASE}/${trackId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
            },
        });

        if (!response.ok) {
            console.warn(`[Intro] Embed fetch failed for ${trackId}: ${response.status}`);
            previewCache.set(trackId, null);
            return null;
        }

        const html = await response.text();

        // The embed page contains a <script id="__NEXT_DATA__"> with JSON
        // that includes an audioPreview.url field
        const match = html.match(/"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/);
        if (match && match[1]) {
            const url = match[1];
            previewCache.set(trackId, url);
            console.log(`[Intro] Found preview for ${trackId}`);
            return url;
        }

        // Fallback: look for mp3 preview URL pattern
        const mp3Match = html.match(/https:\/\/p\.scdn\.co\/mp3-preview\/[a-zA-Z0-9]+[^"']*/);
        if (mp3Match) {
            const url = mp3Match[0];
            previewCache.set(trackId, url);
            console.log(`[Intro] Found mp3 preview for ${trackId}`);
            return url;
        }

        previewCache.set(trackId, null);
        return null;
    } catch (e) {
        console.warn(`[Intro] Preview fetch error for ${trackId}:`, e);
        previewCache.set(trackId, null);
        return null;
    }
}

/**
 * Batch-fetch preview URLs for multiple tracks.
 * Returns count of tracks that got previews.
 */
export async function batchFetchPreviews(
    tracks: { id: string; previewUrl: string | null }[]
): Promise<number> {
    const needPreviews = tracks.filter((t) => !t.previewUrl);
    if (needPreviews.length === 0) return tracks.length;

    console.log(`[Intro] Fetching previews for ${needPreviews.length} tracks...`);

    // Fetch in batches of 5 to avoid overwhelming the browser
    let found = tracks.filter((t) => t.previewUrl).length;
    for (let i = 0; i < needPreviews.length; i += 5) {
        const batch = needPreviews.slice(i, i + 5);
        const results = await Promise.allSettled(
            batch.map(async (track) => {
                const url = await getPreviewUrl(track.id);
                if (url) {
                    track.previewUrl = url;
                    found++;
                }
            })
        );
    }

    console.log(`[Intro] Preview fetch complete: ${found}/${tracks.length} tracks have audio`);
    return found;
}
