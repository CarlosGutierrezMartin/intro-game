import 'dotenv/config';
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

    // Proxy for Spotify Embed (to get previews)
    app.get('/api/spotify-embed/track/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const response = await fetch(`https://open.spotify.com/embed/track/${id}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const html = await response.text();
            res.send(html);
        } catch (e) {
            console.error(`[Proxy] Embed fetch failed for ${id}:`, e);
            res.status(500).send('Proxy Error');
        }
    });

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

        room.playerReady(socket.id);
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

    // ─── Request Generic Playlists (No Auth) ───
    socket.on('request_generic_playlists', async () => {
        try {
            const token = await getClientCredentialsToken();
            if (!token) {
                socket.emit('generic_playlists_error', { message: 'Server not configured for public API access' });
                return;
            }

            // Fetch Global Top 50
            const playlistId = '37i9dQZEVXbMDoHDwVN2tF';
            const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!response.ok) throw new Error('Failed to fetch Top 50');

            const data = await response.json();
            const tracks = data.tracks.items
                .filter((item: any) => item.track && item.track.preview_url)
                .map((item: any) => ({
                    id: item.track.id,
                    title: item.track.name,
                    artist: item.track.artists.map((a: any) => a.name).join(', '),
                    album: item.track.album.name,
                    albumArt: item.track.album.images?.[0]?.url || '',
                    previewUrl: item.track.preview_url,
                }))
                .slice(0, 50); // Limit to 50

            const playlist = {
                id: 'global-top-50',
                name: 'Global Top 50 🌎',
                coverUrl: data.images?.[0]?.url || '',
                trackCount: tracks.length,
                tracks: tracks
            };

            socket.emit('generic_playlists', { playlists: [playlist] });

        } catch (e) {
            console.error('[Server] Failed to fetch generic playlists:', e);
            socket.emit('generic_playlists_error', { message: 'Failed to load Top 50' });
        }
    });
});

// ─── Spotify Client Credentials (Server Side) ───
let cachedClientToken: string | null = null;
let clientTokenExpiresAt = 0;

async function getClientCredentialsToken(): Promise<string | null> {
    if (cachedClientToken && Date.now() < clientTokenExpiresAt) {
        return cachedClientToken;
    }

    const clientId = process.env.VITE_SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.warn('[Server] Missing Client ID or Secret for Client Credentials Flow');
        return null;
    }

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${btoa(clientId + ':' + clientSecret)}`,
            },
            body: new URLSearchParams({ grant_type: 'client_credentials' }),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[Server] Token fetch failed:', err);
            return null;
        }

        const data = await response.json();
        cachedClientToken = data.access_token;
        clientTokenExpiresAt = Date.now() + (data.expires_in * 1000) - 60000; // Buffer 1 min
        return cachedClientToken;
    } catch (e) {
        console.error('[Server] Client Credentials Error:', e);
        return null;
    }
}


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

    room.onStageAdvance = (payload) => {
        io.to(roomCode).emit(Events.STAGE_ADVANCE, payload);
    };

    room.onOpponentCorrect = (targetId, payload) => {
        io.to(targetId).emit(Events.OPPONENT_CORRECT, payload);
    };
}

const PORT = 3011;
httpServer.listen(PORT, () => {
    console.log(`\n  🎮 Intro Game Server running on http://localhost:${PORT}\n`);
});
