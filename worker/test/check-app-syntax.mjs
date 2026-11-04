import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const html = await readFile(join(root, "index.html"), "utf8");
const scripts = [];
let cursor = 0;

while (true) {
  const start = html.indexOf("<script", cursor);
  if (start < 0) break;
  const openingEnd = html.indexOf(">", start);
  if (openingEnd < 0) break;
  const closingStart = html.indexOf("</script>", openingEnd + 1);
  if (closingStart < 0) break;
  const attributes = html.slice(start + 7, openingEnd).toLowerCase();
  if (attributes.includes('type="module"') || attributes.includes("type='module'")) {
    scripts.push(html.slice(openingEnd + 1, closingStart));
  }
  cursor = closingStart + 9;
}

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
