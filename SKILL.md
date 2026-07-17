---
name: ai-echo
description: >-
  개인 말투/이디올렉트(idiolect)를 프로파일링해 이메일·카톡 답장 **초안**을 사용자 본인의
  톤으로 생성할 때 사용한다. AI가 사용자를 대신해 답장을 보내는 자동응답기가 아니다 —
  과거 메시지 샘플·상황별 반응·이모지 팔레트·인물별 호칭을 dJinn MCP(`mcp__ai-echo__*`)에
  누적해 프로파일을 만들고, 새 대화 맥락이나 "이런 의도로 말하고 싶다"는 요점만 주어지면
  그 프로파일 기반으로 톤 변주 초안을 렌더링한다. 답장을 쓰기 전에 상대 메시지/스레드/
  단톡 로그의 핵심 의도·서브텍스트·답변 필요 포인트를 먼저 파악하는 `analyze` 모드도
  제공한다(비저장, 휘발성 분석). 카톡/이메일 대화 내보내기 파일을 통째로 학습시키는
  벌크 인제스트, 실제 발송한 최종본을 되먹이는 피드백 루프, 채널·상대별 금칙어 가드레일과
  상황 템플릿, 업무/개인 페르소나 전환도 지원한다. 최종 검토·수정·발송은 항상 사용자가 한다.
  "말투 학습해서 답장 써줘 / 내 톤으로 카톡 답장 초안 / 이메일 회신 초안 / 나 대신 말투로
  써줘(단, 대행 아님) / 이 대화 무슨 얘기인지 분석해줘 / 카톡 대화 내보내기 학습시켜줘 /
  analyze / draft / say / ingest / feedback / guardrail / template / persona" 류에서
  트리거된다.
---

# ai-echo

당신의 말투를 배워서 **초안**을 써주는 스킬이다. **AI 대행이 아니다.**

