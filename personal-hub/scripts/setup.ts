// `npm run setup`: brings this Mac's hub up from nothing, start to finish. Every
// step is safe to repeat; one that's already done prints "–" with the reason and
// the run carries on.
//
//   npm run setup                 build, helpers, config, model check, permissions, passcode
//   npm run setup -- --launchd    also start the hub at login (when the user asks for it)
//   npm run setup -- --install-app  also copy dist/Hub.app to ~/Applications
//
// Configuration is read from the shell when the config is empty:
//   ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, with optional ANTHROPIC_MODEL as a fallback.
import Anthropic from '@anthropic-ai/sdk';
import { execFile, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { hashPasscode } from '../server/auth.ts';
import { anthropicSettings, createConfigStore } from '../server/config.ts';
import { hubPaths } from '../server/paths.ts';
import { backupCopy, dayKey } from '../server/services/backup.ts';
import { configFromEnv, fillPlist, LAUNCH_AGENT_LABEL, modelCandidates } from './setup-config.ts';

/** Node 26 runs the server's TypeScript directly; nothing older does. */
const MIN_NODE_MAJOR = 26;
const PASSCODE_MIN = 6;
const PLIST_TEMPLATE = fileURLToPath(new URL('./launchd.plist.template', import.meta.url));

const HUB_DIR = fileURLToPath(new URL('..', import.meta.url));
const APP_PATH = join(HUB_DIR, 'dist', 'Hub.app');
const INSTALLED_APP = join(homedir(), 'Applications', 'Hub.app');

const flags = new Set(process.argv.slice(2));
const say = (line = '') => console.log(line);
const ok = (message: string) => say(`✓ ${message}`);
const skip = (reason: string) => say(`– skipped: ${reason}`);

class StepFailed extends Error {}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(cmd, args, { cwd: opts.cwd ?? HUB_DIR, env: opts.env ?? process.env, encoding: 'utf8' });
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** Runs a command that must succeed; the last line of its output is the reason when it doesn't. */
function must(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  const result = run(cmd, args, opts);
  if (result.code !== 0) {
    const last = result.out.split('\n').filter(Boolean).at(-1) ?? `exit ${result.code}`;
    throw new StepFailed(`${cmd} ${args.join(' ')} failed: ${last}`);
  }
  return result;
}

// ── 1. Node ────────────────────────────────────────────────────────────────
function checkNode(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new StepFailed(`Node ${process.versions.node} is too old — install Node ${MIN_NODE_MAJOR} or newer, then run setup again`);
  }
  ok(`Node ${process.versions.node}`);
}

// ── 2. Web build ───────────────────────────────────────────────────────────
function buildWeb(): void {
  must('npm', ['run', 'build']);
  ok('Built the web app into web/dist');
}

// ── 3. Swift helpers ───────────────────────────────────────────────────────
function buildHelpers(): void {
  if (run('xcode-select', ['-p']).code !== 0) {
    skip('the Swift toolchain isn’t installed — run xcode-select --install, then setup again');
    return;
  }
  const built = must('bash', ['scripts/build-helpers.sh']);
  ok(built.out.split('\n').at(-1) ?? 'Built the Swift helpers');
}

// ── 4. Data folder and config ─────────────────────────────────────────────
const paths = hubPaths(process.env.HUB_DATA_DIR ?? join(homedir(), 'PersonalHub'));

function ensureConfig(): void {
  const before = anthropicSettings(paths.configFile);
  const patch = before.baseURL === null && before.authToken === null ? configFromEnv(process.env) : {};
  const config = createConfigStore(paths.configFile); // creates a fresh config with its secrets
  if (Object.keys(patch).length > 0) config.update(patch);

  const after = anthropicSettings(paths.configFile);
  say(`  Data folder: ${paths.dataDir}`);
  if (after.baseURL !== null && after.authToken !== null) ok(`Config has a gateway (${after.baseURL}), token saved`);
  else if (Object.keys(patch).length > 0) skip('the gateway needs both ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN — set both, then setup again');
  else ok('Config kept as it was');
}

