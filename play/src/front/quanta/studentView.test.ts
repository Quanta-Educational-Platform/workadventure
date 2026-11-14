import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userIsAdminStore } from "../Stores/GameStore";
import { canViewAsStudentStore, moderationInView, setRoomAdmin, setStudentView, studentViewStore } from "./studentView";

vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_UI: true }));
vi.mock("./platformOrigin", () => ({ platformOrigin: () => undefined }));

afterEach(() => {
    setStudentView(false);
    setRoomAdmin(false);
});

describe("student view", () => {
    it("hides staff's own rights and brings them back", () => {
        setRoomAdmin(true);
        expect(get(userIsAdminStore)).toBe(true);
        setStudentView(true);
        expect(get(studentViewStore)).toBe(true);
        expect(get(userIsAdminStore)).toBe(false);
        expect(get(canViewAsStudentStore)).toBe(true);
        setStudentView(false);
        expect(get(userIsAdminStore)).toBe(true);
    });
    it("gives a student nothing", () => {
        setRoomAdmin(false);
        expect(get(canViewAsStudentStore)).toBe(false);
        setStudentView(true);
        expect(get(studentViewStore)).toBe(false);
        expect(get(userIsAdminStore)).toBe(false);
    });
    it("stays on when the room reconnects", () => {
        setRoomAdmin(true);
        setStudentView(true);
        setRoomAdmin(true);
        expect(get(userIsAdminStore)).toBe(false);
    });
    it("offers moderation only outside it", () => {
        expect(moderationInView(true, false)).toBe(true);
        expect(moderationInView(true, true)).toBe(false);
        expect(moderationInView(false, false)).toBe(false);
    });
});
