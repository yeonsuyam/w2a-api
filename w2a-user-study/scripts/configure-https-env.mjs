import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(".env");
const examplePath = resolve(".env.example");
const sourcePath = existsSync(envPath) ? envPath : examplePath;

if (!existsSync(sourcePath)) {
  console.error("Neither .env nor .env.example exists.");
  process.exit(1);
}

const httpsKeys = new Set(["HTTPS_CERT_PATH", "HTTPS_KEY_PATH"]);
const lines = readFileSync(sourcePath, "utf8")
  .split(/\r?\n/)
  .filter((line) => {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    return !match || !httpsKeys.has(match[1]);
  });

while (lines.at(-1) === "") lines.pop();

lines.push(
  "",
  "# HTTPS certificate copied by npm run setup:https:8003",
  "HTTPS_CERT_PATH=.certs/cert.pem",
  "HTTPS_KEY_PATH=.certs/key.pem",
  "",
);

writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log("Configured .env to use .certs/cert.pem and .certs/key.pem.");
