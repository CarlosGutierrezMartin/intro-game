import * as React from 'react';
import { useState } from 'react';
import { useMultiplayerStore } from '../../stores/multiplayerStore';
import { useAuthStore } from '../../stores/authStore';

export const Lobby: React.FC = () => {
    const { createSession, joinSession, error } = useMultiplayerStore();
    const user = useAuthStore((s) => s.user);
    const [joinCode, setJoinCode] = useState('');
    const [mode, setMode] = useState<'pick' | 'join'>('pick');

    const displayName = user?.displayName || 'Player';
    const avatarUrl = user?.avatarUrl || '';

    const handleCreate = () => {
        createSession(displayName, avatarUrl);
    };

    const handleJoin = () => {
        if (joinCode.trim().length >= 4) {
            joinSession(joinCode.trim(), displayName, avatarUrl);
        }
    };

    if (mode === 'join') {
        return (
            <div className="lobby-container slide-up">
                <div className="lobby-header">
                    <button className="game-header-btn" onClick={() => setMode('pick')}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                    </button>
                    <h2 className="lobby-title">Join Game</h2>
                    <div style={{ width: 40 }} />
                </div>

                <p className="lobby-subtitle">Enter the session code from your friend</p>

                <div className="code-input-container">
                    <input
                        className="code-input"
                        type="text"
                        placeholder="ABC123"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                        maxLength={6}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    />
                </div>

                {error && <div className="lobby-error">{error}</div>}

                <button
                    className="md-btn md-btn-filled"
                    onClick={handleJoin}
                    disabled={joinCode.trim().length < 4}
                    style={{ width: '100%', maxWidth: 320 }}
                >
                    Join Session
                </button>
            </div>
        );
    }

    return (
        <div className="lobby-container slide-up">
            <div className="lobby-header">
                <h1 className="discovery-logo">Intro</h1>
                <p className="lobby-subtitle">Challenge a friend — first to guess wins!</p>
            </div>

            {error && <div className="lobby-error">{error}</div>}

            <div className="lobby-cards">
                <button className="lobby-card lobby-card-create" onClick={handleCreate}>
                    <div className="lobby-card-icon">🎮</div>
                    <div className="lobby-card-title">Create Game</div>
                    <div className="lobby-card-desc">Host a session and share the code</div>
                </button>

                <button className="lobby-card lobby-card-join" onClick={() => setMode('join')}>
                    <div className="lobby-card-icon">🔗</div>
                    <div className="lobby-card-title">Join Game</div>
                    <div className="lobby-card-desc">Enter a friend's session code</div>
                </button>
            </div>
        </div>
    );
};
