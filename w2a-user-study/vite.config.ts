import { sites } from '@openai/sites-vite-plugin';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv, type Plugin } from 'vite';
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

const ENTITY_DOMAINS = ['roads', 'content', 'restaurants', 'stations'];

// Target words come from L2-KPNS/metadata/recording_targets/{domain}_200.csv.
// L2-KPNS lives at /home/user/L2-KPNS; L2_KPNS_DIR overrides it.
const DEFAULT_L2_KPNS_DIR = '/home/user/L2-KPNS';

function findRecordingTargetsDir(configured?: string) {
  const root = resolve(configured ?? DEFAULT_L2_KPNS_DIR);
  for (const dir of [join(root, 'metadata', 'recording_targets'), root]) {
    if (ENTITY_DOMAINS.some((domain) => existsSync(join(dir, `${domain}_200.csv`)))) return dir;
  }
  return '';
}

function recordingTargets(configured?: string): Plugin {
  const publicId = 'virtual:recording-targets';
  const resolvedId = '\0' + publicId;
  return {
    name: 'w2a-recording-targets',
    resolveId(id) {
      if (id === publicId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      const sourceDir = findRecordingTargetsDir(configured);
      const csvByDomain: Record<string, string> = {};
      for (const domain of ENTITY_DOMAINS) {
        const path = sourceDir && join(sourceDir, `${domain}_200.csv`);
        if (path && existsSync(path)) {
          this.addWatchFile(path);
          csvByDomain[domain] = readFileSync(path, 'utf8');
        }
      }
      if (!sourceDir)
        this.warn(
          `No recording_targets/{domain}_200.csv found under ${configured ?? DEFAULT_L2_KPNS_DIR}. Set L2_KPNS_DIR to the L2-KPNS folder.`,
        );
      return (
        `export const csvByDomain = ${JSON.stringify(csvByDomain)};\n` +
        `export const sourceDir = ${JSON.stringify(sourceDir)};\n`
      );
    },
  };
}

export default defineConfig(async ({ mode }) => {
  // Pass only the ASR settings to the Worker; root .env isn't read by
  // `wrangler dev --config dist/server/wrangler.json` after the build.
  const fileEnv = loadEnv(mode, process.cwd(), ['W2A_', 'HTTPS_', 'L2_KPNS_']);
  const l2KpnsDir = (process.env.L2_KPNS_DIR ?? fileEnv.L2_KPNS_DIR)?.trim() || undefined;
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
      recordingTargets(l2KpnsDir),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: { ...localBindingConfig, vars: asrVars },
      }),
    ],
  };
});
