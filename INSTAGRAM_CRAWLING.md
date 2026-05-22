# 인스타그램 해시태그 크롤링 실행 메모

## 현재 상태

1차 크롤러는 `scripts/instagram_hashtag_crawler.mjs`에 만들어두었다.

현재 방식은 인스타그램 검색 페이지에서 확인한 GraphQL 검색 요청을 재현한 뒤, 응답 JSON 안에서 게시물/계정 후보를 추출해 CSV로 저장한다.

다만 2026-05-18 기준으로 인스타그램은 비로그인 요청에 실제 게시물/계정 데이터를 거의 노출하지 않는다. 로그인 세션 쿠키가 있어야 정상적으로 후보가 수집된다.

## 기본 실행

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_hashtag_crawler.mjs
```

특정 해시태그만 테스트하려면 다음처럼 실행한다.

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_hashtag_crawler.mjs --tag 공동구매 --limit 20
```

## 해시태그 목록

기본 해시태그는 `hashtags.txt`에서 관리한다.

현재 포함된 예시는 다음과 같다.

- 공동구매
- 공구
- 마켓
- 인스타마켓
- 육아템공구
- 뷰티공구
- 패션마켓
- 다이어트공구
- 살림템
- 주부마켓

## 로그인 세션을 붙여 실행하는 방법

브라우저에서 인스타그램에 로그인한 뒤, 요청 쿠키 값을 `ig_cookie.txt` 같은 파일에 저장한다.

그 다음 아래처럼 실행한다.

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_hashtag_crawler.mjs --cookie-file ig_cookie.txt
```

또는 환경변수로 넣을 수도 있다.

```powershell
$env:IG_COOKIE="여기에_인스타그램_쿠키"
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_hashtag_crawler.mjs
```

현재 PC 환경에서 인증서 검증 오류가 발생하면 아래처럼 실행한다.

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_hashtag_crawler.mjs --cookie-file ig_cookie.txt
```

이 옵션은 HTTPS 인증서 검증을 끄므로, 로컬 테스트에서만 사용한다.

## 현재 GraphQL 검색 설정

해시태그 검색에 사용하는 기본 `doc_id`는 다음 값이다.

```text
26586987494245638
```

인스타그램 내부 요청 구조가 바뀌면 DevTools Network에서 다시 `doc_id`와 `variables`를 확인한 뒤 아래처럼 바꿔 실행한다.

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_hashtag_crawler.mjs --cookie-file ig_cookie.txt --search-doc-id 26586987494245638
```

## 결과 파일

결과는 `data` 폴더에 저장된다.

- `instagram_hashtag_sellers_*.csv`: DM 발송 후보 리스트
- `instagram_hashtag_diagnostics_*.json`: 요청 상태, HTML 길이, 로그인 제한 여부 등 진단 정보

CSV 필드는 전략 문서의 1차 DM 리스트 구조와 맞춰두었다.

## 주의사항

인스타그램은 자동화 요청에 민감하므로 과도한 요청을 보내지 않는다.

현재 크롤러는 기본적으로 해시태그마다 2.5초씩 대기한다. 필요하면 `--delay-ms` 값으로 조절한다.

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_hashtag_crawler.mjs --delay-ms 5000
```

## 주기적으로 계속 실행

`scripts/run_periodic_crawler.mjs`는 기존 `scripts/crawl_import_refresh.mjs` 파이프라인을 일정 간격으로 반복 실행한다.
기본값은 6시간마다 한 번이며, 첫 실행은 바로 시작한다.

로컬 터미널에서만 테스트하려면 다음처럼 실행한다.

```bash
npm run crawler:periodic -- --interval-minutes 360
```

터미널을 닫아도 계속 돌리려면 데몬 스크립트로 실행한다.
이미 `crawl_import_refresh`가 실행 중이면 중복 실행하지 않고 10분 뒤 다시 확인한다.

```bash
./scripts/crawler_daemon.sh start
./scripts/crawler_daemon.sh logs
```

상태 확인/중지/재시작은 다음 명령을 사용한다.

```bash
./scripts/crawler_daemon.sh status
./scripts/crawler_daemon.sh stop
./scripts/crawler_daemon.sh restart
```

기본 파이프라인 인자는 다음과 같다.

```text
--cookie-file ig_cookie.txt --delay-ms 8000 --limit 20 --refresh-limit 120
```

실행 간격은 환경변수로 바꿀 수 있다.

```bash
CRAWLER_INTERVAL_MINUTES=180 ./scripts/crawler_daemon.sh restart
```

Codex 앱의 recurring automation을 쓰면 이 터미널 세션과 별개로 같은 작업을 주기 실행할 수 있다.
현재 권장 주기는 6시간이다.
