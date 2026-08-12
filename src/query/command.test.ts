import { describe, expect, it } from "bun:test";
import type { ArgsDef } from "citty";

import { contextCommand } from "../grace-context";
import { cursorCommand } from "../grace-cursor";
import { doctorCommand } from "../grace-doctor";
import { fileCommand } from "../grace-file";
import { graphCommand } from "../grace-graph";
import { lintCommand } from "../grace-lint";
import { moduleCommand } from "../grace-module";
import { statusCommand } from "../grace-status";
import { verificationCommand } from "../grace-verification";
import { gateCommand } from "../gates/command";
import { reviewCommand } from "../review/command";
import { asGraceCommandError, GraceCommandError, runGraceCommand, runQueryCommand } from "./errors";
import {
  BOOLEAN_SPACE_GUARD_BRAND,
  collectBooleanFlagNames,
  defineGraceCommand,
  listBooleanFlags,
  refuseBooleanSpaceForm,
  resolveErrorFormat,
} from "./command";

/** Capture process.stdout.write chunks for the duration of `fn`. */
function captureStdout(fn: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  return Promise.resolve(fn()).finally(() => {
    process.stdout.write = original;
  }).then(() => chunks.join(""));
}

/** Capture process.stderr.write chunks for the duration of `fn`. */
function captureStderr(fn: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  return Promise.resolve(fn()).finally(() => {
    process.stderr.write = original;
  }).then(() => chunks.join(""));
}

/** Read process.exitCode without control-flow narrowing to the prior assignment. */
function readExitCode(): number | string | null | undefined {
  return process.exitCode;
}

/** Restore exitCode; Bun treats an uncleared non-zero as the process exit even when tests pass. */
function restoreExitCode(previous: number | string | null | undefined): void {
  process.exitCode = previous === undefined || previous === null ? 0 : previous;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * C-FLAG-HONESTY T-001 — pure refuse primitive + live inventory walker.
 * Brand-all-boolean-nodes is T-003; this task only builds the walker and pure helper.
 */

describe("refuseBooleanSpaceForm (pure)", () => {
  const flagNames = ["flag"];

  it("throws on --flag false and names equals and --no-/bare forms", () => {
    expect(() => refuseBooleanSpaceForm(["--flag", "false"], flagNames)).toThrow(GraceCommandError);
    try {
      refuseBooleanSpaceForm(["--flag", "false"], flagNames);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GraceCommandError);
      const err = error as GraceCommandError;
      expect(err.code).toBe("invalid-arguments");
      expect(err.message).toContain("--flag=false");
      expect(err.message).toContain("--flag=true");
      expect(err.message).toContain("--no-flag");
      expect(err.message).toContain("--flag");
    }
  });

  it("throws on --flag true and names equals and --no-/bare forms", () => {
    expect(() => refuseBooleanSpaceForm(["--flag", "true"], flagNames)).toThrow(GraceCommandError);
    try {
      refuseBooleanSpaceForm(["--flag", "true"], flagNames);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GraceCommandError);
      const err = error as GraceCommandError;
      expect(err.code).toBe("invalid-arguments");
      expect(err.message).toContain("--flag=true");
      expect(err.message).toContain("--flag=false");
      expect(err.message).toContain("--no-flag");
      expect(err.message).toMatch(/bare `--flag`|`--flag` \(presence|--flag means true/i);
    }
  });

  it("does not throw on --flag=false, --flag=true, bare --flag, or --no-flag", () => {
    expect(() => refuseBooleanSpaceForm(["--flag=false"], flagNames)).not.toThrow();
    expect(() => refuseBooleanSpaceForm(["--flag=true"], flagNames)).not.toThrow();
    expect(() => refuseBooleanSpaceForm(["--flag"], flagNames)).not.toThrow();
    expect(() => refuseBooleanSpaceForm(["--no-flag"], flagNames)).not.toThrow();
  });

  it("does not throw on bare false as the sole token (positional counterweight)", () => {
    // Naive "any bare true/false is an error" fails this case.
    expect(() => refuseBooleanSpaceForm(["false"], flagNames)).not.toThrow();
  });

  it("does not throw on argv [\"true\"] alone (positional counterweight)", () => {
    // Naive "any bare true/false is an error" fails this case.
    expect(() => refuseBooleanSpaceForm(["true"], flagNames)).not.toThrow();
  });

  it("throws on --json true when json is among flag names (F18.1 shape)", () => {
    expect(() => refuseBooleanSpaceForm(["--json", "true"], ["json"])).toThrow(GraceCommandError);
    try {
      refuseBooleanSpaceForm(["--json", "true"], ["json"]);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GraceCommandError);
      const err = error as GraceCommandError;
      expect(err.code).toBe("invalid-arguments");
      expect(err.message).toContain("--json=true");
      expect(err.message).toContain("--json=false");
      expect(err.message).toContain("--no-json");
    }
  });

  it("throws on --no-flag false (negation space-form is the same class)", () => {
    // --no-record false: flag intent lands, bare false binds to a positional (F18.1 shape).
    expect(() => refuseBooleanSpaceForm(["--no-flag", "false"], flagNames)).toThrow(GraceCommandError);
    try {
      refuseBooleanSpaceForm(["--no-flag", "false"], flagNames);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GraceCommandError);
      const err = error as GraceCommandError;
      expect(err.code).toBe("invalid-arguments");
      expect(err.message).toContain("--flag=false");
      expect(err.message).toContain("--flag=true");
      expect(err.message).toContain("--no-flag");
    }
  });

  it("throws on --no-flag true and on kebab --no-run-commands false", () => {
    expect(() => refuseBooleanSpaceForm(["--no-flag", "true"], flagNames)).toThrow(GraceCommandError);
    expect(() => refuseBooleanSpaceForm(["--no-run-commands", "false"], ["runCommands"])).toThrow(
      GraceCommandError,
    );
  });
});

