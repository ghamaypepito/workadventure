import fs from "fs";
import process from "process";
import * as Sentry from "@sentry/node";
import { Server, ServerCredentials } from "@grpc/grpc-js";
import { RoomApiService } from "@workadventure/messages/src/ts-proto-generated/room-api";
import { setErrorHandler } from "@workadventure/shared-utils";
import app from "./pusher/app";
import {
    PUSHER_HTTP_PORT,
    ADMIN_API_URL,
    ROOM_API_BIND_HOST,
    ROOM_API_PORT,
    ROOM_API_SECRET_KEY,
    SENTRY_DSN,
    SENTRY_RELEASE,
    SENTRY_TRACES_SAMPLE_RATE,
    SENTRY_ENVIRONMENT,
    PUSHER_WS_PORT,
} from "./pusher/enums/EnvironmentVariable";
import RoomApiServer from "./room-api/RoomApiServer";
import { startPathProxy } from "./pusher/pathProxy";

// In production, the current working directory is "dist".
if (fs.existsSync("dist") && !fs.existsSync("src")) {
    process.chdir("dist");
}

// Sentry integration
if (SENTRY_DSN != undefined) {
    try {
        const sentryOptions: Sentry.NodeOptions = {
            dsn: SENTRY_DSN,
            release: SENTRY_RELEASE,
            environment: SENTRY_ENVIRONMENT,
            tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
            attachStacktrace: true,
        };

        Sentry.init(sentryOptions);

        setErrorHandler((error: Error) => {
            console.error(error);
            Sentry.captureException(error);
        });

        console.info("Sentry initialized");
    } catch (e) {
        console.error("Error while initializing Sentry", e);
    }
}

(async () => {
    await app.init();

    await Promise.race([
        app
            .listenWebServer(PUSHER_HTTP_PORT)
            .then(() => console.info(`WorkAdventure Pusher web-server started on port ${PUSHER_HTTP_PORT}!`)),
        app
            .listenWebSocket(PUSHER_WS_PORT)
            .then(() => console.info(`WorkAdventure Pusher web-socket server started on port ${PUSHER_WS_PORT}!`)),
        app.listenPrometheusPort(),
    ]);

    // Single-port PaaS providers (e.g. Railway) can only proxy one public port per service, but the
    // HTTP server and the WebSocket game server listen on two different ports internally (see
    // docker-compose.single-domain.yaml, which normally splits these via a Traefik "/ws/" path rule).
    // PUBLIC_PORT lets us recreate that split with an in-process proxy when there's no such reverse
    // proxy in front of us.
    const publicPort = process.env.PUBLIC_PORT ? parseInt(process.env.PUBLIC_PORT) : undefined;
    if (publicPort) {
        startPathProxy(publicPort, PUSHER_HTTP_PORT, PUSHER_WS_PORT);
    }
})().catch((e) => {
    console.error(e);
    Sentry.captureException(e);
});

// Room API
if (!ADMIN_API_URL && !ROOM_API_SECRET_KEY) {
    console.info("RoomAPI is disabled! ROOM_API_SECRET_KEY is not defined on environment variables.");
} else {
    const RoomAPI = new Server();

    RoomAPI.addService(RoomApiService, RoomApiServer);

    RoomAPI.bindAsync(`${ROOM_API_BIND_HOST}:${ROOM_API_PORT}`, ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
            throw err;
        }
        console.info(`RoomAPI starting on port ${ROOM_API_PORT}!`);
        RoomAPI.start();
    });
}
