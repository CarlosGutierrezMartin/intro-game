import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SessionManager } from './SessionManager';
import {
    Events,
    CreateSessionPayload,
    JoinSessionPayload,
    SelectTracksPayload,
    SubmitGuessPayload,
    PlayerInfo,
} from '../shared/events';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: ['http://127.0.0.1:3000', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
    },
});

const sessions = new SessionManager();

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Fix for Express 5 path-to-regexp issue with '*'
    app.get(/(.*)/, (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

io.on('connection', (socket) => {
    console.log(`[IO] Connected: ${socket.id}`);
    let currentRoomCode: string | null = null;

    // ─── Create Session ───
    socket.on(Events.CREATE_SESSION, (payload: CreateSessionPayload) => {
        const code = sessions.createSession();
        const room = sessions.getRoom(code)!;
        const player: PlayerInfo = { id: socket.id, ...payload.player };
        room.addHost(player);
        currentRoomCode = code;
        socket.join(code);

        socket.emit(Events.SESSION_CREATED, { sessionCode: code, player });
        console.log(`[IO] ${player.displayName} created session ${code}`);
    });

    // ─── Join Session ───
    socket.on(Events.JOIN_SESSION, (payload: JoinSessionPayload) => {
        const code = payload.sessionCode.toUpperCase();
        const room = sessions.getRoom(code);

        if (!room) {
            socket.emit(Events.SESSION_ERROR, { message: 'Session not found' });
            return;
        }
        if (room.isFull()) {
            socket.emit(Events.SESSION_ERROR, { message: 'Session is full' });
            return;
        }

        const player: PlayerInfo = { id: socket.id, ...payload.player };
        room.addGuest(player);
        currentRoomCode = code;
        socket.join(code);

        // Tell guest about the session
        socket.emit(Events.SESSION_JOINED, {
            sessionCode: code,
            host: room.host,
            guest: player,
        });

        // Tell host about the guest
        socket.to(code).emit(Events.PLAYER_JOINED, { guest: player });
        console.log(`[IO] ${player.displayName} joined session ${code}`);
    });

    // ─── Select Tracks (Host) ───
    socket.on(Events.SELECT_TRACKS, (payload: SelectTracksPayload) => {
        if (!currentRoomCode) return;
        const room = sessions.getRoom(currentRoomCode);
        if (!room || room.host?.id !== socket.id) return;

        room.setTracks(payload.tracks, payload.playlistName);
        const firstTrack = room.startGame();

        if (firstTrack) {
            // Wire up room callbacks
            wireRoomCallbacks(room, currentRoomCode);

            io.to(currentRoomCode).emit(Events.GAME_STARTING, {
                round: 1,
                totalRounds: room.getTotalRounds(),
                track: firstTrack,
                playlistName: room.getPlaylistName(),
            });
            console.log(`[IO] Game started in ${currentRoomCode}: ${room.getTotalRounds()} rounds`);
        }
    });

    // ─── Submit Guess ───
    socket.on(Events.SUBMIT_GUESS, (payload: SubmitGuessPayload) => {
        if (!currentRoomCode) return;
        const room = sessions.getRoom(currentRoomCode);
        if (!room) return;

        room.submitGuess(socket.id, payload.trackId, payload.stage);
    });

    // ─── Next Round ───
    socket.on(Events.NEXT_ROUND, () => {
        if (!currentRoomCode) return;
        const room = sessions.getRoom(currentRoomCode);
        if (!room) return;

        // Only advance when both players request next
        const readyKey = `${currentRoomCode}:nextReady`;
        if (!nextRoundReady.has(readyKey)) {
            nextRoundReady.set(readyKey, new Set());
        }
        nextRoundReady.get(readyKey)!.add(socket.id);

        if (nextRoundReady.get(readyKey)!.size >= 2) {
            nextRoundReady.delete(readyKey);
            room.advanceRound();
        }
    });

    // ─── Disconnect ───
    socket.on('disconnect', () => {
        console.log(`[IO] Disconnected: ${socket.id}`);
        if (currentRoomCode) {
            const room = sessions.getRoom(currentRoomCode);
            if (room) {
                room.removePlayer(socket.id);
                socket.to(currentRoomCode).emit(Events.PLAYER_DISCONNECTED, { playerId: socket.id });

                if (room.isEmpty()) {
                    sessions.deleteRoom(currentRoomCode);
                }
            }
        }
    });
});

// Track which players are ready for next round
const nextRoundReady = new Map<string, Set<string>>();

function wireRoomCallbacks(room: ReturnType<SessionManager['getRoom']>, roomCode: string): void {
    if (!room) return;

    room.onGuessResult = (playerId, result) => {
        io.to(playerId).emit(Events.GUESS_RESULT, result);
    };

    room.onOpponentGuessed = (targetId, timerSeconds, opponentStage, correct) => {
        io.to(targetId).emit(Events.OPPONENT_GUESSED, {
            timerSeconds,
            opponentStage,
            opponentGuessedCorrectly: correct,
        });
    };

    room.onPressureExpired = (playerId) => {
        io.to(playerId).emit(Events.PRESSURE_TIMER_EXPIRED, {});
    };

    room.onRoundComplete = (result) => {
        io.to(roomCode).emit(Events.ROUND_COMPLETE, result);
    };

    room.onNewRound = (round, totalRounds, track) => {
        io.to(roomCode).emit(Events.NEW_ROUND, { round, totalRounds, track });
    };

    room.onGameOver = (result) => {
        io.to(roomCode).emit(Events.GAME_OVER, result);
    };

    room.onOpponentStageUpdate = (targetId, stage) => {
        io.to(targetId).emit(Events.OPPONENT_STAGE_UPDATE, { stage });
    };
}

const PORT = 3011;
httpServer.listen(PORT, () => {
    console.log(`\n  🎮 Intro Game Server running on http://localhost:${PORT}\n`);
});