describe("collectBooleanFlagNames", () => {
  it("returns only keys whose type is boolean", () => {
    expect(
      collectBooleanFlagNames({
        record: { type: "boolean", default: true },
        path: { type: "string", default: "." },
        query: { type: "positional" },
        json: { type: "boolean", default: false },
      }),
    ).toEqual(["record", "json"]);
  });

  it("returns empty array for undefined or empty args", () => {
    expect(collectBooleanFlagNames(undefined)).toEqual([]);
    expect(collectBooleanFlagNames({})).toEqual([]);
  });
});

describe("defineGraceCommand", () => {
  it("brands the command def; space-form skips original run (control flow, not rethrow)", async () => {
    // After C-LEGIBLE-FAILURE T-003, runGraceCommand swallows the throw.
    // Assert ran===false + rendered channel, not cmd.run rejection.
    let ran = false;
    const cmd = defineGraceCommand({
      args: {
        record: { type: "boolean", default: true },
      },
      async run() {
        ran = true;
      },
    });

    expect((cmd as Record<symbol, unknown>)[BOOLEAN_SPACE_GUARD_BRAND]).toBe(true);

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const stderr = await captureStderr(async () => {
      await cmd.run!({
        rawArgs: ["--record", "false"],
        args: { record: true, _: ["false"] },
        cmd,
      } as never);
    });
    const refusedExit = readExitCode();
    restoreExitCode(previousExit);
    expect(ran).toBe(false);
    expect(refusedExit).toBe(1);
    expect(stderr).toContain("--record=false");
    expect(stderr).toContain("--no-record");
    expect(stderr).not.toMatch(/at refuseBooleanSpaceForm/);

    ran = false;
    await cmd.run!({
      rawArgs: ["--record=false"],
      args: { record: false, _: [] },
      cmd,
    } as never);
    expect(ran).toBe(true);
  });

  it("re-reads boolean names from def.args at run time and skips original run", async () => {
    const args: ArgsDef = {
      apply: { type: "boolean", default: false },
    };
    let ran = false;
    const cmd = defineGraceCommand({
      get args() {
        return args;
      },
      async run() {
        ran = true;
      },
    });

    // Add a boolean after wrap — run-time re-read must see it.
    args.fix = { type: "boolean", default: false };

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    await captureStderr(async () => {
      await cmd.run!({
        rawArgs: ["--fix", "true"],
        args: { apply: false, fix: true, _: ["true"] },
        cmd,
      } as never);
    });
    const refusedExit = readExitCode();
    restoreExitCode(previousExit);
    expect(ran).toBe(false);
    expect(refusedExit).toBe(1);
  });
});

