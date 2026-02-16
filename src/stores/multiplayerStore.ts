// ─── Multiplayer State Store ───
import { create } from 'zustand';
import {
    PlayerInfo,
    TrackData,
    RoundCompletePayload,
    GameOverPayload,
    Events,
    PRESSURE_TIMER_SECONDS,
} from '../../shared/events';
import { connectSocket, disconnectSocket, emit, getSocket } from '../services/socketService';

export type MultiplayerPhase =
    | 'idle'         // Not in multiplayer
    | 'lobby'        // Create/join screen
    | 'waiting'      // In session, waiting for opponent or game start
    | 'playing'      // Game in progress
    | 'round_result' // Showing round results
    | 'game_over';   // Final results

interface MultiplayerState {
    phase: MultiplayerPhase;
    sessionCode: string | null;
    isHost: boolean;
    me: PlayerInfo | null;
    opponent: PlayerInfo | null;
    error: string | null;

    // Game state
    currentTrack: TrackData | null;
    round: number;
    totalRounds: number;
    playlistName: string;
    myStage: number;
    myGuessedCorrectly: boolean;
    myPointsThisRound: number;
    myTotalScore: number;

    // Opponent state
    opponentStage: number;
    opponentHasGuessed: boolean;
    opponentGuessedCorrectly: boolean;

    // Pressure timer
    pressureTimerActive: boolean;
    pressureTimerSeconds: number;

    // Round results
    roundResults: RoundCompletePayload | null;

    // Game over
    gameOverData: GameOverPayload | null;

    // Actions
    enterLobby: () => void;
    createSession: (displayName: string, avatarUrl: string) => void;
    joinSession: (code: string, displayName: string, avatarUrl: string) => void;
    selectTracks: (tracks: TrackData[], playlistName: string) => void;
    submitGuess: (trackId: string) => void;
    requestNextRound: () => void;
    leaveLobby: () => void;
    reset: () => void;
}

const initialState = {
    phase: 'idle' as MultiplayerPhase,
    sessionCode: null,
    isHost: false,
    me: null,
    opponent: null,
    error: null,
    currentTrack: null,
    round: 0,
    totalRounds: 0,
    playlistName: '',
    myStage: 0,
    myGuessedCorrectly: false,
    myPointsThisRound: 0,
    myTotalScore: 0,
    opponentStage: 0,
    opponentHasGuessed: false,
    opponentGuessedCorrectly: false,
    pressureTimerActive: false,
    pressureTimerSeconds: 0,
    roundResults: null,
    gameOverData: null,
};

let pressureInterval: ReturnType<typeof setInterval> | null = null;

export const useMultiplayerStore = create<MultiplayerState>()((set, get) => ({
    ...initialState,

    enterLobby: () => {
        set({ ...initialState, phase: 'lobby' });
    },

    createSession: (displayName, avatarUrl) => {
        const socket = connectSocket();
        setupListeners(set, get, socket);
        socket.emit(Events.CREATE_SESSION, { player: { displayName, avatarUrl } });
    },

    joinSession: (code, displayName, avatarUrl) => {
        const socket = connectSocket();
        setupListeners(set, get, socket);
        socket.emit(Events.JOIN_SESSION, {
            sessionCode: code.toUpperCase(),
            player: { displayName, avatarUrl },
        });
    },

    selectTracks: (tracks, playlistName) => {
        emit(Events.SELECT_TRACKS, { tracks, playlistName });
    },

    submitGuess: (trackId) => {
        const { myStage } = get();
        emit(Events.SUBMIT_GUESS, { trackId, stage: myStage });
    },

    requestNextRound: () => {
        emit(Events.NEXT_ROUND);
    },

    leaveLobby: () => {
        disconnectSocket();
        clearPressureInterval();
        set({ ...initialState });
    },

    reset: () => {
        disconnectSocket();
        clearPressureInterval();
        set({ ...initialState });
    },
}));

function clearPressureInterval() {
    if (pressureInterval) {
        clearInterval(pressureInterval);
        pressureInterval = null;
    }
}

