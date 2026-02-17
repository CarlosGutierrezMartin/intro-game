import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useGameStore, GAME_LENGTH } from '../../stores/gameStore';
import { useThemeStore } from '../../stores/themeStore';
import { audioEngine } from '../../services/audioEngine';
import { GamePhase, STAGE_CONFIG, STAGES_ORDER, Stage } from '../../types';
import { SearchGuess } from './SearchGuess';

export const GameArena: React.FC = () => {
    const {
        currentTrack,
        currentPlaylist,
        stage,
        phase,
        score,
        streak,
        bestStreak,
        isAudioPlaying,
        roundsPlayed,
        correctGuesses,
        lastPointsEarned,
        setAudioPlaying,
        advanceToGuessing,
        submitGuess,
        nextRound,
        giveUp,
        resetGame,
    } = useGameStore();

    const { resetTheme } = useThemeStore();
    const [feedback, setFeedback] = useState<'none' | 'success' | 'wrong' | 'fail'>('none');

    // ─── Play Audio ───
    const handlePlay = useCallback(async () => {
        if (!currentTrack?.previewUrl || isAudioPlaying || phase !== GamePhase.IDLE) return;

        setAudioPlaying(true);
        const duration = STAGE_CONFIG[stage].durationMs;

        await audioEngine.playSegment(currentTrack.previewUrl, duration, () => {
            setAudioPlaying(false);
            advanceToGuessing();
        });
    }, [currentTrack, isAudioPlaying, phase, stage]);

    // ─── Submit Guess ───
    const handleGuess = useCallback((trackId: string, title: string, artist: string) => {
        const result = submitGuess(trackId, title, artist);

        if (result === 'correct') {
            setFeedback('success');
            if (navigator.vibrate) navigator.vibrate(50);
            audioEngine.stop();
        } else if (result === 'wrong') {
            setFeedback('wrong');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            audioEngine.stop();
            setTimeout(() => setFeedback('none'), 800);
        } else {
            setFeedback('fail');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            audioEngine.stop();
        }
    }, [submitGuess]);

    // ─── Handle Next ───
    const handleNext = useCallback(() => {
        setFeedback('none');
        nextRound();
    }, [nextRound]);

    // ─── Handle Back to Playlists ───
    const handleBack = useCallback(() => {
        audioEngine.stop();
        audioEngine.clearCache();
        resetGame();
        resetTheme();
    }, [resetGame, resetTheme]);

    // ─── Preload next track ───
    useEffect(() => {
        if (currentTrack?.previewUrl) {
            audioEngine.preload(currentTrack.previewUrl);
        }
    }, [currentTrack]);


    // ─── Game Complete State ───
    if (!currentTrack && phase === GamePhase.REVEAL) {
        const accuracy = roundsPlayed > 0 ? Math.round((correctGuesses / roundsPlayed) * 100) : 0;
        return (
            <div className="game-summary slide-up">
                <div className="summary-emoji">
                    {accuracy >= 80 ? '🏆' : accuracy >= 50 ? '🎉' : '💪'}
                </div>
                <div className="summary-title">
                    {accuracy >= 80 ? 'Incredible!' : accuracy >= 50 ? 'Nice Work!' : 'Good Try!'}
                </div>
                <p style={{ color: 'var(--md-on-surface-variant)', marginBottom: '32px', fontSize: '0.9375rem' }}>
                    You finished <strong>{currentPlaylist?.name}</strong>
                </p>

                <div className="summary-stats-grid">
                    <div className="summary-stat">
                        <span className="summary-stat-value">{score}</span>
                        <span className="summary-stat-label">Score</span>
                    </div>
                    <div className="summary-stat">
                        <span className="summary-stat-value">{accuracy}%</span>
                        <span className="summary-stat-label">Accuracy</span>
                    </div>
                    <div className="summary-stat">
                        <span className="summary-stat-value">{correctGuesses}/{roundsPlayed}</span>
                        <span className="summary-stat-label">Correct</span>
                    </div>
                    <div className="summary-stat">
                        <span className="summary-stat-value">{bestStreak}</span>
                        <span className="summary-stat-label">Best Streak</span>
                    </div>
                </div>

                <button className="md-btn md-btn-filled" onClick={handleBack} style={{ marginTop: '32px' }}>
                    Play Again
                </button>
            </div>
        );
    }

    if (!currentTrack) return null;

    const isReveal = phase === GamePhase.REVEAL;
    const isIdle = phase === GamePhase.IDLE;
    const isGuessing = phase === GamePhase.GUESSING;
    const stageConfig = STAGE_CONFIG[stage];
    const currentStageIndex = STAGES_ORDER.indexOf(stage);

    return (
        <div className="game-container">
            {/* ─── Blurred Album Art Background ─── */}
            <div className="game-bg">
                <img
                    src={currentTrack.albumArt}
                    alt=""
                    className="game-bg-art"
                />
                <div className="game-bg-overlay" />
            </div>

            {/* ─── Animated Glow Background ─── */}
            <div
                className={`game-glow ${isAudioPlaying ? 'game-glow-active' : ''}`}
                style={{ '--glow-opacity': isAudioPlaying ? '0.25' : '0.05' } as React.CSSProperties}
            />

            {/* ─── Header ─── */}
            <div className="game-header">
                <button className="game-header-btn" onClick={handleBack} title="Back to playlists">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>

                {/* Round Counter */}
                <div className="game-round-pill">
                    <span className="game-round-num">{roundsPlayed + 1}</span>
                    <span className="game-round-sep">/</span>
                    <span className="game-round-total">{GAME_LENGTH}</span>
                </div>

                {/* Score */}
                <div className="game-score-block">
                    <div className="score-value">{score}</div>
                    <div className="score-label">PTS</div>
                </div>
            </div>

            {/* ─── Streak Badge (below header) ─── */}
            {streak >= 2 && (
                <div className="game-streak-container">
                    <div className="streak-badge" key={streak}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 23c-3.866 0-7-3.134-7-7 0-3.146 2.278-5.727 4.865-8.115L12 6l2.135 1.885C16.722 10.273 19 12.854 19 16c0 3.866-3.134 7-7 7zm0-3c2.21 0 4-1.79 4-4 0-1.643-1.186-3.138-2.662-4.706L12 10l-1.338 1.294C9.186 12.862 8 14.357 8 16c0 2.21 1.79 4 4 4z" />
                        </svg>
                        {streak} streak!
                    </div>
                </div>
            )}

            {/* ─── Main Area ─── */}
            <div className="game-main">

                {/* ─── Stage Progress Bar ─── */}
                {!isReveal && (
                    <div className="stage-progress">
                        {STAGES_ORDER.map((s, i) => {
                            let state: string = 'future';
                            if (i === currentStageIndex) state = 'current';
                            else if (i < currentStageIndex) state = 'spent';
                            return (
                                <div key={s} className="stage-step">
                                    <div className={`stage-step-dot stage-step-${state}`}>
                                        {state === 'spent' ? '✕' : STAGE_CONFIG[s].seconds}
                                    </div>
                                    <div className={`stage-step-label stage-step-label-${state}`}>
                                        {STAGE_CONFIG[s].points}pts
                                    </div>
                                </div>
                            );
                        })}
                        {/* Connecting line */}
                        <div className="stage-progress-line">
                            <div
                                className="stage-progress-fill"
                                style={{ width: `${(currentStageIndex / (STAGES_ORDER.length - 1)) * 100}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* ─── Play FAB ─── */}
                <div className="play-fab-container">
                    {/* Ripple Rings */}
                    {isAudioPlaying && (
                        <>
                            <span className="ripple-ring ripple-ring-active" />
                            <span className="ripple-ring ripple-ring-active" />
                            <span className="ripple-ring ripple-ring-active" />
                        </>
                    )}

                    <button
                        className={`play-fab ${isAudioPlaying ? 'play-fab-playing' : ''} ${isGuessing ? 'play-fab-guessing' : ''}`}
                        onClick={handlePlay}
                        disabled={!isIdle || isAudioPlaying}
                    >
                        {isAudioPlaying ? (
                            <div className="audio-bars">
                                <div className="audio-bar" />
                                <div className="audio-bar" />
                                <div className="audio-bar" />
                                <div className="audio-bar" />
                                <div className="audio-bar" />
                            </div>
                        ) : isGuessing ? (
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                        ) : (
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        )}
                    </button>
                </div>

                {/* ─── Instruction Text ─── */}
                {!isReveal && (
                    <p className="game-instruction">
                        {isIdle && !isAudioPlaying && (
                            <>
                                Tap play to hear <strong>{stageConfig.seconds}</strong> of the intro
                            </>
                        )}
                        {isAudioPlaying && (
                            <>
                                <span className="listening-dot" /> Listening...
                            </>
                        )}
                        {isGuessing && 'What song is this?'}
                    </p>
                )}

                {/* ─── Search Input ─── */}
                {!isReveal && (
                    <div
                        className={`game-search-area ${feedback === 'wrong' ? 'shake' : ''}`}
                    >
                        <SearchGuess
                            onSelect={handleGuess}
                            disabled={isAudioPlaying || isIdle}
                        />
                    </div>
                )}

                {/* ─── Skip / Give Up ─── */}
                {!isReveal && !isAudioPlaying && (isGuessing || (isIdle && stage !== Stage.INTRO)) && (
                    <button
                        className="skip-link"
                        onClick={giveUp}
                    >
                        Skip this song →
                    </button>
                )}
            </div>

            {/* ─── Reveal Overlay ─── */}
            {isReveal && currentTrack && (
                <div className="reveal-backdrop">
                    <div className="reveal-card">
                        <img
                            className="reveal-art"
                            src={currentTrack.albumArt}
                            alt={currentTrack.album}
                        />
                        <div className="reveal-title">{currentTrack.title}</div>
                        <div className="reveal-artist">{currentTrack.artist}</div>
                        <div className="reveal-album">{currentTrack.album}{currentTrack.year ? ` · ${currentTrack.year}` : ''}</div>

                        <div className={`reveal-points ${lastPointsEarned > 0 ? 'reveal-points-success' : 'reveal-points-fail'}`}>
                            {lastPointsEarned > 0 ? `+${lastPointsEarned}` : '0'}
                        </div>
                        <div className="reveal-points-label">
                            {lastPointsEarned > 0
                                ? `Nailed it at ${stageConfig.seconds}!`
                                : feedback === 'fail' ? 'Better luck next time' : 'Skipped'
                            }
                        </div>

                        <button
                            className="md-btn md-btn-filled"
                            onClick={handleNext}
                            style={{ width: '100%' }}
                        >
                            Next Song →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