describe("resolveErrorFormat (Trap 2)", () => {
  it("honours --format json and --json; text otherwise", () => {
    expect(resolveErrorFormat({ format: "json" })).toBe("json");
    expect(resolveErrorFormat({ json: true, format: "text" })).toBe("json");
    expect(resolveErrorFormat({ json: false, format: "text" })).toBe("text");
    expect(resolveErrorFormat({ format: "text" })).toBe("text");
    expect(resolveErrorFormat({})).toBe("text");
    expect(resolveErrorFormat(undefined)).toBe("text");
  });
});

describe("C-LEGIBLE-FAILURE T-003 channel criteria", () => {
  it("AC-CHANNEL-JSON-ENVELOPE: --format json space-form → entire stdout is envelope", async () => {
    let ran = false;
    const cmd = defineGraceCommand({
      args: {
        record: { type: "boolean", default: true },
        format: { type: "string", default: "text" },
      },
      async run() {
        ran = true;
      },
    });

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const stdout = await captureStdout(async () => {
      await cmd.run!({
        rawArgs: ["--record", "false", "--format", "json"],
        args: { record: true, format: "json", _: ["false"] },
        cmd,
      } as never);
    });
    const refusedExit = readExitCode();
    restoreExitCode(previousExit);
    expect(ran).toBe(false);
    expect(refusedExit).toBe(1);
    // Entire stdout must parse as the envelope — not a prefix/suffix around a stack.
    const body = JSON.parse(stdout);
    expect(body.schemaVersion).toBe("1.0.0");
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid-arguments");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message).toContain("--record=false");
    expect(stdout).not.toMatch(/at refuseBooleanSpaceForm|GraceCommandError:/);
  });

  it("AC-CHANNEL-JSON-ENVELOPE Trap 2: --json convention (not only --format) yields envelope", async () => {
    // status/module/context/file/verification use --json; reading only args.format
    // would leave the envelope missing on those five. Pin the --json path.
    let ran = false;
    const cmd = defineGraceCommand({
      args: {
        json: { type: "boolean", default: false },
        format: { type: "string", default: "text" },
      },
      async run() {
        ran = true;
      },
    });

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const stdout = await captureStdout(async () => {
      // citty shape for `--json false`: json presence true, bare false positional.
      // format stays default "text" — only Boolean(args.json) selects JSON.
      await cmd.run!({
        rawArgs: ["--json", "false"],
        args: { json: true, format: "text", _: ["false"] },
        cmd,
      } as never);
    });
    const refusedExit = readExitCode();
    restoreExitCode(previousExit);
    expect(ran).toBe(false);
    expect(refusedExit).toBe(1);
    const body = JSON.parse(stdout);
    expect(body.schemaVersion).toBe("1.0.0");
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid-arguments");
    expect(typeof body.error.message).toBe("string");
  });

  it("AC-CHANNEL-TEXT-LEGIBLE: single stderr message, no stack, names working forms", async () => {
    let ran = false;
    const cmd = defineGraceCommand({
      args: {
        record: { type: "boolean", default: true },
      },
      async run() {
        ran = true;
      },
    });

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const stderr = await captureStderr(async () => {
      await cmd.run!({
        rawArgs: ["--record", "false"],
        args: { record: true, _: ["false"] },
        cmd,
      } as never);
    });
    const refusedExit = readExitCode();
    restoreExitCode(previousExit);
    expect(ran).toBe(false);
    expect(refusedExit).toBe(1);
    // Single message line (trailing newline from renderer is fine).
    const lines = stderr.replace(/\n$/, "").split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("--record=false");
    expect(lines[0]).toContain("--record=true");
    expect(lines[0]).toContain("--no-record");
    // Actual refuseBooleanSpaceForm wording (not a family of plausible paraphrases).
    expect(lines[0]).toContain("bare `--record` means true");
    expect(stderr).not.toMatch(/at refuseBooleanSpaceForm|at async runCommand|GraceCommandError:/);
  });

  it("AC-EXIT-CODE-FROM-ERROR: GraceCommandError exitCode 2 through same render path → toBe(2)", async () => {
    // Discriminating probe: non-default exitCode 2 must reach process.exitCode.
    // A test that only checks !== 0 would miss a hard-coded 1 regression.
    let ran = false;
    const cmd = defineGraceCommand({
      args: {
        record: { type: "boolean", default: true },
      },
      async run() {
        ran = true;
        throw new GraceCommandError("invalid-arguments", "exit-code probe", { exitCode: 2 });
      },
    });

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    await captureStderr(async () => {
      await cmd.run!({
        rawArgs: ["--record=true"],
        args: { record: true, _: [] },
        cmd,
      } as never);
    });
    const probeExit = readExitCode();
    restoreExitCode(previousExit);
    expect(ran).toBe(true);
    expect(probeExit).toBe(2);
  });

  it("AC-CHANNEL-SIDE-EFFECT-HELD (unit): original run never executes on space-form refuse", async () => {
    // Infer-and-continue / rewrite-argv-and-continue would set ran true.
    // Control-flow short-circuit leaves ran false; Decision pins live in core.test.ts.
    let ran = false;
    let sideEffect = 0;
    const cmd = defineGraceCommand({
      args: {
        record: { type: "boolean", default: true },
      },
      async run() {
        ran = true;
        sideEffect += 1;
      },
    });

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    await captureStderr(async () => {
      await cmd.run!({
        rawArgs: ["--record", "false"],
        args: { record: true, _: ["false"] },
        cmd,
      } as never);
    });
    restoreExitCode(previousExit);
    expect(ran).toBe(false);
    expect(sideEffect).toBe(0);
  });

  it("unexpected TypeError message reaches operator in text and json (cause preserved)", async () => {
    // Class-wide runGraceCommand would erase non-GraceCommandError to a fixed fallback.
    // Identity of the caught object (not a second message comparison) is the cause pin.
    const original = new TypeError("cannot read property 'wrapper' of null");
    const cause = original.message;
    let wrapped!: GraceCommandError;
    await captureStderr(() => {
      wrapped = asGraceCommandError(original, original.message);
    });
    expect(wrapped.cause).toBe(original);

    const cmd = defineGraceCommand({
      args: {
        format: { type: "string", default: "text" },
      },
      async run() {
        throw original;
      },
    });

    const previousExit = process.exitCode;

    process.exitCode = undefined;
    const textStderr = await captureStderr(async () => {
      await cmd.run!({
        rawArgs: [],
        args: { format: "text", _: [] },
        cmd,
      } as never);
    });
    restoreExitCode(previousExit);
    expect(textStderr).toContain(cause);
    expect(textStderr).not.toBe("Unable to complete the GRACE command.\n");
    expect(countOccurrences(textStderr, original.stack!)).toBe(1);

    process.exitCode = undefined;
    let jsonStdout = "";
    let jsonStderr = "";
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      outChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await cmd.run!({
        rawArgs: ["--format", "json"],
        args: { format: "json", _: [] },
        cmd,
      } as never);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    jsonStdout = outChunks.join("");
    jsonStderr = errChunks.join("");
    restoreExitCode(previousExit);

    const body = JSON.parse(jsonStdout);
    expect(body.schemaVersion).toBe("1.0.0");
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe(cause);
    expect(body.error.stack).toBeUndefined();
    // Stack is diagnostic on stderr; stdout stays pure envelope.
    expect(jsonStderr).toContain(cause);
    expect(jsonStdout).not.toContain("at ");
    expect(countOccurrences(jsonStderr, original.stack!)).toBe(1);
  });
});

