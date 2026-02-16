// ─── Socket.IO Client Service ───
// Singleton wrapper managing connection to the game server.

import { io, Socket } from 'socket.io-client';
import { Events } from '../../shared/events';

const SERVER_URL = import.meta.env.PROD ? undefined : 'http://127.0.0.1:3011';

let socket: Socket | null = null;

export function getSocket(): Socket {
    if (!socket) {
        socket = io(SERVER_URL, {
            autoConnect: false,
            transports: ['websocket', 'polling'],
        });
    }
    return socket;
}

export function connectSocket(): Socket {
    const s = getSocket();
    if (!s.connected) {
        s.connect();
    }
    return s;
}

export function disconnectSocket(): void {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}

export function emit(event: string, payload?: any): void {
    const s = getSocket();
    if (s.connected) {
        s.emit(event, payload);
    } else {
        console.warn('[Socket] Not connected, cannot emit', event);
    }
}

export { Events };
