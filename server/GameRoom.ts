import {
    PlayerInfo,
    TrackData,
    GuessResultPayload,
    RoundCompletePayload,
    GameOverPayload,
    OpponentCorrectPayload,
    StageAdvancePayload,
    ROUNDS_PER_GAME,
    PRESSURE_TIMER_SECONDS,
    normalizeForMatch,
} from '../shared/events';

// ─── Per-Player State ───
interface PlayerRoundState {
    isLocked: boolean;       // true = blocked after wrong guess
    guessedCorrectly: boolean;
    pointsEarned: number;
    stageGuessedAt: number | null;

    // Cumulative stats (persist across rounds)
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
    private currentStage = 0;           // 0, 1, 2 — synchronized across both players
    private playerStates = new Map<string, PlayerRoundState>();
    private pressureTimer: ReturnType<typeof setTimeout> | null = null;
    private roundComplete = false;
    private nextRoundReady = new Set<string>();

    // Callbacks set by the socket handler
    onGuessResult?: (playerId: string, result: GuessResultPayload) => void;
    onOpponentGuessed?: (targetId: string, timerSeconds: number, opponentStage: number, correct: boolean) => void;
    onPressureExpired?: (playerId: string) => void;
    onRoundComplete?: (result: RoundCompletePayload) => void;
    onNewRound?: (round: number, totalRounds: number, track: TrackData) => void;
    onGameOver?: (result: GameOverPayload) => void;
    onOpponentStageUpdate?: (targetId: string, stage: number) => void;
    onStageAdvance?: (payload: StageAdvancePayload) => void;
    onOpponentCorrect?: (targetId: string, payload: OpponentCorrectPayload) => void;

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
            isLocked: false,
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
        this.currentStage = 0;
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
        this.currentStage = 0;
        this.clearPressureTimer();
        for (const [, state] of this.playerStates) {
            state.isLocked = false;
            state.guessedCorrectly = false;
            state.pointsEarned = 0;
            state.stageGuessedAt = null;
        }
    }

    // ─── Guess Handling ───
    // Rules:
    // 1. Both players are always in the same stage (currentStage)
    // 2. Wrong guess → player's input is BLOCKED (isLocked = true)
    //    → 15s pressure timer starts for the opponent
    // 3. Correct guess → round ends immediately → both move to next round
    // 4. If both players guess wrong → cancel timer, both advance to next stage
    // 5. Pressure timer expiry → both advance to next stage
    // 6. Last stage failure → round over with 0 points for that player

    submitGuess(playerId: string, guessTrackId: string, stage: number, guessTitle?: string, guessArtist?: string): void {
        if (this.roundComplete) return;

        const state = this.playerStates.get(playerId);
        if (!state) return;

        // Guard: already locked (guessed wrong), already guessed correctly, or stage desync
        if (state.isLocked) return;
        if (state.guessedCorrectly) return;

        const currentTrack = this.getCurrentTrack();
        if (!currentTrack) return;

        const opponentId = this.getOpponentId(playerId);

        // Primary: exact ID match
        let correct = guessTrackId === currentTrack.id;

        // Fallback: normalized title + artist match
        if (!correct && guessTitle && guessArtist) {
            const guessKey = normalizeForMatch(guessTitle) + '|' + normalizeForMatch(guessArtist);
            const trackKey = normalizeForMatch(currentTrack.title) + '|' + normalizeForMatch(currentTrack.artist);
            correct = guessKey === trackKey;
            if (correct) console.log(`[GameRoom] Fuzzy match accepted: "${guessTitle}" ≈ "${currentTrack.title}"`);
        }

        if (correct) {
            // ─── CORRECT GUESS ─── Round ends immediately
            const points = STAGE_POINTS[Math.min(this.currentStage, MAX_STAGE)] || 33;
            state.guessedCorrectly = true;
            state.pointsEarned = points;
            state.stageGuessedAt = this.currentStage;
            state.totalScore += points;
            state.correctGuesses++;
            state.streak++;
            state.bestStreak = Math.max(state.bestStreak, state.streak);

            this.onGuessResult?.(playerId, {
                correct: true,
                pointsEarned: points,
                newStage: null,
                isLocked: false,
            });

            // Notify opponent that you guessed correctly
            if (opponentId) {
                this.onOpponentCorrect?.(opponentId, {
                    track: currentTrack,
                    opponentPointsEarned: points,
                    opponentStage: this.currentStage,
                });
            }

            // Cancel any active pressure timer and complete the round
            this.clearPressureTimer();
            this.roundComplete = true;

            // Reset streak for opponent if they didn't guess correctly
            if (opponentId) {
                const opponentState = this.playerStates.get(opponentId);
                if (opponentState && !opponentState.guessedCorrectly) {
                    opponentState.streak = 0;
                }
            }

            this.emitRoundComplete();
        } else {
            // ─── WRONG GUESS ─── Lock this player's input
            state.isLocked = true;

            this.onGuessResult?.(playerId, {
                correct: false,
                pointsEarned: 0,
                newStage: null, // Stage doesn't change yet — wait for timer/opponent
                isLocked: true,
            });

            // Check: did the opponent ALSO guess wrong already?
            const opponentState = opponentId ? this.playerStates.get(opponentId) : null;
            const opponentAlsoLocked = opponentState?.isLocked === true;

            if (opponentAlsoLocked) {
                // Both players guessed wrong — cancel existing timer, advance immediately
                this.clearPressureTimer();
                this.advanceStage();
            } else if (opponentId && !this.pressureTimer) {
                // Opponent hasn't guessed yet — start pressure timer for them
                this.onOpponentGuessed?.(opponentId, PRESSURE_TIMER_SECONDS, this.currentStage, false);

                this.pressureTimer = setTimeout(() => {
                    this.handlePressureExpired();
                }, PRESSURE_TIMER_SECONDS * 1000);
            }
        }
    }

    /**
     * Advance both players to the next stage simultaneously.
     * If already at last stage, end the round with 0 points for those who didn't guess.
     */
    private advanceStage(): void {
        if (this.roundComplete) return;

        if (this.currentStage >= MAX_STAGE) {
            // Last stage — round is over, no one gets more chances
            this.roundComplete = true;

            // Reset streaks for players who didn't guess correctly
            for (const [, state] of this.playerStates) {
                if (!state.guessedCorrectly) {
                    state.streak = 0;
                }
            }

            this.emitRoundComplete();
            return;
        }

        // Advance to next stage
        this.currentStage++;

        // Reset per-stage state for both players
        for (const [, state] of this.playerStates) {
            if (!state.guessedCorrectly) {
                state.isLocked = false;
            }
        }

        // Notify both players
        this.onStageAdvance?.({ newStage: this.currentStage });
    }

    private handlePressureExpired(): void {
        this.clearPressureTimer();
        // Timer expired — both players advance to next stage
        this.advanceStage();
    }

    private clearPressureTimer(): void {
        if (this.pressureTimer) {
            clearTimeout(this.pressureTimer);
            this.pressureTimer = null;
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

    playerReady(playerId: string): void {
        this.nextRoundReady.add(playerId);

        // Wait for both players to be ready
        const playerIds = Array.from(this.playerStates.keys());
        const allReady = playerIds.every((id) => this.nextRoundReady.has(id));

        if (allReady) {
            this.nextRoundReady.clear();
            this.advanceRound();
        }
    }

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
