import {
    PlayerInfo,
    TrackData,
    GuessResultPayload,
    RoundCompletePayload,
    GameOverPayload,
    ROUNDS_PER_GAME,
    PRESSURE_TIMER_SECONDS,
} from '../shared/events';

// ─── Per-Player State ───
interface PlayerRoundState {
    stage: number;       // 0, 1, 2
    hasGuessed: boolean; // guessed at this stage already?
    guessedCorrectly: boolean;
    pointsEarned: number;
    stageGuessedAt: number | null;
    totalScore: number;
    correctGuesses: number;
    streak: number;
    bestStreak: number;
}

const STAGE_POINTS = [100, 50, 33];
const MAX_STAGE = 2;

export class GameRoom {
    code: string;
    host: PlayerInfo | null = null;
    guest: PlayerInfo | null = null;

    private tracks: TrackData[] = [];
    private playlistName = '';
    private currentRound = 0;
    private playerStates = new Map<string, PlayerRoundState>();
    private pressureTimer: ReturnType<typeof setTimeout> | null = null;
    private pressureTargetId: string | null = null;
    private roundComplete = false;

    // Callbacks set by the socket handler
    onGuessResult?: (playerId: string, result: GuessResultPayload) => void;
    onOpponentGuessed?: (targetId: string, timerSeconds: number, opponentStage: number, correct: boolean) => void;
    onPressureExpired?: (playerId: string) => void;
    onRoundComplete?: (result: RoundCompletePayload) => void;
    onNewRound?: (round: number, totalRounds: number, track: TrackData) => void;
    onGameOver?: (result: GameOverPayload) => void;
    onOpponentStageUpdate?: (targetId: string, stage: number) => void;

    constructor(code: string) {
        this.code = code;
    }

    addHost(player: PlayerInfo): void {
        this.host = player;
        this.initPlayerState(player.id);
    }

    addGuest(player: PlayerInfo): void {
        this.guest = player;
        this.initPlayerState(player.id);
    }

    private initPlayerState(playerId: string): void {
        this.playerStates.set(playerId, {
            stage: 0,
            hasGuessed: false,
            guessedCorrectly: false,
            pointsEarned: 0,
            stageGuessedAt: null,
            totalScore: 0,
            correctGuesses: 0,
            streak: 0,
            bestStreak: 0,
        });
    }

    isFull(): boolean {
        return this.host !== null && this.guest !== null;
    }

    isEmpty(): boolean {
        return this.host === null && this.guest === null;
    }

    getOpponentId(playerId: string): string | null {
        if (this.host?.id === playerId) return this.guest?.id ?? null;
        if (this.guest?.id === playerId) return this.host?.id ?? null;
        return null;
    }

    removePlayer(playerId: string): void {
        if (this.host?.id === playerId) this.host = null;
        if (this.guest?.id === playerId) this.guest = null;
        this.clearPressureTimer();
    }

    // ─── Game Setup ───

    setTracks(tracks: TrackData[], playlistName: string): void {
        // Shuffle and take up to ROUNDS_PER_GAME
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        this.tracks = shuffled.slice(0, ROUNDS_PER_GAME);
        this.playlistName = playlistName;
        this.currentRound = 0;
    }

    startGame(): TrackData | null {
        if (this.tracks.length === 0) return null;
        this.currentRound = 1;
        this.resetRoundStates();
        return this.tracks[0];
    }

    getCurrentTrack(): TrackData | null {
        if (this.currentRound < 1 || this.currentRound > this.tracks.length) return null;
        return this.tracks[this.currentRound - 1];
    }

    getTotalRounds(): number {
        return this.tracks.length;
    }

    getPlaylistName(): string {
        return this.playlistName;
    }

    // ─── Round State ───

    private resetRoundStates(): void {
        this.roundComplete = false;
        this.clearPressureTimer();
        for (const [id, state] of this.playerStates) {
            state.stage = 0;
            state.hasGuessed = false;
            state.guessedCorrectly = false;
            state.pointsEarned = 0;
            state.stageGuessedAt = null;
        }
    }

    // ─── Guess Handling ───

