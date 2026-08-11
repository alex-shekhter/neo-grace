// START_MODULE_CONTRACT
//   PURPOSE: Citty CLI argument-form guard and error-channel routing
//   SCOPE: Boolean space-form refusal, resolveErrorFormat, and defineGraceCommand
//          wrapper that routes refusal through runGraceCommand
//   DEPENDS: none
//   LINKS: M-CLI-INFRA
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   BOOLEAN_SPACE_GUARD_BRAND
//   BooleanFlagSite
//   collectBooleanFlagNames
//   defineGraceCommand
//   listBooleanFlags
//   refuseBooleanSpaceForm
//   resolveErrorFormat
// END_MODULE_MAP

/**
 * Citty boolean space-form guard (C-FLAG-HONESTY) + error channel (C-LEGIBLE-FAILURE).
 *
 * citty treats `type: "boolean"` as presence-only: `--flag false` sets the flag
 * true and leaves bare `false` as a positional (F18 / F18.1). Working forms are
 * `--flag=false` / `--flag=true`, bare `--flag`, and `--no-flag`.
 *
 * defineGraceCommand routes the refusal through runGraceCommand so JSON envelope
 * and text one-line rendering apply (honouring both --format and --json).
 *
 * Hosted under M-CLI-INFRA (F24 repair): shared CLI infrastructure, not query resolution.
 */

import { defineCommand, type ArgsDef, type CommandDef, type Resolvable } from "citty";

import { GraceCommandError, runGraceCommand } from "./errors";

/** Brand stamped on every command def produced by defineGraceCommand. */
export const BOOLEAN_SPACE_GUARD_BRAND = Symbol.for("ngrace.booleanSpaceGuard");

/** One live boolean flag site discovered by walking composed command objects. */
export type BooleanFlagSite = {
  /** Dotted path from a root name through subCommands (e.g. `gate.approve`). */
  path: string;
  /** Arg key as declared on the command def (e.g. `record`, `allowDirty`). */
  name: string;
  /** Declared default, if any. */
  default: unknown;
};

/** Convert camelCase / PascalCase arg keys to kebab-case long-flag form. */
function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

/**
 * Long-form argv tokens an operator may type for a boolean arg key.
 * citty aliases camelCase keys to kebab-case (measured in citty parseArgs)
 * and accepts both `--no-<name>` and `--no-<kebab>` negation spellings.
 */
function flagArgvTokens(name: string): string[] {
  const kebab = toKebabCase(name);
  const tokens = [`--${name}`, `--${kebab}`, `--no-${name}`, `--no-${kebab}`];
  return [...new Set(tokens)];
}

/** Arg keys whose declared type is `"boolean"`. */
export function collectBooleanFlagNames(argsDef: ArgsDef | undefined | null): string[] {
  if (!argsDef) return [];
  const names: string[] = [];
  for (const [name, def] of Object.entries(argsDef)) {
    if (def && typeof def === "object" && def.type === "boolean") {
      names.push(name);
    }
  }
  return names;
}

/**
 * Refuse `--flag true|false` (space-separated) for the given boolean flag names.
 * Does not rewrite argv or guess intent — throws GraceCommandError so the process
 * exits before any flagged side effect.
 */
export function refuseBooleanSpaceForm(rawArgs: readonly string[], flagNames: readonly string[]): void {
  if (flagNames.length === 0 || rawArgs.length === 0) return;

  /** Map argv token (`--record`, `--allow-dirty`) → declared arg key. */
  const tokenToName = new Map<string, string>();
  for (const name of flagNames) {
    for (const token of flagArgvTokens(name)) {
      tokenToName.set(token, name);
    }
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i]!;
    if (token === "--") break;
    if (!token.startsWith("--")) continue;
    // Equals form (`--flag=false`) is a working form — never refuse.
    if (token.includes("=")) continue;

    const flagName = tokenToName.get(token);
    if (flagName === undefined) continue;

    const next = rawArgs[i + 1];
    if (next !== "true" && next !== "false") continue;

    const kebab = toKebabCase(flagName);
    const long = `--${kebab}`;
    throw new GraceCommandError(
      "invalid-arguments",
      `Boolean flag \`${long}\` does not accept a space-separated value (\`${token} ${next}\`). ` +
        `Use the equals form (\`${long}=true\` / \`${long}=false\`) or the citty forms ` +
        `(\`--no-${kebab}\` for false, bare \`${long}\` means true).`,
    );
  }
}

async function resolveValue<T>(value: Resolvable<T>): Promise<T> {
  const resolved = typeof value === "function" ? (value as () => T | Promise<T>)() : value;
  return await resolved;
}

function wrapSubCommandEntry(sub: Resolvable<CommandDef<any>>): Resolvable<CommandDef<any>> {
  if (typeof sub === "function") {
    return async () => defineGraceCommand(await resolveValue(sub as Resolvable<CommandDef<any>>));
  }
  if (sub && typeof sub === "object" && "then" in (sub as object)) {
    return (sub as Promise<CommandDef<any>>).then((def) => defineGraceCommand(def));
  }
  return defineGraceCommand(sub as CommandDef<any>);
}

function wrapSubCommands(
  subCommands: Resolvable<Record<string, Resolvable<CommandDef<any>>>> | undefined,
): Resolvable<Record<string, Resolvable<CommandDef<any>>>> | undefined {
  if (subCommands === undefined) return undefined;

  if (typeof subCommands === "function") {
    return async () => {
      const resolved = await resolveValue(subCommands);
      return wrapSubCommandsObject(resolved);
    };
  }
  if (subCommands && typeof subCommands === "object" && "then" in (subCommands as object)) {
    return (subCommands as Promise<Record<string, Resolvable<CommandDef<any>>>>).then(wrapSubCommandsObject);
  }
  return wrapSubCommandsObject(subCommands as Record<string, Resolvable<CommandDef<any>>>);
}

