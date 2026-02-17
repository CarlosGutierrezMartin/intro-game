import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GamePhase, Stage, STAGE_CONFIG, STAGES_ORDER, Track, Playlist } from '../types';
import { normalizeForMatch } from '../../shared/events';

/** Maximum number of rounds (songs) per game */
export const GAME_LENGTH = 10;

interface GameState {
    // Current round
    currentPlaylist: Playlist | null;
    currentTrack: Track | null;
    phase: GamePhase;
    stage: Stage;
    isAudioPlaying: boolean;

    // Scoring
    score: number;
    streak: number;
    bestStreak: number;
    roundsPlayed: number;
    correctGuesses: number;
    lastPointsEarned: number;

    // Track pool (loaded tracks with preview URLs)
    trackPool: Track[];
    playedTrackIds: Set<string>;

    // Actions
    startGame: (playlist: Playlist, tracks: Track[]) => void;
    setPhase: (phase: GamePhase) => void;
    setAudioPlaying: (playing: boolean) => void;
    submitGuess: (guessTrackId: string, guessTitle?: string, guessArtist?: string) => 'correct' | 'wrong' | 'fail';
    advanceToGuessing: () => void;
    giveUp: () => void;
    nextRound: () => void;
    resetGame: () => void;
}

function getRandomTrack(pool: Track[], playedIds: Set<string>): Track | null {
    const available = pool.filter((t) => !playedIds.has(t.id));
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

export const useGameStore = create<GameState>()(
    persist(
        (set, get) => ({
            currentPlaylist: null,
            currentTrack: null,
            phase: GamePhase.IDLE,
            stage: Stage.INTRO,
            isAudioPlaying: false,
            score: 0,
            streak: 0,
            bestStreak: 0,
            roundsPlayed: 0,
            correctGuesses: 0,
            lastPointsEarned: 0,
            trackPool: [],
            playedTrackIds: new Set<string>(),

            startGame: (playlist, tracks) => {
                // Limit to GAME_LENGTH tracks
                const pool = tracks.length > GAME_LENGTH ? tracks.slice(0, GAME_LENGTH) : tracks;
                const firstTrack = pool[Math.floor(Math.random() * pool.length)];
                set({
                    currentPlaylist: playlist,
                    trackPool: pool,
                    currentTrack: firstTrack,
                    playedTrackIds: new Set([firstTrack.id]),
                    phase: GamePhase.IDLE,
                    stage: Stage.INTRO,
                    score: 0,
                    streak: 0,
                    bestStreak: 0,
                    roundsPlayed: 0,
                    correctGuesses: 0,
                    lastPointsEarned: 0,
                    isAudioPlaying: false,
                });
            },

            setPhase: (phase) => set({ phase }),

            setAudioPlaying: (playing) => set({ isAudioPlaying: playing }),

            advanceToGuessing: () => {
                set({ phase: GamePhase.GUESSING, isAudioPlaying: false });
            },

            submitGuess: (guessTrackId, guessTitle?, guessArtist?) => {
                const { currentTrack, stage, score, streak, bestStreak, correctGuesses, roundsPlayed } = get();
                if (!currentTrack) return 'fail';

                // Primary: exact ID match
                let isCorrect = guessTrackId === currentTrack.id;

                // Fallback: normalized title + artist match
                if (!isCorrect && guessTitle && guessArtist) {
                    const guessKey = normalizeForMatch(guessTitle) + '|' + normalizeForMatch(guessArtist);
                    const trackKey = normalizeForMatch(currentTrack.title) + '|' + normalizeForMatch(currentTrack.artist);
                    isCorrect = guessKey === trackKey;
                    if (isCorrect) console.log('[Guess] Fuzzy match accepted:', guessTitle, '≈', currentTrack.title);
                }

                if (isCorrect) {
                    // ✅ Correct guess
                    const points = STAGE_CONFIG[stage].points;
                    const newStreak = streak + 1;
                    set({
                        score: score + points,
                        streak: newStreak,
                        bestStreak: Math.max(bestStreak, newStreak),
                        correctGuesses: correctGuesses + 1,
                        roundsPlayed: roundsPlayed + 1,
                        lastPointsEarned: points,
                        phase: GamePhase.REVEAL,
                        isAudioPlaying: false,
                    });
                    return 'correct';
                } else {
                    // ❌ Wrong guess — advance stage or fail
                    const currentStageIndex = STAGES_ORDER.indexOf(stage);
                    if (currentStageIndex < STAGES_ORDER.length - 1) {
                        // Move to next stage
                        set({
                            stage: STAGES_ORDER[currentStageIndex + 1],
                            phase: GamePhase.IDLE, // Back to idle so they can play the longer clip
                            isAudioPlaying: false,
                        });
                        return 'wrong';
                    } else {
                        // Failed at last stage (VIBE)
                        set({
                            streak: 0,
                            roundsPlayed: roundsPlayed + 1,
                            lastPointsEarned: 0,
                            phase: GamePhase.REVEAL,
                            isAudioPlaying: false,
                        });
                        return 'fail';
                    }
                }
            },

            giveUp: () => {
                const { roundsPlayed } = get();
                set({
                    streak: 0,
                    roundsPlayed: roundsPlayed + 1,
                    lastPointsEarned: 0,
                    phase: GamePhase.REVEAL,
                    isAudioPlaying: false,
                });
            },

            nextRound: () => {
                const { trackPool, playedTrackIds, roundsPlayed } = get();

                // Game complete after GAME_LENGTH rounds
                if (roundsPlayed >= GAME_LENGTH) {
                    set({ currentTrack: null, phase: GamePhase.REVEAL });
                    return;
                }

                const nextTrack = getRandomTrack(trackPool, playedTrackIds);

                if (!nextTrack) {
                    // All tracks played (pool smaller than GAME_LENGTH)
                    set({ currentTrack: null, phase: GamePhase.REVEAL });
                    return;
                }

                const newPlayed = new Set(playedTrackIds);
                newPlayed.add(nextTrack.id);

                set({
                    currentTrack: nextTrack,
                    playedTrackIds: newPlayed,
                    phase: GamePhase.IDLE,
                    stage: Stage.INTRO,
                    isAudioPlaying: false,
                    lastPointsEarned: 0,
                });
            },

            resetGame: () =>
                set({
                    currentPlaylist: null,
                    currentTrack: null,
                    trackPool: [],
                    playedTrackIds: new Set(),
                    phase: GamePhase.IDLE,
                    stage: Stage.INTRO,
                    isAudioPlaying: false,
                    score: 0,
                    streak: 0,
                    bestStreak: 0,
                    roundsPlayed: 0,
                    correctGuesses: 0,
                    lastPointsEarned: 0,
                }),
        }),
        {
            name: 'intro-game',
            partialize: (state) => ({
                score: state.score,
                bestStreak: state.bestStreak,
                roundsPlayed: state.roundsPlayed,
                correctGuesses: state.correctGuesses,
            }),
            // Custom serializer for Set
            storage: {
                getItem: (name) => {
                    const str = localStorage.getItem(name);
                    return str ? JSON.parse(str) : null;
                },
                setItem: (name, value) => {
                    localStorage.setItem(name, JSON.stringify(value));
                },
                removeItem: (name) => localStorage.removeItem(name),
            },
        }
    )
);
