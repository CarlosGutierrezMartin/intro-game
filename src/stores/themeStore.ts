import { create } from 'zustand';
import { extractDominantColor, generatePalette, applyPalette } from '../design/colorExtractor';

interface ThemeState {
    currentHue: number;
    currentSaturation: number;
    isExtracting: boolean;

    applyPlaylistTheme: (coverUrl: string) => Promise<void>;
    resetTheme: () => void;
}

// Default MD3 purple
const DEFAULT_HUE = 270;
const DEFAULT_SAT = 50;

export const useThemeStore = create<ThemeState>((set) => ({
    currentHue: DEFAULT_HUE,
    currentSaturation: DEFAULT_SAT,
    isExtracting: false,

    applyPlaylistTheme: async (coverUrl: string) => {
        set({ isExtracting: true });
        try {
            const [h, s] = await extractDominantColor(coverUrl);
            const palette = generatePalette(h, s);
            applyPalette(palette);
            set({ currentHue: h, currentSaturation: s, isExtracting: false });
        } catch (e) {
            console.warn('Theme extraction failed, using default:', e);
            const palette = generatePalette(DEFAULT_HUE, DEFAULT_SAT);
            applyPalette(palette);
            set({ isExtracting: false });
        }
    },

    resetTheme: () => {
        const palette = generatePalette(DEFAULT_HUE, DEFAULT_SAT);
        applyPalette(palette);
        set({ currentHue: DEFAULT_HUE, currentSaturation: DEFAULT_SAT });
    },
}));