    submitGuess(playerId: string, guessTrackId: string, stage: number): void {
        if (this.roundComplete) return;

        const state = this.playerStates.get(playerId);
        if (!state) return;

        const currentTrack = this.getCurrentTrack();
        if (!currentTrack) return;

        const opponentId = this.getOpponentId(playerId);

        // Check if correct
        const correct = guessTrackId === currentTrack.id;

        if (correct) {
            const points = STAGE_POINTS[Math.min(stage, MAX_STAGE)] || 33;
            state.guessedCorrectly = true;
            state.pointsEarned = points;
            state.stageGuessedAt = stage;
            state.totalScore += points;
            state.correctGuesses++;
            state.streak++;
            state.bestStreak = Math.max(state.bestStreak, state.streak);
            state.hasGuessed = true;

            this.onGuessResult?.(playerId, {
                correct: true,
                pointsEarned: points,
                newStage: null,
            });
        } else {
            state.hasGuessed = true; // used their guess for this stage

            if (stage < MAX_STAGE) {
                // Advance to next stage
                state.stage = stage + 1;
                state.hasGuessed = false; // can guess again at next stage

                this.onGuessResult?.(playerId, {
                    correct: false,
                    pointsEarned: 0,
                    newStage: stage + 1,
                });

                // Notify opponent of stage change
                if (opponentId) {
                    this.onOpponentStageUpdate?.(opponentId, stage + 1);
                }
            } else {
                // Failed at last stage
                state.streak = 0;
                state.hasGuessed = true;

                this.onGuessResult?.(playerId, {
                    correct: false,
                    pointsEarned: 0,
                    newStage: null,
                });
            }
        }

        // Start pressure timer on opponent if not already pressured
        if (opponentId && !this.pressureTimer) {
            const opponentState = this.playerStates.get(opponentId);
            const opponentDone = opponentState?.guessedCorrectly ||
                (opponentState && opponentState.stage >= MAX_STAGE && opponentState.hasGuessed);

            if (!opponentDone) {
                this.pressureTargetId = opponentId;
                this.onOpponentGuessed?.(opponentId, PRESSURE_TIMER_SECONDS, stage, correct);

                this.pressureTimer = setTimeout(() => {
                    this.handlePressureExpired();
                }, PRESSURE_TIMER_SECONDS * 1000);
            }
        }

        // Check if round is complete
        this.checkRoundComplete();
    }

    private handlePressureExpired(): void {
        this.clearPressureTimer();
        if (this.pressureTargetId) {
            const state = this.playerStates.get(this.pressureTargetId);
            if (state && !state.guessedCorrectly) {
                // Auto-advance stage or mark as failed
                if (state.stage < MAX_STAGE) {
                    state.stage = state.stage + 1;
                    state.hasGuessed = false;
                    this.onPressureExpired?.(this.pressureTargetId);
                } else {
                    state.hasGuessed = true;
                    state.streak = 0;
                    this.onPressureExpired?.(this.pressureTargetId);
                }
            }
            this.pressureTargetId = null;
        }
        this.checkRoundComplete();
    }

    private clearPressureTimer(): void {
        if (this.pressureTimer) {
            clearTimeout(this.pressureTimer);
            this.pressureTimer = null;
        }
        this.pressureTargetId = null;
    }

    private checkRoundComplete(): void {
        if (this.roundComplete) return;

        const playerIds = Array.from(this.playerStates.keys());
        const allDone = playerIds.every((id) => {
            const s = this.playerStates.get(id)!;
            return s.guessedCorrectly || (s.stage >= MAX_STAGE && s.hasGuessed);
        });

        if (allDone) {
            this.roundComplete = true;
            this.clearPressureTimer();
            this.emitRoundComplete();
        }
    }

    private emitRoundComplete(): void {
        const track = this.getCurrentTrack();
        if (!track) return;

        const results: RoundCompletePayload['results'] = {};
        for (const [id, state] of this.playerStates) {
            results[id] = {
                guessedCorrectly: state.guessedCorrectly,
                pointsEarned: state.pointsEarned,
                stageGuessedAt: state.stageGuessedAt,
                totalScore: state.totalScore,
            };
        }

        this.onRoundComplete?.({
            round: this.currentRound,
            track,
            results,
        });
    }

    // ─── Next Round ───

    advanceRound(): void {
        this.currentRound++;
        if (this.currentRound > this.tracks.length) {
            this.emitGameOver();
            return;
        }

        this.resetRoundStates();
        const track = this.getCurrentTrack();
        if (track) {
            this.onNewRound?.(this.currentRound, this.tracks.length, track);
        }
    }

    private emitGameOver(): void {
        const scores: GameOverPayload['scores'] = {};
        let maxScore = -1;
        let winnerId = '';

        for (const [id, state] of this.playerStates) {
            const player = this.host?.id === id ? this.host : this.guest;
            scores[id] = {
                displayName: player?.displayName || 'Unknown',
                totalScore: state.totalScore,
                correctGuesses: state.correctGuesses,
                bestStreak: state.bestStreak,
            };
            if (state.totalScore > maxScore) {
                maxScore = state.totalScore;
                winnerId = id;
            }
        }

        this.onGameOver?.({
            playlistName: this.playlistName,
            totalRounds: this.tracks.length,
            scores,
            winnerId,
        });
    }
}