describe("GraceCommandError object cause (D14)", () => {
  it("attaches the original object as cause by identity", () => {
    const original = new TypeError("boom");
    const err = new GraceCommandError("invalid-project", "wrapped", { cause: original, exitCode: 2 });
    expect(err.cause).toBe(original);
    expect(err.exitCode).toBe(2);
    expect(err.message).toBe("wrapped");
  });

  it("does not own a cause property when none was supplied", () => {
    const err = new GraceCommandError("invalid-arguments", "usage");
    expect(Object.hasOwn(err, "cause")).toBe(false);
  });

  it("asGraceCommandError attaches the caught value by identity (command.ts message policy)", async () => {
    const original = new TypeError("boundary");
    let wrapped!: GraceCommandError;
    await captureStderr(() => {
      wrapped = asGraceCommandError(original, original.message);
    });
    expect(wrapped).toBeInstanceOf(GraceCommandError);
    expect(wrapped.cause).toBe(original);
    expect(wrapped.message).toBe(original.message);
    expect(wrapped.code).toBe("invalid-project");
  });

  it("asGraceCommandError attaches the caught value by identity (runGraceCommand fallback policy)", async () => {
    const original = new TypeError("direct wrap");
    const fallback = "Unable to complete the GRACE command.";
    let wrapped!: GraceCommandError;
    await captureStderr(() => {
      wrapped = asGraceCommandError(original, fallback);
    });
    expect(wrapped.cause).toBe(original);
    expect(wrapped.message).toBe(fallback);
    expect(wrapped.message).not.toBe(original.message);
  });

  it("asGraceCommandError returns an existing GraceCommandError untouched and writes no chain", async () => {
    const original = new GraceCommandError("not-found", "missing");
    const stderr = await captureStderr(() => {
      const wrapped = asGraceCommandError(original, "fallback");
      expect(wrapped).toBe(original);
    });
    expect(stderr).toBe("");
    expect(Object.hasOwn(original, "cause")).toBe(false);
  });

  it("non-Error throws get a distinguishable synthesized diagnostic, not a blank line", async () => {
    // D14 clause 2: a non-Error rejection may be synthesized. The marker names
    // the class (no stack, because this was not an Error). Labels name the value.
    const marker = "[non-Error thrown]";
    async function wrap(thrown: unknown, message: string) {
      let wrapped!: GraceCommandError;
      const stderr = await captureStderr(() => {
        wrapped = asGraceCommandError(thrown, message);
      });
      return { wrapped, stderr };
    }

    const undef = await wrap(undefined, String(undefined));
    const nulled = await wrap(null, String(null));
    const empty = await wrap("", "");
    const zero = await wrap(0, String(0));
    const text = "database connection refused";
    const str = await wrap(text, text);
    const object = { code: "ECONN" };
    const obj = await wrap(object, String(object));

    const rows = [undef, nulled, empty, zero, str, obj];
    for (const row of rows) {
      expect(row.stderr).not.toBe("\n");
      expect(row.stderr).toContain(marker);
      expect(row.stderr).not.toContain("[no diagnostic content]");
      expect(row.stderr).not.toMatch(/\bat\s/);
    }

    expect(undef.stderr).toBe(`${marker} undefined\n`);
    expect(nulled.stderr).toBe(`${marker} null\n`);
    expect(empty.stderr).toBe(`${marker} empty string\n`);
    expect(zero.stderr).toBe(`${marker} number 0\n`);
    expect(str.stderr).toBe(`${marker} string ${JSON.stringify(text)}\n`);
    expect(obj.stderr).toBe(`${marker} ${Object.prototype.toString.call(object)}\n`);

    expect(new Set(rows.map((row) => row.stderr)).size).toBe(6);

    // Envelope: faithful String(thrown) when that is non-empty; never an empty message.
    expect(undef.wrapped.message).toBe("undefined");
    expect(nulled.wrapped.message).toBe("null");
    expect(empty.wrapped.message).toBe(`${marker} empty string`);
    expect(zero.wrapped.message).toBe("0");
    expect(str.wrapped.message).toBe(text);
    expect(obj.wrapped.message).toBe(String(object));
  });
});

