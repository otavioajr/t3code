import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { InfoIcon, LockIcon, PlugIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ProviderDriverKind,
  type EnvironmentId,
  type ProviderInstanceId,
  type ProviderPlugin,
  type ProviderPluginsSnapshot,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { ensureLocalApi } from "../../localApi";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  ADD_MARKETPLACE_TARGET,
  describePluginsFailure,
  describePluginsReadiness,
  groupPluginsByMarketplace,
  marketplaceTarget,
  pluginActionTarget,
  pluginCountLabel,
  pluginTarget,
  vanishedPluginTargets,
  type PluginAction,
  type PluginMarketplaceGroup,
  type PluginsFailureView,
} from "./pluginsSettings.logic";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");

interface PluginActionError {
  readonly action: PluginAction;
  readonly view: PluginsFailureView;
}

type PluginActionErrors = ReadonlyMap<string, PluginActionError>;

/**
 * Plugins are installed into a Claude instance on one environment, so the page
 * manages that environment's Claude instances. Only marketplaces the user added
 * are listed; there is no catalog to browse.
 */
export function PluginsSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const serverProviders = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const claudeInstances = useMemo(
    () =>
      (serverProviders ?? EMPTY_SERVER_PROVIDERS).filter(
        (provider) => provider.driver === CLAUDE_DRIVER,
      ),
    [serverProviders],
  );
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | null>(null);
  const instance =
    claudeInstances.find((provider) => provider.instanceId === selectedInstanceId) ??
    claudeInstances[0] ??
    null;

  if (serverProviders === null) {
    return (
      <SettingsPageContainer>
        <div className="flex items-center gap-2 px-3 text-sm text-muted-foreground sm:px-4">
          <Spinner size="sm" /> Loading providers
        </div>
      </SettingsPageContainer>
    );
  }

  if (instance === null) {
    return (
      <SettingsPageContainer>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>No Claude provider instance</EmptyTitle>
            <EmptyDescription>
              Plugins are managed by Claude Code. Add a Claude instance in Providers to install
              plugins on this environment.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      {/* Keyed by instance: switching instances remounts and reloads the list. */}
      <PluginsInstancePanel
        key={instance.instanceId}
        environmentId={environmentId}
        instance={instance}
        instances={claudeInstances}
        onSelectInstance={setSelectedInstanceId}
      />
    </SettingsPageContainer>
  );
}

