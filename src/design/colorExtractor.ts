// ─── Dynamic Color Extraction (Canvas-based) ───
// Extracts dominant color from a playlist cover and generates MD3 tonal palette.

interface TonalPalette {
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    secondary: string;
    onSecondary: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    tertiary: string;
    onTertiary: string;
    tertiaryContainer: string;
    onTertiaryContainer: string;
    surface: string;
    surfaceDim: string;
    surfaceBright: string;
    surfaceContainerLowest: string;
    surfaceContainerLow: string;
    surfaceContainer: string;
    surfaceContainerHigh: string;
    surfaceContainerHighest: string;
    onSurface: string;
    onSurfaceVariant: string;
    outline: string;
    outlineVariant: string;
}

/**
 * Extract the dominant color from an image URL.
 * Returns [H, S, L] where H is 0-360, S and L are 0-100.
 */
export async function extractDominantColor(imageUrl: string): Promise<[number, number, number]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const size = 50; // Downsample for performance
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('No 2d context'));

            ctx.drawImage(img, 0, 0, size, size);
            const imageData = ctx.getImageData(0, 0, size, size).data;

            // Simple averaging with saturation weighting
            let totalR = 0, totalG = 0, totalB = 0, count = 0;

            for (let i = 0; i < imageData.length; i += 4) {
                const r = imageData[i];
                const g = imageData[i + 1];
                const b = imageData[i + 2];
                const a = imageData[i + 3];

                if (a < 128) continue; // Skip transparent

                // Skip very dark and very light pixels (they don't contribute to "color")
                const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                if (luminance < 20 || luminance > 235) continue;

                // Weight by saturation
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const saturation = max === 0 ? 0 : (max - min) / max;
                const weight = 1 + saturation * 3; // Saturated colors count more

                totalR += r * weight;
                totalG += g * weight;
                totalB += b * weight;
                count += weight;
            }

            if (count === 0) {
                resolve([270, 40, 60]); // Fallback purple
                return;
            }

            const avgR = totalR / count;
            const avgG = totalG / count;
            const avgB = totalB / count;

            resolve(rgbToHsl(avgR, avgG, avgB));
        };

        img.onerror = () => resolve([270, 40, 60]); // Fallback purple
        img.src = imageUrl;
    });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Generate a full MD3 dark theme tonal palette from a hue value.
 */
export function generatePalette(h: number, s: number): TonalPalette {
    // Ensure minimum saturation for visual impact
    const sat = Math.max(s, 30);
    const secH = (h + 30) % 360;  // Secondary: slight hue shift
    const terH = (h + 60) % 360;  // Tertiary: complementary shift

    return {
        // Primary tones (dark theme: 80/20/30/90)
        primary: hsl(h, sat, 80),
        onPrimary: hsl(h, sat, 20),
        primaryContainer: hsl(h, sat - 10, 30),
        onPrimaryContainer: hsl(h, sat, 90),
        // Secondary
        secondary: hsl(secH, sat - 20, 80),
        onSecondary: hsl(secH, sat - 20, 20),
        secondaryContainer: hsl(secH, sat - 20, 30),
        onSecondaryContainer: hsl(secH, sat - 20, 90),
        // Tertiary
        tertiary: hsl(terH, sat - 10, 80),
        onTertiary: hsl(terH, sat - 10, 20),
        tertiaryContainer: hsl(terH, sat - 10, 30),
        onTertiaryContainer: hsl(terH, sat - 10, 90),
        // Surfaces (neutral desaturated tones of primary hue)
        surface: hsl(h, 10, 8),
        surfaceDim: hsl(h, 10, 6),
        surfaceBright: hsl(h, 10, 24),
        surfaceContainerLowest: hsl(h, 10, 5),
        surfaceContainerLow: hsl(h, 10, 11),
        surfaceContainer: hsl(h, 10, 14),
        surfaceContainerHigh: hsl(h, 10, 17),
        surfaceContainerHighest: hsl(h, 10, 22),
        onSurface: hsl(h, 8, 90),
        onSurfaceVariant: hsl(h, 12, 80),
        outline: hsl(h, 8, 60),
        outlineVariant: hsl(h, 10, 30),
    };
}

function hsl(h: number, s: number, l: number): string {
    return `hsl(${h}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/**
 * Apply a tonal palette to the document's CSS custom properties.
 */
export function applyPalette(palette: TonalPalette): void {
    const root = document.documentElement;
    root.style.setProperty('--md-primary', palette.primary);
    root.style.setProperty('--md-on-primary', palette.onPrimary);
    root.style.setProperty('--md-primary-container', palette.primaryContainer);
    root.style.setProperty('--md-on-primary-container', palette.onPrimaryContainer);
    root.style.setProperty('--md-secondary', palette.secondary);
    root.style.setProperty('--md-on-secondary', palette.onSecondary);
    root.style.setProperty('--md-secondary-container', palette.secondaryContainer);
    root.style.setProperty('--md-on-secondary-container', palette.onSecondaryContainer);
    root.style.setProperty('--md-tertiary', palette.tertiary);
    root.style.setProperty('--md-on-tertiary', palette.onTertiary);
    root.style.setProperty('--md-tertiary-container', palette.tertiaryContainer);
    root.style.setProperty('--md-on-tertiary-container', palette.onTertiaryContainer);
    root.style.setProperty('--md-surface', palette.surface);
    root.style.setProperty('--md-surface-dim', palette.surfaceDim);
    root.style.setProperty('--md-surface-bright', palette.surfaceBright);
    root.style.setProperty('--md-surface-container-lowest', palette.surfaceContainerLowest);
    root.style.setProperty('--md-surface-container-low', palette.surfaceContainerLow);
    root.style.setProperty('--md-surface-container', palette.surfaceContainer);
    root.style.setProperty('--md-surface-container-high', palette.surfaceContainerHigh);
    root.style.setProperty('--md-surface-container-highest', palette.surfaceContainerHighest);
    root.style.setProperty('--md-on-surface', palette.onSurface);
    root.style.setProperty('--md-on-surface-variant', palette.onSurfaceVariant);
    root.style.setProperty('--md-outline', palette.outline);
    root.style.setProperty('--md-outline-variant', palette.outlineVariant);

    // Also update meta theme-color for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', palette.surface);
}