describe("cause-chain diagnostic written exactly once", () => {
  it("defineGraceCommand TypeError dumps original.stack exactly once (text and json)", async () => {
    const original = new TypeError("single-dump probe");
    const cmd = defineGraceCommand({
      args: { format: { type: "string", default: "text" } },
      async run() {
        throw original;
      },
    });

    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const textStderr = await captureStderr(async () => {
      await cmd.run!({
        rawArgs: [],
        args: { format: "text", _: [] },
        cmd,
      } as never);
    });
    restoreExitCode(previousExit);
    expect(countOccurrences(textStderr, original.stack!)).toBe(1);

    process.exitCode = undefined;
    let jsonStderr = "";
    const errChunks: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    const origOut = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await cmd.run!({
        rawArgs: ["--format", "json"],
        args: { format: "json", _: [] },
        cmd,
      } as never);
    } finally {
      process.stderr.write = origErr;
      process.stdout.write = origOut;
    }
    jsonStderr = errChunks.join("");
    restoreExitCode(previousExit);
    expect(countOccurrences(jsonStderr, original.stack!)).toBe(1);
  });

  it("runGraceCommand wrap dumps original.stack exactly once and keeps fallback on the envelope", async () => {
    const original = new TypeError("runGraceCommand wrap probe");
    const fallback = "Unable to complete the GRACE command.";
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const stderr = await captureStderr(async () => {
      await runGraceCommand("text", () => {
        throw original;
      }, fallback);
    });
    restoreExitCode(previousExit);
    expect(countOccurrences(stderr, original.stack!)).toBe(1);
    expect(stderr).toContain(fallback);

    process.exitCode = undefined;
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      outChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await runGraceCommand("json", () => {
        throw original;
      }, fallback);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    restoreExitCode(previousExit);
    const jsonStderr = errChunks.join("");
    const jsonStdout = outChunks.join("");
    expect(countOccurrences(jsonStderr, original.stack!)).toBe(1);
    const body = JSON.parse(jsonStdout);
    expect(body.schemaVersion).toBe("1.0.0");
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe(fallback);
    expect(body.error.stack).toBeUndefined();
    expect(jsonStdout).not.toContain("at ");
  });

  it("nested cause chain prints each stack exactly once", async () => {
    const inner = new Error("inner-cause");
    const outer = new Error("outer-fault", { cause: inner });
    const cmd = defineGraceCommand({
      args: { format: { type: "string", default: "text" } },
      async run() {
        throw outer;
      },
    });
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const stderr = await captureStderr(async () => {
      await cmd.run!({
        rawArgs: [],
        args: { format: "text", _: [] },
        cmd,
      } as never);
    });
    restoreExitCode(previousExit);
    expect(countOccurrences(stderr, outer.stack!)).toBe(1);
    expect(countOccurrences(stderr, inner.stack!)).toBe(1);
  });

  it("runQueryCommand json: stdout stays envelope-only; stderr has the stack once", async () => {
    const original = new TypeError("query wrap probe");
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      outChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await runQueryCommand("json", () => {
        throw original;
      });
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    restoreExitCode(previousExit);
    const jsonStdout = outChunks.join("");
    const jsonStderr = errChunks.join("");
    const body = JSON.parse(jsonStdout);
    expect(body.schemaVersion).toBe("1.0.0");
    expect(body.ok).toBe(false);
    expect(body.error.stack).toBeUndefined();
    expect(jsonStdout).not.toContain("at ");
    expect(countOccurrences(jsonStderr, original.stack!)).toBe(1);
  });
});

