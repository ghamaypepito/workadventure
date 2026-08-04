import { randomUUID } from "crypto";
import * as Sentry from "@sentry/node";
import type { RedisClient } from "./RedisClient";
import { getRedisClient } from "./RedisClient";

const SESSION_TTL_SECONDS = 120;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SESSION_KEY_PREFIX = "workadventure:office-session:";
const REPLACEMENT_CHANNEL = "workadventure:office-session:replaced";

type SessionRecord = {
    sessionId: string;
    instanceId: string;
    userUuid: string;
    tabId?: string;
};

type LocalSession = {
    record: SessionRecord;
    disconnect: (notifyBrowser: boolean) => void;
};

type ReplacementMessage = { record: SessionRecord; notifyBrowser: boolean };

export type ActiveSessionRegistration = {
    duplicate: boolean;
};

/**
 * Owns the single authenticated session for an office account. Redis coordinates Railway
 * instances; the local maps provide the same semantics for development/single-process installs.
 */
export class ActiveSessionCoordinator {
    private readonly instanceId = randomUUID();
    private readonly localSessions = new Map<string, LocalSession>();
    private readonly localOwners = new Map<string, string>();
    private redisClient: RedisClient | null = null;
    private redisSubscriber: ReturnType<RedisClient["duplicate"]> | null = null;
    private initializationPromise: Promise<void> | undefined;

    constructor() {
        const heartbeat = setInterval(() => {
            this.refreshOwnedSessions().catch((error) => {
                console.error("Failed to refresh active office sessions", error);
                Sentry.captureException(error);
            });
        }, HEARTBEAT_INTERVAL_MS);
        heartbeat.unref();
    }

    async register(options: {
        sessionId: string;
        userUuid: string;
        tabId?: string;
        disconnect: (notifyBrowser: boolean) => void;
    }): Promise<ActiveSessionRegistration> {
        await this.initialize();
        const record: SessionRecord = {
            sessionId: options.sessionId,
            instanceId: this.instanceId,
            userUuid: options.userUuid,
            tabId: options.tabId,
        };
        this.localSessions.set(record.sessionId, { record, disconnect: options.disconnect });

        if (!this.redisClient) {
            const activeSessionId = this.localOwners.get(record.userUuid);
            if (!activeSessionId) {
                this.localOwners.set(record.userUuid, record.sessionId);
                this.logTransfer("registered", record);
                return { duplicate: false };
            }
            const active = this.localSessions.get(activeSessionId);
            if (record.tabId && active?.record.tabId === record.tabId) {
                this.localOwners.set(record.userUuid, record.sessionId);
                this.disconnectLocalSession(active.record.sessionId, false);
                this.logTransfer("same-tab-replaced", record, active.record);
                return { duplicate: false };
            }
            this.logTransfer("duplicate-detected", record, active?.record);
            return { duplicate: true };
        }

        const key = this.getSessionKey(record.userUuid);
        const serialized = JSON.stringify(record);
        const result = await this.redisClient.set(key, serialized, { NX: true, EX: SESSION_TTL_SECONDS });
        if (result === "OK") {
            this.logTransfer("registered", record);
            return { duplicate: false };
        }

        const current = this.parseRecord(await this.redisClient.get(key));
        if (record.tabId && current?.tabId === record.tabId) {
            await this.takeOver(record.sessionId, false);
            return { duplicate: false };
        }
        this.logTransfer("duplicate-detected", record, current);
        return { duplicate: true };
    }

