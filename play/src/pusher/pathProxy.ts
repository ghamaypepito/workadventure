import net from "net";

/**
 * Railway (and similar single-port PaaS providers) can only proxy one public port per service.
 * WorkAdventure's pusher process needs two: an Express HTTP server (PUSHER_HTTP_PORT) and a raw
 * uWebSockets server for the game protocol (PUSHER_WS_PORT), split by the "/ws/" path prefix
 * (see docker-compose.single-domain.yaml, which does the same split via Traefik).
 *
 * This lightweight TCP proxy recreates that split inside the container: it listens on the public
 * port and forwards each connection, based on whether its first line starts with "GET /ws/", to
 * the internal HTTP or WS port.
 */
export function startPathProxy(publicPort: number, httpPort: number, wsPort: number): void {
    const server = net.createServer((clientSocket) => {
        clientSocket.once("data", (firstChunk: Buffer) => {
            const requestLine = firstChunk.toString("utf-8", 0, Math.min(firstChunk.length, 2048));
            const isWebsocket = /^[A-Z]+ \/ws\//.test(requestLine);
            const targetPort = isWebsocket ? wsPort : httpPort;

            const upstreamSocket = net.createConnection({ host: "127.0.0.1", port: targetPort }, () => {
                upstreamSocket.write(firstChunk);
                clientSocket.pipe(upstreamSocket);
                upstreamSocket.pipe(clientSocket);
            });

            upstreamSocket.on("error", () => clientSocket.destroy());
            clientSocket.on("error", () => upstreamSocket.destroy());
        });

        clientSocket.on("error", () => clientSocket.destroy());
    });

    server.listen(publicPort, () => {
        console.info(
            `Path-based proxy started on port ${publicPort} (HTTP -> ${httpPort}, "/ws/*" -> ${wsPort})`,
        );
    });
}
