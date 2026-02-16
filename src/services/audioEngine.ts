// ─── Web Audio API Precision Playback Engine ───
// Provides exact-duration playback with fade-in/fade-out for the 1-3-5 game mechanic.

class AudioEngine {
    private context: AudioContext | null = null;
    private sourceNode: AudioBufferSourceNode | null = null;
    private gainNode: GainNode | null = null;
    private stopTimeout: number | null = null;
    private audioCache = new Map<string, AudioBuffer>();

    private getContext(): AudioContext {
        if (!this.context || this.context.state === 'closed') {
            this.context = new AudioContext();
        }
        return this.context;
    }

    /**
     * Resume AudioContext after user gesture (required by browsers).
     */
    async resume(): Promise<void> {
        const ctx = this.getContext();
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }
    }

    /**
     * Pre-fetch and decode an audio URL into the cache.
     */
    async preload(url: string): Promise<void> {
        if (this.audioCache.has(url)) return;
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.getContext().decodeAudioData(arrayBuffer);
            this.audioCache.set(url, audioBuffer);
        } catch (e) {
            console.warn('Failed to preload audio:', url, e);
        }
    }

    /**
     * Play a segment of audio for exactly `durationMs` milliseconds.
     * Includes 50ms fade-in and 50ms fade-out for smooth edges.
     */
    async playSegment(
        url: string,
        durationMs: number,
        onComplete: () => void
    ): Promise<void> {
        this.stop(); // Clean up any previous playback

        const ctx = this.getContext();
        await this.resume();

        try {
            // Try cache first, then fetch
            let buffer = this.audioCache.get(url);
            if (!buffer) {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                buffer = await ctx.decodeAudioData(arrayBuffer);
                this.audioCache.set(url, buffer);
            }

            // Create new nodes for this playback
            this.sourceNode = ctx.createBufferSource();
            this.sourceNode.buffer = buffer;

            this.gainNode = ctx.createGain();
            this.gainNode.gain.value = 0;

            // Chain: source → gain → output
            this.sourceNode.connect(this.gainNode);
            this.gainNode.connect(ctx.destination);

            const now = ctx.currentTime;
            const durationSec = durationMs / 1000;
            const fadeTime = 0.05; // 50ms

            // Fade in
            this.gainNode.gain.setValueAtTime(0, now);
            this.gainNode.gain.linearRampToValueAtTime(0.8, now + fadeTime);

            // Fade out
            const fadeOutStart = now + durationSec - fadeTime;
            this.gainNode.gain.setValueAtTime(0.8, fadeOutStart);
            this.gainNode.gain.linearRampToValueAtTime(0, now + durationSec);

            // Start from a random position (not always the beginning — adds variety)
            // But for very short clips (1s), start from the beginning
            const maxOffset = Math.max(0, buffer.duration - durationSec - 1);
            const offset = durationMs <= 1000 ? 0 : Math.random() * Math.min(maxOffset, 10);

            this.sourceNode.start(0, offset, durationSec + 0.1);

            // Precision timer for callback
            this.stopTimeout = window.setTimeout(() => {
                this.stop();
                onComplete();
            }, durationMs);

        } catch (e) {
            console.error('Playback failed:', e);
            this.stop();
            onComplete();
        }
    }

    /**
     * Immediately stop playback and clean up.
     */
    stop(): void {
        if (this.stopTimeout !== null) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
        if (this.sourceNode) {
            try {
                this.sourceNode.stop();
                this.sourceNode.disconnect();
            } catch { /* already stopped */ }
            this.sourceNode = null;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
    }

    /**
     * Clear the audio cache (e.g., when switching playlists).
     */
    clearCache(): void {
        this.audioCache.clear();
    }
}

export const audioEngine = new AudioEngine();
