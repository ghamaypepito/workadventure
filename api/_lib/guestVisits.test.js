const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transition } = require("./guestVisits");
const now = 1000000;
const pending = {
  status: "pending",
  target: "host@example.com",
  expiresAt: now + 1000,
};
test("only selected host can approve", () => {
  assert.throws(() => transition(pending, "approve", "other@example.com", now));
  assert.equal(
    transition(pending, "approve", "host@example.com", now).status,
    "approved",
  );
});
test("expired requests cannot enter", () =>
  assert.throws(() =>
    transition(pending, "approve", pending.target, now + 2000),
  ));
test("declined request cannot later be approved", () =>
  assert.throws(() =>
    transition(
      { ...pending, status: "declined" },
      "approve",
      pending.target,
      now,
    ),
  ));
test("removed visit cannot be approved again", () => {
  const removed = transition(
    { ...pending, status: "approved" },
    "remove",
    "admin",
    now,
  );
  assert.equal(removed.status, "removed");
  assert.throws(() => transition(removed, "approve", pending.target, now));
});
test("removal is idempotent and does not ban a new visit", () => {
  assert.equal(
    transition({ ...pending, status: "removed" }, "remove", "admin", now)
      .status,
    "removed",
  );
  assert.equal(
    transition(pending, "approve", pending.target, now).status,
    "approved",
  );
});
test("host may decline its own request", () =>
  assert.equal(
    transition(pending, "decline", pending.target, now).status,
    "declined",
  ));
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
async function runtime(states) {
  const calls = [];
  const timers = [];
  let index = 0;
  const html = fs.readFileSync(
    path.join(__dirname, "../../play/public/scripts/admission-script.html"),
    "utf8",
  );
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .join("\n");
  const context = {
    console,
    setTimeout: (fn) => timers.push(fn),
    sessionStorage: {
      setItem() {},
      removeItem() {
        calls.push("clear");
      },
    },
    fetch: async (url, opts) => ({
      ok: true,
      json: async () =>
        url.includes("session-status")
          ? { authenticated: false }
          : JSON.parse(opts.body).action === "access" ? {enabled:true} : JSON.parse(opts.body).action === "begin"
            ? { id: "visit", token: "secret" }
            : { status: states[index++] || "pending" },
    }),
    WA: {
      room: {id: "https://office.example/~/office/map.wam"},
      ui: { modal: { openModal() {}, closeModal: () => calls.push("close") } },
      onInit: () => Promise.resolve(),
      player: { name: "Test Guest" },
      controls: {
        disablePlayerControls: () => calls.push("lock"),
        restorePlayerControls: () => calls.push("unlock"),
      },
      nav: {
        openCoWebSite: async () => ({ close: async () => calls.push("close") }),
        goToPage: (url) => calls.push(url),
      },
    },
  };
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, timers };
}
test("pending guest stays locked until approval, then removal ends visit", async () => {
  const r = await runtime(["pending", "approved", "removed"]);
  assert(!r.calls.includes("unlock"));
  await r.timers.shift()();
  assert(r.calls.includes("close"));
  assert(r.calls.includes("unlock"));
  await r.timers.shift()();
  assert.equal(r.calls.at(-1), "/guest-removed.html");
  assert.equal(r.timers.length, 0);
});
test("declined guest is never unlocked", async () => {
  const r = await runtime(["declined"]);
  assert(!r.calls.includes("unlock"));
  assert.equal(r.calls.at(-1), "/guest-removed.html");
});
test("expired guest is never unlocked", async () => {
  const r = await runtime(["expired"]);
  assert(!r.calls.includes("unlock"));
  assert.equal(r.calls.at(-1), "/guest-removed.html");
});
test("compare-and-set retries instead of overwriting a concurrent removal", async () => {
  const { update } = require("./guestVisits");
  let stored = { ...pending, status: "approved" };
  let first = true;
  const client = {
    command: async (command, ...args) => {
      if (command === "HGET") return JSON.stringify(stored);
      if (command === "EVAL") {
        if (first) {
          first = false;
          stored = { ...stored, status: "removed" };
          return "0";
        }
        if (JSON.stringify(stored) !== args[4]) return "0";
        stored = JSON.parse(args[5]);
        return "1";
      }
    },
  };
  const result = await update(client, "id", (visit) => ({
    ...visit,
    seenAt: now,
  }));
  assert.equal(result.status, "removed");
});
async function endpoint(
  body,
  {
    admin = false,
    user = false,
    method = "POST",
    origin = "https://office.example",
  } = {},
) {
  const handlerModule = { exports: {} };
  let redisCalled = false;
  const code = fs.readFileSync(path.join(__dirname, "../guests.js"), "utf8");
  const deny = (req, res) => {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: "Forbidden" }));
    return null;
  };
  vm.runInNewContext(code, {
    module: handlerModule,
    require: (name) => {
      if (name.endsWith("/session")) return {verifySession:()=>null,parseCookies:()=>({})};
      if (name === "crypto") return require("crypto");
      if (name.endsWith("requireAdmin"))
        return {
          requireAdmin: admin
            ? async () => ({ email: "admin@example.com" })
            : deny,
        };
      if (name.endsWith("requireUser"))
        return {
          requireUser: user
            ? async () => ({ email: "host@example.com" })
            : deny,
        };
      if (name.endsWith("redis"))
        return {
          withRedis: async () => {
            redisCalled = true;
            throw new Error("Unexpected Redis call");
          },
        };
      if (name.endsWith("admin")) return { REDIS_URL: "unused" };
      if (name.endsWith("presence"))
        return { listKnownMembers: async () => [] };
      if (name.endsWith("guestVisits")) return require("./guestVisits");
      throw new Error(name);
    },
  });
  const req = {
    method,
    headers: {
      host: "office.example",
      origin,
      "content-type": "application/json",
    },
    async *[Symbol.asyncIterator]() {
      yield JSON.stringify(body);
    },
  };
  const res = {
    setHeader() {},
    end(text) {
      this.body = JSON.parse(text);
    },
  };
  await handlerModule.exports(req, res);
  return { ...res, redisCalled };
}
test("admin guest list and removal reject unauthenticated callers before storage", async () => {
  for (const action of ["list", "remove"]) {
    const r = await endpoint({ action, id: "a".repeat(32) });
    assert.equal(r.statusCode, 403);
    assert.equal(r.redisCalled, false);
  }
});
test("host decisions reject unauthenticated callers", async () => {
  for (const action of ["pending", "approve", "decline"])
    assert.equal((await endpoint({ action })).statusCode, 403);
});
test("cross-origin and GET requests cannot mutate visits", async () => {
  assert.equal(
    (
      await endpoint(
        { action: "remove" },
        { admin: true, origin: "https://evil.example" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await endpoint({ action: "remove" }, { admin: true, method: "GET" }))
      .statusCode,
    405,
  );
});
test("host request messages render as text, not HTML", async () => {
  const { JSDOM } = require("jsdom");
  const html = fs.readFileSync(
    path.join(__dirname, "../../play/public/scripts/guest-requests.html"),
    "utf8",
  );
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      window.fetch = async () => ({
        ok: true,
        json: async () => ({
          visits: [
            {
              id: "a",
              name: "<img src=x onerror=alert(1)>",
              message: "<script>bad()</script>",
            },
          ],
        }),
      });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    dom.window.document.querySelectorAll("article img,article script").length,
    0,
  );
  assert.equal(
    dom.window.document.querySelector("h2").textContent,
    "<img src=x onerror=alert(1)>",
  );
  dom.window.close();
});
test("guest picker shows avatar and first name while preserving host selection", async () => {
  const { JSDOM } = require("jsdom");
  const html = fs.readFileSync(path.join(__dirname, "../../play/public/scripts/guest-entry.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost", runScripts: "dangerously", beforeParse(window) {
    window.sessionStorage.setItem("wa:guest-visit", JSON.stringify({id:"test",token:"token"}));
    window.fetch = async (_, options) => ({ok:true,json:async()=> JSON.parse(options.body).action === "status" ? {status:"selecting"} : {members:[{email:"host@example.com",name:"Ghamay Pepito",avatar:"data:image/png;base64,aGVsbG8="},{email:"other@example.com",name:"Himal"}]}});
  }});
  await new Promise(resolve=>setImmediate(resolve));
  const radio = dom.window.document.querySelector('input[name="host"]');
  assert.ok(radio);
  assert.equal(radio.value,"host@example.com");
  assert.equal(dom.window.document.querySelector('.person-name').textContent,"Ghamay");
  assert.ok(dom.window.document.querySelector('.person-avatar img'));
  assert.equal(dom.window.document.getElementById('host').textContent.includes('host@example.com'),false);
  radio.checked = true;
  dom.window.document.getElementById('refresh').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dom.window.document.querySelector('input:checked').value, 'host@example.com');
  assert.equal(dom.window.document.querySelectorAll('.person').length, 2);
  dom.window.close();
});