// ── 5. Model smoke test ────────────────────────────────────────────────────
async function smokeModel(): Promise<void> {
  const gateway = anthropicSettings(paths.configFile);
  if (gateway.baseURL === null || gateway.authToken === null) {
    skip('no gateway in config — the model check needs one');
    return;
  }
  const client = new Anthropic({ baseURL: gateway.baseURL, authToken: gateway.authToken, apiKey: null, maxRetries: 0 });
  let lastError: unknown = null;
  for (const model of modelCandidates(gateway.model, process.env.ANTHROPIC_MODEL)) {
    try {
      const reply = await client.messages.create({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word ready.' }],
      });
      if (model !== gateway.model) createConfigStore(paths.configFile).update({ anthropic: { model } });
      const text = reply.content.find((block) => block.type === 'text');
      const said = text?.type === 'text' ? ` — it said “${text.text.trim()}”` : '';
      ok(`Model ${model} answered${said}`);
      return;
    } catch (err) {
      lastError = err;
      if (err instanceof Anthropic.NotFoundError) continue; // the gateway has no such model: try the fallback
      break;
    }
  }
  const reason = lastError instanceof Anthropic.NotFoundError ? 'the gateway knows neither model' : (lastError as Error)?.message;
  skip(`the model check didn’t pass: ${reason ?? 'no reply'}`);
}

// ── 6. Calendar access ────────────────────────────────────────────────────
const CALENDAR_HELPER = join(HUB_DIR, 'mac', 'bin', 'calendar-helper');
const MEDIA_HELPER = join(HUB_DIR, 'mac', 'bin', 'media-helper');

async function askCalendar(): Promise<void> {
  if (!existsSync(CALENDAR_HELPER)) {
    skip('the calendar helper isn’t built — run setup again after the helpers build');
    return;
  }
  must(CALENDAR_HELPER, ['request']);
  const status = run(CALENDAR_HELPER, ['status']);
  let authorized = false;
  try {
    authorized = (JSON.parse(status.out) as { authorized?: boolean }).authorized === true;
  } catch {
    // An unreadable status is a refusal, handled below.
  }
  if (authorized) ok('Calendar access granted');
  else skip('calendar access wasn’t granted — allow Hub under System Settings → Privacy & Security → Calendars');
}

// ── 7. Media (Accessibility) ──────────────────────────────────────────────
function checkMedia(): void {
  if (!existsSync(MEDIA_HELPER)) {
    skip('the media helper isn’t built — run setup again after the helpers build');
    return;
  }
  const status = run(MEDIA_HELPER, ['status']);
  let accessibility: unknown = undefined;
  try {
    accessibility = (JSON.parse(status.out) as { accessibility?: unknown }).accessibility;
  } catch {
    // Unreadable: reported as no access below.
  }
  if (accessibility === true) {
    ok('Media controls have Accessibility access');
  } else if (accessibility === false) {
    skip(
      'media controls need Accessibility — open System Settings → Privacy & Security → Accessibility, click +, and add ' +
        HUB_DIR +
        ' (the folder setup ran from)',
    );
  } else {
    skip('the media helper didn’t answer — the now-playing controls will show on their own');
  }
}

// ── 8. Passcode ───────────────────────────────────────────────────────────
async function askPasscode(): Promise<void> {
  const cfg = createConfigStore(paths.configFile).get();
  if (cfg.passcodeHash !== null) {
    skip('a passcode is already set — change it in Settings on the Mac');
    return;
  }
  if (!process.stdin.isTTY) {
    skip('there’s no terminal to ask in — set the passcode in Settings on the Mac');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let passcode = '';
    while (passcode.length < PASSCODE_MIN) {
      passcode = (await rl.question(`Passcode for your phone (at least ${PASSCODE_MIN} characters): `)).trim();
      if (passcode.length < PASSCODE_MIN && passcode !== '') say(`  ${PASSCODE_MIN} characters or more, please.`);
    }
    createConfigStore(paths.configFile).update({ passcodeHash: await hashPasscode(passcode) });
    ok('Passcode set');
  } finally {
    rl.close();
  }
}

