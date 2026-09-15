interface RoomOperations {
    owner: symbol;
    leases: Set<symbol>;
    pending: Promise<void>;
}

/** Serializes room API calls across retiring and replacement strategies in this backend process. */
export class LivekitRoomLease {
    private static readonly rooms = new Map<string, RoomOperations>();
    private readonly owner = Symbol("Livekit room owner");
    private readonly operations: RoomOperations;
    private released = false;

    constructor(private readonly key: string) {
        const existing = LivekitRoomLease.rooms.get(key);
        this.operations = existing ?? { owner: this.owner, leases: new Set(), pending: Promise.resolve() };
        this.operations.owner = this.owner;
        this.operations.leases.add(this.owner);
        LivekitRoomLease.rooms.set(key, this.operations);
    }

    get isCurrent(): boolean {
        return !this.released && this.operations.owner === this.owner;
    }

    run(operation: () => Promise<void>): Promise<void> {
        return this.enqueue(async () => {
            if (this.isCurrent) await operation();
        });
    }

    release(cleanup: () => Promise<void>): Promise<void> {
        if (this.released) return Promise.resolve();
        this.released = true;
        return this.enqueue(async () => {
            try {
                if (this.operations.owner === this.owner) await cleanup();
            } finally {
                this.operations.leases.delete(this.owner);
                if (this.operations.leases.size === 0 && LivekitRoomLease.rooms.get(this.key) === this.operations) {
                    LivekitRoomLease.rooms.delete(this.key);
                }
            }
        });
    }

    private enqueue(operation: () => Promise<void>): Promise<void> {
        const next = this.operations.pending.then(operation);
        // A failed API call must not poison subsequent cleanup or creation.
        this.operations.pending = next.catch(() => {});
        return next;
    }
}