describe("listBooleanFlags live inventory (anti-F10)", () => {
  it("counts type===boolean sites on the eleven exported command roots with exact pin", () => {
    const sites = listBooleanFlags([
      { name: "gate", command: gateCommand },
      { name: "cursor", command: cursorCommand },
      { name: "status", command: statusCommand },
      { name: "lint", command: lintCommand },
      { name: "module", command: moduleCommand },
      { name: "file", command: fileCommand },
      { name: "graph", command: graphCommand },
      { name: "context", command: contextCommand },
      { name: "verification", command: verificationCommand },
      { name: "review", command: reviewCommand },
      { name: "doctor", command: doctorCommand },
    ]);

    // Re-measured at execute via this walker. Plan-authoring HEAD 4bf483c: 24.
    // F23: exact pin, not a lower bound. F12.2: this run's number is the source of truth.
    expect(sites.length).toBe(24);

    // review and doctor included in the walk (0 booleans today).
    expect(sites.some((s) => s.path.startsWith("review"))).toBe(false);
    expect(sites.some((s) => s.path.startsWith("doctor"))).toBe(false);

    // gateSubCommand factory: --record on approve, apply, archive (3 live sites).
    const gateRecords = sites.filter((s) => s.name === "record" && s.path.startsWith("gate."));
    expect(gateRecords.length).toBe(3);
  });

  it("throws on lazy subCommands instead of silently omitting nested boolean sites", () => {
    // Probe shape: eager boolean visible; sneaky nested under function subCommands invisible
    // under a silent skip — must refuse to produce a count.
    const cmd = {
      args: { eager: { type: "boolean" as const, default: false } },
      subCommands: () => ({
        sneaky: {
          args: { sneaky: { type: "boolean" as const, default: false } },
        },
      }),
    };
    expect(() => listBooleanFlags([{ name: "lazy", command: cmd as never }])).toThrow();
    try {
      listBooleanFlags([{ name: "lazy", command: cmd as never }]);
      expect.unreachable("expected throw");
    } catch (error) {
      expect((error as Error).message).toContain("lazy");
      expect((error as Error).message).toMatch(/subCommands|cannot read|unreadable|resolvable/i);
    }
  });

  it("throws on lazy args instead of returning an empty under-count", () => {
    const cmd = {
      args: () => ({ hidden: { type: "boolean" as const, default: false } }),
    };
    expect(() => listBooleanFlags([{ name: "lazy-args", command: cmd as never }])).toThrow();
    try {
      listBooleanFlags([{ name: "lazy-args", command: cmd as never }]);
      expect.unreachable("expected throw");
    } catch (error) {
      expect((error as Error).message).toContain("lazy-args");
      expect((error as Error).message).toMatch(/args|cannot read|unreadable|resolvable/i);
    }
  });

  it("throws on a lazy individual subCommand entry, naming the child path", () => {
    const cmd = {
      subCommands: {
        child: () => ({
          args: { hidden: { type: "boolean" as const, default: false } },
        }),
      },
    };
    expect(() => listBooleanFlags([{ name: "root", command: cmd as never }])).toThrow();
    try {
      listBooleanFlags([{ name: "root", command: cmd as never }]);
      expect.unreachable("expected throw");
    } catch (error) {
      expect((error as Error).message).toContain("root.child");
    }
  });
});

