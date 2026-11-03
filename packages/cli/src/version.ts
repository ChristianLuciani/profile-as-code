/**
 * The installed CLI version — ONE home (#434).
 *
 * `--version`, `pasco doctor`, the `.pascorc` engine gate and `pasco init`'s
 * birth-time floor all describe the SAME engine. It is read from the package
 * manifest at module load, never typed: a literal would drift from the released
 * version and turn `init` into a workspace that declares a floor its own engine
 * cannot prove it meets.
 *
 * `init` used to be the one surface that did not need the version; now it writes
 * it into `.pascorc`, so the read moved out of the dispatcher instead of being
 * duplicated.
 */

import { readFileSync } from "node:fs";

export const CLI_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
})();
