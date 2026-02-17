import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    handleSpotifyCallback,
    refreshAccessToken,
    type SpotifyTokens,
} from '../features/auth/spotifyAuth';

interface UserProfile {
    id: string;
    displayName: string;
    email: string;
    avatarUrl: string;
}

interface AuthState {
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: number | null;
    user: UserProfile | null;
    isAuthenticated: boolean;
    isGuest: boolean;
    isLoading: boolean;

    // Actions
    setTokens: (tokens: SpotifyTokens) => void;
    setUser: (user: UserProfile) => void;
    handleCallback: (code: string) => Promise<void>;
    checkAndRefresh: () => Promise<string | null>;
    loginAsGuest: () => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            user: null,
            isAuthenticated: false,
            isGuest: false,
            isLoading: false,

            setTokens: (tokens) =>
                set({
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresAt: tokens.expiresAt,
                    isAuthenticated: true,
                }),

            setUser: (user) => set({ user }),

            handleCallback: async (code) => {
                set({ isLoading: true });
                try {
                    const tokens = await handleSpotifyCallback(code);
                    get().setTokens(tokens);
                } catch (e) {
                    console.error('Auth callback failed:', e);
                    get().logout();
                } finally {
                    set({ isLoading: false });
                }
            },

            checkAndRefresh: async () => {
                const { accessToken, refreshToken, expiresAt } = get();
                if (!accessToken || !refreshToken || !expiresAt) return null;

                // Refresh if within 5 minutes of expiry
                const FIVE_MINUTES = 5 * 60 * 1000;
                if (Date.now() > expiresAt - FIVE_MINUTES) {
                    try {
                        const tokens = await refreshAccessToken(refreshToken);
                        get().setTokens(tokens);
                        return tokens.accessToken;
                    } catch {
                        get().logout();
                        return null;
                    }
                }

                return accessToken;
            },

            loginAsGuest: () => {
                set({ isGuest: true });
            },

            logout: () => {
                set({
                    accessToken: null,
                    refreshToken: null,
                    expiresAt: null,
                    user: null,
                    isAuthenticated: false,
                    isGuest: false,
                    isLoading: false,
                });
                // Force-clear persisted state so stale tokens don't linger
                localStorage.removeItem('intro-auth');
                sessionStorage.removeItem('spotify_code_verifier');
            },
        }),
        {
            name: 'intro-auth',
            partialize: (state) => ({
                accessToken: state.accessToken,
                refreshToken: state.refreshToken,
                expiresAt: state.expiresAt,
                user: state.user,
                isAuthenticated: state.isAuthenticated,
                isGuest: state.isGuest,
            }),
        }
    )
);
