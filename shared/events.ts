// ─── Shared Socket.IO Event Types ───
// Imported by both client and server

// ─── Event Names ───
export const Events = {
    // Lobby
    CREATE_SESSION: 'create_session',
    SESSION_CREATED: 'session_created',
    JOIN_SESSION: 'join_session',
    SESSION_JOINED: 'session_joined',
    PLAYER_JOINED: 'player_joined',
    SESSION_ERROR: 'session_error',
    PLAYER_DISCONNECTED: 'player_disconnected',

    // Game setup
    SELECT_TRACKS: 'select_tracks',
    GAME_STARTING: 'game_starting',

    // Gameplay
    PLAYER_READY: 'player_ready',
    SUBMIT_GUESS: 'submit_guess',
    GUESS_RESULT: 'guess_result',
    OPPONENT_GUESSED: 'opponent_guessed',
    PRESSURE_TIMER_EXPIRED: 'pressure_timer_expired',
    ROUND_COMPLETE: 'round_complete',
    NEXT_ROUND: 'next_round',
    NEW_ROUND: 'new_round',
    GAME_OVER: 'game_over',

    // New multiplayer events
    STAGE_ADVANCE: 'stage_advance',         // Both players advance to next stage simultaneously
    OPPONENT_CORRECT: 'opponent_correct',   // Opponent guessed correctly — show overlay

    // State sync
    OPPONENT_STAGE_UPDATE: 'opponent_stage_update',
} as const;

// ─── Player Info ───
export interface PlayerInfo {
    id: string;          // socket.id
    displayName: string;
    avatarUrl: string;
}

// ─── Payloads ───

export interface CreateSessionPayload {
    player: Omit<PlayerInfo, 'id'>;
}

export interface JoinSessionPayload {
    sessionCode: string;
    player: Omit<PlayerInfo, 'id'>;
}

export interface SessionCreatedPayload {
    sessionCode: string;
    player: PlayerInfo;
}

export interface SessionJoinedPayload {
    sessionCode: string;
    host: PlayerInfo;
    guest: PlayerInfo;
}

export interface PlayerJoinedPayload {
    guest: PlayerInfo;
}

export interface TrackData {
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArt: string;
    previewUrl: string | null;
}

export interface SelectTracksPayload {
    tracks: TrackData[];
    playlistName: string;
}

export interface GameStartingPayload {
    round: number;
    totalRounds: number;
    track: TrackData;
    playlistName: string;
}

export interface SubmitGuessPayload {
    trackId: string;
    stage: number; // 0=1s, 1=3s, 2=5s
}

export interface GuessResultPayload {
    correct: boolean;
    pointsEarned: number;
    newStage: number | null; // null = no stage change, number = new stage
    isLocked: boolean;       // true if input should be blocked (wrong guess)
}

export interface OpponentGuessedPayload {
    timerSeconds: number; // 15
    opponentStage: number;
    opponentGuessedCorrectly: boolean;
}

/** Sent when opponent guesses correctly — triggers overlay on the other player */
export interface OpponentCorrectPayload {
    track: TrackData;
    opponentPointsEarned: number;
    opponentStage: number;
}

/** Sent to both players when they should advance to the next stage simultaneously */
export interface StageAdvancePayload {
    newStage: number; // 0, 1, or 2
}

export interface RoundCompletePayload {
    round: number;
    track: TrackData;
    results: {
        [playerId: string]: {
            guessedCorrectly: boolean;
            pointsEarned: number;
            stageGuessedAt: number | null;
            totalScore: number;
        };
    };
}

export interface NewRoundPayload {
    round: number;
    totalRounds: number;
    track: TrackData;
}

export interface GameOverPayload {
    playlistName: string;
    totalRounds: number;
    scores: {
        [playerId: string]: {
            displayName: string;
            totalScore: number;
            correctGuesses: number;
            bestStreak: number;
        };
    };
    winnerId: string;
}

export interface OpponentStageUpdatePayload {
    stage: number;
}

export const ROUNDS_PER_GAME = 10;
export const PRESSURE_TIMER_SECONDS = 15;
export const MAX_PLAYS_PER_STAGE = 3;
