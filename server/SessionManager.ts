import { customAlphabet } from 'nanoid';
import { GameRoom } from './GameRoom';

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

export class SessionManager {
    private rooms = new Map<string, GameRoom>();

    createSession(): string {
        let code: string;
        do {
            code = generateCode();
        } while (this.rooms.has(code));

        const room = new GameRoom(code);
        this.rooms.set(code, room);
        console.log(`[Session] Created room ${code}`);
        return code;
    }

    getRoom(code: string): GameRoom | undefined {
        return this.rooms.get(code.toUpperCase());
    }

    deleteRoom(code: string): void {
        this.rooms.delete(code);
        console.log(`[Session] Deleted room ${code}`);
    }

    /** Clean up rooms where both players disconnected */
    cleanup(): void {
        for (const [code, room] of this.rooms) {
            if (room.isEmpty()) {
                this.rooms.delete(code);
                console.log(`[Session] Cleaned up empty room ${code}`);
            }
        }
    }
}
