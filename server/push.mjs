// 결재 알림: Firebase Cloud Messaging(FCM) HTTP v1으로 폰에 푸시를 보냅니다.
// Firebase 서비스 계정 키(JSON)가 없으면 아무것도 하지 않고, 앱이 백그라운드에서 직접 확인합니다.

import { createSign } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createPush({ dataDir, serviceAccountPath }) {
  const tokensFile = join(dataDir, 'push-tokens.json');
  let tokens = [];
  try {
    if (existsSync(tokensFile)) tokens = JSON.parse(readFileSync(tokensFile, 'utf8'));
  } catch {
    tokens = [];
  }

  let account = null;
  try {
    if (serviceAccountPath && existsSync(serviceAccountPath)) {
      account = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      console.log(`[push] FCM 사용 (프로젝트 ${account.project_id})`);
    } else {
      console.log('[push] Firebase 서비스 계정 키가 없어 푸시 알림은 끕니다. 앱이 백그라운드에서 직접 확인합니다.');
    }
  } catch (e) {
    console.error('[push] 서비스 계정 키를 읽지 못했습니다:', e?.message || e);
  }

  function saveTokens() {
    writeFileSync(tokensFile + '.tmp', JSON.stringify(tokens));
    renameSync(tokensFile + '.tmp', tokensFile);
  }

  let cached = null;
  async function accessToken() {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) throw new Error(`Google 인증 실패: ${JSON.stringify(data).slice(0, 200)}`);
    cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
    return cached.token;
  }

  async function sendOne(token, { title, body, id, projectId }) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: { attentionId: id, projectId: projectId || '' },
          android: { priority: 'HIGH', notification: { channel_id: 'approval' } },
        },
      }),
    });
    if (res.ok) return true;
    const text = await res.text();
    // 앱이 지워졌거나 토큰이 바뀐 경우
    if (res.status === 404 || /UNREGISTERED/.test(text)) return false;
    throw new Error(`FCM 전송 실패 (${res.status}): ${text.slice(0, 200)}`);
  }

  return {
    enabled: () => !!account,

    register(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new Error('잘못된 토큰입니다.');
      if (!tokens.includes(token)) {
        tokens = [...tokens.slice(-4), token];
        saveTokens();
      }
      return !!account;
    },

    async send(attention) {
      if (!account || tokens.length === 0) return;
      const keep = [];
      for (const t of tokens) {
        try {
          if (await sendOne(t, attention)) keep.push(t);
        } catch (e) {
          keep.push(t);
          console.error('[push]', e?.message || e);
        }
      }
      if (keep.length !== tokens.length) {
        tokens = keep;
        saveTokens();
      }
    },
  };
}
