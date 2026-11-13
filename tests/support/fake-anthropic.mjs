// A stand-in for api.anthropic.com for the tests: no key, no network, no money. The real SDK talks to it (ANTHROPIC_BASE_URL), so the
// request that would leave the site is the one that is checked here.
//
// It "translates" like this: the language of a text is the tag at the start of its title or description ("[de] Hallo" is German);
// a text without a tag is taken for English and comes back unchanged in every language (a harmless no-op, so that other tests are not disturbed).
// A translation of a text into language xx is the text without its tag, followed by " (xx)".
// "[fail]" in the text makes the service answer 500; "[refuse]" makes it refuse; "[slow]" makes it answer after a second.
import http from "node:http";

const LANGS = ["fr", "en", "es", "zh"];

/** @returns {Promise<{ port: number, calls: () => any[], reset: () => void, close: () => Promise<void> }>} */
export function startFakeAnthropic(port = 0) {
  /** @type {any[]} */
  let calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/__calls") {
      if (req.method === "DELETE") calls = [];
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(calls));
    }
    if (req.method !== "POST" || url.pathname !== "/v1/messages") { res.statusCode = 404; return res.end("{}"); }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const input = JSON.parse(body.messages?.[0]?.content ?? "{}");
    calls.push({ model: body.model, system: body.system, user: body.messages?.[0]?.content, outputConfig: body.output_config, apiKey: req.headers["x-api-key"] ?? (String(req.headers.authorization ?? "").replace(/^Bearer /, "") || null) });
    res.setHeader("content-type", "application/json");
    const text = `${input.title ?? ""}\n${input.description ?? ""}`;
    if (text.includes("[slow]")) await new Promise((r) => setTimeout(r, 1000));
    if (text.includes("[fail]")) { res.statusCode = 500; return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } })); }
    const base = { id: "msg_fake", type: "message", role: "assistant", model: body.model, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 20 } };
    if (text.includes("[refuse]")) return res.end(JSON.stringify({ ...base, content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } }));
    const tag = /\[([a-z]{2,3})\]/.exec(text)?.[1];
    const source = tag ?? "en";
    const strip = (s) => (s ?? "").replace(/\[[a-z]{2,3}\]\s*/g, "");
    const out = { source_language: source };
    for (const l of LANGS) {
      out[l] = !tag || l === source
        ? { title: strip(input.title), description: strip(input.description) }
        : { title: input.title ? `${strip(input.title)} (${l})` : "", description: input.description ? `${strip(input.description)} (${l})` : "" };
    }
    res.end(JSON.stringify({ ...base, content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn" }));
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
      resolve({ port: addr.port, calls: () => calls, reset: () => { calls = []; }, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r(undefined)); }) });
    });
  });
}
