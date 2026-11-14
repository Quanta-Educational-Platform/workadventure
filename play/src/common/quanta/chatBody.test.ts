import { describe, expect, it } from "vitest";
import { chatBodyFromInput, chatInputFromBody, isBlankChatBody } from "./chatBody";
import { RoomSession } from "./RoomSession";

describe("isBlankChatBody", () => {
    it.each(["", "   ", "&nbsp; &nbsp;", "&nbsp;&nbsp;", "<br><br>", "<div><br></div>", "\n", "\u200b", "&#160;"])(
        "treats %j as blank",
        (body) => expect(isBlankChatBody(body)).toBe(true),
    );

    it.each(["+", "1.", "#", "---", "👍", "&amp;", "a<br>b", "<b>x</b>"])("keeps %j", (body) =>
        expect(isBlankChatBody(body)).toBe(false),
    );
});

describe("chatBodyFromInput", () => {
    it("turns line breaks into newlines and drops the blank edges", () => {
        expect(chatBodyFromInput("&nbsp;чути<br>видно<br><br>")).toBe("чути\nвидно");
        expect(chatBodyFromInput("a&nbsp; b")).toBe("a&nbsp; b");
    });
});

describe("RoomSession.send", () => {
    const person = { id: "u1", name: "Student", staff: false };

    it("refuses bodies that only hold spaces or line breaks", () => {
        const session = new RoomSession();
        expect(() => session.send(person, "&nbsp; &nbsp;")).toThrow();
        expect(() => session.send(person, "<br><br>")).toThrow();
        session.send(person, "+");
        expect(session.messages.map((message) => message.body)).toEqual(["+"]);
    });
});

describe("chatInputFromBody", () => {
    it.each(["2+2=5", "a\nb", "x &lt; y", "line\n\nafter a blank"])("puts %j back in the box as typed", (body) =>
        expect(chatBodyFromInput(chatInputFromBody(body))).toBe(body),
    );
});
