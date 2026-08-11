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
import { GraceCommandError } from "./errors";
import {
  BOOLEAN_SPACE_GUARD_BRAND,
  collectBooleanFlagNames,
  defineGraceCommand,
  listBooleanFlags,
  refuseBooleanSpaceForm,
} from "./command";

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
  it("brands the command def and refuses space-form via wrapped run", async () => {
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

    await expect(
      cmd.run!({
        rawArgs: ["--record", "false"],
        args: { record: true, _: ["false"] },
        cmd,
      } as never),
    ).rejects.toBeInstanceOf(GraceCommandError);
    expect(ran).toBe(false);

    await cmd.run!({
      rawArgs: ["--record=false"],
      args: { record: false, _: [] },
      cmd,
    } as never);
    expect(ran).toBe(true);
  });

  it("re-reads boolean names from def.args at run time", async () => {
    const args: ArgsDef = {
      apply: { type: "boolean", default: false },
    };
    const cmd = defineGraceCommand({
      get args() {
        return args;
      },
      async run() {},
    });

    // Add a boolean after wrap — run-time re-read must see it.
    args.fix = { type: "boolean", default: false };

    await expect(
      cmd.run!({
        rawArgs: ["--fix", "true"],
        args: { apply: false, fix: true, _: ["true"] },
        cmd,
      } as never),
    ).rejects.toBeInstanceOf(GraceCommandError);
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