function PluginsInstancePanel({
  environmentId,
  instance,
  instances,
  onSelectInstance,
}: {
  readonly environmentId: EnvironmentId;
  readonly instance: ServerProvider;
  readonly instances: ReadonlyArray<ServerProvider>;
  readonly onSelectInstance: (instanceId: ProviderInstanceId) => void;
}) {
  const instanceId = instance.instanceId;
  const navigate = useNavigate();
  const canManage = useAtomValue(
    serverEnvironment.addProviderPluginMarketplace.permissionAtom(environmentId),
  );
  const readiness = describePluginsReadiness(instance);
  const canChange = canManage && readiness?.blocksChanges !== true;
  const listPlugins = useAtomCommand(serverEnvironment.listProviderPlugins, {
    reportFailure: false,
  });
  const addMarketplace = useAtomCommand(serverEnvironment.addProviderPluginMarketplace, {
    reportFailure: false,
  });
  const removeMarketplace = useAtomCommand(serverEnvironment.removeProviderPluginMarketplace, {
    reportFailure: false,
  });
  const updateMarketplace = useAtomCommand(serverEnvironment.updateProviderPluginMarketplace, {
    reportFailure: false,
  });
  const installPlugin = useAtomCommand(serverEnvironment.installProviderPlugin, {
    reportFailure: false,
  });
  const uninstallPlugin = useAtomCommand(serverEnvironment.uninstallProviderPlugin, {
    reportFailure: false,
  });
  const setPluginEnabled = useAtomCommand(serverEnvironment.setProviderPluginEnabled, {
    reportFailure: false,
  });
  const [snapshot, setSnapshot] = useState<ProviderPluginsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailure, setLoadFailure] = useState<PluginsFailureView | null>(null);
  const [errors, setErrors] = useState<PluginActionErrors>(() => new Map());
  const [pendingTargets, setPendingTargets] = useState<ReadonlySet<string>>(() => new Set());
  // Refs guard re-entry: state can lag a second click that lands before the re-render.
  const loadingRef = useRef(false);
  const pendingRef = useRef<Set<string>>(new Set());
  const snapshotRef = useRef<ProviderPluginsSnapshot | null>(null);
  // A mutation answers with a snapshot taken after it ran. A list that was in flight
  // when one landed may predate it, so that list result is dropped.
  const mutationsLandedRef = useRef(0);

  // A row that left the list takes its failure with it, so re-adding it starts clean.
  const applySnapshot = useCallback((next: ProviderPluginsSnapshot) => {
    const vanished = vanishedPluginTargets(snapshotRef.current, next);
    snapshotRef.current = next;
    setSnapshot(next);
    if (vanished.size > 0) setErrors((current) => withoutTargets(current, vanished));
  }, []);

  const requestPlugins = useCallback(async () => {
    const mutationsBefore = mutationsLandedRef.current;
    const result = await listPlugins({ environmentId, input: { instanceId } });
    if (result._tag === "Success") {
      if (mutationsLandedRef.current === mutationsBefore) applySnapshot(result.value);
      setLoadFailure(null);
    } else if (!isAtomCommandInterrupted(result)) {
      setLoadFailure(describePluginsFailure("load", squashAtomCommandFailure(result)));
    }
  }, [applySnapshot, environmentId, instanceId, listPlugins]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- State changes only after the list response arrives.
    void requestPlugins();
  }, [requestPlugins]);

  const refreshPlugins = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    await requestPlugins();
    loadingRef.current = false;
    setLoading(false);
  }, [requestPlugins]);

  const dispatch = useCallback(
    (action: PluginAction): Promise<AtomCommandResult<ProviderPluginsSnapshot, unknown>> => {
      switch (action.kind) {
        case "add-marketplace":
          return addMarketplace({ environmentId, input: { instanceId, source: action.source } });
        case "update-marketplace":
          return updateMarketplace({
            environmentId,
            input: { instanceId, marketplace: action.marketplace },
          });
        case "remove-marketplace":
          return removeMarketplace({
            environmentId,
            input: { instanceId, marketplace: action.marketplace },
          });
        case "install-plugin":
          return installPlugin({ environmentId, input: { instanceId, pluginId: action.pluginId } });
        case "uninstall-plugin":
          return uninstallPlugin({
            environmentId,
            input: { instanceId, pluginId: action.pluginId },
          });
        case "set-plugin-enabled":
          return setPluginEnabled({
            environmentId,
            input: { instanceId, pluginId: action.pluginId, enabled: action.enabled },
          });
      }
    },
    [
      addMarketplace,
      environmentId,
      instanceId,
      installPlugin,
      removeMarketplace,
      setPluginEnabled,
      uninstallPlugin,
      updateMarketplace,
    ],
  );

  /** Resolves true when the change landed, so the add form knows to clear its draft. */
  const runAction = useCallback(
    async (action: PluginAction): Promise<boolean> => {
      const target = pluginActionTarget(action);
      if (pendingRef.current.has(target)) return false;
      pendingRef.current.add(target);
      setPendingTargets(new Set(pendingRef.current));
      const result = await dispatch(action);
      pendingRef.current.delete(target);
      setPendingTargets(new Set(pendingRef.current));
      if (result._tag === "Success") {
        mutationsLandedRef.current += 1;
        applySnapshot(result.value);
        // A change answers with a fresh snapshot, so an earlier failed load no longer applies.
        setLoadFailure(null);
        setErrors((current) => withoutTargets(current, new Set([target])));
        return true;
      }
      if (isAtomCommandInterrupted(result)) return false;
      const view = describePluginsFailure(action.kind, squashAtomCommandFailure(result));
      setErrors((current) => new Map(current).set(target, { action, view }));
      // The change may have landed even though its answer failed, or the row may be stale.
      // Re-reading the list shows what is really installed while the failure stays visible.
      void refreshPlugins();
      return false;
    },
    [applySnapshot, dispatch, refreshPlugins],
  );

  // Removing a marketplace or uninstalling a plugin is hard to undo, so both ask first.
  const confirmThen = useCallback(
    async (action: PluginAction, message: string) => {
      const confirmed = await ensureLocalApi().dialogs.confirm(message, {
        variant: "destructive",
      });
      if (confirmed) await runAction(action);
    },
    [runAction],
  );

  const submitMarketplace = useCallback(
    (source: string) => runAction({ kind: "add-marketplace", source }),
    [runAction],
  );

  const groups = useMemo(
    () => (snapshot === null ? [] : groupPluginsByMarketplace(snapshot)),
    [snapshot],
  );
  const addPending = pendingTargets.has(ADD_MARKETPLACE_TARGET);
  const addError = errors.get(ADD_MARKETPLACE_TARGET);

  return (
    <SettingsSection
      title="Marketplaces"
      headerAction={
        <div className="flex items-center gap-2">
          {instances.length > 1 ? (
            <InstanceSelect instance={instance} instances={instances} onSelect={onSelectInstance} />
          ) : null}
          <Button
            size="xs"
            variant="outline"
            disabled={loading}
            onClick={() => void refreshPlugins()}
          >
            <RefreshIcon refreshing={loading} size="xs" />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      }
    >
      {readiness ? (
        <div className="px-3 py-3 sm:px-4">
          <Alert variant={readiness.tone}>
            {readiness.tone === "info" ? <InfoIcon /> : <TriangleAlertIcon />}
            <AlertTitle>{readiness.heading}</AlertTitle>
            <AlertDescription>{readiness.message}</AlertDescription>
            <AlertAction>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void navigate({
                    to: "/settings/providers",
                    search: { environmentId, instanceId },
                  })
                }
              >
                Open Providers
              </Button>
            </AlertAction>
          </Alert>
        </div>
      ) : null}

      {canManage ? null : (
        <div className="px-3 py-3 sm:px-4">
          <Alert variant="info">
            <InfoIcon />
            <AlertDescription>
              This connection can view plugins but cannot change them.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {loadFailure ? (
        <div className="px-3 py-3 sm:px-4">
          <PluginsFailureAlert
            view={loadFailure}
            retrying={loading}
            onRetry={() => void refreshPlugins()}
          />
        </div>
      ) : null}

      <AddMarketplaceRow
        canChange={canChange}
        pending={addPending}
        error={addError?.view}
        onSubmit={submitMarketplace}
        onRetry={() => {
          if (addError) void runAction(addError.action);
        }}
      />

      {snapshot === null && loadFailure === null ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground sm:px-4">
          <Spinner size="sm" /> Loading plugins
        </div>
      ) : null}
      {snapshot !== null && groups.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground sm:px-4">
          No marketplaces yet. Add a repository above to see its plugins.
        </p>
      ) : null}
      {groups.map((group) => (
        <MarketplaceBlock
          key={group.name}
          group={group}
          canChange={canChange}
          pendingTargets={pendingTargets}
          errors={errors}
          onAction={(action) => void runAction(action)}
          onConfirmedAction={(action, message) => void confirmThen(action, message)}
        />
      ))}
    </SettingsSection>
  );
}

