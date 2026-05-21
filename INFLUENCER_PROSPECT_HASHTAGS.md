# 인플루언서 욕망 후보 해시태그 기준

## 목적

브랜드에게 바로 팔 수 있는 셀러가 아니라, 앞으로 인플루언서/협찬/수익화를 하고 싶어 할 가능성이 높은 사람을 찾는다.

기존 뷰티 셀러 크롤링과 다르게 `마케터`, `직장인`, `부업`, `성장` 신호를 감점하지 않고 긍정 신호로 본다.

## 기본 태그 파일

`data/influencer_desire_hashtags.txt`

## 우선순위 묶음

### 1. 뷰티 리뷰러

이미 제품을 사고, 비교하고, 길게 설명하는 사람이다. 아직 돈은 못 벌지만 콘텐츠 습관이 있다.

- 올영추천
- 올리브영추천
- 올영추천템
- 내돈내산
- 공병템
- 재구매템
- 뷰티리뷰
- 화장품추천
- 코덕

### 2. 협찬 초기 계정

이미 브랜드 협찬 구조를 경험했거나 경험하고 싶어 하는 사람이다.

- 협찬
- 제품제공
- 체험단
- 광고

### 3. 뷰티/마케팅 직무자

인플루언서 단가와 협찬 구조를 옆에서 본 사람일 가능성이 있다.

- 뷰티마케터
- 마케터일상

### 4. 직장인 N잡 욕망

회사 밖 수익에 관심이 있지만, 뷰티 콘텐츠와 같이 나타날 때만 우선순위를 높인다.

- 직장인일상
- 직장인부업
- 퇴근후부업
- n잡
- n잡러
- 부업

### 5. 성장 지향 크리에이터

이미 계정 성장이나 퍼스널 브랜딩을 의식하는 사람이다.

- 인스타성장
- 릴스성장
- 퍼스널브랜딩
- 뷰티크리에이터

## 실행

```bash
npm run crawl:instagram -- --hashtag-file data/influencer_desire_hashtags.txt --prospect-mode --limit 30
```

로그인 쿠키가 있으면 다음처럼 실행한다.

```bash
npm run crawl:instagram -- --hashtag-file data/influencer_desire_hashtags.txt --prospect-mode --limit 30 --cookie-file ig_cookie.txt
```

## 해석

요약 CSV에서 우선 볼 필드는 다음이다.

- `grade`: 상/중/하
- `prospect_score`: 인플루언서 욕망 신호 점수
- `prospect_personas`: 뷰티리뷰러, 협찬초기, 뷰티마케터, 직장인N잡, 성장지향크리에이터
- `prospect_signal_tags`: 욕망 신호로 잡힌 태그
- `matched_prospect_keywords`: 캡션/태그에서 잡힌 키워드
- `matched_hashtags_count`: 여러 태그에서 반복 발견됐는지
- `total_likes`, `total_comments`: 최소 반응이 있는지

처음 DM을 보낼 때는 `grade=상`이면서 `prospect_personas`에 `뷰티리뷰러` 또는 `협찬초기`가 포함된 계정을 먼저 본다.
