import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const html = await readFile(join(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)]
  .filter((match) => /\\btype\\s*=\\s*["']module["']/i.test(match[1]))
  .map((match) => match[2]);

if (!scripts.length) throw new Error("No se encontró ningún script type=module en index.html.");

for (let index = 0; index < scripts.length; index++) {
  const file = join(tmpdir(), "barber-vip-module-" + index + ".mjs");
  await writeFile(file, scripts[index], "utf8");
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  await unlink(file).catch(() => {});
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "Error de sintaxis en el módulo " + index);
    process.exit(result.status || 1);
  }
}
console.log("index.html: " + scripts.length + " módulos JavaScript verificados.");
