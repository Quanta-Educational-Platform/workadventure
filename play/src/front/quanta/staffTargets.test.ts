import { afterEach, expect, it, vi } from "vitest";

vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_UI: true }));

import { mayBlockOrReport, setRoomStaff } from "./staffTargets";

afterEach(() => setRoomStaff([]));

it("never offers to block or report a teacher in a Quanta classroom", () => {
    expect(mayBlockOrReport({ uuid: "t", tags: ["member", "admin"] })).toBe(false);
    expect(mayBlockOrReport({ uuid: "t", isAdmin: true })).toBe(false);
});

it("knows the teachers from the room's people when the target's tags are not at hand (an avatar on the map)", () => {
    setRoomStaff([
        { id: "teacher", staff: true },
        { id: "student", staff: false },
    ]);
    expect(mayBlockOrReport({ uuid: "teacher" })).toBe(false);
    expect(mayBlockOrReport({ uuid: "student" })).toBe(true);
});

it("keeps classmates blockable, and changes nothing outside Quanta", () => {
    expect(mayBlockOrReport({ uuid: "s", tags: ["member"] })).toBe(true);
    expect(mayBlockOrReport({ uuid: "t", tags: ["admin"] }, false)).toBe(true);
});