/**
 * The draft lives here, not in the panel, so typing re-renders this row alone and not
 * every marketplace and plugin row beneath it.
 */
function AddMarketplaceRow({
  canChange,
  pending,
  error,
  onSubmit,
  onRetry,
}: {
  readonly canChange: boolean;
  readonly pending: boolean;
  readonly error: PluginsFailureView | undefined;
  readonly onSubmit: (source: string) => Promise<boolean>;
  readonly onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = draft.trim();
    if (!canChange || pending || source.length === 0) return;
    void onSubmit(source).then((added) => {
      if (added) setDraft((current) => (current.trim() === source ? "" : current));
    });
  };
  return (
    <SettingsRow
      title="Add marketplace"
      description="A GitHub repository, as owner/repo or its link. Its plugins are listed once added."
      control={
        <form
          className="flex w-full items-center gap-2 @min-[32rem]/settings-row:w-auto"
          onSubmit={submit}
        >
          <div className="min-w-0 flex-1 @min-[32rem]/settings-row:w-72">
            {/* Read-only while adding, not disabled: a disabled input drops focus, and Enter is how users add. */}
            <Input
              font="mono"
              size="sm"
              aria-label="Marketplace source"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="owner/repo or https://github.com/owner/repo"
              value={draft}
              disabled={!canChange}
              readOnly={pending}
              onValueChange={(value) => setDraft(value)}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!canChange || pending || draft.trim().length === 0}
          >
            {pending ? <Spinner size="xs" /> : <PlusIcon />}
            {pending ? "Adding" : "Add"}
          </Button>
        </form>
      }
    >
      {error ? (
        <div className="pb-2">
          <PluginsFailureAlert view={error} retrying={pending} onRetry={onRetry} />
        </div>
      ) : null}
    </SettingsRow>
  );
}

