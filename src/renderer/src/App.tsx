import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { UiAcpEvent } from '../../shared/types';
import { CommandPalette } from './components/CommandPalette';
import { Composer } from './components/Composer';
import { EmptySession } from './components/EmptySession';
import { Inspector } from './components/Inspector';
import { PermissionDialog } from './components/PermissionDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';
import { cleanDesktopError } from './lib/connection';
import { desktopApi, isBrowserPreview } from './lib/desktop-api';
import { runEngineConnectionAttempt } from './lib/engine-connection';
import { runSessionTaskOnce } from './lib/in-flight';
import { decideInitialMode } from './lib/session-mode';
import { type StreamChunkEvent, streamChunkKey } from './lib/stream-chunks';
import { initialState } from './state/demo';
import { makeProject, makeSession, sessionBlocksInput } from './state/model';
import { loadState, saveState } from './state/persistence';
import { reducer } from './state/reducer';

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState, loadState);
  const stateRef = useRef(state);
  const sessionsSending = useRef(new Set<string>());
  const acpSessionRoutes = useRef(new Map<string, string>());
  const unroutedAcpEvents = useRef(new Map<string, UiAcpEvent[]>());
  const modeRequestSequence = useRef(0);
  const modeRequestsInFlight = useRef(new Set<string>());
  const permissionSubmittingRef = useRef(false);
  const connectionAttemptSequence = useRef(0);
  const connectionInFlight = useRef<Promise<void> | null>(null);
  const persistenceWarningShown = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [permissionSubmitting, setPermissionSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    id: number;
    tone: 'info' | 'warning' | 'error';
    message: string;
  } | null>(null);
  stateRef.current = state;

  const activeProject = useMemo(
    () => state.projects.find((project) => project.id === state.activeProjectId) ?? null,
    [state.projects, state.activeProjectId],
  );
  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? null,
    [state.sessions, state.activeSessionId],
  );
  const showError = useCallback((error: unknown, fallback: string): void => {
    setNotice({
      id: Date.now(),
      tone: 'error',
      message: cleanDesktopError(error, fallback),
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = saveState(state);
      if (!saved && !persistenceWarningShown.current) {
        persistenceWarningShown.current = true;
        setNotice({
          id: Date.now(),
          tone: 'warning',
          message: '本地历史暂时无法保存；当前任务仍可继续，请检查可用磁盘空间。',
        });
      }
      if (saved) persistenceWarningShown.current = false;
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const flushState = (): void => {
      saveState(stateRef.current);
    };
    window.addEventListener('beforeunload', flushState);
    return () => window.removeEventListener('beforeunload', flushState);
  }, []);

  useEffect(() => {
    if (window.matchMedia('(max-width: 1180px)').matches && stateRef.current.inspectorOpen) {
      dispatch({ type: 'INSPECTOR_TOGGLED' });
    }
  }, []);

  useEffect(() => {
    const pendingChunks = new Map<string, { sessionId: string; event: StreamChunkEvent }>();
    let frame = 0;
    const flushChunks = (): void => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      for (const pending of pendingChunks.values()) {
        dispatch({ type: 'ACP_EVENT', sessionId: pending.sessionId, event: pending.event });
      }
      pendingChunks.clear();
    };
    const discardChunks = (): void => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      pendingChunks.clear();
    };
    const enqueueSessionEvent = (sessionId: string, event: UiAcpEvent): void => {
      if (event.type !== 'message.chunk' && event.type !== 'thought.chunk') {
        flushChunks();
        dispatch({ type: 'ACP_EVENT', sessionId, event });
        return;
      }
      const streamEvent = event as StreamChunkEvent;
      const key = streamChunkKey(sessionId, streamEvent);
      const existing = pendingChunks.get(key);
      pendingChunks.set(key, {
        sessionId,
        event: existing
          ? { ...streamEvent, text: `${existing.event.text}${streamEvent.text}` }
          : streamEvent,
      });
      if (!frame) frame = window.requestAnimationFrame(flushChunks);
    };
    const offUpdate = desktopApi.onSessionUpdate((event) => {
      const routedId = acpSessionRoutes.current.get(event.sessionId);
      const local = routedId
        ? stateRef.current.sessions.find((session) => session.id === routedId)
        : stateRef.current.sessions.find((session) => session.acpSessionId === event.sessionId);
      if (!local) {
        const pending = unroutedAcpEvents.current.get(event.sessionId) ?? [];
        pending.push(event.event);
        unroutedAcpEvents.current.set(event.sessionId, pending);
        return;
      }
      enqueueSessionEvent(local.id, event.event);
    });
    const offPermission = desktopApi.onPermissionRequest((event) => {
      const routedId = acpSessionRoutes.current.get(event.sessionId);
      const local = stateRef.current.sessions.find(
        (session) => session.id === routedId || session.acpSessionId === event.sessionId,
      );
      const project = stateRef.current.projects.find((item) => item.id === local?.projectId);
      if (!local || !project || project.path !== event.workspacePath) {
        void desktopApi.resolvePermission({ requestId: event.requestId, cancelled: true });
        return;
      }
      dispatch({ type: 'PERMISSION_REQUEST', request: event });
    });
    const offPermissionCleared = desktopApi.onPermissionCleared((event) => {
      dispatch({ type: 'PERMISSION_CLEARED', requestId: event.requestId });
    });
    const offConnection = desktopApi.onConnectionEvent((event) => {
      if (event.status === 'offline' || event.status === 'error') {
        flushChunks();
        acpSessionRoutes.current.clear();
        unroutedAcpEvents.current.clear();
      }
      dispatch({ type: 'CONNECTION_EVENT', event });
    });
    return () => {
      offUpdate();
      offPermission();
      offPermissionCleared();
      offConnection();
      discardChunks();
    };
  }, []);

  const retryConnection = useCallback(() => {
    if (connectionInFlight.current) return;
    const attemptId = ++connectionAttemptSequence.current;
    const attempt = runEngineConnectionAttempt(desktopApi, attemptId, dispatch);
    connectionInFlight.current = attempt;
    void attempt.finally(() => {
      if (connectionInFlight.current === attempt) connectionInFlight.current = null;
    });
  }, []);

  useEffect(() => {
    void desktopApi
      .getAppInfo()
      .then(async (info) => {
        dispatch({
          type: 'APP_INFO',
          version: info.version,
          platform: info.platform,
          arch: info.arch,
        });
        await desktopApi.reportRendererReady();
      })
      .catch((error) => {
        setNotice({
          id: Date.now(),
          tone: 'error',
          message: cleanDesktopError(error, '无法读取应用信息'),
        });
      });
    retryConnection();
  }, [retryConnection]);

  const openWorkspace = useCallback(async () => {
    try {
      const summary = await desktopApi.chooseDirectory();
      if (!summary) return;
      const project = makeProject(summary, stateRef.current.projects);
      dispatch({ type: 'PROJECT_ADDED', project });
      const session = makeSession(project.id);
      dispatch({ type: 'SESSION_CREATED', session });
    } catch (error) {
      showError(error, '无法打开工作区');
    }
  }, [showError]);

  const newSession = useCallback(() => {
    const current = stateRef.current;
    const project = current.projects.find((item) => item.id === current.activeProjectId);
    if (!project || project.demo) {
      void openWorkspace();
      return;
    }
    dispatch({ type: 'SESSION_CREATED', session: makeSession(project.id) });
  }, [openWorkspace]);

  const sendPrompt = useCallback(async (text: string) => {
    const current = stateRef.current;
    const localSession = current.sessions.find((session) => session.id === current.activeSessionId);
    const project = current.projects.find((item) => item.id === current.activeProjectId);
    if (
      !localSession ||
      !project ||
      current.connectionStatus !== 'ready' ||
      project.demo ||
      !project.path ||
      localSession.continuity === 'local-history-only' ||
      localSession.modeSwitchStatus === 'switching' ||
      modeRequestsInFlight.current.has(localSession.id)
    ) {
      return;
    }
    if (sessionsSending.current.has(localSession.id)) return;

    await runSessionTaskOnce(sessionsSending.current, localSession.id, async () => {
      let acpSessionId = localSession.acpSessionId;
      let availableModes = localSession.availableModes;
      let desiredModeId = localSession.requestedModeId;
      if (!acpSessionId) {
        dispatch({ type: 'SESSION_STATUS', sessionId: localSession.id, status: 'connecting' });
        try {
          const created = await desktopApi.createSession(project.path);
          acpSessionId = created.sessionId;
          acpSessionRoutes.current.set(created.sessionId, localSession.id);
          availableModes = created.availableModes;
          const modeDecision = decideInitialMode(
            desiredModeId,
            created.currentModeId,
            created.availableModes,
          );
          desiredModeId = modeDecision.desiredModeId;
          dispatch({
            type: 'SESSION_CONNECTED',
            localSessionId: localSession.id,
            acpSessionId: created.sessionId,
            currentModeId: created.currentModeId,
            availableModes: created.availableModes,
            configOptions: created.configOptions,
            configOptionsTruncated: created.configOptionsTruncated,
          });
          const earlyEvents = unroutedAcpEvents.current.get(created.sessionId) ?? [];
          unroutedAcpEvents.current.delete(created.sessionId);
          for (const event of earlyEvents) {
            dispatch({ type: 'ACP_EVENT', sessionId: localSession.id, event });
          }
          if (desiredModeId && modeDecision.shouldSwitch) {
            const requestId = ++modeRequestSequence.current;
            dispatch({
              type: 'MODE_SWITCH_REQUESTED',
              sessionId: localSession.id,
              modeId: desiredModeId,
              requestId,
            });
            try {
              await desktopApi.setSessionMode(created.sessionId, desiredModeId);
              dispatch({
                type: 'MODE_SWITCH_CONFIRMED',
                sessionId: localSession.id,
                modeId: desiredModeId,
                requestId,
              });
            } catch (error) {
              const detail = error instanceof Error ? error.message : '无法切换 Grok 会话模式';
              dispatch({
                type: 'MODE_SWITCH_FAILED',
                sessionId: localSession.id,
                requestId,
                error: detail,
              });
              dispatch({
                type: 'ACP_EVENT',
                sessionId: localSession.id,
                event: { type: 'turn.failed', detail: `模式切换失败，任务未发送：${detail}` },
              });
              return;
            }
          } else if (desiredModeId && modeDecision.unsupported) {
            const requestId = ++modeRequestSequence.current;
            const detail = `当前 Grok 会话不支持请求的模式“${desiredModeId}”，任务未发送。`;
            dispatch({
              type: 'MODE_SWITCH_REQUESTED',
              sessionId: localSession.id,
              modeId: desiredModeId,
              requestId,
            });
            dispatch({
              type: 'MODE_SWITCH_FAILED',
              sessionId: localSession.id,
              requestId,
              error: detail,
            });
            dispatch({
              type: 'ACP_EVENT',
              sessionId: localSession.id,
              event: { type: 'turn.failed', detail },
            });
            return;
          }
        } catch (error) {
          dispatch({
            type: 'ACP_EVENT',
            sessionId: localSession.id,
            event: {
              type: 'turn.failed',
              detail: error instanceof Error ? error.message : '无法创建 Grok 会话',
            },
          });
          return;
        }
      }

      const usesNativeModes = availableModes.length > 0;
      const enginePrompt = !usesNativeModes && desiredModeId === 'plan' ? `/plan ${text}` : text;
      setDrafts((currentDrafts) => {
        if (!(localSession.id in currentDrafts)) return currentDrafts;
        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[localSession.id];
        return nextDrafts;
      });
      dispatch({ type: 'USER_MESSAGE', sessionId: localSession.id, text });
      try {
        await desktopApi.sendPrompt(acpSessionId, enginePrompt);
      } catch (error) {
        dispatch({
          type: 'ACP_EVENT',
          sessionId: localSession.id,
          event: {
            type: 'turn.failed',
            detail: error instanceof Error ? error.message : 'Grok 任务执行失败',
          },
        });
      }
    });
  }, []);

  const stopSession = useCallback(() => {
    const session = stateRef.current.sessions.find(
      (item) => item.id === stateRef.current.activeSessionId,
    );
    if (session?.acpSessionId) {
      dispatch({ type: 'SESSION_STATUS', sessionId: session.id, status: 'cancelling' });
      void desktopApi.cancelSession(session.acpSessionId).catch((error) => {
        dispatch({
          type: 'ACP_EVENT',
          sessionId: session.id,
          event: {
            type: 'turn.failed',
            detail: error instanceof Error ? error.message : '无法停止 Grok 任务',
          },
        });
      });
    }
  }, []);

  const changeMode = useCallback((modeId: string) => {
    const session = stateRef.current.sessions.find(
      (item) => item.id === stateRef.current.activeSessionId,
    );
    if (
      !session ||
      session.continuity === 'local-history-only' ||
      sessionBlocksInput(session.status) ||
      session.modeSwitchStatus === 'switching' ||
      modeRequestsInFlight.current.has(session.id)
    ) {
      return;
    }
    const nativeMode = session.availableModes.some((mode) => mode.id === modeId);
    if (session.acpSessionId && nativeMode) {
      const requestId = ++modeRequestSequence.current;
      modeRequestsInFlight.current.add(session.id);
      dispatch({
        type: 'MODE_SWITCH_REQUESTED',
        sessionId: session.id,
        modeId,
        requestId,
      });
      void desktopApi
        .setSessionMode(session.acpSessionId, modeId)
        .then(() => {
          dispatch({
            type: 'MODE_SWITCH_CONFIRMED',
            sessionId: session.id,
            modeId,
            requestId,
          });
        })
        .catch((error) => {
          dispatch({
            type: 'MODE_SWITCH_FAILED',
            sessionId: session.id,
            requestId,
            error: error instanceof Error ? error.message : '无法切换 Grok 会话模式',
          });
        })
        .finally(() => {
          modeRequestsInFlight.current.delete(session.id);
        });
      return;
    }
    const requestId = ++modeRequestSequence.current;
    dispatch({
      type: 'MODE_PREFERENCE_SET',
      sessionId: session.id,
      modeId,
      requestId,
    });
  }, []);

  const refreshProject = useCallback(async () => {
    const project = stateRef.current.projects.find(
      (item) => item.id === stateRef.current.activeProjectId,
    );
    if (!project || project.demo || !project.path) return;
    try {
      const summary = await desktopApi.inspectProject(project.path);
      dispatch({ type: 'PROJECT_UPDATED', project: { ...project, ...summary } });
    } catch (error) {
      showError(error, '无法刷新 Git 状态');
    }
  }, [showError]);

  const resolvePermission = useCallback(
    async (optionId?: string, cancelled?: boolean) => {
      if (permissionSubmittingRef.current) return;
      const request = stateRef.current.pendingPermissions[0];
      if (!request) return;
      permissionSubmittingRef.current = true;
      setPermissionSubmitting(true);
      try {
        await desktopApi.resolvePermission({ requestId: request.requestId, optionId, cancelled });
        dispatch({ type: 'PERMISSION_CLEARED', requestId: request.requestId });
      } catch (error) {
        showError(error, '无法提交权限选择');
      } finally {
        permissionSubmittingRef.current = false;
        setPermissionSubmitting(false);
      }
    },
    [showError],
  );

  const toggleSidebar = useCallback(() => dispatch({ type: 'SIDEBAR_TOGGLED' }), []);
  const toggleInspector = useCallback(() => dispatch({ type: 'INSPECTOR_TOGGLED' }), []);
  const openSettings = useCallback(() => dispatch({ type: 'SETTINGS', open: true }), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = event.metaKey || event.ctrlKey;
      if (stateRef.current.pendingPermissions.length > 0) {
        if (
          command &&
          (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'n' || event.key === ',')
        ) {
          event.preventDefault();
        }
        return;
      }
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dispatch({ type: 'COMMAND_PALETTE', open: true });
      }
      if (command && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newSession();
      }
      if (command && event.key === ',') {
        event.preventDefault();
        openSettings();
      }
      if (event.key === 'Escape') {
        dispatch({ type: 'COMMAND_PALETTE', open: false });
        dispatch({ type: 'SETTINGS', open: false });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newSession, openSettings]);

  return (
    <div
      className={`app-shell platform-${state.appPlatform} ${state.sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${state.inspectorOpen ? '' : 'is-inspector-closed'}`}
    >
      <Sidebar
        state={state}
        onOpenWorkspace={openWorkspace}
        onNewSession={newSession}
        onSelectProject={(projectId) => dispatch({ type: 'PROJECT_SELECTED', projectId })}
        onSelectSession={(sessionId) => dispatch({ type: 'SESSION_SELECTED', sessionId })}
        onToggle={toggleSidebar}
        onOpenCommands={() => dispatch({ type: 'COMMAND_PALETTE', open: true })}
        onOpenSettings={openSettings}
      />
      <main className="workspace-main">
        <TopBar
          project={activeProject}
          session={activeSession}
          inspectorOpen={state.inspectorOpen}
          connectionStatus={state.connectionStatus}
          onOpenConnectionCenter={openSettings}
          onToggleInspector={toggleInspector}
          onRefreshProject={refreshProject}
        />
        <div className="workspace-main__content">
          <section className="conversation">
            {activeSession ? (
              <Timeline
                session={activeSession}
                emptyState={
                  activeProject ? (
                    <EmptySession
                      project={activeProject}
                      connectionStatus={state.connectionStatus}
                      connectionIssueCode={state.connectionIssueCode}
                      onChoosePrompt={(prompt) => {
                        setDrafts((current) => ({ ...current, [activeSession.id]: prompt }));
                      }}
                      onRetryConnection={retryConnection}
                      onOpenConnectionCenter={openSettings}
                    />
                  ) : undefined
                }
              />
            ) : (
              <Welcome
                connectionStatus={state.connectionStatus}
                connectionDetail={state.connectionDetail}
                connectionIssueCode={state.connectionIssueCode}
                binaryPath={state.grokBinaryPath}
                cliVersion={state.grokCliVersion}
                onRetryConnection={retryConnection}
                onOpenWorkspace={openWorkspace}
                onOpenConnectionCenter={openSettings}
              />
            )}
            <Composer
              project={activeProject}
              session={activeSession}
              value={activeSession ? (drafts[activeSession.id] ?? '') : ''}
              connectionStatus={state.connectionStatus}
              connectionIssueCode={state.connectionIssueCode}
              connectionDetail={state.connectionDetail}
              onValueChange={(value) => {
                if (!activeSession) return;
                setDrafts((current) => ({ ...current, [activeSession.id]: value }));
              }}
              onSend={sendPrompt}
              onStop={stopSession}
              onModeChange={changeMode}
              onNewSession={newSession}
              onRetryConnection={retryConnection}
              onOpenConnectionCenter={openSettings}
            />
          </section>
          {state.inspectorOpen && (
            <Inspector
              project={activeProject}
              session={activeSession}
              appVersion={state.appVersion}
              activeTab={state.inspectorTab}
              connectionStatus={state.connectionStatus}
              connectionDetail={state.connectionDetail}
              onTabChange={(tab) => dispatch({ type: 'INSPECTOR_TAB', tab })}
              onRefreshProject={refreshProject}
            />
          )}
        </div>
      </main>

      <CommandPalette
        open={state.commandPaletteOpen}
        platform={state.appPlatform}
        onClose={() => dispatch({ type: 'COMMAND_PALETTE', open: false })}
        onNewSession={newSession}
        onOpenWorkspace={openWorkspace}
        onToggleSidebar={toggleSidebar}
        onToggleInspector={toggleInspector}
        onOpenSettings={openSettings}
      />
      <SettingsDialog
        open={state.settingsOpen}
        version={state.appVersion}
        platform={state.appPlatform}
        arch={state.appArch}
        connectionStatus={state.connectionStatus}
        connectionDetail={`${state.connectionDetail}${isBrowserPreview ? ' · 当前为浏览器视觉预览' : ''}`}
        connectionIssueCode={state.connectionIssueCode}
        binaryPath={state.grokBinaryPath}
        cliVersion={state.grokCliVersion}
        agentName={state.grokAgentName}
        agentVersion={state.grokAgentVersion}
        onRetryConnection={retryConnection}
        onClose={() => dispatch({ type: 'SETTINGS', open: false })}
      />
      {notice && (
        <div className={`app-notice notice notice--${notice.tone}`} role="alert">
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭通知">
            知道了
          </button>
        </div>
      )}
      {state.pendingPermissions[0] && (
        <PermissionDialog
          key={state.pendingPermissions[0].requestId}
          request={state.pendingPermissions[0]}
          source={(() => {
            const request = state.pendingPermissions[0];
            const session = state.sessions.find((item) => item.acpSessionId === request.sessionId);
            const project = state.projects.find((item) => item.id === session?.projectId);
            return {
              verified: Boolean(session && project && project.path === request.workspacePath),
              projectName: project?.name ?? '来源无法验证',
              projectPath: request.workspacePath,
              sessionTitle: session?.title ?? '未知会话',
              background: session?.id !== state.activeSessionId,
              onShowSource: session
                ? () => dispatch({ type: 'SESSION_SELECTED', sessionId: session.id })
                : undefined,
            };
          })()}
          remainingCount={state.pendingPermissions.length - 1}
          submitting={permissionSubmitting}
          onResolve={resolvePermission}
        />
      )}
    </div>
  );
}