/** Eleven exported roots used by coverage / inventory (design D3). */
function elevenRoots() {
  return [
    { name: "gate", command: gateCommand },
    { name: "cursor", command: cursorCommand },
    { name: "status", command: statusCommand },
    { name: "lint", command: lintCommand },
    { name: "module", command: moduleCommand },
    { name: "file", command: fileCommand },
    { name: "graph", command: graphCommand },
    { name: "context", command: contextCommand },
    { name: "verification", command: verificationCommand },
    { name: "review", command: reviewCommand },
    { name: "doctor", command: doctorCommand },
  ] as const;
}

function commandAtPath(
  roots: ReadonlyArray<{ name: string; command: (typeof gateCommand) }>,
  path: string,
) {
  const [rootName, ...rest] = path.split(".");
  const root = roots.find((r) => r.name === rootName);
  if (!root) throw new Error(`unknown root ${rootName}`);
  let cmd: { subCommands?: Record<string, unknown>; args?: unknown } = root.command as never;
  for (const part of rest) {
    const subs = cmd.subCommands as Record<string, typeof cmd> | undefined;
    if (!subs || !(part in subs)) throw new Error(`missing command at ${path}`);
    cmd = subs[part] as typeof cmd;
  }
  return cmd;
}

describe("AC-CLASS-COVERAGE (T-003)", () => {
  it("every live boolean site sits on a defineGraceCommand-branded node (exact count)", () => {
    const roots = elevenRoots();
    const sites = listBooleanFlags([...roots]);
    // Re-measure at execute (F12.2). Plan authoring: 24. F23: exact pin.
    expect(sites.length).toBe(24);

    for (const site of sites) {
      const node = commandAtPath(roots as never, site.path);
      expect(
        (node as Record<symbol, unknown>)[BOOLEAN_SPACE_GUARD_BRAND],
        `boolean ${site.name} at ${site.path} must carry BOOLEAN_SPACE_GUARD_BRAND`,
      ).toBe(true);
    }
  });

  it("pure refuse covers every collected live flag name for space true and space false", () => {
    const sites = listBooleanFlags([...elevenRoots()]);
    expect(sites.length).toBe(24);
    const names = [...new Set(sites.map((s) => s.name))];
    for (const name of names) {
      const long = `--${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase()}`;
      expect(() => refuseBooleanSpaceForm([long, "false"], [name])).toThrow(GraceCommandError);
      expect(() => refuseBooleanSpaceForm([long, "true"], [name])).toThrow(GraceCommandError);
      // Counterweight: equals form is not refused.
      expect(() => refuseBooleanSpaceForm([`${long}=false`], [name])).not.toThrow();
    }
  });
});
