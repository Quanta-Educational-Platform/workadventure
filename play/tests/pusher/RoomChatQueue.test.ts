import { afterEach, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { SubMessage } from "@workadventure/messages";
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { ROOM_CHAT_QUEUE_BYTES } from "../../src/pusher/quanta/roomModeration";
afterEach(() => vi.useRealTimers());
it("bounds batched plus retained chat bytes even while the transport drops every frame", () => {
    vi.useFakeTimers();
    const raw = mock<RawSocket>();
    raw.send.mockReturnValue(2);
    raw.getBufferedAmount.mockReturnValue(0);
    const socket = new PusherWebSocket(raw);
    const payload = SubMessage.fromPartial({
        message: {
            $case: "publicEvent",
            publicEvent: {
                spaceName: "quantaRoomChat",
                senderUserId: "quanta-server",
                spaceEvent: { event: { $case: "spaceMessage", spaceMessage: { message: "x".repeat(400000) } } },
            },
        },
    });
    let accepted = 0;
    for (let i = 0; i < 50; i++) {
        if (socket.emitInBatchBounded(payload, ROOM_CHAT_QUEUE_BYTES)) accepted++;
        if (i % 2 === 0) socket.flushBatch();
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted * SubMessage.encode(payload).finish().byteLength).toBeLessThanOrEqual(ROOM_CHAT_QUEUE_BYTES);
    expect(accepted).toBeLessThan(11);
    socket.end();
});