function setupListeners(
    set: (state: Partial<MultiplayerState>) => void,
    get: () => MultiplayerState,
    socket: ReturnType<typeof getSocket>
) {
    // Remove any old listeners first
    socket.removeAllListeners();

    socket.on(Events.SESSION_CREATED, (data: any) => {
        set({
            phase: 'waiting',
            sessionCode: data.sessionCode,
            isHost: true,
            me: data.player,
            error: null,
        });
    });

    socket.on(Events.SESSION_JOINED, (data: any) => {
        set({
            phase: 'waiting',
            sessionCode: data.sessionCode,
            isHost: false,
            me: data.guest,
            opponent: data.host,
            error: null,
        });
    });

    socket.on(Events.PLAYER_JOINED, (data: any) => {
        set({ opponent: data.guest });
    });

    socket.on(Events.SESSION_ERROR, (data: any) => {
        set({ error: data.message });
    });

    socket.on(Events.GAME_STARTING, (data: any) => {
        set({
            phase: 'playing',
            currentTrack: data.track,
            round: data.round,
            totalRounds: data.totalRounds,
            playlistName: data.playlistName,
            myStage: 0,
            myGuessedCorrectly: false,
            myPointsThisRound: 0,
            opponentStage: 0,
            opponentHasGuessed: false,
            opponentGuessedCorrectly: false,
            pressureTimerActive: false,
            roundResults: null,
        });
    });

    socket.on(Events.GUESS_RESULT, (data: any) => {
        if (data.correct) {
            set({
                myGuessedCorrectly: true,
                myPointsThisRound: data.pointsEarned,
                myTotalScore: get().myTotalScore + data.pointsEarned,
            });
        } else if (data.newStage !== null && data.newStage !== undefined) {
            set({ myStage: data.newStage });
        }
    });

    socket.on(Events.OPPONENT_GUESSED, (data: any) => {
        set({
            opponentHasGuessed: true,
            opponentGuessedCorrectly: data.opponentGuessedCorrectly,
            opponentStage: data.opponentStage,
            pressureTimerActive: true,
            pressureTimerSeconds: data.timerSeconds,
        });

        // Start countdown
        clearPressureInterval();
        pressureInterval = setInterval(() => {
            const s = get().pressureTimerSeconds;
            if (s <= 1) {
                clearPressureInterval();
                set({ pressureTimerActive: false, pressureTimerSeconds: 0 });
            } else {
                set({ pressureTimerSeconds: s - 1 });
            }
        }, 1000);
    });

    socket.on(Events.PRESSURE_TIMER_EXPIRED, () => {
        clearPressureInterval();
        const { myStage } = get();
        if (myStage < 2) {
            set({
                myStage: myStage + 1,
                pressureTimerActive: false,
                pressureTimerSeconds: 0,
            });
        } else {
            set({
                pressureTimerActive: false,
                pressureTimerSeconds: 0,
            });
        }
    });

    socket.on(Events.ROUND_COMPLETE, (data: RoundCompletePayload) => {
        clearPressureInterval();
        set({
            phase: 'round_result',
            roundResults: data,
            pressureTimerActive: false,
            pressureTimerSeconds: 0,
        });
    });

    socket.on(Events.NEW_ROUND, (data: any) => {
        set({
            phase: 'playing',
            currentTrack: data.track,
            round: data.round,
            totalRounds: data.totalRounds,
            myStage: 0,
            myGuessedCorrectly: false,
            myPointsThisRound: 0,
            opponentStage: 0,
            opponentHasGuessed: false,
            opponentGuessedCorrectly: false,
            pressureTimerActive: false,
            pressureTimerSeconds: 0,
            roundResults: null,
        });
    });

    socket.on(Events.GAME_OVER, (data: GameOverPayload) => {
        clearPressureInterval();
        set({
            phase: 'game_over',
            gameOverData: data,
        });
    });

    socket.on(Events.OPPONENT_STAGE_UPDATE, (data: any) => {
        set({ opponentStage: data.stage });
    });

    socket.on(Events.PLAYER_DISCONNECTED, () => {
        set({ error: 'Opponent disconnected', opponent: null });
    });

    socket.on('disconnect', () => {
        console.log('[Socket] Disconnected from server');
    });
}
