# 맥미니 서버

폰 앱의 요청을 받아 맥미니에 로그인된 **Claude Pro**(Claude Agent SDK)와 **ChatGPT Plus**(Codex SDK) 구독으로 처리합니다. API 키를 쓰지 않으며, `ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 환경 변수는 AI 쪽으로 넘기지 않습니다.

## 준비

- Node.js 20 이상
- 맥미니 터미널에서 `claude` → `/login`(Pro 계정), `codex` → Sign in with ChatGPT(Plus 계정)로 로그인
- Tailscale Funnel이 3000번 포트를 가리키도록 설정 (`tailscale funnel --bg 3000`)

## 처음 설치

```bash
cd ~
git clone https://github.com/jiyoo0209/AI-AGENT-PROJECT.git
cd ~/AI-AGENT-PROJECT/server
npm install
pm2 delete ai-server
SERVER_TOKEN=내토큰 pm2 start server.mjs --name ai-server
pm2 save
```

## 업데이트

```bash
cd ~/AI-AGENT-PROJECT && git pull
cd server && npm install
pm2 restart ai-server
```

## 주소

모든 요청은 `Authorization: Bearer <토큰>` 헤더가 필요합니다. `GET /`만 `?token=` 쿼리도 받습니다.

| 주소 | 설명 |
| --- | --- |
| `GET /` | 연결 확인. `macmini server OK` |
| `GET /v1/health` | 앱의 연결 테스트 |
| `POST /v1/chat` | `{ provider: "claude" \| "openai", model, system, messages }` → `{ text, usage, limits? }` |
| `POST /v1/image` | `{ prompt }` → `{ base64 }` (Codex의 이미지 생성 도구 사용) |
| `GET /v1/limits` | 남은 구독 한도. Claude는 Agent SDK의 /usage 정보, ChatGPT는 Codex 세션 기록(`~/.codex/sessions`)에서 읽음 |

오래 걸리는 요청은 연결이 끊기지 않도록 15초마다 공백을 먼저 보내고, 마지막에 JSON을 보냅니다. 그래서 실패도 200 응답의 `error` 필드로 옵니다.

## 문제 해결

- 로그: `pm2 logs ai-server`
- `로그인이 풀렸을 수 있습니다`가 나오면 맥미니에서 `claude` → `/login` 또는 `codex`로 다시 로그인하세요.
- 본인 혼자 쓰는 용도입니다. 구독 계정을 다른 사람과 나눠 쓰지 마세요.
