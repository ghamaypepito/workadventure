const crypto = require("crypto");
const { verifySession, parseCookies } = require("./_lib/session");
const { requireAdmin } = require("./_lib/requireAdmin");
const { requireUser } = require("./_lib/requireUser");
const { withRedis } = require("./_lib/redis");
const { REDIS_URL } = require("./_lib/admin");
const { listKnownMembers } = require("./_lib/presence");
const { KEY, TTL, transition, update } = require("./_lib/guestVisits");
const digest = (token) =>
  crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const send = (code, data) => {
    res.statusCode = code;
    res.end(JSON.stringify(data));
  };
  if (req.method !== "POST") return send(405, { error: "POST required" });
  if (
    req.headers["sec-fetch-site"] === "cross-site" ||
    (req.headers.origin &&
      req.headers.origin !== `https://${req.headers.host}` &&
      req.headers.origin !== `http://${req.headers.host}`)
  )
    return send(403, { error: "Origin not allowed" });
  if (!String(req.headers["content-type"] || "").startsWith("application/json"))
    return send(415, { error: "JSON required" });
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) return send(413, { error: "Request too large" });
    }
    const body = JSON.parse(raw || "{}");
    const action = body.action;
    let actor;
    if (["list", "remove"].includes(action)) {
      actor = await requireAdmin(req, res);
      if (!actor) return;
    }
    if (["pending", "approve", "decline"].includes(action)) {
      actor = await requireUser(req, res);
      if (!actor) return;
    }
    if (action === "access") {
      if (
        !process.env.GUEST_ADMISSION_ROOM ||
        new URL(body.room).origin !==
          new URL(process.env.GUEST_ADMISSION_ROOM).origin
      )
        return send(200, { enabled: false });
      const session = verifySession(parseCookies(req).wa_session);
      if (!session || !session.email)
        return send(200, { enabled: true, member: false });
      const member = await requireUser(req, res);
      if (!member) return;
      if (!member.sessionId)
        return send(401, { error: "Please sign in again" });
      const id = crypto.randomBytes(16).toString("hex"),
        token = crypto.randomBytes(32).toString("hex");
      await withRedis(REDIS_URL, (client) =>
        client.command(
          "HSET",
          KEY,
          id,
          JSON.stringify({
            kind: "member",
            email: member.email,
            sessionId: member.sessionId,
            tokenHash: digest(token),
            status: "approved",
            expiresAt: Math.min(
              member.exp || Date.now() + 86400000,
              Date.now() + 86400000,
            ),
            seenAt: Date.now(),
          }),
        ),
      );
      return send(200, { enabled: true, member: true, pass: `${id}.${token}` });
    }
    if (action === "members") {
      const members = await listKnownMembers();
      return send(200, {
        members: members
          .filter((m) => m.online)
          .map((m) => ({ email: m.email, name: m.name, avatar: m.avatar })),
      });
    }
    if (action === "begin") {
      const id = crypto.randomBytes(16).toString("hex");
      const token = crypto.randomBytes(32).toString("hex");
      await withRedis(REDIS_URL, async (client) => {
        const rateKey = `wa:guest-rate:${digest(req.headers["x-forwarded-for"] || "unknown")}`;
        const count = Number(await client.command("INCR", rateKey));
        if (count === 1) await client.command("EXPIRE", rateKey, "60");
        if (count > 30) throw new Error("Too many requests; wait one minute");
        await client.command(
          "HSET",
          KEY,
          id,
          JSON.stringify({
            name: String(body.name || "Guest").slice(0, 80),
            tokenHash: digest(token),
            status: "selecting",
            expiresAt: Date.now() + TTL,
            seenAt: Date.now(),
          }),
        );
      });
      return send(200, { id, token });
    }
    if (["list", "pending"].includes(action)) {
      const visits = await withRedis(REDIS_URL, async (client) => {
        const rows = await client.command("HGETALL", KEY);
        const result = [];
        for (let i = 0; i < rows.length; i += 2) {
          const visit = JSON.parse(rows[i + 1]);

          if (Date.now() - visit.seenAt > 24 * 60 * 60 * 1000) {
            await client.command(
              "EVAL",
              "if redis.call('HGET',KEYS[1],ARGV[1]) == ARGV[2] then return redis.call('HDEL',KEYS[1],ARGV[1]) else return 0 end",
              "1",
              KEY,
              rows[i],
              rows[i + 1],
            );
            continue;
          }
          if (visit.kind === "member") continue;
          // Stale visits are hidden, never interpreted as online.
          if (Date.now() - visit.seenAt > 45000) continue;
          if (
            action === "list"
              ? visit.status !== "approved"
              : visit.status !== "pending" ||
                visit.target !== actor.email.toLowerCase() ||
                visit.expiresAt <= Date.now()
          )
            continue;
          result.push({
            id: rows[i],
            name: visit.name,
            message: visit.message,
            target: visit.target,
            status: visit.status,
          });
        }
        return result;
      });
      return send(200, { visits });
    }
    if (!/^[a-f0-9]{32}$/.test(body.id || ""))
      return send(400, { error: "Invalid visit" });
    if (!["request", "status", "approve", "decline", "remove"].includes(action))
      return send(400, { error: "Unknown action" });
    if (action === "request") {
      const members = await listKnownMembers();
      if (
        !members.some(
          (m) => m.online && m.email === String(body.target).toLowerCase(),
        )
      )
        return send(409, {
          error: "That person is no longer online. Choose someone else.",
        });
    }
    const visit = await withRedis(REDIS_URL, (client) =>
      update(client, body.id, (visit) => {
        if (["request", "status"].includes(action)) {
          if (visit.tokenHash !== digest(body.token))
            throw new Error("Invalid visit token");
          if (action === "request") {
            if (visit.status !== "selecting" || visit.expiresAt <= Date.now())
              throw new Error("Start a new entry request");
            return {
              ...visit,
              target: String(body.target).toLowerCase(),
              message: String(body.message || "").slice(0, 500),
              status: "pending",
              seenAt: Date.now(),
            };
          }
          return {
            ...visit,
            seenAt: Date.now(),
            status:
              ["selecting", "pending"].includes(visit.status) &&
              visit.expiresAt <= Date.now()
                ? "expired"
                : visit.status,
          };
        }
        if (visit.kind === "member")
          throw new Error("Only guest visits can be removed");
        return transition(visit, action, actor.email);
      }),
    );
    return send(200, { status: visit.status });
  } catch (error) {
    return send(400, { error: error.message });
  }
};
