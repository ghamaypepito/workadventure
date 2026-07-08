const net = require('net');

function encodeCommand(args) {
    let out = `*${args.length}\r\n`;
    for (const arg of args) {
        const s = String(arg);
        out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
    }
    return out;
}

// Minimal RESP2 reply parser. Handles simple strings, errors, integers, bulk strings, and arrays.
function parseReplies(buffer, count) {
    const replies = [];
    let offset = 0;

    function readLine() {
        const idx = buffer.indexOf('\r\n', offset);
        if (idx === -1) return null;
        const line = buffer.slice(offset, idx);
        offset = idx + 2;
        return line;
    }

    function parseOne() {
        const type = buffer[offset];
        if (type === undefined) return undefined;
        offset += 1;
        if (type === '+' || type === '-' || type === ':') {
            const line = readLine();
            if (line === null) return undefined;
            return type === '-' ? new Error(line) : line;
        }
        if (type === '$') {
            const line = readLine();
            if (line === null) return undefined;
            const len = parseInt(line, 10);
            if (len === -1) return null;
            if (buffer.length < offset + len + 2) return undefined;
            const str = buffer.slice(offset, offset + len);
            offset += len + 2;
            return str;
        }
        if (type === '*') {
            const line = readLine();
            if (line === null) return undefined;
            const len = parseInt(line, 10);
            if (len === -1) return null;
            const arr = [];
            for (let i = 0; i < len; i++) {
                const val = parseOne();
                if (val === undefined) return undefined;
                arr.push(val);
            }
            return arr;
        }
        return undefined;
    }

    for (let i = 0; i < count; i++) {
        const before = offset;
        const val = parseOne();
        if (val === undefined) {
            offset = before;
            return { replies, consumed: offset, complete: false };
        }
        replies.push(val);
    }
    return { replies, consumed: offset, complete: true };
}

class RedisClient {
    constructor(url) {
        const parsed = new URL(url);
        this.host = parsed.hostname;
        this.port = Number(parsed.port);
        this.password = parsed.password || undefined;
        this.socket = null;
        this.buffer = '';
        this.queue = [];
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection({ host: this.host, port: this.port }, async () => {
                try {
                    if (this.password) {
                        await this._rawCommand(['AUTH', this.password]);
                    }
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
            this.socket.on('error', reject);
            this.socket.on('data', (chunk) => this._onData(chunk));
        });
    }

    _onData(chunk) {
        this.buffer += chunk.toString('binary');
        while (this.queue.length > 0) {
            const { resolve, reject } = this.queue[0];
            const { replies, consumed, complete } = parseReplies(this.buffer, 1);
            if (!complete) break;
            this.buffer = this.buffer.slice(consumed);
            this.queue.shift();
            const reply = replies[0];
            if (reply instanceof Error) reject(reply);
            else resolve(reply);
        }
    }

    _rawCommand(args) {
        return new Promise((resolve, reject) => {
            this.queue.push({ resolve, reject });
            this.socket.write(encodeCommand(args), 'binary');
        });
    }

    async command(...args) {
        return this._rawCommand(args);
    }

    quit() {
        if (this.socket) this.socket.end();
    }
}

async function withRedis(url, fn) {
    const client = new RedisClient(url);
    await client.connect();
    try {
        return await fn(client);
    } finally {
        client.quit();
    }
}

module.exports = { RedisClient, withRedis };
