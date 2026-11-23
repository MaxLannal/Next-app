import { useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { DataBackups } from './DataBackups.tsx';
import { GitHubSetup } from './GitHubSetup.tsx';
import { Permissions } from './Permissions.tsx';
import { PhoneAccess } from './PhoneAccess.tsx';
import { SleepSetup } from './SleepSetup.tsx';
import { messageOf, settingsQuery, useSettings } from './useSettings.ts';
import './settings.css';

/**
 * Settings: the phone over Tailscale, the sleep Shortcut, the GitHub repository,
 * macOS permissions and the data folder. The hub reads its gateway at startup,
 * so a gateway changed by setup waits for a restart.
 */
export function SettingsPage() {
  const { query, save } = useSettings();
  const queryClient = useQueryClient();

  return (
    <div className="container page settings">
      <h1>Settings</h1>
      <p className="page__lead">Phone access, sleep, GitHub, permissions and backups.</p>

      {query.isLoading ? (
        <p className="settings-status" role="status">
          Reading settings…
        </p>
      ) : query.isError || !query.data ? (
        <EmptyState
          title="Couldn’t read the settings"
          line={messageOf(query.error, 'The hub didn’t answer.')}
          action={
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <div className="settings__sections">
          <PhoneAccess settings={query.data} onSave={save} />
          <SleepSetup settings={query.data} />
          <GitHubSetup github={query.data.github} />
          <Permissions settings={query.data} />
          <DataBackups
            dataDir={query.data.dataDir}
            lastBackupAt={query.data.lastBackupAt}
            onBackedUp={() => void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey })}
          />
        </div>
      )}
    </div>
  );
}
