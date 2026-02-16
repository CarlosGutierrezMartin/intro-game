import React from 'react';
import { AuthGate } from '../features/auth/AuthGate';
import { PlaylistBrowser } from '../features/discovery/PlaylistBrowser';
import { GameArena } from '../features/game/GameArena';
import { Lobby } from '../features/multiplayer/Lobby';
import { WaitingRoom } from '../features/multiplayer/WaitingRoom';
import { MultiplayerArena } from '../features/multiplayer/MultiplayerArena';
import { useGameStore } from '../stores/gameStore';
import { useMultiplayerStore } from '../stores/multiplayerStore';
import '../features/multiplayer/multiplayer.css';

const AppContent: React.FC = () => {
    const currentPlaylist = useGameStore((s) => s.currentPlaylist);
    const mpPhase = useMultiplayerStore((s) => s.phase);

    // Multiplayer flow
    if (mpPhase === 'lobby') return <Lobby />;
    if (mpPhase === 'waiting') return <WaitingRoom />;
    if (mpPhase === 'playing' || mpPhase === 'round_result' || mpPhase === 'game_over') {
        return <MultiplayerArena />;
    }

    // Solo flow
    return (
        <div className="app-shell">
            {!currentPlaylist ? <PlaylistBrowser /> : <GameArena />}
        </div>
    );
};

const App: React.FC = () => {
    return (
        <AuthGate>
            <AppContent />
        </AuthGate>
    );
};

export default App;
