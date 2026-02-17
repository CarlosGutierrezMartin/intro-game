import * as React from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useMultiplayerStore } from '../../stores/multiplayerStore';
import { audioEngine } from '../../services/audioEngine';
import { STAGE_CONFIG, Stage, STAGES_ORDER } from '../../types';
import { SearchGuess } from '../game/SearchGuess';
import { PRESSURE_TIMER_SECONDS } from '../../../shared/events';

export const MultiplayerArena: React.FC = () => {
    const {
        currentTrack,
        round,
        totalRounds,
        myStage,
        isLocked,
        myGuessedCorrectly,
        myTotalScore,
        opponentStage,
        opponentHasGuessed,
        opponentGuessedCorrectly,
        pressureTimerActive,
        pressureTimerSeconds,
        opponentCorrectData,
        roundResults,
        gameOverData,
        me,
        opponent,
        phase,
        submitGuess,
        requestNextRound,
        leaveLobby,
    } = useMultiplayerStore();

    const [isPlaying, setIsPlaying] = useState(false);
    const [hasListened, setHasListened] = useState(false);
    const [feedback, setFeedback] = useState<'none' | 'wrong'>('none');
    const [waitingForNext, setWaitingForNext] = useState(false);
    const prevRoundRef = useRef(round);
    const prevStageRef = useRef(myStage);

    // Reset per-round local state when round changes
    useEffect(() => {
        if (round !== prevRoundRef.current) {
            prevRoundRef.current = round;
            setIsPlaying(false);
            setHasListened(false);
            setFeedback('none');
            setWaitingForNext(false);
        }
    }, [round]);

    // Reset hasListened when stage advances
    useEffect(() => {
        if (myStage !== prevStageRef.current) {
            prevStageRef.current = myStage;
            setHasListened(false);
            setIsPlaying(false);
        }
    }, [myStage]);

    // Preload audio
    useEffect(() => {
        if (currentTrack?.previewUrl) {
            audioEngine.preload(currentTrack.previewUrl);
        }
    }, [currentTrack]);

    // ─── Play Audio ───
    const handlePlay = useCallback(async () => {
        if (!currentTrack?.previewUrl || isPlaying || myGuessedCorrectly || isLocked) return;

        setIsPlaying(true);
        const stageKey = STAGES_ORDER[myStage] ?? Stage.INTRO;
        const duration = STAGE_CONFIG[stageKey].durationMs;

        await audioEngine.playSegment(currentTrack.previewUrl, duration, () => {
            setIsPlaying(false);
            setHasListened(true);
        });
    }, [currentTrack, isPlaying, myStage, myGuessedCorrectly, isLocked]);

    // ─── Submit Guess ───
    const handleGuess = useCallback((trackId: string, title: string, artist: string) => {
        if (isLocked || myGuessedCorrectly) return;

        submitGuess(trackId, title, artist);
        audioEngine.stop();
        setIsPlaying(false);

        // Check shortly if it was wrong for shake feedback
        setTimeout(() => {
            const state = useMultiplayerStore.getState();
            if (!state.myGuessedCorrectly && state.isLocked) {
                setFeedback('wrong');
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
                setTimeout(() => setFeedback('none'), 800);
            } else if (state.myGuessedCorrectly) {
                if (navigator.vibrate) navigator.vibrate(50);
            }
        }, 100);
    }, [submitGuess, isLocked, myGuessedCorrectly]);

    // ─── Handle Next Round ───
    const handleNext = useCallback(() => {
        setWaitingForNext(true);
        requestNextRound();
    }, [requestNextRound]);

    // ─── Handle Leave ───
    const handleLeave = useCallback(() => {
        audioEngine.stop();
        audioEngine.clearCache();
        leaveLobby();
    }, [leaveLobby]);

    // ─── Game Over ───
    if (phase === 'game_over' && gameOverData) {
        const players = Object.entries(gameOverData.scores);
        const iWon = gameOverData.winnerId === me?.id;
        const isTie = players.length === 2 && players[0][1].totalScore === players[1][1].totalScore;

        return (
            <div className="game-summary slide-up">
                <div className="summary-emoji">{isTie ? '🤝' : iWon ? '🏆' : '😤'}</div>
                <div className="summary-title">
                    {isTie ? 'It\'s a Tie!' : iWon ? 'You Won!' : 'You Lost!'}
                </div>
                <p style={{ color: 'var(--md-on-surface-variant)', marginBottom: '24px', fontSize: '0.875rem' }}>
                    {gameOverData.playlistName} · {gameOverData.totalRounds} rounds
                </p>

                <div className="mp-final-scores">
                    {players.map(([id, data]) => (
                        <div key={id} className={`mp-final-player ${id === me?.id ? 'mp-final-me' : ''} ${id === gameOverData.winnerId && !isTie ? 'mp-final-winner' : ''}`}>
                            <div className="mp-final-name">{id === me?.id ? 'You' : data.displayName}</div>
                            <div className="mp-final-score">{data.totalScore}</div>
                            <div className="mp-final-stats">{data.correctGuesses} correct · {data.bestStreak} streak</div>
                        </div>
                    ))}
                </div>

                <button className="md-btn md-btn-filled" onClick={handleLeave} style={{ width: '100%', maxWidth: 320, marginTop: '24px' }}>
                    Back to Menu
                </button>
            </div>
        );
    }

    // ─── Round Result ───
    if (phase === 'round_result' && roundResults) {
        const myResult = roundResults.results[me?.id || ''];
        const opponentResult = roundResults.results[opponent?.id || ''];

        return (
            <div className="reveal-backdrop">
                <div className="reveal-card mp-reveal-card">
                    <img className="reveal-art" src={roundResults.track.albumArt} alt={roundResults.track.album} />
                    <div className="reveal-title">{roundResults.track.title}</div>
                    <div className="reveal-artist">{roundResults.track.artist}</div>

                    {/* Side-by-side scores */}
                    <div className="mp-round-scores">
                        <div className={`mp-round-player ${myResult?.guessedCorrectly ? 'mp-correct' : 'mp-wrong'}`}>
                            <div className="mp-round-name">You</div>
                            <div className="mp-round-points">
                                {myResult?.guessedCorrectly ? `+${myResult.pointsEarned}` : '0'}
                            </div>
                            <div className="mp-round-total">{myResult?.totalScore || 0} total</div>
                        </div>
                        <div className="mp-round-vs">VS</div>
                        <div className={`mp-round-player ${opponentResult?.guessedCorrectly ? 'mp-correct' : 'mp-wrong'}`}>
                            <div className="mp-round-name">{opponent?.displayName || 'Opponent'}</div>
                            <div className="mp-round-points">
                                {opponentResult?.guessedCorrectly ? `+${opponentResult.pointsEarned}` : '0'}
                            </div>
                            <div className="mp-round-total">{opponentResult?.totalScore || 0} total</div>
                        </div>
                    </div>

                    <button
                        className="md-btn md-btn-filled"
                        onClick={handleNext}
                        disabled={waitingForNext}
                        style={{ width: '100%' }}
                    >
                        {waitingForNext ? 'Waiting for opponent...' : 'Continue →'}
                    </button>
                </div>
            </div>
        );
    }

    if (!currentTrack) return null;

    const stageKey = STAGES_ORDER[myStage] ?? Stage.INTRO;
    const stageConfig = STAGE_CONFIG[stageKey];
    const canGuess = hasListened && !myGuessedCorrectly && !isPlaying && !isLocked;

    return (
        <div className="game-container">
            {/* ─── Blurred BG ─── */}
            <div className="game-bg">
                <img src={currentTrack.albumArt} alt="" className="game-bg-art" />
                <div className="game-bg-overlay" />
            </div>

            <div className={`game-glow ${isPlaying ? 'game-glow-active' : ''}`}
                style={{ '--glow-opacity': isPlaying ? '0.25' : '0.05' } as React.CSSProperties} />

            {/* ─── Header ─── */}
            <div className="game-header">
                <button className="game-header-btn" onClick={handleLeave}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>

                <div className="game-round-pill">
                    <span className="game-round-num">{round}</span>
                    <span className="game-round-sep">/</span>
                    <span className="game-round-total">{totalRounds}</span>
                </div>

                <div className="game-score-block">
                    <div className="score-value">{myTotalScore}</div>
                    <div className="score-label">PTS</div>
                </div>
            </div>

            {/* ─── Opponent Banner ─── */}
            <div className={`opponent-banner ${opponentHasGuessed ? 'opponent-guessed' : ''}`}>
                <div className="opponent-info">
                    {opponent?.avatarUrl ? (
                        <img className="opponent-avatar" src={opponent.avatarUrl} alt="" />
                    ) : (
                        <div className="opponent-avatar opponent-avatar-placeholder">
                            {opponent?.displayName?.charAt(0) || '?'}
                        </div>
                    )}
                    <span className="opponent-name">{opponent?.displayName || 'Opponent'}</span>
                </div>

                <div className="opponent-stage-dots">
                    {STAGES_ORDER.map((s, i) => (
                        <div key={s}
                            className={`opponent-dot ${i === opponentStage ? 'opponent-dot-active' : i < opponentStage ? 'opponent-dot-spent' : ''}`}
                        />
                    ))}
                </div>

                {opponentHasGuessed && (
                    <div className={`opponent-status ${opponentGuessedCorrectly ? 'opponent-status-correct' : 'opponent-status-wrong'}`}>
                        {opponentGuessedCorrectly ? '✓' : '✗'}
                    </div>
                )}
            </div>

            {/* ─── Pressure Timer ─── */}
            {pressureTimerActive && (
                <div className="pressure-timer-bar">
                    <div className="pressure-timer-icon">⚡</div>
                    <div className="pressure-timer-text">
                        Opponent guessed! <strong>{pressureTimerSeconds}s</strong> left
                    </div>
                    <div className="pressure-timer-progress">
                        <div
                            className="pressure-timer-fill"
                            style={{ width: `${(pressureTimerSeconds / PRESSURE_TIMER_SECONDS) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* ─── Locked Overlay (wrong guess) ─── */}
            {isLocked && !myGuessedCorrectly && !opponentCorrectData && (
                <div className="locked-overlay">
                    <div className="locked-icon">🔒</div>
                    <div className="locked-text">Wrong! Waiting for opponent...</div>
                </div>
            )}

            {/* ─── Opponent Correct Overlay ─── */}
            {opponentCorrectData && (
                <div className="opponent-correct-overlay">
                    <div className="opponent-correct-icon">😮</div>
                    <div className="opponent-correct-text">
                        {opponent?.displayName || 'Opponent'} got it!
                    </div>
                    <div className="opponent-correct-track">
                        {opponentCorrectData.track.title} — {opponentCorrectData.track.artist}
                    </div>
                </div>
            )}

            {/* ─── Main Area ─── */}
            <div className="game-main">

                {/* ─── Stage Progress ─── */}
                <div className="stage-progress">
                    {STAGES_ORDER.map((s, i) => {
                        let state = 'future';
                        if (i === myStage) state = 'current';
                        else if (i < myStage) state = 'spent';
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
                    <div className="stage-progress-line">
                        <div
                            className="stage-progress-fill"
                            style={{ width: `${(myStage / (STAGES_ORDER.length - 1)) * 100}%` }}
                        />
                    </div>
                </div>

                {/* ─── Play Button ─── */}
                <div className="play-fab-container">
                    {isPlaying && (
                        <>
                            <span className="ripple-ring ripple-ring-active" />
                            <span className="ripple-ring ripple-ring-active" />
                            <span className="ripple-ring ripple-ring-active" />
                        </>
                    )}

                    <button
                        className={`play-fab ${isPlaying ? 'play-fab-playing' : ''} ${myGuessedCorrectly ? 'play-fab-guessing' : ''}`}
                        onClick={handlePlay}
                        disabled={isPlaying || myGuessedCorrectly || isLocked}
                    >
                        {isPlaying ? (
                            <div className="audio-bars">
                                <div className="audio-bar" /><div className="audio-bar" />
                                <div className="audio-bar" /><div className="audio-bar" /><div className="audio-bar" />
                            </div>
                        ) : myGuessedCorrectly ? (
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                            </svg>
                        ) : isLocked ? (
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                                <rect x="3" y="11" width="18" height="11" rx="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" strokeWidth="2" />
                            </svg>
                        ) : (
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        )}
                    </button>
                </div>

                {/* ─── Instruction ─── */}
                <p className="game-instruction">
                    {myGuessedCorrectly && (
                        <span style={{ color: 'var(--md-primary)' }}>✓ Correct! +{useMultiplayerStore.getState().myPointsThisRound}</span>
                    )}
                    {isLocked && !myGuessedCorrectly && 'Wrong guess — waiting for opponent...'}
                    {!myGuessedCorrectly && !isLocked && isPlaying && (
                        <><span className="listening-dot" /> Listening to {stageConfig.seconds}...</>
                    )}
                    {!myGuessedCorrectly && !isLocked && !isPlaying && !hasListened && 'Tap play to hear the clip'}
                    {!myGuessedCorrectly && !isLocked && !isPlaying && hasListened && 'Guess below or replay the clip'}
                </p>

                {/* ─── Search Input ─── */}
                {!myGuessedCorrectly && !isLocked && (
                    <div className={`game-search-area ${feedback === 'wrong' ? 'shake' : ''}`}>
                        <SearchGuess
                            onSelect={handleGuess}
                            disabled={!canGuess}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
