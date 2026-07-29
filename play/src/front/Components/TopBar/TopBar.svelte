<script lang="ts">
    import MeetingViewToggle from "../ActionBar/MeetingViewToggle.svelte";
    import { currentZoneNameStore } from "../../Stores/CurrentZoneStore";
    import { IconChevronDown } from "@wa-icons";

    interface SessionUser {
        name?: string;
        email?: string;
        isAdmin?: boolean;
    }

    interface Props {
        /**
         * Horizontal offsets that clear the chat sidebar (left) and map editor panel/toolbar (right).
         * Passed in from MainLayout.svelte, which already computes these to apply as padding on its
         * own root - reused here rather than duplicated, so the two can't drift out of sync. This bar
         * is absolutely positioned, so `inset-x-0` would resolve against the padding box edges and
         * ignore that padding entirely; these are applied as explicit inline insets instead.
         */
        marginLeft?: number;
        marginRight?: number;
    }

    let { marginLeft = 0, marginRight = 0 }: Props = $props();

    function getCookie(name: string): string | null {
        const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
        if (!match) return null;
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return null;
        }
    }

    function getSessionUser(): SessionUser | null {
        const raw = getCookie("wa_user");
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    const sessionUser = getSessionUser();

    let showAccountMenu = $state(false);

    function toggleAccountMenu() {
        showAccountMenu = !showAccountMenu;
    }

    function closeAccountMenu() {
        showAccountMenu = false;
    }
</script>

<svelte:window onclick={closeAccountMenu} />

<div
    class="absolute top-0 z-[1000] h-12 bg-[#1c2a41] flex items-center px-4 gap-4 text-white pointer-events-auto"
    style="inset-inline-start: {marginLeft}px; inset-inline-end: {marginRight}px;"
>
    <div class="flex-1 min-w-0 flex items-center">
        {#if $currentZoneNameStore}
            <span class="text-sm truncate opacity-80">{$currentZoneNameStore}</span>
        {/if}
    </div>

    <div>
        <MeetingViewToggle />
    </div>

    <div class="relative">
        {#if sessionUser}
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 transition-all"
                onclick={(event) => {
                    event.stopPropagation();
                    toggleAccountMenu();
                }}
            >
                {sessionUser.name ?? sessionUser.email ?? "Account"}
                <IconChevronDown font-size="14" />
            </button>
            {#if showAccountMenu}
                <div
                    class="absolute right-0 top-full mt-1 min-w-[160px] rounded-lg bg-contrast/80 backdrop-blur-md p-1 shadow-lg"
                    onclick={(event) => event.stopPropagation()}
                >
                    {#if sessionUser.isAdmin}
                        <a
                            href="/admin/"
                            class="block rounded-md px-3 py-2 text-sm text-white hover:bg-white/10 no-underline"
                        >
                            Admin dashboard
                        </a>
                    {/if}
                    <a
                        href="/api/auth/logout"
                        class="block rounded-md px-3 py-2 text-sm text-white hover:bg-white/10 no-underline"
                    >
                        Sign out
                    </a>
                </div>
            {/if}
        {:else}
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-[#0f172a] hover:bg-emerald-400 transition-all"
                onclick={(event) => {
                    event.stopPropagation();
                    toggleAccountMenu();
                }}
            >
                Sign in
                <IconChevronDown font-size="14" />
            </button>
            {#if showAccountMenu}
                <div
                    class="absolute right-0 top-full mt-1 min-w-[180px] rounded-lg bg-contrast/80 backdrop-blur-md p-1 shadow-lg"
                    onclick={(event) => event.stopPropagation()}
                >
                    <a
                        href="/api/auth/google"
                        class="block rounded-md px-3 py-2 text-sm text-white hover:bg-white/10 no-underline"
                    >
                        Sign in with Google
                    </a>
                    <a
                        href="/api/auth/microsoft"
                        class="block rounded-md px-3 py-2 text-sm text-white hover:bg-white/10 no-underline"
                    >
                        Sign in with Microsoft
                    </a>
                </div>
            {/if}
        {/if}
    </div>
</div>