    async takeOver(sessionId: string, notifyReplacedBrowser = true): Promise<boolean> {
        await this.initialize();
        const localSession = this.localSessions.get(sessionId);
        if (!localSession) return false;

        if (!this.redisClient) {
            const previousSessionId = this.localOwners.get(localSession.record.userUuid);
            const previousRecord = previousSessionId ? this.localSessions.get(previousSessionId)?.record : undefined;
            this.localOwners.set(localSession.record.userUuid, sessionId);
            if (previousSessionId && previousSessionId !== sessionId) {
                this.disconnectLocalSession(previousSessionId, notifyReplacedBrowser);
            }
            this.logTransfer("ownership-transferred", localSession.record, previousRecord);
            return true;
        }

        const serialized = JSON.stringify(localSession.record);
        const previous = (await this.redisClient.eval(
            "local old = redis.call('GET', KEYS[1]); redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]); return old",
            {
                keys: [this.getSessionKey(localSession.record.userUuid)],
                arguments: [serialized, String(SESSION_TTL_SECONDS)],
            },
        )) as string | null;
        const previousRecord = this.parseRecord(previous);
        if (previousRecord && previousRecord.sessionId !== sessionId) {
            const replacement: ReplacementMessage = { record: previousRecord, notifyBrowser: notifyReplacedBrowser };
            await this.redisClient.publish(REPLACEMENT_CHANNEL, JSON.stringify(replacement));
            if (previousRecord.instanceId === this.instanceId) {
                this.disconnectLocalSession(previousRecord.sessionId, notifyReplacedBrowser);
            }
        }
        this.logTransfer("ownership-transferred", localSession.record, previousRecord);
        return true;
    }

    async release(sessionId: string): Promise<void> {
        await this.initialize();
        const localSession = this.localSessions.get(sessionId);
        if (!localSession) return;
        this.localSessions.delete(sessionId);

        if (!this.redisClient) {
            if (this.localOwners.get(localSession.record.userUuid) === sessionId) {
                this.localOwners.delete(localSession.record.userUuid);
            }
            return;
        }

        await this.redisClient.eval(
            "local current = redis.call('GET', KEYS[1]); if current == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
            {
                keys: [this.getSessionKey(localSession.record.userUuid)],
                arguments: [JSON.stringify(localSession.record)],
            },
        );
    }

    private async initialize(): Promise<void> {
        if (this.initializationPromise) return this.initializationPromise;
        this.initializationPromise = (async () => {
            try {
                this.redisClient = await getRedisClient();
                if (!this.redisClient) return;
                this.redisSubscriber = this.redisClient.duplicate();
                await this.redisSubscriber.connect();
                await this.redisSubscriber.subscribe(REPLACEMENT_CHANNEL, (message) => {
                    const replacement = this.parseReplacementMessage(message);
                    if (replacement?.record.instanceId === this.instanceId) {
                        this.disconnectLocalSession(replacement.record.sessionId, replacement.notifyBrowser);
                    }
                });
            } catch (error) {
                this.redisClient = null;
                this.redisSubscriber = null;
                console.error("Redis session coordination unavailable; using single-process session ownership", error);
                Sentry.captureException(error);
            }
        })();
        return this.initializationPromise;
    }

    private disconnectLocalSession(sessionId: string, notifyBrowser: boolean): void {
        const session = this.localSessions.get(sessionId);
        if (!session) return;
        this.localSessions.delete(sessionId);
        session.disconnect(notifyBrowser);
    }

    private async refreshOwnedSessions(): Promise<void> {
        await this.initialize();
        if (!this.redisClient) return;
        await Promise.all(
            Array.from(this.localSessions.values()).map(({ record }) =>
                this.redisClient!.eval(
                    "local current = redis.call('GET', KEYS[1]); if current == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end; return 0",
                    {
                        keys: [this.getSessionKey(record.userUuid)],
                        arguments: [JSON.stringify(record), String(SESSION_TTL_SECONDS)],
                    },
                ),
            ),
        );
    }

    private getSessionKey(userUuid: string): string {
        return `${SESSION_KEY_PREFIX}${userUuid}`;
    }

    private parseRecord(value: string | null): SessionRecord | undefined {
        if (!value) return undefined;
        try {
            return JSON.parse(value) as SessionRecord;
        } catch {
            return undefined;
        }
    }

    private parseReplacementMessage(value: string): ReplacementMessage | undefined {
        try {
            return JSON.parse(value) as ReplacementMessage;
        } catch {
            return undefined;
        }
    }

    private logTransfer(action: string, current: SessionRecord, previous?: SessionRecord): void {
        console.info("Active office session update", {
            action,
            userUuid: current.userUuid,
            sessionId: current.sessionId,
            instanceId: current.instanceId,
            previousSessionId: previous?.sessionId,
            previousInstanceId: previous?.instanceId,
        });
    }
}

export const activeSessionCoordinator = new ActiveSessionCoordinator();
