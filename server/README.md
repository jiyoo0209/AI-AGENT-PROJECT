# 나만의사무실 서버 (맥미니 또는 VPS)

AI 팀(PM·팀원)이 이 서버에서 일합니다. 서버에 로그인된 **Claude Pro**(Claude Agent SDK)와 **ChatGPT Plus**(Codex SDK) 구독을 쓰고, 폰 앱은 지시·결재·화면만 맡습니다. 앱을 꺼도 작업은 계속되고, 결재가 필요하면 알림이 갑니다. API 키를 쓰지 않으며, `ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 환경 변수는 AI 쪽으로 넘기지 않습니다.

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

## 데이터

프로젝트, 채팅, 산출물 파일, 설정은 `~/.my-office`에 저장됩니다. 다른 폴더를 쓰려면 `DATA_DIR` 환경 변수를 주세요. 서버를 옮길 때(예: VPS) 이 폴더를 복사하면 그대로 이어집니다.

## 문서·화면 (Word, Excel, PPT, PDF 미리보기, 화면 캡처)

팀원은 Markdown으로 쓰고, 파일명 확장자(.docx, .xlsx, .pptx)에 따라 서버가 Word·Excel·PowerPoint 파일을 만듭니다. 앱에서는 PDF로 바꾼 페이지 이미지로 보여 줍니다. 퍼블리셔 HTML 화면은 앱 안에서 바로 실행되고, 서버가 Chrome으로 캡처해 썸네일과 화면설계서 PPT에 넣습니다.

필요한 프로그램 (맥미니에 한 번 설치):

```
brew install pandoc poppler
brew install --cask libreoffice
```

화면 캡처는 맥미니에 설치된 Google Chrome을 씁니다. Chrome이 없으면 `cd server && npx playwright-core install chromium`.
없는 프로그램이 있으면 그 기능만 꺼지고, 서버를 켤 때 로그(`pm2 logs ai-server`)에 `[docs]`로 알려 줍니다.

| 주소 | 내용 |
|---|---|
| `GET /v1/files/:id/page/:n` (`?v=thumb`) | 문서 미리보기 n쪽 이미지 |
| `GET /v1/files/:id/pdf` | 문서 PDF |
| `GET /v1/files/:id?v=source` | 문서의 Markdown 원본 |
| `GET /site/<비밀 값>/<역할>/<파일>` | 화면 실행용 (앱의 웹 화면이 씀, 비밀 값은 `/v1/state`의 `siteBase`) |

## 결재 알림 (선택: Firebase 푸시)

- 기본: 앱이 백그라운드에서 15분 이상 간격으로 서버를 확인해 알림을 띄웁니다. 늦게 올 수 있습니다.
- 바로 받으려면 Firebase 푸시를 켭니다 (무료).
  1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트를 만들고 Android 앱을 추가합니다. 패키지 이름: `com.jiyoo0209.aiagentproject`
  2. 내려받은 `google-services.json` 내용 전체를 GitHub 저장소 **Settings → Secrets and variables → Actions**에 `GOOGLE_SERVICES_JSON` 이름으로 넣고, 앱을 다시 빌드해 설치합니다.
  3. Firebase **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**으로 받은 JSON을 서버의 `~/.my-office/firebase-service-account.json`에 둡니다. 이 파일은 비밀번호와 같으니 저장소에 올리지 마세요.
  4. `pm2 restart ai-server` 후 로그에 `[push] FCM 사용`이 보이면 됩니다.

## 주소

모든 요청은 `Authorization: Bearer <토큰>` 헤더가 필요합니다. `GET /`만 `?token=` 쿼리도 받습니다.

| 주소 | 설명 |
| --- | --- |
| `GET /` | 연결 확인. `macmini server OK` |
| `GET /v1/health` | 앱의 연결 테스트 |
| `POST /v1/chat` | `{ provider: "claude" \| "openai", model, system, messages }` → `{ text, usage, limits? }` |
| `POST /v1/image` | `{ prompt }` → `{ base64 }` (Codex의 이미지 생성 도구 사용) |
| `GET /v1/state?since=&wait=` | 프로젝트·바쁜 팀원·알림·사용량. `since`가 지금 버전과 같으면 바뀔 때까지 최대 `wait`초(30초까지) 기다립니다 |
| `POST /v1/action` | `{ type: "start", request }` · `{ type: "run" }`(승인·다시 시도) · `{ type: "replan" }` · `{ type: "reset" }` · `{ type: "room", role, text }`. 바로 응답하고 일은 뒤에서 계속합니다 |
| `POST /v1/settings` | `{ roles, stepApproval }` 역할별 모델과 작업마다 결재 |
| `GET /v1/files/:id` | 산출물 파일 |
| `POST /v1/push/register` | `{ token }` FCM 푸시 토큰 등록 |
| `GET /v1/limits` | 남은 구독 한도. Claude는 Agent SDK의 /usage 정보, ChatGPT는 Codex 세션 기록(`~/.codex/sessions`)에서 읽음 |

오래 걸리는 요청은 연결이 끊기지 않도록 15초마다 공백을 먼저 보내고, 마지막에 JSON을 보냅니다. 그래서 실패도 200 응답의 `error` 필드로 옵니다.

## 문제 해결

- 로그: `pm2 logs ai-server`
- `로그인이 풀렸을 수 있습니다`가 나오면 맥미니에서 `claude` → `/login` 또는 `codex`로 다시 로그인하세요.
- 본인 혼자 쓰는 용도입니다. 구독 계정을 다른 사람과 나눠 쓰지 마세요.
