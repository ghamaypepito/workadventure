import type { Room } from "../Connection/Room";
import { localUserStore } from "../Connection/LocalUserStore";

export enum GameConnexionTypes {
    room = 1,
    register /*@deprecated*/,
    empty,
    unknown,
    jwt /*@deprecated*/,
    login,
}

/**
 * The room every vanity invitation slug (e.g. "/john", "/maria") silently resolves to.
 */
const VANITY_SLUG_ROOM_TARGET = "/~/vings-test/map.wam";

/**
 * Reserved single-segment paths that must never be treated as a vanity sales-invite slug.
 */
const RESERVED_TOP_LEVEL_SLUGS = new Set(["login", "jwt", "register", "api"]);

/**
 * A vanity invitation link is any single path segment (e.g. "/john") that isn't one of the
 * reserved routes above and doesn't already look like a real room path (containing an
 * underscore-slash, star-slash, at-slash, or tilde-slash marker).
 * It silently resolves to VANITY_SLUG_ROOM_TARGET without ever showing that real path in the
 * address bar - so sales can hand out "office.connectiumai.com/<their-name>" links freely,
 * without needing a code change per person.
 */
function isVanitySlug(pathname: string): boolean {
    if (pathname.includes("_/") || pathname.includes("*/") || pathname.includes("@/") || pathname.includes("~/")) {
        return false;
    }
    const match = /^\/([a-zA-Z0-9_-]+)$/.exec(pathname);
    if (!match) {
        return false;
    }
    return !RESERVED_TOP_LEVEL_SLUGS.has(match[1].toLowerCase());
}

const VANITY_SLUG_STORAGE_KEY = "vanityInvitationSlug";

//this class is responsible with analysing and editing the game's url
class UrlManager {
    /**
     * If pathname is a vanity invitation slug, returns the real room path it stands for.
     * Otherwise returns pathname unchanged. Never touches window.location, so the address bar
     * keeps showing the vanity slug for the whole session.
     */
    public resolveRoomPath(pathname: string): string {
        return isVanitySlug(pathname) ? VANITY_SLUG_ROOM_TARGET : pathname;
    }

    /**
     * Call before any full-page navigation away from the app (e.g. the OpenID/SSO redirect,
     * which necessarily leaves the site and comes back via a server-built URL that only knows
     * the real room path). Persists the vanity slug currently shown in the address bar - if
     * there is one - in localStorage, since it wouldn't otherwise survive the round trip.
     */
    public rememberVanitySlugBeforeNavigatingAway(): void {
        const pathname = window.location.pathname;
        if (isVanitySlug(pathname)) {
            localStorage.setItem(VANITY_SLUG_STORAGE_KEY, pathname);
        }
    }

    /**
     * Call once the app has a room loaded (whether or not a full-page redirect happened in
     * between). If a vanity slug was remembered, puts it back in the address bar - without a
     * page reload - and forgets it, so it only ever gets applied once.
     */
    public restoreVanitySlugIfRemembered(): void {
        const slug = localStorage.getItem(VANITY_SLUG_STORAGE_KEY);
        if (slug === null) {
            return;
        }
        localStorage.removeItem(VANITY_SLUG_STORAGE_KEY);
        if (window.location.pathname !== slug) {
            history.replaceState(null, "", slug);
        }
    }

    public getGameConnexionType(): GameConnexionTypes {
        const url = window.location.pathname.toString();
        if (url === "/login") {
            return GameConnexionTypes.login;
        }
        //@deprecated jwt url will be replace by "?token=<private access token>"
        else if (url === "/jwt") {
            return GameConnexionTypes.jwt;
        } else if (
            url.includes("_/") ||
            url.includes("*/") ||
            url.includes("@/") ||
            url.includes("~/") ||
            isVanitySlug(url)
        ) {
            return GameConnexionTypes.room;
        }
        //@deprecated register url will be replaced by "?token=<private access token>"
        else if (url.includes("register/")) {
            return GameConnexionTypes.register;
        } else if (url === "/") {
            return GameConnexionTypes.empty;
        } else {
            return GameConnexionTypes.unknown;
        }
    }

    /**
     * @deprecated
     */
    public getOrganizationToken(): string | null {
        const match = /\/register\/(.+)/.exec(window.location.pathname.toString());
        return match ? match[1] : null;
    }

    public pushRoomIdToUrl(room: Room): void {
        if (window.location.pathname === room.id) return;
        //Set last room visited! (connected or nor, must to be saved in local storage and cache API)
        //use href to keep # value
        localUserStore.setLastRoomUrl(room.href).catch((e) => console.error(e));
        const hash = window.location.hash;
        const search = room.search.toString();
        history.pushState({}, "WorkAdventure", room.id + (search ? "?" + search : "") + hash);
    }

    public getStartPositionNameFromUrl(): string | undefined {
        const parameters = this.getHashParameters();
        for (const key in parameters) {
            if (parameters[key] === undefined) {
                return key;
            }
        }
        return undefined;
    }

    public getHashParameter(name: string): string | undefined {
        return this.getHashParameters()[name];
    }

    public clearHashParameter(): void {
        window.location.hash = "";
        history.pushState("", document.title, window.location.pathname + window.location.search);
    }

    public getHashParameters(): Record<string, string> {
        return window.location.hash
            .substring(1)
            .split("&")
            .reduce((res: Record<string, string>, item: string) => {
                const parts = item.split("=");
                res[parts[0]] = parts[1];
                return res;
            }, {});
    }

    pushStartLayerNameToUrl(startLayerName: string): void {
        if (startLayerName) {
            window.location.hash = startLayerName;
        } else {
            // Remove the hash
            history.pushState("", document.title, window.location.pathname + window.location.search);
        }
    }
}

export const urlManager = new UrlManager();
