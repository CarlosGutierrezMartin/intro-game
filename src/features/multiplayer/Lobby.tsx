import * as React from 'react';
import { useState } from 'react';
import { useMultiplayerStore } from '../../stores/multiplayerStore';
import { useAuthStore } from '../../stores/authStore';

export const Lobby: React.FC = () => {
    const { createSession, joinSession, leaveLobby, error } = useMultiplayerStore();
    const user = useAuthStore((s) => s.user);
    const [joinCode, setJoinCode] = useState('');
    const [localName, setLocalName] = useState('');
    const [mode, setMode] = useState<'pick' | 'join'>('pick');

    // Use auth name if available, otherwise local state (Guest)
    const displayName = user?.displayName || localName;
    const avatarUrl = user?.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${displayName}`;

    const setDisplayName = (name: string) => setLocalName(name);

    const handleCreate = () => {
        if (!displayName.trim()) return;
        createSession(displayName, avatarUrl);
    };

    const handleJoin = () => {
        if (joinCode.trim().length >= 4 && displayName.trim()) {
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

                {/* Guest Name Input (if not logged in) */}
                {!user && (
                    <div className="code-input-container" style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: '#aaa' }}>Your Name</label>
                        <input
                            className="code-input"
                            style={{ fontSize: '1.2rem', padding: '12px' }}
                            type="text"
                            placeholder="Player Name"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            maxLength={12}
                        />
                    </div>
                )}

                <div className="code-input-container">
                    <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: '#aaa' }}>Session Code</label>
                    <input
                        className="code-input"
                        type="text"
                        placeholder="ABC123"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                        maxLength={6}
                        autoFocus={!!user} // Only autofocus code if user is logged in
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    />
                </div>

                {error && <div className="lobby-error">{error}</div>}

                <button
                    className="md-btn md-btn-filled"
                    onClick={handleJoin}
                    disabled={joinCode.trim().length < 4 || !displayName.trim()}
                    style={{ width: '100%', maxWidth: 320 }}
                >
                    Join Session
                </button>
            </div>
        );
    }

    return (
        <div className="lobby-container slide-up">
            <div className="game-header">
                <button className="game-header-btn" onClick={leaveLobby}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                </button>
                <div style={{ flex: 1 }} />
            </div>
            <div className="lobby-header">
                <h1 className="discovery-logo">Intro</h1>
                <p className="lobby-subtitle">Challenge a friend — first to guess wins!</p>
            </div>

            {error && <div className="lobby-error">{error}</div>}

            {/* Guest Name Input (if not logged in) */}
            {!user && (
                <div className="code-input-container" style={{ marginBottom: 24, maxWidth: 320, marginInline: 'auto' }}>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: '#aaa', textAlign: 'left' }}>Your Name</label>
                    <input
                        className="code-input"
                        style={{ fontSize: '1.2rem', padding: '12px' }}
                        type="text"
                        placeholder="Player Name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={12}
                    />
                </div>
            )}

            <div className="lobby-cards">
                <button
                    className="lobby-card lobby-card-create"
                    onClick={handleCreate}
                    disabled={!displayName.trim()}
                    style={{ opacity: !displayName.trim() ? 0.5 : 1 }}
                >
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
