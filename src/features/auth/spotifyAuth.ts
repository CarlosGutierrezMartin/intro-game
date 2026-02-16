// ─── Spotify OAuth 2.0 PKCE Flow ───
// No backend required — everything runs client-side

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'user-top-read',
].join(' ');

function getClientId(): string {
    return import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
}

function getRedirectUri(): string {
    return import.meta.env.VITE_SPOTIFY_REDIRECT_URI || `${window.location.origin}/callback`;
}

// ─── PKCE Helpers ───

function generateRandomString(length: number): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, (x) => possible[x % possible.length]).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64urlEncode(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// ─── Public API ───

export async function redirectToSpotifyLogin(): Promise<void> {
    const codeVerifier = generateRandomString(64);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64urlEncode(hashed);

    // Store verifier for callback
    sessionStorage.setItem('spotify_code_verifier', codeVerifier);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: getClientId(),
        scope: SCOPES,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        redirect_uri: getRedirectUri(),
    });

    window.location.href = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

export interface SpotifyTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Unix timestamp in ms
}

export async function handleSpotifyCallback(code: string): Promise<SpotifyTokens> {
    const codeVerifier = sessionStorage.getItem('spotify_code_verifier');
    if (!codeVerifier) throw new Error('Missing PKCE code verifier');

    const response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: getClientId(),
            grant_type: 'authorization_code',
            code,
            redirect_uri: getRedirectUri(),
            code_verifier: codeVerifier,
        }),
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Token exchange failed: ${err.error_description || err.error}`);
    }

    const data = await response.json();
    sessionStorage.removeItem('spotify_code_verifier');

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
    };
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: getClientId(),
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    if (!response.ok) {
        throw new Error('Token refresh failed');
    }

    const data = await response.json();

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
    };
}

/**
 * Check if the current URL contains a callback code.
 */
export function getCallbackCode(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('code');
}
