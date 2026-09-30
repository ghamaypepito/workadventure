import { describe, expect, it } from "vitest";
import { selectSocialSignalTargets } from "../src/Services/SocialSignalTarget";
describe("personal wave routing", () => {
    const users = [
        { id: 1, uuid: "shared" },
        { id: 2, uuid: "shared" },
    ];
    it("delivers only to the selected session even with overlapping identities", () => {
        expect(selectSocialSignalTargets(users, "shared", 2)).toEqual([users[1]]);
    });
    it("does not broadcast an ambiguous identity-only request", () => {
        expect(selectSocialSignalTargets(users, "shared")).toEqual([]);
    });
    it("does not fall back to another session when the target has left", () => {
        expect(selectSocialSignalTargets(users, "shared", 3)).toEqual([]);
    });
    it("rejects anonymous broadcasts and mismatched identities", () => {
        expect(selectSocialSignalTargets([{ id: 1, uuid: "" }], "")).toEqual([]);
        expect(selectSocialSignalTargets(users, "someone-else", 1)).toEqual([]);
    });
    it("supports a unique identity for the people-list action", () => {
        expect(selectSocialSignalTargets([users[0]], "shared")).toEqual([users[0]]);
    });
});
