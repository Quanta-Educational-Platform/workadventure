import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomSession, RoomSessions, ROOM_SESSION_TTL } from "../../play/src/common/quanta/RoomSession";
const student = { id: "student", name: "username", staff: false };
const other = { id: "other", name: "other", staff: false };
const teacher = { id: "teacher", name: "teacher", staff: true };
afterEach(() => vi.useRealTimers());
describe("classroom session", () => {
    it("replays ordered, bounded, server-attributed history without deleted messages", () => {
        vi.useFakeTimers();
        const session = new RoomSession();
        for (let i = 0; i < 120; i++) {
            session.send(student, String(i));
            vi.advanceTimersByTime(1);
        }
        expect(session.messages).toHaveLength(100);
        expect(session.messages[0]).toMatchObject({ body: "20", name: "username", sender: "student" });
        expect(session.messages[99].at).toBeGreaterThan(session.messages[0].at);
        session.delete(teacher, session.messages[0].id);
        expect(session.messages[0].body).toBe("21");
        expect(() => session.send(student, "x".repeat(4001))).toThrow();
    });
    it("rejects student moderation and deletion of others, permits own deletion and staff deletion", () => {
        const session = new RoomSession();
        session.send(student, "help");
        expect(() => session.delete(other, "1")).toThrow();
        for (const action of ["mute_chat", "unmute_chat", "mute_mic", "remove", "allow_back"]) {
            expect(() => session.moderate(student, action, other)).toThrow();
            expect(() => session.moderate(teacher, action, teacher)).toThrow();
        }
        session.delete(student, "1");
        expect(session.messages).toHaveLength(0);
    });
    it("blocks chat until unmuted and admission until allowed back", () => {
        const session = new RoomSession();
        session.moderate(teacher, "mute_chat", student);
        expect(() => session.send(student, "spam")).toThrow();
        session.moderate(teacher, "unmute_chat", student);
        session.send(student, "help");
        session.moderate(teacher, "remove", student);
        expect(session.removed.has(student.id)).toBe(true);
        expect(() => session.send(student, "spam")).toThrow();
        session.moderate(teacher, "allow_back", student);
        expect(session.removed.has(student.id)).toBe(false);
        expect(session.moderate(teacher, "mute_mic", student)).toBe("mute_mic");
    });
    it("keeps history across reconnects, clears mute on empty, expires after thirty empty minutes", () => {
        vi.useFakeTimers();
        const sessions = new RoomSessions();
        const member = {};
        sessions.join("room", member);
        const session = sessions.get("room");
        session.send(student, "help");
        session.moderate(teacher, "mute_chat", student);
        sessions.leave("room", member);
        expect(session.muted.size).toBe(0);
        vi.advanceTimersByTime(ROOM_SESSION_TTL - 1);
        sessions.join("room", member);
        expect(sessions.get("room").messages).toHaveLength(1);
        vi.advanceTimersByTime(ROOM_SESSION_TTL);
        expect(sessions.get("room")).toBe(session);
        session.moderate(teacher, "remove", student);
        sessions.leave("room", member);
        expect(sessions.get("room").removed.has(student.id)).toBe(true);
        vi.advanceTimersByTime(ROOM_SESSION_TTL);
        expect(sessions.get("room").removed.size).toBe(0);
        expect(sessions.get("room").messages).toHaveLength(0);
        expect(sessions.get("another").messages).toHaveLength(0);
    });
});
