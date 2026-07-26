#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const lifecycleLogPath = process.env.GROK_FAKE_LIFECYCLE_LOG;
function lifecycle(message) {
  if (!lifecycleLogPath) return;
  try {
    appendFileSync(lifecycleLogPath, `${message}\n`, 'utf8');
  } catch {
    // Integration diagnostics must never alter the fake protocol behavior.
  }
}

if (process.argv.includes('--version')) {
  console.log('grok 0.0.0-fake');
  process.exit(0);
}

if (process.argv.includes('logout')) {
  lifecycle(`cli-logout:${process.pid}`);
  if (process.env.GROK_FAKE_CLI_LOGOUT_MODE === 'fail') {
    console.error('Fake CLI logout failed');
    process.exit(2);
  }
  if (process.env.GROK_FAKE_CLI_LOGOUT_MODE === 'ambiguous-fail') {
    console.error('Logout failed: token was not signed out because the server is unreachable');
    process.exit(2);
  }
  if (process.env.GROK_FAKE_CLI_LOGOUT_MODE === 'already') {
    console.log('Not logged in');
    process.exit(0);
  }
  console.log('Logged out (was signed in as fake-account@example.test)');
  process.exit(0);
}

lifecycle(`start:${process.pid}`);

const ORIGINAL_PERMISSION_OPTION_ID = `allow-original::${'x'.repeat(1_200)}`;
const sessions = new Set();
let sessionSequence = 0;

async function sendUpdate(client, sessionId, update) {
  await client.notify(acp.methods.client.session.update, { sessionId, update });
}

async function sendEventScenario(client, sessionId) {
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'message-a',
    content: { type: 'text', text: 'A1' },
  });
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'message-b',
    content: { type: 'text', text: 'B1' },
  });
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'message-a',
    content: { type: 'text', text: 'A2' },
  });
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'plan_update',
    plan: {
      type: 'items',
      planId: 'plan-items',
      entries: [
        {
          content: 'Inspect the protocol boundary',
          priority: 'high',
          status: 'in_progress',
        },
      ],
    },
  });
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'plan_update',
    plan: {
      type: 'markdown',
      planId: 'plan-markdown',
      content: '# Verified plan\n\n- Keep the UI truthful',
    },
  });
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'plan_update',
    plan: {
      type: 'file',
      planId: 'plan-file',
      uri: 'file:///workspace/PLAN.md',
    },
  });
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'plan_removed',
    planId: 'plan-file',
  });
}

async function sendPermissionScenario(client, sessionId) {
  const response = await client.request(acp.methods.client.session.requestPermission, {
    sessionId,
    toolCall: {
      toolCallId: 'permission-tool',
      title: 'Delete generated output',
      kind: 'delete',
      status: 'pending',
      locations: [{ path: '/workspace/generated' }],
      rawInput: {
        command: 'rm -rf ./generated',
        nested: { source: 'fake-agent' },
      },
    },
    options: [
      {
        optionId: ORIGINAL_PERMISSION_OPTION_ID,
        name: 'Allow once\u202E password="agent option secret"',
        kind: 'allow_once',
      },
      {
        optionId: 'reject-original',
        name: 'Reject once',
        kind: 'reject_once',
      },
    ],
  });

  const originalOptionWasRestored =
    response.outcome.outcome === 'selected' &&
    response.outcome.optionId === ORIGINAL_PERMISSION_OPTION_ID;
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'permission-result',
    content: {
      type: 'text',
      text: originalOptionWasRestored ? 'original-option-restored' : 'permission-mapping-failed',
    },
  });
}

async function sendPermissionFlood(client, sessionId) {
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      client.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: {
          toolCallId: `flood-tool-${index}`,
          title: `Flood request ${index}`,
          kind: 'execute',
          status: 'pending',
        },
        options: [
          {
            optionId: `flood-allow-${index}`,
            name: 'Allow once',
            kind: 'allow_once',
          },
        ],
      }),
    ),
  );
  const selected = responses.filter((response) => response.outcome.outcome === 'selected').length;
  await sendUpdate(client, sessionId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'permission-flood-result',
    content: { type: 'text', text: `selected-${selected}` },
  });
}

const app = acp
  .agent({ name: 'orbit-workbench-fake-agent' })
  .onRequest(acp.methods.agent.initialize, (context) => ({
    protocolVersion: context.params.protocolVersion,
    agentCapabilities:
      process.env.GROK_FAKE_DISABLE_ACP_LOGOUT === '1' ? {} : { auth: { logout: {} } },
    authMethods: [
      { id: 'cached_token', name: 'Cached test account' },
      { id: 'xai.api_key', name: 'XAI API key' },
    ],
    agentInfo: {
      name: 'orbit-workbench-fake-agent',
      title: 'Orbit Fake ACP Agent',
      version: '1.0.0-test',
    },
  }))
  .onRequest(acp.methods.agent.authenticate, (context) => {
    lifecycle(`authenticate:${context.params.methodId}`);
    if (
      context.params.methodId === 'cached_token' &&
      process.env.GROK_FAKE_CACHED_AUTH_FAIL === '1'
    ) {
      throw acp.RequestError.authRequired();
    }
    return {};
  })
  .onRequest(acp.methods.agent.logout, () => {
    lifecycle(`acp-logout:${process.pid}`);
    return {};
  })
  .onRequest(acp.methods.agent.session.new, async (context) => {
    sessionSequence += 1;
    const sessionId = `fake-session-${sessionSequence}`;
    sessions.add(sessionId);
    if (context.params.cwd.includes('early-flood')) {
      for (let index = 0; index < 65; index += 1) {
        await sendUpdate(context.client, sessionId, {
          sessionUpdate: 'session_info_update',
          title: `early-${index}`,
        });
      }
    }
    await sendUpdate(context.client, sessionId, {
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan',
    });
    await sendUpdate(context.client, sessionId, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        {
          name: 'early-review',
          description: 'Emitted before session/new returns',
        },
      ],
    });
    return {
      sessionId,
      modes: {
        currentModeId: 'normal',
        availableModes: [
          { id: 'normal', name: 'Normal' },
          { id: 'plan', name: 'Plan' },
          { id: 'reject-mode', name: 'Rejected mode' },
        ],
      },
    };
  })
  .onRequest(acp.methods.agent.session.setMode, (context) => {
    if (!sessions.has(context.params.sessionId)) throw new Error('Unknown session');
    if (context.params.modeId === 'reject-mode') {
      throw new Error(`Fake agent rejected mode token=xai-${'secret'.repeat(64)}`);
    }
    return {};
  })
  .onRequest(acp.methods.agent.session.prompt, async (context) => {
    const { sessionId } = context.params;
    if (!sessions.has(sessionId)) throw new Error('Unknown session');
    const promptText = context.params.prompt
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');

    if (promptText.includes('events')) {
      await sendEventScenario(context.client, sessionId);
    } else if (promptText.includes('unknown mode')) {
      await sendUpdate(context.client, sessionId, {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'not-declared',
      });
    } else if (promptText.includes('permission')) {
      if (promptText.includes('flood')) await sendPermissionFlood(context.client, sessionId);
      else await sendPermissionScenario(context.client, sessionId);
    }
    return { stopReason: 'end_turn' };
  })
  .onNotification(acp.methods.agent.session.cancel, () => undefined);

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const connection = app.connect(acp.ndJsonStream(input, output));
await connection.closed;
lifecycle(`stop:${process.pid}`);
