import type { GrokDesktopApi } from '../../../shared/types';
import type { AppAction } from '../state/model';
import { cleanDesktopError } from './connection';

type EngineApi = Pick<GrokDesktopApi, 'checkGrok' | 'connectGrok'>;
type EngineDispatch = (action: AppAction) => void;

export async function runEngineConnectionAttempt(
  api: EngineApi,
  attemptId: number,
  dispatch: EngineDispatch,
): Promise<void> {
  dispatch({ type: 'CONNECTION_ATTEMPT', attemptId });
  try {
    const inspected = await api.checkGrok();
    dispatch({ type: 'GROK_INSPECTED', attemptId, result: inspected });
    if (inspected.status !== 'detected' && inspected.status !== 'ready') return;
    dispatch({
      type: 'CONNECTION_RESULT',
      attemptId,
      result: { status: 'connecting', detail: '正在启动 Grok ACP 并验证登录…' },
    });
    const connected = await api.connectGrok();
    dispatch({ type: 'CONNECTION_RESULT', attemptId, result: connected });
  } catch (error) {
    dispatch({
      type: 'CONNECTION_RESULT',
      attemptId,
      result: {
        status: 'error',
        detail: cleanDesktopError(error, '无法连接 Grok Build'),
        issueCode: 'unknown',
        retryable: true,
      },
    });
  }
}
