import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, parseCspReports, supabaseOrigins } from "@/lib/security/csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `))?.slice(name.length + 1).split(" ") ?? [];

describe("the Content-Security-Policy", () => {
  const csp = contentSecurityPolicy({ reportUri: "/api/csp-report" });
  it("allows the site itself, nothing foreign, and no eval", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:\/\//); // no outside origin at all without Supabase
    expect(directive(csp, "script-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });
  it("cannot be framed, embeds no frame, no plugin, keeps the base address and the forms at home", () => {
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "frame-src")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
  });
  it("lets the canvases work (data and blob images) and reports where asked", () => {
    expect(directive(csp, "img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:"]));
    expect(directive(csp, "report-uri")).toEqual(["/api/csp-report"]);
  });
  it("opens the Supabase project, and only it, when there is one", () => {
    const withSupa = contentSecurityPolicy({ supabaseUrl: "https://abcd1234.supabase.co/rest/v1?x=1", reportUri: "/r" });
    expect(directive(withSupa, "connect-src")).toEqual(["'self'", "https://abcd1234.supabase.co", "wss://abcd1234.supabase.co"]);
    expect(directive(withSupa, "img-src")).toContain("https://abcd1234.supabase.co");
    expect(directive(withSupa, "script-src")).not.toContain("https://abcd1234.supabase.co");
  });
  it("ignores a Supabase address that is not a plain https URL", () => {
    for (const bad of ["", "not a url", "http://insecure.example", "javascript:alert(1)", null, undefined]) expect(supabaseOrigins(bad as string | null | undefined), String(bad)).toEqual([]);
    expect(directive(contentSecurityPolicy({ supabaseUrl: "http://insecure.example", reportUri: "/r" }), "connect-src")).toEqual(["'self'"]);
  });
});

describe("the violation reports", () => {
  it("reads the classic report and the Reporting API's list", () => {
    const classic = parseCspReports({ "csp-report": { "document-uri": "https://x.test/", "violated-directive": "img-src", "blocked-uri": "https://evil.example/a.png", "line-number": 12, "source-file": "https://x.test/a.js" } });
    expect(classic).toEqual([{ documentUri: "https://x.test/", violatedDirective: "img-src", blockedUri: "https://evil.example/a.png", sourceFile: "https://x.test/a.js", line: 12 }]);
    const modern = parseCspReports([{ type: "csp-violation", body: { documentURL: "https://x.test/p", effectiveDirective: "script-src", blockedURL: "inline", lineNumber: 3 } }, { type: "deprecation", body: {} }]);
    expect(modern).toHaveLength(1);
    expect(modern[0]).toMatchObject({ violatedDirective: "script-src", blockedUri: "inline", line: 3 });
  });
  it("cleans and clips what a stranger can put in a log, and reads at most ten", () => {
    const [v] = parseCspReports({ "csp-report": { "document-uri": "https://x.test/\n[csp] forged line\u0000", "blocked-uri": "x".repeat(5000), "violated-directive": "y".repeat(500) } });
    expect(v!.documentUri).not.toMatch(/[\n\u0000]/);
    expect(v!.blockedUri.length).toBe(200);
    expect(v!.violatedDirective.length).toBe(80);
    expect(parseCspReports(Array.from({ length: 50 }, () => ({ "csp-report": { "blocked-uri": "a" } })))).toHaveLength(10);
  });
  it("ignores anything that is not a report", () => {
    for (const junk of [null, undefined, 3, "x", {}, [], [1, "a", null], { "csp-report": "no" }]) expect(parseCspReports(junk), JSON.stringify(junk)).toEqual([]);
  });
});
