import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { Composer } from './components/Composer';
import { Inspector } from './components/Inspector';
import { PermissionDialog } from './components/PermissionDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';
import { desktopApi, isBrowserPreview } from './lib/desktop-api';
import { initialState } from './state/demo';
import { makeProject, makeSession } from './state/model';
import { loadState, reducer, saveState } from './state/reducer';

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState, loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeProject = useMemo(
    () => state.projects.find((project) => project.id === state.activeProjectId) ?? null,
    [state.projects, state.activeProjectId],
  );
  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? null,
    [state.sessions, state.activeSessionId],
  );

  useEffect(() => saveState(state), [state]);

  useEffect(() => {
    const offUpdate = desktopApi.onSessionUpdate((event) => {
      const local = stateRef.current.sessions.find(
        (session) => session.acpSessionId === event.sessionId,
      );
      if (!local) return;
      dispatch({ type: 'ACP_UPDATE', sessionId: local.id, update: event.update });
    });
    const offPermission = desktopApi.onPermissionRequest((event) => {
      dispatch({ type: 'PERMISSION_REQUEST', request: event });
    });
    const offPermissionCleared = desktopApi.onPermissionCleared((event) => {
      dispatch({ type: 'PERMISSION_CLEARED', requestId: event.requestId });
    });
    const offConnection = desktopApi.onConnectionEvent((event) => {
      dispatch({ type: 'CONNECTION', status: event.status, detail: event.detail });
    });
    return () => {
      offUpdate();
      offPermission();
      offPermissionCleared();
      offConnection();
    };
  }, []);

  useEffect(() => {
    void desktopApi
      .getAppInfo()
      .then((info) => dispatch({ type: 'APP_VERSION', version: info.version }));
    void desktopApi.checkGrok().then(async (status) => {
      dispatch({
        type: 'CONNECTION',
        status: status.status,
        detail: status.detail ?? status.version ?? undefined,
      });
      if (status.status === 'ready') {
        try {
          const connected = await desktopApi.connectGrok();
          dispatch({ type: 'CONNECTION', status: connected.status, detail: connected.detail });
        } catch (error) {
          dispatch({
            type: 'CONNECTION',
            status: 'error',
            detail: error instanceof Error ? error.message : '无法连接 Grok Build',
          });
        }
      }
    });
  }, []);

  const openWorkspace = useCallback(async () => {
    try {
      const summary = await desktopApi.chooseDirectory();
      if (!summary) return;
      const project = makeProject(summary, stateRef.current.projects);
      dispatch({ type: 'PROJECT_ADDED', project });
      const session = makeSession(project.id);
      dispatch({ type: 'SESSION_CREATED', session });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '无法打开工作区');
    }
  }, []);

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
    if (!localSession || !project || project.demo || !project.path) return;

    let acpSessionId = localSession.acpSessionId;
    let availableModes = localSession.availableModes;
    let desiredModeId = localSession.currentModeId;
    if (!acpSessionId) {
      dispatch({ type: 'SESSION_STATUS', sessionId: localSession.id, status: 'connecting' });
      try {
        const created = await desktopApi.createSession(project.path);
        acpSessionId = created.sessionId;
        availableModes = created.availableModes;
        desiredModeId = desiredModeId ?? created.currentModeId;
        dispatch({
          type: 'SESSION_CONNECTED',
          localSessionId: localSession.id,
          acpSessionId: created.sessionId,
          currentModeId: desiredModeId,
          availableModes: created.availableModes,
        });
        if (
          desiredModeId &&
          desiredModeId !== created.currentModeId &&
          created.availableModes.some((mode) => mode.id === desiredModeId)
        ) {
          await desktopApi.setSessionMode(created.sessionId, desiredModeId).catch(() => undefined);
        }
      } catch (error) {
        dispatch({
          type: 'ACP_UPDATE',
          sessionId: localSession.id,
          update: {
            sessionUpdate: 'client_turn_error',
            detail: error instanceof Error ? error.message : '无法创建 Grok 会话',
          },
        });
        return;
      }
    }

    const usesNativeModes = availableModes.length > 0;
    const enginePrompt = !usesNativeModes && desiredModeId === 'plan' ? `/plan ${text}` : text;
    dispatch({ type: 'USER_MESSAGE', sessionId: localSession.id, text });
    void desktopApi.sendPrompt(acpSessionId, enginePrompt).catch((error) => {
      dispatch({
        type: 'ACP_UPDATE',
        sessionId: localSession.id,
        update: {
          sessionUpdate: 'client_turn_error',
          detail: error instanceof Error ? error.message : 'Grok 任务执行失败',
        },
      });
    });
  }, []);

  const stopSession = useCallback(() => {
    const session = stateRef.current.sessions.find(
      (item) => item.id === stateRef.current.activeSessionId,
    );
    if (session?.acpSessionId) void desktopApi.cancelSession(session.acpSessionId);
  }, []);

  const changeMode = useCallback((modeId: string) => {
    const session = stateRef.current.sessions.find(
      (item) => item.id === stateRef.current.activeSessionId,
    );
    if (!session) return;
    const nativeMode = session.availableModes.some((mode) => mode.id === modeId);
    if (session.acpSessionId && nativeMode) {
      void desktopApi.setSessionMode(session.acpSessionId, modeId);
    }
    dispatch({
      type: 'ACP_UPDATE',
      sessionId: session.id,
      update: { sessionUpdate: 'current_mode_update', currentModeId: modeId },
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
    } catch {
      // Keep the last known Git state if refresh fails.
    }
  }, []);

  const resolvePermission = useCallback(async (optionId?: string, cancelled?: boolean) => {
    const request = stateRef.current.pendingPermissions[0];
    if (!request) return;
    await desktopApi.resolvePermission({ requestId: request.requestId, optionId, cancelled });
    dispatch({ type: 'PERMISSION_CLEARED', requestId: request.requestId });
  }, []);

  const toggleSidebar = useCallback(() => dispatch({ type: 'SIDEBAR_TOGGLED' }), []);
  const toggleInspector = useCallback(() => dispatch({ type: 'INSPECTOR_TOGGLED' }), []);
  const openSettings = useCallback(() => dispatch({ type: 'SETTINGS', open: true }), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = event.metaKey || event.ctrlKey;
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
      className={`app-shell ${state.sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${state.inspectorOpen ? '' : 'is-inspector-closed'}`}
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
          onToggleInspector={toggleInspector}
          onRefreshProject={refreshProject}
        />
        <div className="workspace-main__content">
          <section className="conversation">
            {activeSession ? (
              <Timeline session={activeSession} />
            ) : (
              <Welcome onOpenWorkspace={openWorkspace} />
            )}
            <Composer
              project={activeProject}
              session={activeSession}
              onSend={sendPrompt}
              onStop={stopSession}
              onModeChange={changeMode}
              onOpenWorkspace={openWorkspace}
            />
          </section>
          {state.inspectorOpen && (
            <Inspector
              project={activeProject}
              session={activeSession}
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
        connectionStatus={state.connectionStatus}
        connectionDetail={`${state.connectionDetail}${isBrowserPreview ? ' · 当前为浏览器视觉预览' : ''}`}
        onClose={() => dispatch({ type: 'SETTINGS', open: false })}
      />
      {state.pendingPermissions[0] && (
        <PermissionDialog
          request={state.pendingPermissions[0]}
          remainingCount={state.pendingPermissions.length - 1}
          onResolve={resolvePermission}
        />
      )}
    </div>
  );
}