function MarketplaceBlock({
  group,
  canChange,
  pendingTargets,
  errors,
  onAction,
  onConfirmedAction,
}: {
  readonly group: PluginMarketplaceGroup;
  readonly canChange: boolean;
  readonly pendingTargets: ReadonlySet<string>;
  readonly errors: PluginActionErrors;
  readonly onAction: (action: PluginAction) => void;
  readonly onConfirmedAction: (action: PluginAction, message: string) => void;
}) {
  const target = marketplaceTarget(group.name);
  const busy = pendingTargets.has(target);
  const error = errors.get(target);
  const controlsDisabled = !canChange || busy;
  return (
    <div className="grid gap-2 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 sm:px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{group.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {group.source ?? (group.added ? "Source not reported" : "No longer added")}
            {" · "}
            {pluginCountLabel(group.plugins.length)}
          </p>
        </div>
        {group.added ? (
          <div className="flex shrink-0 items-center gap-1">
            {busy ? <Spinner size="sm" tone="muted" /> : null}
            <Button
              size="xs"
              variant="ghost-muted"
              aria-label={`Update marketplace ${group.name}`}
              disabled={controlsDisabled}
              onClick={() => onAction({ kind: "update-marketplace", marketplace: group.name })}
            >
              Update
            </Button>
            <Button
              size="xs"
              variant="ghost-destructive"
              aria-label={`Remove marketplace ${group.name}`}
              disabled={controlsDisabled}
              onClick={() =>
                onConfirmedAction(
                  { kind: "remove-marketplace", marketplace: group.name },
                  `Remove marketplace "${group.name}"? Plugins installed from it may be uninstalled too.`,
                )
              }
            >
              Remove
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="px-3 sm:px-4">
          <PluginsFailureAlert
            view={error.view}
            retrying={busy}
            onRetry={() => onAction(error.action)}
          />
        </div>
      ) : null}

      {group.plugins.length === 0 ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">
          No plugins in this marketplace.
        </p>
      ) : (
        <div className="divide-y divide-border/60 border-y border-border/60">
          {group.plugins.map((plugin) => {
            const pluginRowTarget = pluginTarget(plugin.id);
            return (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                canChange={canChange}
                busy={pendingTargets.has(pluginRowTarget)}
                error={errors.get(pluginRowTarget)}
                onAction={onAction}
                onConfirmedAction={onConfirmedAction}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PluginRow({
  plugin,
  canChange,
  busy,
  error,
  onAction,
  onConfirmedAction,
}: {
  readonly plugin: ProviderPlugin;
  readonly canChange: boolean;
  readonly busy: boolean;
  readonly error: PluginActionError | undefined;
  readonly onAction: (action: PluginAction) => void;
  readonly onConfirmedAction: (action: PluginAction, message: string) => void;
}) {
  const controlsDisabled = !canChange || busy;
  return (
    <div className="grid gap-2 px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-medium text-foreground">{plugin.name}</p>
            {plugin.version ? (
              <span className="text-xs text-muted-foreground">{plugin.version}</span>
            ) : null}
            {plugin.installed ? null : (
              <Badge size="sm" variant="outline">
                Not installed
              </Badge>
            )}
          </div>
          {plugin.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{plugin.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy ? <Spinner size="sm" tone="muted" /> : null}
          {plugin.installed ? (
            <>
              <Switch
                aria-label={`Enable ${plugin.name}`}
                checked={plugin.enabled}
                disabled={controlsDisabled}
                onCheckedChange={(enabled) =>
                  onAction({ kind: "set-plugin-enabled", pluginId: plugin.id, enabled })
                }
              />
              <Button
                size="xs"
                variant="ghost-destructive"
                aria-label={`Uninstall ${plugin.name}`}
                disabled={controlsDisabled}
                onClick={() =>
                  onConfirmedAction(
                    { kind: "uninstall-plugin", pluginId: plugin.id },
                    `Uninstall "${plugin.name}" from Claude?`,
                  )
                }
              >
                Uninstall
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              aria-label={`Install ${plugin.name}`}
              disabled={controlsDisabled}
              onClick={() => onAction({ kind: "install-plugin", pluginId: plugin.id })}
            >
              Install
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <PluginsFailureAlert
          view={error.view}
          retrying={busy}
          onRetry={() => onAction(error.action)}
        />
      ) : null}
    </div>
  );
}

/** An access problem gets a lock and a warning tone, so it reads apart from a failed command. */
function PluginsFailureAlert({
  view,
  retrying,
  onRetry,
}: {
  readonly view: PluginsFailureView;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  const Icon = view.needsAccess ? LockIcon : view.tone === "info" ? InfoIcon : TriangleAlertIcon;
  return (
    <Alert variant={view.tone}>
      <Icon />
      <AlertTitle>{view.heading}</AlertTitle>
      <AlertDescription>{view.message}</AlertDescription>
      {view.retryable ? (
        <AlertAction>
          <Button size="xs" variant="outline" disabled={retrying} onClick={onRetry}>
            {retrying ? "Retrying" : "Retry"}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

function InstanceSelect({
  instance,
  instances,
  onSelect,
}: {
  readonly instance: ServerProvider;
  readonly instances: ReadonlyArray<ServerProvider>;
  readonly onSelect: (instanceId: ProviderInstanceId) => void;
}) {
  return (
    <Select
      value={instance.instanceId}
      onValueChange={(value) => {
        const next = instances.find((candidate) => candidate.instanceId === value);
        if (next) onSelect(next.instanceId);
      }}
    >
      <SelectTrigger aria-label="Claude instance" size="sm">
        <SelectValue>{instanceLabel(instance)}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {instances.map((candidate) => (
          <SelectItem key={candidate.instanceId} value={candidate.instanceId}>
            {instanceLabel(candidate)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function instanceLabel(provider: ServerProvider): string {
  return provider.displayName ?? provider.instanceId;
}

function withoutTargets(
  errors: PluginActionErrors,
  targets: ReadonlySet<string>,
): PluginActionErrors {
  if (![...targets].some((target) => errors.has(target))) return errors;
  const next = new Map(errors);
  for (const target of targets) next.delete(target);
  return next;
}
