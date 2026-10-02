import { sites } from '@openai/sites-vite-plugin';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  // Pass only the ASR settings to the Worker; root .env isn't read by
  // `wrangler dev --config dist/server/wrangler.json` after the build.
  const fileEnv = loadEnv(mode, process.cwd(), ['W2A_', 'HTTPS_']);
  const asrVars: Record<string, string> = {};
  for (const name of ['W2A_API_URL', 'W2A_DOMAIN', 'W2A_TOP_K']) {
    const value = process.env[name] ?? fileEnv[name];
    if (value?.trim()) asrVars[name] = value.trim();
  }
  const certPath = process.env.HTTPS_CERT_PATH ?? fileEnv.HTTPS_CERT_PATH;
  const keyPath = process.env.HTTPS_KEY_PATH ?? fileEnv.HTTPS_KEY_PATH;
  if (Boolean(certPath) !== Boolean(keyPath))
    throw new Error('Set both HTTPS_CERT_PATH and HTTPS_KEY_PATH.');
  const https =
    certPath && keyPath
      ? {
          cert: readFileSync(resolve(certPath)),
          key: readFileSync(resolve(keyPath)),
        }
      : undefined;
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      host: '0.0.0.0',
      https,
      watch: isCodexSeatbeltSandbox
        ? { useFsEvents: false, usePolling: true }
        : undefined,
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: { ...localBindingConfig, vars: asrVars },
      }),
    ],
  };
});
