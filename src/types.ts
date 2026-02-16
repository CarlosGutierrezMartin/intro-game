// ─── Core Domain Types ───

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArt: string;       // Cover image URL
  previewUrl: string | null; // 30s Spotify preview (nullable)
  year?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  trackCount: number;
  owner: string;
  tracks?: Track[];       // Loaded lazily
}

// ─── Game State Machine ───

export enum GamePhase {
  IDLE     = 'IDLE',      // Waiting for player to press play
  PLAYING  = 'PLAYING',   // Audio is active
  GUESSING = 'GUESSING',  // Audio stopped, waiting for guess input
  REVEAL   = 'REVEAL',    // Round ended — show answer
}

export enum Stage {
  INTRO = 0,  // 1s → 100pts
  HOOK  = 1,  // 3s → 50pts
  VIBE  = 2,  // 5s → 33pts
}

export const STAGE_CONFIG = {
  [Stage.INTRO]: { durationMs: 1000, points: 100, label: 'Intro', seconds: '1s' },
  [Stage.HOOK]:  { durationMs: 3000, points: 50,  label: 'Hook',  seconds: '3s' },
  [Stage.VIBE]:  { durationMs: 5000, points: 33,  label: 'Vibe',  seconds: '5s' },
} as const;

export const STAGES_ORDER: Stage[] = [Stage.INTRO, Stage.HOOK, Stage.VIBE];

// ─── Search ───

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArt: string;
}
