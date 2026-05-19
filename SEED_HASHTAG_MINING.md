# Seed 셀러 기반 해시태그 자동 수집

## 목적

CMO가 직접 찾아낸 양질의 뷰티 셀러들을 seed로 넣고, 그 셀러들이 실제로 반복해서 사용하는 해시태그를 자동으로 뽑는다.

이 방식은 처음부터 `#공동구매`처럼 넓은 태그로 사람을 찾는 방식보다 정확도가 높다.

## 흐름

1. 좋은 셀러 계정을 `seed_sellers.txt`에 추가한다.
2. 스크립트가 각 셀러 이름으로 인스타그램 검색 API를 호출한다.
3. 해당 셀러가 작성한 게시물만 필터링한다.
4. 캡션에서 해시태그를 추출한다.
5. 해시태그별 반복 횟수, 반응 수, 뷰티 키워드, 판매 키워드를 집계한다.
6. 좋은 해시태그를 `beauty_hashtags.txt`에 추가해 다시 셀러 후보를 확장한다.

## 실행

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_seed_hashtag_miner.mjs --cookie-file ig_cookie.txt
```

특정 셀러만 테스트하려면 다음처럼 실행한다.

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"
.\.tools\node-v22.22.3-win-x64\node.exe scripts\instagram_seed_hashtag_miner.mjs --seller innshushu --cookie-file ig_cookie.txt
```

## 결과 파일

- `instagram_seed_hashtags_*.csv`: seed 셀러들이 사용한 해시태그 랭킹
- `instagram_seed_posts_*.csv`: seed 셀러별 게시물과 캡션/해시태그
- `instagram_seed_hashtag_diagnostics_*.json`: 요청 진단 정보

## 해석 방법

브랜드 확장용 해시태그로 우선 볼 기준은 다음과 같다.

- 여러 seed 셀러에게 반복 등장하는 태그
- `beauty_score`가 높은 태그
- `selling_score`가 있거나 구매 의도가 보이는 태그
- 좋아요나 댓글이 높은 게시물에서 나온 태그

예를 들어 `innshushu` seed에서는 다음과 같은 태그가 추출되었다.

- makeup
- 커버메이크업
- makeuptutorial
- 컨실러추천
- 마스카라추천
- 뷰티꿀팁
- 올리브영추천템

이 태그들을 다시 검색 태그로 사용하면 뷰티 크리에이터와 셀러 후보를 더 정밀하게 찾을 수 있다.
