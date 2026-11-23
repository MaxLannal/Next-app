import type { SettingsView } from '@shared/types.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataBackups, formatDay } from './DataBackups.tsx';
import { formatWhen, GitHubSetup } from './GitHubSetup.tsx';
import { PhoneAccess } from './PhoneAccess.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { SleepSetup } from './SleepSetup.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const settings: SettingsView = {
  hasPasscode: true,
  keepAwake: false,
  timeZone: 'America/Chicago',
  sleepTargetHours: 8,
  dataDir: '/Users/you/PersonalHub',
  ingestUrl: 'http://100.101.102.103:4747/api/ingest/sleep',
  ingestHost: '100.101.102.103',
  tailscale: true,
  hubToken: 'a'.repeat(64),
  github: { configured: false, repo: null, lastSyncAt: null, lastError: null, pending: 0 },
  calendar: 'granted',
  media: 'no-accessibility',
  model: 'claude-opus-5-5',
  lastBackupAt: '2026-11-22',
};

function withClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('SettingsPage', () => {
  it('shows every section once the settings arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(settings)));
    withClient(<SettingsPage />);

    expect(await screen.findByRole('region', { name: 'Phone access' })).toBeTruthy();
    for (const name of ['Sleep', 'GitHub', 'Permissions', 'Data']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getByText('http://100.101.102.103:4747')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sleep' }).textContent).toContain('http://100.101.102.103:4747/api/ingest/sleep');
    expect(screen.getByText('/Users/you/PersonalHub')).toBeTruthy();
    expect(screen.getByText('Needs Accessibility')).toBeTruthy();
  });

  it('gives a retry instead of sections when the hub can’t be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'login required' }, 401)));
    withClient(<SettingsPage />);
    expect(await screen.findByText('Couldn’t read the settings')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('PhoneAccess', () => {
  it('sets a passcode of six characters or more', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (patch: object) => ({ ...settings, ...patch }));
    render(<PhoneAccess settings={{ ...settings, hasPasscode: false }} onSave={save} />);

    const form = screen.getByRole('button', { name: 'Set passcode' }).closest('form') as HTMLFormElement;
    await user.type(within(form).getByLabelText('Passcode'), '123');
    await user.click(screen.getByRole('button', { name: 'Set passcode' }));
    expect(screen.getByRole('alert').textContent).toContain('6 characters');
    expect(save).not.toHaveBeenCalled();

    await user.clear(within(form).getByLabelText('Passcode'));
    await user.type(within(form).getByLabelText('Passcode'), 'hunter22');
    await user.type(within(form).getByLabelText('Repeat passcode'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Set passcode' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ passcode: 'hunter22' }));
  });

  it('keeps the two passcodes equal', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (patch: object) => ({ ...settings, ...patch }));
    render(<PhoneAccess settings={settings} onSave={save} />);

    await user.type(screen.getByLabelText('Passcode'), 'hunter22');
    await user.type(screen.getByLabelText('Repeat passcode'), 'hunter23');
    await user.click(screen.getByRole('button', { name: 'Change passcode' }));
    expect(screen.getByRole('alert').textContent).toContain('don’t match');
    expect(save).not.toHaveBeenCalled();
  });

  it('turns keep-awake on', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (patch: object) => ({ ...settings, ...patch }));
    render(<PhoneAccess settings={settings} onSave={save} />);

    await user.click(screen.getByRole('switch', { name: 'Keep the Mac awake while plugged in' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ keepAwake: true }));
  });
});

describe('the sleep history import', () => {
  it('posts the export to the hub’s ingest route and shows how many samples it added', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => json({ inserted: 1204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SleepSetup settings={settings} />);

    const file = new File(['<HealthData></HealthData>'], 'export.xml', { type: 'application/xml' });
    await user.upload(screen.getByLabelText('Upload a Health export'), file);

    await waitFor(() => expect(screen.getByText('Added 1204 samples')).toBeTruthy());
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/ingest/health-export');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('says plainly when the hub couldn’t read the export', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Could not read the export: bad XML' }, 400)));
    render(<SleepSetup settings={settings} />);
    await user.upload(screen.getByLabelText('Upload a Health export'), new File(['x'], 'export.xml'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not read the export: bad XML');
  });
});

describe('the other sections', () => {
  it('GitHub shows the status and offers sync once connected', async () => {
    render(
      <GitHubSetup
        github={{ configured: true, repo: 'max/work-journal', lastSyncAt: '2026-11-22T20:02:00.000Z', lastError: 'push failed — retry', pending: 2 }}
      />,
    );
    expect(screen.getByDisplayValue('max/work-journal')).toBeTruthy();
    expect(screen.getByText('2 files')).toBeTruthy();
    expect(screen.getByText(/push failed — retry/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('GitHub refuses a name that isn’t owner/name', () => {
    render(<GitHubSetup github={settings.github} />);
    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true); // the default "work-journal" has no owner yet
  });

  it('Data backs up on demand', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => json({ file: '/Users/you/PersonalHub/backups/hub-2026-11-22.db' }));
    vi.stubGlobal('fetch', fetchMock);
    const onBackedUp = vi.fn();
    render(<DataBackups dataDir="/Users/you/PersonalHub" lastBackupAt={null} onBackedUp={onBackedUp} />);

    expect(screen.getByText('No backup yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() => expect(onBackedUp).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/backup', expect.objectContaining({ method: 'POST' }));
  });

  it('formats days and times the Dusk way', () => {
    expect(formatDay('2026-11-22')).toBe('22 Nov 2026');
    expect(formatDay(null)).toBe('No backup yet');
    expect(formatWhen(null)).toBe('Never');
    const now = new Date(2026, 10, 22, 18, 0);
    expect(formatWhen(new Date(2026, 10, 22, 20, 2).toISOString(), now)).toBe('20:02');
    expect(formatWhen(new Date(2026, 10, 19, 14, 2).toISOString(), now)).toBe('Thu 19 Nov, 14:02');
  });
});
