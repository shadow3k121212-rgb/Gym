import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("serves the beta shell and required assets", async (t) => {
  const port = 4187;
  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("dev server did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("GYM running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error("dev server exited with " + code)));
  });

  t.after(() => child.kill("SIGTERM"));

  for (const path of ["/", "/index.html", "/src/app.js", "/src/data.js", "/src/storage.js", "/src/styles.css", "/src/sw.js", "/public/manifest.webmanifest", "/public/runtime-config.js"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, 200, path);
  }

  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /GYM — Training OS/);
});