// ── 9. The app in ~/Applications ─────────────────────────────────────────
function installApp(): void {
  const built = run('bash', ['scripts/build-app.sh']);
  if (built.code !== 0 || !existsSync(APP_PATH)) {
    skip(`the Mac app didn’t build — ${built.out.split('\n').filter(Boolean).at(-1) ?? 'see the build output above'}`);
    return;
  }
  mkdirSync(dirname(INSTALLED_APP), { recursive: true });
  rmSync(INSTALLED_APP, { recursive: true, force: true });
  run('ditto', [APP_PATH, INSTALLED_APP]);
  ok(`Installed Hub in ${INSTALLED_APP}`);
}

// ── 10. launchd ───────────────────────────────────────────────────────────
function installLaunchAgent(): void {
  if (platform() !== 'darwin') {
    skip('launchd is macOS only');
    return;
  }
  const plistFile = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
  const template = readFileSync(PLIST_TEMPLATE, 'utf8');
  const plist = fillPlist(template, {
    NODE: process.execPath,
    MAIN: join(HUB_DIR, 'server', 'main.ts'),
    HUB_DIR,
    DATA_DIR: paths.dataDir,
    LOG_DIR: paths.logsDir,
  });
  mkdirSync(dirname(plistFile), { recursive: true });
  writeFileSync(plistFile, plist);

  const domain = `gui/${process.getuid?.() ?? 0}`;
  run('launchctl', ['bootout', domain, plistFile]); // quietly, when it wasn't running
  const boot = run('launchctl', ['bootstrap', domain, plistFile]);
  if (boot.code !== 0) {
    skip(`launchd didn’t take the agent: ${boot.out.split('\n').at(-1) ?? `exit ${boot.code}`}`);
    return;
  }
  ok(`Hub starts at login (${plistFile})`);
}

// ── After a reset: an empty database, with a backup of the old one ───────
export function resetData(): void {
  if (!existsSync(paths.dbFile)) {
    skip('there’s no database to reset');
    return;
  }
  mkdirSync(paths.backupsDir, { recursive: true });
  const backup = join(paths.backupsDir, `hub-${dayKey(new Date(), 'UTC')}-reset.db`);
  backupCopy(paths.dbFile, backup);
  rmSync(paths.dbFile, { force: true });
  for (const suffix of ['-wal', '-shm']) rmSync(paths.dbFile + suffix, { force: true });
  ok(`Cleared the database; the old one is in ${backup}`);
}

// ── Run ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  say('Personal Hub setup');
  const steps: Array<[string, () => void | Promise<void>]> = [
    ['Checking Node', checkNode],
    ['Building the web app', buildWeb],
    ['Building the Mac helpers', buildHelpers],
    ['Preparing the data folder and config', ensureConfig],
    ['Checking the model', smokeModel],
    ['Asking for calendar access', askCalendar],
    ['Checking media access', checkMedia],
    ['Setting a passcode', askPasscode],
  ];
  if (flags.has('--reset')) steps.push(['Clearing the database', resetData]);
  if (flags.has('--install-app')) steps.push(['Installing the Mac app', installApp]);
  if (flags.has('--launchd')) steps.push(['Starting the hub at login', installLaunchAgent]);

  let failed = false;
  for (const [name, step] of steps) {
    say(`\n${name}`);
    try {
      await step();
    } catch (err) {
      if (!(err instanceof StepFailed)) throw err;
      say(`✗ ${err.message}`);
      failed = true;
      if (name === 'Checking Node') break;
    }
  }

  const { port } = createConfigStore(paths.configFile).get();
  say(`\nOpen http://localhost:${port}\n`);
  say('The hub reads its gateway at startup, so a gateway changed here needs a restart.');
  process.exitCode = failed ? 1 : 0;
}

void main();