> **카파시 4원칙**(Karpathy's agentic-coding guidelines) — 아래 절차 전체에 우선한다:
> 1. **Think Before Coding** — 가정하지 말고, 불확실하면 먼저 묻는다. 해석이 둘 이상이면 모두 제시.
> 2. **Simplicity First** — 요청을 푸는 최소한의 코드. 과설계·요청 안 한 유연성 금지.
> 3. **Surgical Changes** — 시킨 것만 건드린다. 무관한 리팩터링·정리 금지.
> 4. **Goal-Driven Execution** — 작업을 검증 가능한 목표로 바꾼다.
>
> 레포에 자체 에이전트 지침(CLAUDE.md 등)이 있으면 그것을 **함께** 따른다. 이 스킬은 "어떻게
> 초안을 만들지"의 절차이며, 실제 발송·최종 표현의 산출물이 아니다.

## 1. 핵심 원칙

- **AI가 사용자를 대신해 답하지 않는다.** 이 스킬이 만드는 것은 항상 **초안(draft)**이다.
  사용자의 최종 검토·수정·발송 없이는 아무것도 나가지 않는다는 전제를 매 응답에서 지킨다.
- 초안은 사용자 **본인의 말투**를 재현하는 것이 목표다 — AI 특유의 문체(과도한 격식,
  이모지 남용, 상투적 마무리 등)로 흘러가지 않도록 프로파일에 근거해 교정한다.
- `mcp__ai-echo__*` (dJinn MCP)를 프로파일/호칭/샘플의 **SoT**로 쓴다. 사람이 읽는 스냅샷은
  `echo_export_md`로 뽑아 스킬 위치의 `PROFILE.md`로 미러한다(사람이 직접 열어볼 수 있게).
- MCP가 없으면 절차를 막지 않되 [optional requirements](#21-optional-requirements)의 폴백을 따른다.
- **프로파일은 owner가 없는 전역 싱글턴이다.** 이 스킬은 "한 사람의 말투를 배우는 도구"라는
  전제(echo=메아리, 반사체는 하나)라 프로파일에 페르소나 개념을 두지 않는다. 업무/사적처럼
  상황에 따라 톤이 달라지는 건 [6장 register](#6-채널격식별-레지스터-register) 축으로
  이미 커버된다. (addressing/sample/guardrail/template은 여전히 owner로 구분되며 [7장
  persona](#7-페르소나owner-전환-persona)로 전환한다 — 프로파일 자체와는 별개다.)
- 프로파일은 3단 그래프 구조로 저장된다 — 루트(`echo_profile`: `schems` 카탈로그+`isOnboard`),
  1차 노드(`echo_dimension`: tone/register/situational 등, `child_schema`로 하위 필드 명세),
  서브그래프(`echo_dimension_childs`: 실제 데이터, `(parent_key, child_key)`로 point-lookup).
  자세한 사용법은 [4장](#4-프로파일링정교화)·[6장](#6-채널격식별-레지스터-register) 참고.
- **온보딩 여부를 먼저 확인한다(isOnboard 게이트).** 어떤 커맨드든 진입 시 `echo_profile_get()`
  으로 루트를 가볍게 확인한다(항상 1-row라 비용이 거의 없다). `isOnboard`가 `true`가 아니면,
  **진행을 막지 않고 온보딩을 유도한다** — "아직 말투 프로파일이 없어요. [3장 온보딩](#3-최초-온보딩-onboarding)을
  먼저 하면 초안이 훨씬 당신 톤에 가까워집니다. 지금 할까요?"라고 제안한다. 사용자가 건너뛰길
  원하면 프로파일 없이도 초안을 시도하되 품질 한계를 고지한다(카파시 #1 — 차단이 아니라 유도).
  온보딩이 끝나면 `isOnboard:true`로 전환되어(§3) 이후 진입에서는 이 유도가 뜨지 않는다.

## 2. 커맨드

사용자는 아래 어휘로 모드를 지정해 스킬을 부른다. 각 커맨드 뒤에 맥락/요점을 붙여 쓴다
(예: `analyze <붙여넣은 대화>`). 커맨드 없이 그냥 메시지를 붙여넣기만 해도 의도상 가장
가까운 모드(대개 `analyze` 또는 `draft`)로 동작하되, 애매하면 어느 모드로 이해했는지 먼저
확인한다(카파시 #1).

- **`analyze <대화맥락>`** — 답장을 쓰기 **전에** 상대 메시지/스레드/단톡 로그가 무슨
  의도로 오간 대화인지 파악한다. 저장하지 않는 휘발성 분석. → [11장](#11-분석-analyze)
- **`draft <대화맥락> [짧게|정중 장문|불릿|캐주얼]`** — 주어진 대화 맥락에 대해 사용자
  톤의 답장 **초안**을 생성한다(톤 변주 1~3개, 가드레일 준수, 템플릿 시드 활용).
  → [12장](#12-답장-초안-생성-draft)
- **`say <의도/요점> [짧게|정중 장문|불릿|캐주얼]`** — 상대 메시지 없이 "이런 말을 하고
  싶다"는 의도/요점만 주면 프로파일 기반 초안을 렌더링한다. → [13장](#13-의도--초안-say)
- **`onboard`** — 최초 온보딩을 실행한다. → [3장](#3-최초-온보딩-onboarding)
- **`onboard writing [장르]`** — 대화체와 별개로, 수필/블로그/개발문서 등 **글쓰기 문체**를
  온보딩한다(`writing_genre` dimension). 장르를 생략하면 어떤 장르부터 할지 먼저 확인한다.
  → [19장](#19-글쓰기-문체-온보딩-writing_genre)
- **`editorial [add|list|get|del] <레퍼런스명>`** — 글쓰기 시 참고할 타인/외부 문체 레퍼런스를
  등록·조회·삭제한다(`editorial` dimension). 사용자 본인 문체(`writing_genre`)와 달리 명시적
  호출 시에만 쓰이는 선택적 참고 자료다. → [20장](#20-editorial-레퍼런스-editorial)
- **`profile`** — 현재 프로파일을 조회/정교화하고 인물별 전역 호칭을 관리한다.
  → [4장](#4-프로파일링정교화), [5장](#5-전역-호칭-vs-휘발성-호칭)
- **`persona [<owner>]`** — 사용 가능한 페르소나(owner) 목록을 보거나 기본 owner를
  전환한다(업무용/개인용 분리). → [7장](#7-페르소나owner-전환-persona)
- **`guardrail`** — 채널·상대별로 절대 쓰지 않는 표현/이모지(avoid) 또는 우선 표현(prefer)을
  관리한다. → [8장](#8-스타일-가드레일-guardrail)
- **`template`** — 거절·사과·독촉·축하·일정조율 등 상황별 톤 스니펫을 관리한다.
  → [9장](#9-상황-템플릿-template)
- **`feedback <최종본>`** — 실제로 고르거나 다듬어 보낸 최종 메시지를 학습에 되먹인다.
  → [14장](#14-피드백-루프-feedback)
- **`ingest <파일경로/붙여넣기>`** — 카톡 대화 내보내기 `.txt`, 이메일 `.mbox` 등을 통째로
  파싱해 샘플을 일괄 적재한다. → [15장](#15-벌크-인제스트-ingest)
- **`drift`** — 프로파일이 시간에 따라 어떻게 바뀌었는지 스냅샷 이력을 요약한다.
  → [16장](#16-드리프트-리포트-drift)
- **`explain`** — 직전 `draft` 결과가 왜 그렇게 나왔는지 근거를 설명한다(휘발성).
  → [17장](#17-초안-근거-설명-explain)
- **`export`** — `echo_export_md`로 `PROFILE.md` 스냅샷을 생성한다. → [18장](#18-export--report--migration)
- **`report`** — `echo_report`로 프로파일 완성도·샘플/호칭 현황 통계를 조회한다. → [18장](#18-export--report--migration)
- **`migrate`** — `echo_migrate_export`/`echo_migrate_import`로 학습 데이터를 다른 설치로
  이관한다. → [18장](#18-export--report--migration)

## 3. 최초 온보딩 (Onboarding)

처음 쓰는 사용자에게는 프로파일이 비어 있다. 다음을 진행한다:

1. 과거에 실제로 보낸 메시지(이메일/카톡/SNS) 샘플을 몇 개 요청한다 — "최근에 보낸 메시지
   몇 개만 붙여넣어 주세요(상황 설명도 함께)". 각각 `echo_sample_add({owner, channel, text,
   situation, origin:'onboarding'})`로 저장한다. 최소 5~10개 정도를 권장하되 사용자가 적게
   줘도 진행한다(카파시 #1, 억지로 채우지 않음). 카톡/이메일 내보내기 파일이 있다면 하나씩
   붙여넣는 대신 [15장 `ingest`](#15-벌크-인제스트-ingest)로 한 번에 적재할 수 있음을 안내한다.
2. 저장된 샘플을 근거로 **말투 특징을 추출/인터뷰**한다: 문장 길이·어미(반말/존댓말 혼용
   패턴)·자주 쓰는 접속사나 추임새·상황별 반응(예: 거절할 때, 사과할 때, 부탁할 때 각각
   어떻게 말하는지)·자주 쓰는 이모지/이모티콘과 빈도·마무리 인사(signoff) 패턴.
3. 주요 인물(자주 답장하는 상대)의 **전역 호칭**을 확인해 `echo_addressing_put`으로 등록한다
   (기준은 [5장](#5-전역-호칭-vs-휘발성-호칭) 참고).
4. 추출한 내용을 **dimension 단위**로 저장한다. dimension마다 두 단계로 나뉜다:
   - `echo_dimension_put({echo_key, description, child_schema})` — 1차 노드를 만든다.
     `description`은 루트 `schems` 카탈로그에 노출될 한 줄 요약, `child_schema`는 그 밑
     `echo_data`가 어떤 필드로 구성되는지 key:description 맵으로 명세한다(DDL 대용).
   - `echo_dimension_child_put({parent_key, child_key, echo_data})` — 실제 값을 넣는다.
     축이 없는(단일값) dimension은 `child_key`를 `parent_key`(=echo_key)와 동일하게 쓰는
     컨벤션을 따른다. 축이 있는 dimension(register 등)은 채널·상대·상황명 등 구체적인 값을
     `child_key`로 쓴다.

   현재 관리 중인 dimension과 schems 목록 (신규 항목은 이 컨벤션을 따라 추가한다):
   | echo_key | description | 축(child_key) |
   |---|---|---|
   | `identity` | 이름/역할 등 기본 신원 정보 | 없음(`identity`) |
   | `tone` | 말투 기본 톤 — 존댓말/반말, 버블 분할, 오타, 어미, 물음표 사용 등 | 없음(`tone`) |
   | `emoji` | 이모지·이모티콘 사용 빈도와 맥락 | 없음(`emoji`) |
   | `signoffs` | 대화 마무리 인사/종료 패턴 | 없음(`signoffs`) |
   | `notes` | 샘플 출처 및 프로파일 메타 노트 | 없음(`notes`) |
   | `register` | 채널·상대별 톤 레지스터 | `<채널:상대>` (예: `kakao:친구`) — [6장](#6-채널격식별-레지스터-register) |
   | `situational` | 상황별 정형 반응 패턴 | 상황명 (예: `지시 수용`, `거절/보류`) |
   | `writing_genre` | 글쓰기 문체 — 장르별(수필/블로그/개발문서 등) 톤·구조(사용자 본인) | 장르명 (예: `블로그`) — [19장](#19-글쓰기-문체-온보딩-writing_genre) |
   | `editorial` | 글쓰기 시 참고할 타인/외부 문체 레퍼런스(명시적 호출 시에만 사용) | 레퍼런스명 — [20장](#20-editorial-레퍼런스-editorial) |

   `writing_genre`/`editorial`은 dimension 껍데기(`child_schema`)만 등록돼 있고 아직 child가
   없다 — 각각 [19장](#19-글쓰기-문체-온보딩-writing_genre)/[20장](#20-editorial-레퍼런스-editorial)의
   절차로 채운다. `writing_genre`가 비어있는 동안 `write` 계열 커맨드가 호출되면 "아직 글쓰기
   문체를 학습하지 않았다"고 안내하고 온보딩을 유도한다(§1 isOnboard 게이트와 같은 원칙 —
   차단이 아니라 유도).

   **이때 `echo_profile_put({isOnboard:true, onboarded_at:<ISO 시각>})`도 호출해 온보딩
   완료를 표시한다** — 이 플래그가 §1의 isOnboard 게이트를 `true`로 전환한다.
5. 온보딩이 끝나면 `echo_export_md({owner})`로 마크다운을 받아 스킬 위치의 `PROFILE.md`에
   Write 툴로 저장한다 — 사람이 언제든 열어볼 수 있는 스냅샷.

> 온보딩은 **차단 게이트가 아니다.** `isOnboard=false`여도 사용자가 원하면 바로 다른 커맨드를
> 쓸 수 있고, 스킬은 그때 온보딩을 한 번 권할 뿐이다(카파시 #1).

## 4. 프로파일링(정교화)

대화할 때마다 새로 관찰되는 말투·반응·호칭이 있으면 그때그때 반영한다:

- 새 특징이 관찰되면 해당 child만 `echo_dimension_child_get({parent_key, child_key})`으로
  읽고, 병합한 값을 그 child 하나만 `echo_dimension_child_put({parent_key, child_key,
  echo_data})`으로 다시 쓴다(child 단위 merge-friendly — 다른 child는 건드리지 않는다). 매
  `echo_dimension_child_put` 호출은 해당 child의 이전 값이 스냅샷으로 자동 축적되어
  [16장 `drift`](#16-드리프트-리포트-drift)로 나중에 이력을 되짚어볼 수 있다.
- 완전히 새로운 축(dimension)이 필요해지면 — 예: 지금까지 없던 상황·채널이 발견됐을 때 —
  `echo_dimension_put`으로 먼저 새 dimension을 등록한 뒤(3장 표 참고) child를 채운다.
- 사용자가 준 새 원문이 있으면 `echo_sample_add`로 계속 누적한다. 샘플이 쌓일수록 초안
  품질이 좋아진다는 점을 사용자에게 알려줘도 좋다.
- 과설계 금지 — 프로파일 스키마에 명세 밖의 필드를 임의로 늘리지 않는다.

## 5. 전역 호칭 vs 휘발성 호칭

- **전역(영속)** — 사용자가 그 사람을 **항상** 그렇게 부른다("김대리님", "지수야" 등 관계상
  고정된 호칭). → `echo_addressing_put`으로 저장한다.
- **휘발성(맥락 한정)** — 이번 대화/스레드에서만 상대를 가리키는 지칭("그 프로젝트 담당자님",
  "아까 말씀하신 분" 등 일회성 맥락 표현). → **저장하지 않는다.** 대화 내에서만 사용하고
  DB에 남기지 않는다.
- 애매하면 "이 호칭, 이 사람한테 항상 쓰시나요, 아니면 이번 건만인가요?"라고 되묻는다
  (카파시 #1 — 가정하지 않는다).

## 6. 채널·격식별 레지스터 (register)

같은 사람에게도 채널(이메일/카톡/단톡)과 상대·상황의 격식 수준(업무/사적, 상사/동료/친구)에
따라 톤이 달라진다. 이 축을 프로파일 안에 구조화해 저장하고, `analyze`/`draft`/`say`는
답장을 만들기 전에 **어느 채널이고 상대가 누구인지부터 판별**해 해당 레지스터를 적용한다.

- 별도 커맨드는 없다 — register는 `echo_dimension`의 `echo_key:'register'` 하나 아래,
  `채널:상대` 조합마다 **독립된 child**로 쪼갠다: `child_key`를 `<채널:상대>` 형식으로
  지정한다. 예:
  ```
  echo_dimension_child_put({parent_key:'register', child_key:'email:업무', echo_data:{tone:'정중체, 완결된 문장, 이모지 없음'}})
  echo_dimension_child_put({parent_key:'register', child_key:'kakao:친구', echo_data:{tone:'반말, ㅋㅋ/이모지 다용'}})
  echo_dimension_child_put({parent_key:'register', child_key:'kakao:상사', echo_data:{tone:'존댓말, 이모지 금지, 늦은 답장 사과 포함'}})
  ```
  이렇게 쪼개두면 `draft`/`say`가 이번에 필요한 채널·상대 하나만
  `echo_dimension_child_get({parent_key:'register', child_key:'kakao:친구'})`로 정확히
  집어서 가져올 수 있다 — 매번 전체 register를 통째로 끌어올 필요가 없다. 등록된 채널·상대
  목록만 가볍게 훑고 싶으면 `echo_dimension_child_list({parent_key:'register'})`로 `child_key`
  목록만(내용 없이) 조회한다. 같은 패턴은 향후 다른 축에도 그대로 재사용할 수 있다 — dimension
  이름만 바꾸면 된다(예: 글쓰기 장르별 문체를 다룰 `writing_genre`).
- `analyze`([11장](#11-분석-analyze))/`draft`([12장](#12-답장-초안-생성-draft))/`say`
  ([13장](#13-의도--초안-say))는 대상 채널과 상대 격식을 먼저 확인하고(불명확하면 사용자에게
  묻는다 — 카파시 #1), 일치하는 `register` 항목이 있으면 그 톤을 우선 적용한다. 없으면
  프로파일 최상위 `tone`으로 폴백한다.

## 7. 페르소나(owner) 전환 (persona)

**말투 프로파일 자체(`echo_profile`/`echo_dimension`/`echo_dimension_childs`)는 owner가 없는
전역 싱글턴이라 이 장의 대상이 아니다** — 업무/사적처럼 상황에 따라 톤이 달라지는 건
[6장 register](#6-채널격식별-레지스터-register) 축으로 이미 커버된다. 이 장은
`addressing`/`sample`/`guardrail`/`template`처럼 여전히 owner로 구분되는 데이터 전용이다
(예: 여러 실제 인물의 호칭/샘플을 분리해 관리하고 싶을 때).

- `persona` — 인자 없이 부르면 `echo_owner_list()`로 현재 사용 가능한 owner 목록을 보여준다.
- `persona <owner>` — 이후 세션의 기본 owner를 그 값으로 전환한다. 기본 owner는 `'default'`다.
- 전환 이후 이 세션에서 호출하는 **`echo_addressing_*`/`echo_sample_*`/`echo_guardrail_*`/
  `echo_template_*` 툴에 owner 인자로 현재 선택된 owner를 넘긴다** (`echo_profile_*`/
  `echo_dimension_*` 계열은 owner 인자가 아예 없다). 전환을 깜빡하면 서로 다른 owner의
  샘플/호칭이 뒤섞이므로, 세션 시작 시 또는 애매할 때 먼저 확인한다(카파시 #1).

## 8. 스타일 가드레일 (guardrail)

- `guardrail` — `echo_guardrail_put`/`echo_guardrail_get`/`echo_guardrail_list`/
  `echo_guardrail_del`로 규칙을 관리한다. 필드: `scope`('global'|'channel'|'person'),
  `target`(channel명 또는 person key), `kind`('avoid'|'prefer'), `rule`. 예: "상사에게
  ㅋㅋ 금지"는 `scope:'person', target:'<상사 key>', kind:'avoid', rule:'ㅋㅋ'`.
- **`draft`([12장](#12-답장-초안-생성-draft))는 초안을 생성할 때마다 해당 owner/채널/상대에
  적용되는 가드레일을 반드시 `echo_guardrail_list`로 조회해 준수한다** — `avoid` 규칙에
  걸리는 표현은 배제하고 `prefer` 규칙이 있으면 우선 반영한다. 이는 선택 사항이 아니라
  강제 준수 사항이다.

## 9. 상황 템플릿 (template)

- `template` — `echo_template_put`/`echo_template_get`/`echo_template_list`/
  `echo_template_del`로 거절·사과·독촉·축하·일정조율 등 빈출 상황의 톤 스니펫을 저장/호출한다.
  필드: `situation`, `channel?`, `body`.
- `draft`([12장](#12-답장-초안-생성-draft))/`say`([13장](#13-의도--초안-say))는 상황을
  인식하면(예: "거절 메일", "일정 미루기") 관련 템플릿을 `echo_template_get`으로 조회해
  초안의 시드로 활용한다 — 샘플이 부족한 낯선 상황에서도 일관된 톤을 유지하는 보조 수단이다.
  일치하는 템플릿이 없으면 평소처럼 프로파일 기반으로만 생성한다.

## 10. 대화맥락 주입 (Context injection)

사용자가 답장해야 할 상대의 메시지/스레드를 붙여넣으면(`analyze`/`draft` 공통 전처리):

1. 필요하면 `echo_profile_get()`으로 루트 `schems`(1차 노드 목록+설명)를 확인하고, 상대
   채널·격식에 맞는 `echo_dimension_child_get({parent_key:'register', child_key:'<채널:상대>'})`
   와 `tone`/`situational` 등 필요한 핵심 child만 point-lookup으로 로드한다(전체를 통째로
   끌어오지 않는다). 이미 channel/상대를 알고 있으면 `schems` 확인 없이 바로
   `echo_dimension_child_get`으로 직행해도 된다.
2. 상대가 특정 인물로 식별되면 `echo_addressing_get({owner, key})`로 해당 호칭을 함께
   로드한다(모르면 사용자에게 어떤 사람인지, 전역 호칭이 있는지 묻는다). 단톡방이면 등장
   인물별로 각각 조회해 화자를 구분한다.
3. 로드한 프로파일 + 호칭을 아래 11장(`analyze`)이나 12장(`draft`)의 생성에 사용한다.

## 11. 분석 (analyze)

`draft`로 답장을 쓰기 **전에**, 붙여넣은 대화(상대 메시지/스레드/단톡 로그)가 무슨 의도로
오간 것인지 먼저 이해하도록 돕는 모드다. **이 스킬의 대행 아님 원칙은 여기서도 유지된다** —
`analyze`는 사용자가 상황을 파악하도록 도울 뿐, 무엇을 할지 대신 결정하거나 보내지 않는다.

- 10장의 절차대로 프로파일+호칭을 로드하되, 이 조회는 참고용일 뿐 **분석 결과 자체는
  DB에 저장하지 않는다**(휘발성 — 대화 세션에만 존재).
- 출력에는 다음 다섯 가지를 포함한다:
  1. **핵심 의도/용건** — 상대가 실제로 원하는 것이 무엇인지.
  2. **서브텍스트/숨은 뉘앙스** — 표면 문구와 다를 수 있는 속뜻·감정·긴급도.
  3. **관계/톤 컨텍스트** — 10장에서 로드한 호칭/관계를 반영해 "누가 누구에게 어떤 톤으로"
     말하는지 정리한다(단톡이면 화자별로 구분).
  4. **답변이 필요한 포인트** — 사용자가 반드시 응답해야 할 질문·결정·요청을 목록으로.
  5. **권장 대응 방향** — 간단히(상세 문구는 여기서 만들지 않는다, 그건 `draft`의 몫).
- **새 인물 등장 시 호칭 자동 제안** — 대화에 [5장](#5-전역-호칭-vs-휘발성-호칭) 기준 아직
  등록되지 않은 인물이 등장하면 관계를 추정해 "이 사람 전역 호칭으로 등록할까요? (전역/이번
  대화 한정)"을 제안한다. 사용자가 전역을 택하면 `echo_addressing_put`으로 저장하고,
  휘발성이면 저장하지 않는다(5장 원칙 재확인 — 강제하지 않는다).
- 분석을 마치면 "이 맥락으로 바로 초안 뽑을까요? (`draft`)"처럼 자연스럽게 다음 단계로
  이어갈 수 있음을 안내한다. 사용자가 원치 않으면 그대로 끝낸다 — 강제로 초안까지 만들지
  않는다(카파시 #2, 요청 이상으로 나가지 않는다).

## 12. 답장 초안 생성 (draft)

주입된 맥락(상대 메시지)에 대해 프로파일 기반으로 답장 **초안**을 만든다.

- 톤 변주 1~3개를 제시하는 것을 권장한다(예: 짧고 캐주얼 / 조금 더 정중 / 원문 그대로).
  사용자가 그중 고르거나 섞어서 다듬는다.
- **출력 프리셋** — 사용자가 `짧게`/`정중 장문`/`불릿`/`캐주얼` 등 길이·포맷을 지정하면
  그대로 따른다(예: `draft <맥락> 짧게`). 지정이 없으면 프로파일/[6장 register](#6-채널격식별-레지스터-register)
  기본 톤을 그대로 쓴다.
- **가드레일 강제 준수** — 생성 전 해당 owner/채널/상대에 걸린 가드레일을 [8장](#8-스타일-가드레일-guardrail)에
  따라 반드시 조회해 위반 표현을 배제한다.
- **템플릿 시드 활용** — 상황이 인식되면 [9장](#9-상황-템플릿-template)의 관련 템플릿을 시드로
  참고한다.
- AI 특유의 어색한 격식·상투구를 피하고, 프로파일에 없는 표현을 새로 지어내지 않는다 —
  샘플/프로파일에 근거가 있는 표현 위주로 조합한다.
- 초안 제시 후 **"이대로 보내지 마시고 검토 후 사용하세요"**를 매번 명시적으로 덧붙인다.
- 초안 제시 후 자연스럽게 "이 버전으로 보내셨다면 알려주세요, 학습에 반영할까요?"라고
  물어 [14장 `feedback`](#14-피드백-루프-feedback) 축적을 유도할 수 있다(강제하지 않음).

## 13. 의도 → 초안 (say)

사용자가 상대 메시지 없이 **"이런 말을 하고 싶다"는 의도/요점**만 준 경우:

- 그 의도 + 프로파일(+ 필요하면 상대의 호칭, [6장 register](#6-채널격식별-레지스터-register))을
  조합해 사용자 톤의 메시지 초안을 렌더링한다.
- 의도가 모호하면(누구에게, 어떤 채널로, 어떤 격식으로) 먼저 확인한다.
- [12장](#12-답장-초안-생성-draft)과 마찬가지로 `짧게`/`정중 장문`/`불릿`/`캐주얼` 등 출력
  프리셋을 받으며, 가드레일 준수·템플릿 시드 활용도 동일하게 적용한다.

## 14. 피드백 루프 (feedback)

- `feedback <최종본>` — 사용자가 `draft`/`say`로 받은 후보들 중 실제로 고르거나 다듬어서
  보낸 **최종 메시지**를 다시 학습에 반영한다. `echo_sample_add({owner, channel, text,
  situation, origin:'accepted-draft'})`로 저장한다.
- `draft`/`say` 흐름이 끝나면 강제하지 않되 자연스럽게 "이 버전으로 보내셨나요? 학습에
  반영할까요?"라고 물어 축적을 유도한다(카파시 #2 — 강제하지 않는다, 사용자가 원할 때만).
- `origin:'accepted-draft'`로 쌓인 샘플은 온보딩 때 준 원본 샘플보다 실제 사용 맥락에 가깝기
  때문에 프로파일 자기교정에 특히 유용하다.

## 15. 벌크 인제스트 (ingest)

- `ingest <파일경로/붙여넣기>` — 카카오톡 대화 내보내기 `.txt`나 이메일 `.mbox` 등을 통째로
  받아 스킬이 파싱해 **사용자 본인이 보낸 발화만** 추려낸 뒤 `echo_sample_add_bulk({owner,
  channel, origin:'imported', items:[{text, situation}]})`로 일괄 적재한다.
- [3장](#3-최초-온보딩-onboarding) 온보딩에서 샘플을 하나씩 붙여넣는 마찰을 크게 줄이는
  경로다 — 파일 하나로 수십~수백 개 샘플을 한 번에 확보할 수 있다.
- 개인정보(상대방 발화 포함)가 담긴 파일이므로, 어떤 대화/기간을 넣을지 **사용자 확인을
  받은 후에만** 진행한다(카파시 #1 — 가정하지 않는다). 상대방 발화는 걸러내고 사용자 발화만
  샘플로 저장한다.

## 16. 드리프트 리포트 (drift)

- `drift` — `echo_profile_history({limit})`로 과거 서브그래프 스냅샷을 불러와 톤/호칭/이모지
  등이 시간에 따라 어떻게 바뀌었는지 요약해 보여준다. 특정 child만 궁금하면
  `echo_profile_history({parent_key:'register', child_key:'kakao:친구', limit})`처럼 좁혀서
  조회할 수 있다.
- 스냅샷은 별도로 만들 필요 없이 [4장](#4-프로파일링정교화)의 `echo_dimension_child_put` 호출
  시마다 해당 child 단위로 자동 축적된다 — `drift`는 그 축적된 이력을 조회만 한다(변경 없음).

## 17. 초안 근거 설명 (explain)

- `explain` — 직전에 만든 `draft`([12장](#12-답장-초안-생성-draft)) 결과가 왜 그렇게
  쓰였는지, 어떤 프로파일 특징/샘플/가드레일/템플릿을 근거로 그 표현을 골랐는지 설명한다.
- 신뢰 확인과 [4장](#4-프로파일링정교화) 프로파일 정교화 판단에 쓰는 디버깅 모드다 — 설명
  자체는 저장하지 않는 휘발성 출력이다(`analyze`와 마찬가지로 카파시 #2, 요청 이상으로
  나가지 않는다).

## 18. export / report / migration

- `echo_export_md({owner})` — 프로파일(루트+dimension+child 전체)+호칭+샘플 요약을 마크다운으로
  합성해 반환한다. 받은 문자열을 Write 툴로 스킬 위치의 `PROFILE.md`에 저장(파일 쓰기는 호출자
  몫). 온보딩 직후, 그리고 프로파일이 크게 바뀔 때마다 갱신을 권장한다. `owner`는 addressing/
  sample/guardrail/template 조회 범위에만 쓰인다 — 프로파일 자체는 owner와 무관하게 전체가
  들어간다.
- `echo_export_md`/`echo_report`는 내부적으로 모든 dimension+child를 모아 통짜로 재구성한다 —
  "전체가 필요한" 케이스(온보딩 직후 검토, 사용자에게 전체 프로파일 요약) 전용이며, `draft`/
  `say` 같은 평소 생성 흐름에서는 쓰지 않는다. 평소에는 [6장](#6-채널격식별-레지스터-register)·
  [10장](#10-대화맥락-주입-context-injection)처럼 필요한 child만
  `echo_dimension_child_get`/`echo_dimension_child_list`로 부분 조회한다.
- `echo_report({owner})` — 프로파일 완성도(어떤 dimension이 채워졌는지), 채널별 샘플 개수,
  호칭 등록 수, 상위 이모지 등 현황 통계를 반환한다(변경 없음). 사용자가 "지금 프로파일
  얼마나 찼어?"라고 물으면 이 툴로 답한다.
- `echo_migrate_export`/`echo_migrate_import` — 다른 설치(다른 기기)로 학습 데이터를 옮길 때
  사용한다. 프로파일(루트+전체 dimension+전체 child)은 owner 무관하게 통째로 옮겨지고,
  addressing/sample/guardrail/template은 지정한 owner 범위만 옮겨진다. export로 번들 JSON을
  받아 파일로 저장해두고, 새 설치에서 import한다. `mode:'merge'`(기본, upsert) 또는
  `mode:'replace'`(기존 데이터 삭제 후 교체, 프로파일도 포함) — replace는 파괴적이므로 사용자
  확인 후에만 사용한다.

## 19. 글쓰기 문체 온보딩 (writing_genre)

수필/블로그/개발문서처럼 **상대에게 답장하는 게 아니라 혼자 완결된 글을 쓰는** 상황을 위한
문체 프로파일이다. [6장 register](#6-채널격식별-레지스터-register)와 달리 "누구에게 말하는가"가
아니라 "무슨 장르로 쓰는가"가 축이라 별도 dimension(`writing_genre`)으로 분리돼 있다.
`echo_dimension`에 이미 껍데기(`child_schema`: `voice`/`structure`/`rhythm`/
`rhetorical_devices`/`vocabulary`/`opening_closing`)만 등록돼 있고 장르별 child는 비어
있다 — 이 장은 그 child를 채우는 온보딩 절차다.

- **트리거**: `onboard writing [장르]` 커맨드, 또는 향후 `write` 계열 커맨드가 호출됐는데
  해당 장르의 child가 없을 때 자연스럽게 유도한다("아직 <장르> 문체를 학습 안 했어요.
  지금 몇 편만 보여주시면 바로 배울 수 있어요. 할까요?") — §1 isOnboard 게이트와 같은
  원칙으로 **차단하지 않고 유도**한다(카파시 #1). 장르가 여러 개 필요해도 한 번에 다 할
  필요는 없다 — 사용자가 원하는 장르부터 하나씩 진행한다.
- **완료 여부 판단에 별도 플래그가 없다** — `isOnboard`(§1)는 대화체 프로파일 전용이다.
  특정 장르가 학습됐는지는 `echo_dimension_child_get({parent_key:'writing_genre',
  child_key:'<장르>'})`가 `null`이 아닌지로 판단한다. 전체 장르 목록은
  `echo_dimension_child_list({parent_key:'writing_genre'})`로 가볍게 확인한다.

**절차**:

1. **장르 확정** — 어떤 장르(수필/블로그/개발문서/기타)를 학습할지 확인한다. 사용자가
   지정하지 않았으면 먼저 묻는다(카파시 #1). 기존 목록에 없는 장르면 새로 추가해도 된다 —
   `child_key`는 자유 문자열이다(스키마 변경 불필요).
2. **실제 글 샘플 요청** — 그 장르로 실제로 쓴 글을 1~3편 요청한다("최근에 쓰신 <장르> 글
   1~3편만 붙여넣어 주세요"). 카카오톡 대화와 달리 한 편이 길 수 있으니 전체를 다 받아도
   된다. [15장 ingest](#15-벌크-인제스트-ingest)처럼 파일 단위로 받을 수도 있다.
   - 저장은 기존 `echo_sample_add`를 재사용한다 — 새 샘플 타입을 만들지 않는다(카파시 #2):
     `echo_sample_add({channel:'etc', situation:'writing:<장르>', text:<원문>,
     origin:'onboarding'})`. `situation`에 `writing:` 접두어를 붙여두면 나중에 채널별 샘플과
     구분해서 필터링할 수 있다.
3. **문체 특징 추출/인터뷰** — 받은 글(또는 사용자 설명)을 근거로 `writing_genre`
   dimension의 `child_schema` 여섯 필드를 기준으로 인터뷰한다:
   - `voice`(기본 어조/시점), `structure`(전개 패턴), `rhythm`(문장 길이·리듬),
     `rhetorical_devices`(자주 쓰는 수사), `vocabulary`(어휘 선택 경향),
     `opening_closing`(여닫는 방식). 샘플 글에서 직접 관찰되지 않는 필드는 짧게 물어봐도
     되고, 근거가 약하면 비워둔 채로 저장해도 된다(억지로 채우지 않는다 — 카파시 #1).
4. **저장** — `echo_dimension_child_put({parent_key:'writing_genre', child_key:'<장르>',
   echo_data:{voice, structure, rhythm, rhetorical_devices, vocabulary, opening_closing}})`
   로 장르 하나를 upsert한다. 이미 있는 장르를 다시 온보딩하면 병합 갱신되고 이전 값은
   [16장 drift](#16-드리프트-리포트-drift)에 자동 스냅샷된다(child 단위 자동 이력 축적,
   다른 코드 변경 불필요).
5. **반복/완료** — 다른 장르도 학습하고 싶으면 1번부터 반복한다. 끝나면 자연스럽게
   `echo_export_md`로 `PROFILE.md`를 갱신할지 물어본다([18장](#18-export--report--migration)와
   동일한 패턴).

> `write <주제> [장르]`처럼 이 문체를 실제로 사용해 글 초안을 뽑는 커맨드는 아직 별도로
> 설계돼 있지 않다 — 이 장은 온보딩(데이터 채우기)까지만 다룬다.

## 20. Editorial 레퍼런스 (editorial)

`writing_genre`(§19)가 **사용자 본인의** 글쓰기 문체라면, `editorial`은 **타인/외부** 문체를
참고용으로 저장해두는 레퍼런스 라이브러리다 — "이 칼럼니스트처럼 써줘", "이 블로그 톤을
참고해서" 같은 경우를 위한 것이다. `echo_dimension`에 이미 껍데기(`child_schema`: `voice`/
`structure`/`rhythm`/`rhetorical_devices`/`vocabulary`/`source`/`notes`)만 등록돼 있다.

> **§1 원칙과의 관계**: 이 스킬의 기본값은 항상 사용자 본인의 말투를 재현하는 것이다(§1).
> `editorial`의 레퍼런스는 **사용자가 명시적으로 호출했을 때만** 적용되는 선택적 스타일
> 오버레이다 — `draft`/`say`/`write`가 기본적으로 참고하거나 자동으로 섞어 쓰지 않는다.
> 또한 저작권·출처를 존중한다 — 원문을 그대로 베끼는 게 아니라 문체적 특징(어조/구조/리듬/
> 수사)만 참고하는 용도이며, `source` 필드에 출처를 남겨 나중에 확인할 수 있게 한다.

- **`editorial add <레퍼런스명>`** — 새 레퍼런스를 등록/갱신한다.
  1. 참고하고 싶은 글의 발췌를 몇 문단 요청한다("어떤 글을 참고하고 싶으신가요? 몇 문단만
     붙여넣어 주세요").
  2. 출처를 확인한다(저자/매체/링크 등) — `source` 필드에 남긴다. 출처를 모르면 모른다고
     저장해도 된다(카파시 #1, 억지로 채우지 않음).
  3. `child_schema` 필드(`voice`/`structure`/`rhythm`/`rhetorical_devices`/`vocabulary`)
     기준으로 특징을 추출한다.
  4. `echo_dimension_child_put({parent_key:'editorial', child_key:'<레퍼런스명>',
     echo_data:{voice, structure, rhythm, rhetorical_devices, vocabulary, source, notes}})`로
     저장한다.
  - 발췌 원문 자체를 오래 보관하고 싶으면 `echo_sample_add({channel:'etc',
    situation:'editorial:<레퍼런스명>', text:<발췌>, origin:'manual'})`로 별도 저장할 수
    있다(§19 writing_genre와 동일한 재사용 패턴 — 새 샘플 타입을 만들지 않는다, 카파시 #2).
- **`editorial list`** — `echo_dimension_child_list({parent_key:'editorial'})`로 등록된
  레퍼런스명 목록만 가볍게 조회한다.
- **`editorial get <레퍼런스명>`** — `echo_dimension_child_get({parent_key:'editorial',
  child_key:'<레퍼런스명>'})`로 상세 내용을 조회한다.
- **`editorial del <레퍼런스명>`** — `echo_dimension_child_del({parent_key:'editorial',
  child_key:'<레퍼런스명>'})`로 삭제한다.

> `write <주제> [장르] [editorial:<레퍼런스명>]`처럼 이 레퍼런스를 실제로 글 생성에 섞어
> 쓰는 커맨드는 아직 설계돼 있지 않다 — 이 장은 레퍼런스를 저장/관리하는 것까지만 다룬다.

## 21. [optional requirements]

- **ai-echo MCP** — 이 스킬 저장소 안의 `mcp-server/`(dJinn/SQLite 기반). 프로파일/호칭/
  샘플의 SoT 역할을 하는 선택적 요구사항이다 — 있으면 우선 사용하고, 없으면 아래 폴백을 따른다.
  - **설치**: 저장소 루트의 `./install.sh`가 심볼릭 링크 설치와 함께 `cd mcp-server && npm
    install`, `node scripts/init-db.js`(=`npm run init`)까지 자동으로 실행한다. 수동으로
    하려면:
    ```bash
    cd mcp-server
    npm install
    npm run init   # init/init.sql로 data/echo.db에 스키마+dimension 골격을 시드한다
    ```
    `init/init.sql`은 `CREATE ... IF NOT EXISTS`/`INSERT OR IGNORE`라 이미 데이터가 있는
    `data/echo.db`에 몇 번을 다시 실행해도 기존 개인 데이터(온보딩 결과, child 콘텐츠)를
    건드리지 않는다 — 멱등하다.
    Claude Code MCP 설정(`~/.claude/settings.json` 등)에 stdio 서버로 등록:
    ```json
    {
      "mcpServers": {
        "ai-echo": {
          "command": "node",
          "args": ["/absolute/path/to/ai-echo/mcp-server/src/index.js"]
        }
      }
    }
    ```
  - **설치돼 있으면**: 위 3~17장 그대로 `mcp__ai-echo__*` 툴을 사용한다.
  - **설치돼 있지 않으면**: 스킬 위치의 `PROFILE.md`를 직접 읽고/쓰는 방식으로 degrade한다.
    온보딩 시 인터뷰한 내용을 `PROFILE.md`에 사람이 읽는 형식으로 직접 기록하고, 이후
    대화에서는 그 파일을 열어 참고해 초안을 만든다. 강제하지 않는다 — 사용자에게 "MCP를
    설치하면 여러 대화 세션 간 프로파일이 자동으로 이어집니다"라고 짧게 설치를 제안할 수 있다.
  - 설치 여부는 세션에 `mcp__ai-echo__*` 도구가 실제로 노출돼 있는지로 판단한다(ToolSearch 등).
  - DB 내부적으로는 프로파일이 루트(`echo_profile`)/1차 노드(`echo_dimension`)/서브그래프
    (`echo_dimension_childs`) 3테이블 그래프로 나뉘어 저장되지만, 이건 MCP 내부 구현일 뿐
    외부 계약이 아니다 — degrade 모드의 `PROFILE.md`는 항상 사람이 읽는 통짜 문서 형태를
    유지한다(`echo_export_md` 출력 형식과 동일).
  - **git으로 공유되는 것과 안 되는 것**: `mcp-server/init/init.sql`(+ 이를 생성하는
    `scripts/generate-init-sql.js`)은 스키마 DDL과 dimension 골격(`echo_profile.schems`,
    `echo_dimension.child_schema`)만 담은 **범용 기본 데이터**라 git에 커밋된다. 반면
    `data/echo.db`(실제 DB 파일)와 `PROFILE.md`는 실제 온보딩으로 채워진 개인 데이터
    (`echo_dimension_childs` — 이름, 대화 샘플, 인물별 톤 등)를 담고 있어 `.gitignore`로
    제외된다. 새 dimension을 추가할 때는 `generate-init-sql.js`의 `DIMENSIONS` 배열을 고친
    뒤 재생성한다(손으로 `init.sql`을 직접 편집하지 않는다).
