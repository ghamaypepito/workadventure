const KEY = "wa:guest-visits:v1";
const TTL = 10 * 60 * 1000;
function transition(visit, action, actor, now = Date.now()) {
  if (action === "remove" && ["approved", "removed"].includes(visit.status)) {
    return { ...visit, status: "removed" };
  }
  if (
    !["approve", "decline"].includes(action) ||
    visit.status !== "pending" ||
    visit.expiresAt <= now ||
    visit.target !== actor.toLowerCase()
  ) {
    throw new Error(
      "Request is expired, already handled, or belongs to another host",
    );
  }
  return {
    ...visit,
    status: action === "approve" ? "approved" : "declined",
    expiresAt:
      action === "approve" ? now + 8 * 60 * 60 * 1000 : visit.expiresAt,
  };
}
// Compare-and-set prevents a concurrent heartbeat/approval from undoing removal.
async function update(client, id, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await client.command("HGET", KEY, id);
    if (!raw) throw new Error("Visit no longer exists");
    const next = change(JSON.parse(raw));
    const result = await client.command(
      "EVAL",
      "if redis.call('HGET',KEYS[1],ARGV[1]) == ARGV[2] then redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); return 1 else return 0 end",
      "1",
      KEY,
      id,
      raw,
      JSON.stringify(next),
    );
    if (String(result) === "1") return next;
  }
  throw new Error("Visit changed; please try again");
}
module.exports = { KEY, TTL, transition, update };