function wrapSubCommandsObject(
  subs: Record<string, Resolvable<CommandDef<any>>>,
): Record<string, Resolvable<CommandDef<any>>> {
  const out: Record<string, Resolvable<CommandDef<any>>> = {};
  for (const [name, sub] of Object.entries(subs)) {
    out[name] = wrapSubCommandEntry(sub);
  }
  return out;
}

/**
 * Resolve text vs JSON error rendering from parsed args.
 * Trap 2: two JSON conventions exist — `--format json` only on some commands,
 * and both `--format` and `--json` on others. Honour either.
 */
export function resolveErrorFormat(args: Record<string, unknown> | undefined | null): "text" | "json" {
  if (!args) return "text";
  return Boolean(args.json) || String(args.format ?? "") === "json" ? "json" : "text";
}

/**
 * citty defineCommand wrapper that always refuses boolean space-form on rawArgs
 * before the original run, re-reading boolean names from def.args at run time.
 * Refusal (and any GraceCommandError from the operation) routes through
 * runGraceCommand so the declared envelope / one-line text path applies.
 * Recursively wraps subCommands and stamps BOOLEAN_SPACE_GUARD_BRAND.
 *
 * Trap 1: refuse and originalRun are sequential steps inside one runGraceCommand
 * operation — the throw short-circuits originalRun by control flow, not by
 * polling process.exitCode.
 */
export function defineGraceCommand<const T extends ArgsDef = ArgsDef>(def: CommandDef<T>): CommandDef<T> {
  const originalRun = def.run;
  const wrapped: CommandDef<T> = {
    ...def,
    subCommands: wrapSubCommands(def.subCommands as Resolvable<Record<string, Resolvable<CommandDef<any>>>> | undefined) as CommandDef<T>["subCommands"],
    async run(context) {
      const argsDef = (await resolveValue(def.args ?? ({} as T))) as ArgsDef;
      const names = collectBooleanFlagNames(argsDef);
      const format = resolveErrorFormat(context.args as Record<string, unknown>);
      await runGraceCommand(
        format,
        async () => {
          refuseBooleanSpaceForm(context.rawArgs, names);
          if (!originalRun) return;
          try {
            await originalRun(context);
          } catch (error) {
            // GraceCommandError is already the renderable channel — rethrow as-is.
            if (error instanceof GraceCommandError) throw error;
            // Class-wide wrap must not erase unexpected causes to the fixed fallback.
            // Preserve the original message on a GraceCommandError; write the original
            // stack to stderr (stdout stays pure envelope in JSON mode).
            const message =
              error instanceof Error && error.message.length > 0
                ? error.message
                : String(error);
            const stack =
              error instanceof Error && error.stack
                ? error.stack
                : `${message}`;
            process.stderr.write(`${stack}\n`);
            // Union has no "internal"/"unexpected": invalid-project is the same code
            // runGraceCommand already used for non-GraceCommandError fallbacks.
            throw new GraceCommandError("invalid-project", message);
          }
        },
        "Unable to complete the GRACE command.",
      );
    },
  };

  (wrapped as CommandDef<T> & Record<symbol, true>)[BOOLEAN_SPACE_GUARD_BRAND] = true;
  return defineCommand(wrapped);
}

/** True when citty Resolvable form is a function or thenable — not statically readable. */
function isLazyResolvable(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "function") return true;
  return typeof value === "object" && "then" in (value as object);
}

/**
 * Walk live command objects and list every type==="boolean" arg site.
 * Coverage denominator is this walk (live sites), not a source-text grep (F10).
 *
 * Throws when it meets args / subCommands / a subCommand entry it cannot read
 * statically (function or promise). Silent under-count is forbidden: the number
 * this walker returns is AC-CLASS-COVERAGE's denominator.
 */
export function listBooleanFlags(
  roots: ReadonlyArray<{ name: string; command: CommandDef<any> }>,
): BooleanFlagSite[] {
  const sites: BooleanFlagSite[] = [];

  function walk(path: string, cmd: CommandDef<any>): void {
    const args = cmd.args;
    if (args !== undefined && args !== null) {
      if (isLazyResolvable(args)) {
        throw new Error(
          `listBooleanFlags: cannot read args at \`${path}\` (function or promise Resolvable). ` +
            `Refuse to under-count; make args a plain object or resolve before walking.`,
        );
      }
      if (typeof args === "object") {
        for (const [name, def] of Object.entries(args as ArgsDef)) {
          if (def && typeof def === "object" && def.type === "boolean") {
            sites.push({ path, name, default: def.default });
          }
        }
      }
    }

    const subs = cmd.subCommands;
    if (subs !== undefined && subs !== null) {
      if (isLazyResolvable(subs)) {
        throw new Error(
          `listBooleanFlags: cannot read subCommands at \`${path}\` (function or promise Resolvable). ` +
            `Refuse to under-count; make subCommands a plain object or resolve before walking.`,
        );
      }
      if (typeof subs === "object") {
        for (const [subName, sub] of Object.entries(subs as Record<string, unknown>)) {
          const childPath = path ? `${path}.${subName}` : subName;
          if (isLazyResolvable(sub)) {
            throw new Error(
              `listBooleanFlags: cannot read subCommand at \`${childPath}\` (function or promise Resolvable). ` +
                `Refuse to under-count; make the entry a plain command def or resolve before walking.`,
            );
          }
          if (sub && typeof sub === "object") {
            walk(childPath, sub as CommandDef<any>);
          }
        }
      }
    }
  }

  for (const root of roots) {
    walk(root.name, root.command);
  }
  return sites;
}
