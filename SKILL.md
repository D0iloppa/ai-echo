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
  으로 루트를 가볍게 확인한다. `isOnboard`가 `true`가 아니면 **차단하지 않고 온보딩을
  유도한다** — 사용자가 건너뛰면 품질 한계를 짧게 고지하고 그대로 진행한다(차단 아니라 유도가
  이 스킬 전체에 반복되는 게이트 패턴이다 — [3장](#3-최초-온보딩-onboarding)·
  [18장](#18-글쓰기-문체-온보딩-writing_genre)도 동일). 온보딩이 끝나면 `isOnboard:true`로
  전환되어 이후 진입에서는 이 유도가 뜨지 않는다.

## 2. 커맨드

아래 어휘로 모드를 지정해 스킬을 부른다. 커맨드 없이 메시지만 붙여넣어도 가장 가까운 모드
(대개 `analyze` 또는 `draft`)로 동작하되, 애매하면 먼저 확인한다.

| 커맨드 | 하는 일 | 상세 |
|---|---|---|
| `help [<커맨드명>]` | 이 표를 그대로 보여준다(별도 요약 유지 안 함). 커맨드명을 붙이면 그 장을 요약. | — |
| `analyze <대화맥락>` | 답장 전에 상대 대화의 의도/서브텍스트를 파악(휘발성, 미저장). | [11장](#11-분석-analyze) |
| `draft <맥락> [프리셋]` | 대화 답장 초안 생성(톤 변주, 가드레일·템플릿 반영). | [12장](#12-답장-초안-생성-draft) |
| `say <의도> [프리셋]` | 상대 메시지 없이 의도만으로 메시지 초안 생성. | [13장](#13-의도--초안-say) |
| `onboard` | 최초 대화체 온보딩. | [3장](#3-최초-온보딩-onboarding) |
| `onboard writing [장르]` | 글쓰기 문체(`writing_genre`) 온보딩. | [18장](#18-글쓰기-문체-온보딩-writing_genre) |
| `editorial [add\|list\|get\|del] <이름>` | 타인 문체 레퍼런스 관리(명시적 호출 시에만 사용). | [19장](#19-editorial-레퍼런스-editorial) |
| `write <주제> [장르] [editorial:<이름>]` | 독립된 글(수필/블로그/개발문서 등) 초안 생성. | [20장](#20-글쓰기-초안-write) |
| `profile` | 프로파일 조회/정교화, 전역 호칭 관리. | [4장](#4-프로파일링정교화)·[5장](#5-전역-호칭-vs-휘발성-호칭) |
| `persona [<owner>]` | addressing/sample/guardrail/template의 owner 전환. | [7장](#7-페르소나owner-전환-persona) |
| `guardrail` | 채널·상대별 금지/우선 표현 관리. | [8장](#8-스타일-가드레일-guardrail) |
| `template` | 상황별(거절/사과/독촉 등) 톤 스니펫 관리. | [9장](#9-상황-템플릿-template) |
| `feedback <최종본>` | 실제로 보낸 최종 메시지를 학습에 되먹인다. | [14장](#14-피드백-루프-feedback) |
| `ingest <파일/붙여넣기>` | 카톡/이메일 내보내기 파일을 일괄 샘플 적재. | [15장](#15-벌크-인제스트-ingest) |
| `explain` | 직전 draft가 왜 그렇게 나왔는지 근거 설명(휘발성). | [16장](#16-초안-근거-설명-explain) |
| `export` / `report` / `migrate` | PROFILE.md 스냅샷 / 완성도 통계 / 다른 설치로 이관. | [17장](#17-export--report--migration) |

## 3. 최초 온보딩 (Onboarding)

1. 과거에 실제로 보낸 메시지(이메일/카톡/SNS) 몇 개를 요청해 `echo_sample_add({owner,
   channel, text, situation, origin:'onboarding'})`로 저장한다. 5~10개를 권장하되 적어도
   진행한다. 내보내기 파일이 있으면 [15장 `ingest`](#15-벌크-인제스트-ingest)로 한 번에
   적재해도 된다.
2. 저장된 샘플을 근거로 **말투 특징을 추출/인터뷰**한다: 문장 길이·어미·접속사/추임새·
   상황별 반응·이모지 빈도·마무리 인사(signoff) 패턴.
3. 주요 인물의 **전역 호칭**을 확인해 `echo_addressing_put`으로 등록한다([5장](#5-전역-호칭-vs-휘발성-호칭)).
4. 추출한 내용을 **dimension 단위**로 저장한다:
   - `echo_dimension_put({echo_key, description, child_schema})` — 1차 노드 생성.
     `description`은 루트 `schems`에 노출되고, `child_schema`는 `echo_data`의 필드 명세다(DDL 대용).
   - `echo_dimension_child_put({parent_key, child_key, echo_data})` — 실제 값 저장. 축이
     없는(단일값) dimension은 `child_key`를 `parent_key`(=echo_key)와 동일하게 쓴다.

   현재 관리 중인 dimension:
   | echo_key | 설명 | 축(child_key) |
   |---|---|---|
   | `identity` | 이름/역할 등 기본 신원 | 없음(`identity`) |
   | `tone` | 말투 기본 톤 | 없음(`tone`) |
   | `emoji` | 이모지·이모티콘 사용 빈도/맥락 | 없음(`emoji`) |
   | `signoffs` | 마무리 인사 패턴 | 없음(`signoffs`) |
   | `notes` | 샘플 출처·메타 노트 | 없음(`notes`) |
   | `register` | 채널·상대별 톤 | `<채널:상대>` — [6장](#6-채널격식별-레지스터-register) |
   | `situational` | 상황별 정형 반응 | 상황명 |
   | `writing_genre` | 사용자 본인의 글쓰기 문체 | 장르명 — [18장](#18-글쓰기-문체-온보딩-writing_genre) |
   | `editorial` | 타인 문체 레퍼런스(명시적 호출 시만) | 레퍼런스명 — [19장](#19-editorial-레퍼런스-editorial) |
   | `lexicon` | 자주 쓰는 구체적 표현/캐치프레이즈 저장고 | 표현 자체(예: `"약간"`) — [4장](#4-프로파일링정교화) 참고 |

   `writing_genre`/`editorial`/`lexicon`은 껍데기만 있고 child는 각 장의 절차(또는 4장의
   평소 정교화)로 채운다. 새 dimension이 필요하면 이 표의 패턴을 따라 추가한다(스키마 변경 불필요).
5. `echo_profile_put({isOnboard:true, onboarded_at:<ISO 시각>})`으로 완료를 표시하고,
   `echo_export_md({owner})`로 받은 마크다운을 `PROFILE.md`에 저장한다.

> 온보딩은 차단 게이트가 아니다 — 사용자가 건너뛰면 그대로 진행한다.

## 4. 프로파일링(정교화)

- 새 특징이 관찰되면 `echo_dimension_child_get`으로 해당 child만 읽고 병합한 값을
  `echo_dimension_child_put`으로 그 child 하나만 다시 쓴다(다른 child는 건드리지 않는다).
- 완전히 새로운 축이 필요하면 `echo_dimension_put`으로 dimension을 먼저 등록한 뒤(3장 표
  참고) child를 채운다.
- **`tone` vs `lexicon` 판단 기준** — 대화 중 새로 관찰된 말버릇이 **경향/패턴**이면(예:
  "물음표를 연달아 찍는다") `tone`의 해당 필드를 갱신하고, **구체적인 단어나 문구 하나**면
  (예: "약간", "얼탱이없네" 같은 특정 표현) `lexicon`에 그 표현을 `child_key`로 새 child를
  추가한다(`echo_dimension_child_put({parent_key:'lexicon', child_key:'<표현>', echo_data:{meaning, context, register, frequency, example}})`).
  같은 정보를 두 곳에 중복해서 넣지 않는다 — 패턴이면 tone, 낱개 표현이면 lexicon 한쪽에만.
- 사용자가 준 새 원문은 `echo_sample_add`로 계속 누적한다.
- 과설계 금지 — 스키마에 명세 밖의 필드를 임의로 늘리지 않는다.

## 5. 전역 호칭 vs 휘발성 호칭

- **전역(영속)** — 항상 그렇게 부르는 호칭("김대리님", "지수야") → `echo_addressing_put`으로 저장.
- **휘발성(맥락 한정)** — 이번 대화에서만 쓰는 지칭("그 프로젝트 담당자님") → 저장하지 않는다.
- 애매하면 "이 호칭, 항상 쓰시나요 이번 건만인가요?"라고 되묻는다.

## 6. 채널·격식별 레지스터 (register)

같은 사람에게도 채널과 격식 수준에 따라 톤이 달라진다. `analyze`/`draft`/`say`는 답장 전에
**어느 채널이고 상대가 누구인지부터 판별**해 해당 register를 적용한다.

- `register` dimension 아래, `채널:상대` 조합마다 독립된 child로 쪼갠다:
  `echo_dimension_child_put({parent_key:'register', child_key:'kakao:친구', echo_data:{tone:'반말, ㅋㅋ/이모지 다용'}})`.
  이렇게 하면 `echo_dimension_child_get({parent_key:'register', child_key:'kakao:친구'})`로
  필요한 것만 정확히 집어올 수 있다 — 전체를 끌어올 필요가 없다. 등록된 채널·상대 목록은
  `echo_dimension_child_list({parent_key:'register'})`로 가볍게 확인한다. 같은 패턴은
  `writing_genre`/`editorial` 등 다른 축에도 그대로 재사용된다.
- 일치하는 `register` child가 있으면 그 톤을 우선 적용하고, 없으면 `tone` dimension으로 폴백한다.

## 7. 페르소나(owner) 전환 (persona)

말투 프로파일 자체(`echo_profile`/`echo_dimension`/`echo_dimension_childs`)는 owner가 없는
전역 싱글턴이다 — 업무/사적 톤 차이는 [6장 register](#6-채널격식별-레지스터-register)로
이미 커버되므로 이 장의 대상이 아니다. 이 장은 `addressing`/`sample`/`guardrail`/`template`
전용이다.

- `persona` — `echo_owner_list()`로 owner 목록 조회.
- `persona <owner>` — 세션 기본 owner 전환(기본값 `'default'`). 이후 `echo_addressing_*`/
  `echo_sample_*`/`echo_guardrail_*`/`echo_template_*` 호출에 이 owner를 넘긴다
  (`echo_profile_*`/`echo_dimension_*`은 owner 인자가 없다).

## 8. 스타일 가드레일 (guardrail)

- `echo_guardrail_put/get/list/del`로 관리. 필드: `scope`('global'|'channel'|'person'),
  `target`, `kind`('avoid'|'prefer'), `rule`.
- `draft`는 생성 전 해당 범위의 가드레일을 반드시 조회해 준수한다(강제 준수 사항).

## 9. 상황 템플릿 (template)

- `echo_template_put/get/list/del`로 관리. 필드: `situation`, `channel?`, `body`.
- `draft`/`say`는 상황이 인식되면 관련 템플릿을 시드로 참고한다. 없으면 평소처럼 생성한다.

## 10. 대화맥락 주입 (Context injection)

`analyze`/`draft` 공통 전처리:

1. 상대 채널·격식에 맞는 `echo_dimension_child_get({parent_key:'register', child_key:'<채널:상대>'})`
   와 `tone`/`situational` 등 필요한 child만 point-lookup으로 로드한다(통째로 끌어오지 않는다).
2. 상대가 특정 인물이면 `echo_addressing_get`으로 호칭을 함께 로드한다(모르면 되묻는다).
   단톡방이면 화자별로 각각 조회한다.

## 11. 분석 (analyze)

답장 전에 대화의 의도를 파악하는 모드. **여기서도 대행 아님 원칙이 유지된다** — 판단을
돕지, 대신 결정하거나 보내지 않는다.

- [10장](#10-대화맥락-주입-context-injection) 절차로 로드하되, 분석 결과 자체는 저장하지 않는다(휘발성).
- 출력: ① 핵심 의도/용건 ② 서브텍스트/숨은 뉘앙스 ③ 관계/톤 컨텍스트(화자별 구분) ④ 답변
  필요 포인트 ⑤ 권장 대응 방향(간단히 — 상세 문구는 `draft`의 몫).
- 새 인물이 등장하면 전역 호칭 등록 여부를 물어본다([5장](#5-전역-호칭-vs-휘발성-호칭)).
- 분석 후 "바로 초안 뽑을까요?(`draft`)"로 자연스럽게 이어가되, 원치 않으면 그대로 끝낸다.

## 12. 답장 초안 생성 (draft)

- 톤 변주 1~3개 제시를 권장한다(예: 짧고 캐주얼 / 조금 더 정중 / 원문 그대로).
- `짧게`/`정중 장문`/`불릿`/`캐주얼` 등 출력 프리셋을 지정하면 그대로 따르고, 없으면
  register/tone 기본을 쓴다.
- 생성 전 [8장](#8-스타일-가드레일-guardrail) 가드레일을 반드시 조회해 준수하고,
  [9장](#9-상황-템플릿-template) 템플릿이 있으면 시드로 참고한다.
- 프로파일에 근거 없는 표현을 새로 지어내지 않는다.
- 초안마다 **"이대로 보내지 마시고 검토 후 사용하세요"**를 명시한다.
- 자연스럽게 [14장 `feedback`](#14-피드백-루프-feedback) 축적을 유도할 수 있다(강제하지 않음).

## 13. 의도 → 초안 (say)

상대 메시지 없이 "이런 말을 하고 싶다"는 의도/요점만 준 경우 — 의도 + 프로파일(+필요하면
상대 호칭)로 초안을 렌더링한다. 모호하면(누구에게/어떤 채널/격식) 먼저 확인한다. 출력
프리셋·가드레일·템플릿 처리는 [12장 `draft`](#12-답장-초안-생성-draft)와 동일하다.

## 14. 피드백 루프 (feedback)

- `feedback <최종본>` — 실제로 다듬어 보낸 메시지를 `echo_sample_add({..., origin:'accepted-draft'})`로 저장한다.
- 강제하지 않되 draft/say 이후 자연스럽게 물어본다. `accepted-draft` 샘플은 실제 사용
  맥락에 가까워 자기교정에 특히 유용하다.

## 15. 벌크 인제스트 (ingest)

- 카톡 `.txt`/이메일 `.mbox` 등을 파싱해 **사용자 본인 발화만** 추려 `echo_sample_add_bulk`로
  일괄 적재한다. 상대방 발화는 걸러낸다.
- 개인정보가 담긴 파일이므로 어떤 대화/기간을 넣을지 **사용자 확인 후에만** 진행한다.

## 16. 초안 근거 설명 (explain)

- 직전 `draft` 결과가 어떤 프로파일/샘플/가드레일/템플릿을 근거로 나왔는지 설명한다.
- 신뢰 확인과 프로파일 정교화 판단용 디버깅 모드. 저장하지 않는 휘발성 출력이다.

## 17. export / report / migration

- `echo_export_md({owner})` — 프로파일(루트+전체 dimension+child) + 호칭 + 샘플 요약을
  `PROFILE.md` 형식 마크다운으로 반환한다. 내부적으로 모든 dimension+child를 통짜로
  재구성하므로 "전체가 필요한" 케이스 전용이다 — `draft`/`say`처럼 평소 생성 흐름에서는
  [6장](#6-채널격식별-레지스터-register)/[10장](#10-대화맥락-주입-context-injection)처럼
  필요한 child만 부분 조회한다.
- `echo_report({owner})` — 프로파일 완성도, 채널별 샘플 개수, 호칭 수, 상위 이모지 등 통계(변경 없음).
- `echo_migrate_export`/`echo_migrate_import` — 다른 설치로 이관. 프로파일은 owner 무관하게
  통째로, addressing/sample/guardrail/template은 지정 owner 범위만 옮긴다.
  `mode:'replace'`는 파괴적이므로 사용자 확인 후에만 사용한다.

## 18. 글쓰기 문체 온보딩 (writing_genre)

수필/블로그/개발문서처럼 **답장이 아니라 혼자 완결된 글을 쓰는** 상황을 위한 문체
프로파일이다. [6장 register](#6-채널격식별-레지스터-register)와 달리 "누구에게"가 아니라
"무슨 장르로"가 축이라 별도 dimension으로 분리돼 있다.

- **트리거**: `onboard writing [장르]`, 또는 [20장 `write`](#20-글쓰기-초안-write)가 호출됐는데
  해당 장르 child가 없을 때 차단하지 않고 유도한다(§1과 동일한 게이트 패턴). 장르를 한 번에
  다 할 필요는 없다.
- **완료 여부**: 별도 플래그 없이 `echo_dimension_child_get({parent_key:'writing_genre',
  child_key:'<장르>'})`가 `null`인지로 판단한다.

**절차**: ① 장르 확정(미지정 시 확인, 새 장르 자유 추가 가능) → ② 실제 글 1~3편 요청, 저장은
새 샘플 타입을 만들지 않고 `echo_sample_add({channel:'etc', situation:'writing:<장르>',
text, origin:'onboarding'})` 재사용 → ③ `child_schema`의 여섯 필드(`voice`/`structure`/
`rhythm`/`rhetorical_devices`/`vocabulary`/`opening_closing`) 기준으로 인터뷰(근거 약하면
비워둬도 됨) → ④ `echo_dimension_child_put({parent_key:'writing_genre', child_key:'<장르>',
echo_data:{...}})`로 저장 → ⑤ 다른 장르는 반복, 끝나면 `echo_export_md` 갱신 제안.

## 19. Editorial 레퍼런스 (editorial)

`writing_genre`(§18)가 **사용자 본인** 문체라면, `editorial`은 **타인/외부** 문체를 참고용으로
저장하는 레퍼런스 라이브러리다("이 칼럼니스트처럼 써줘").

> **§1 원칙과의 관계**: 기본값은 항상 본인 말투다. `editorial`은 **명시적으로 호출했을 때만**
> 적용되는 선택적 오버레이이며(`draft`/`say`/`write`가 자동으로 섞어 쓰지 않는다), 원문을
> 베끼지 않고 어조/구조/리듬 등 문체적 특징만 참고한다. `source` 필드에 출처를 남긴다.

- `editorial add <이름>` — 발췌 요청 → 출처 확인(`source`, 모르면 비워도 됨) → `child_schema`
  기준 특징 추출 → `echo_dimension_child_put({parent_key:'editorial', child_key:'<이름>', echo_data:{...}})`.
  발췌 원문을 오래 보관하려면 `echo_sample_add({channel:'etc', situation:'editorial:<이름>', ...})`로 별도 저장(§18과 동일 재사용 패턴).
- `editorial list/get/del <이름>` — `echo_dimension_child_list/get/del({parent_key:'editorial', ...})`.

## 20. 글쓰기 초안 (write)

`write <주제> [장르] [editorial:<이름>]` — [18장](#18-글쓰기-문체-온보딩-writing_genre)으로
학습한 문체로 독립된 글의 초안을 만든다. [13장 `say`](#13-의도--초안-say)와 비슷하게 의도/
요점만 주면 되고, 상대 메시지를 전제하지 않는다.

- 장르 미지정 시 확인하고, 미학습 장르는 차단하지 않고 §18 온보딩을 제안한다.
- `echo_dimension_child_get({parent_key:'writing_genre', child_key:<장르>})`로 문체를 로드한다.
- `editorial:<이름>`을 **명시했을 때만**([19장](#19-editorial-레퍼런스-editorial) 원칙) 함께
  참고하고, 참고했다는 사실을 초안에 투명하게 밝힌다.
- `scope:'global'` 가드레일은 write에도 적용한다(channel/person scope는 해당 없음).
- 개발문서처럼 길어질 장르는 본문 전에 목차/개요를 먼저 확인받는다.
- 초안마다 **"이대로 발행하지 마시고 검토 후 사용하세요"**를 명시한다(§1 원칙).
- 발행된 최종본을 알려주면 [14장 feedback](#14-피드백-루프-feedback)과 같은 방식으로 그
  장르 child를 갱신할 수 있다(선택).

## 21. [optional requirements]

- **ai-echo MCP** — 이 스킬 저장소 안의 `mcp-server/`(dJinn/SQLite 기반). 프로파일/호칭/
  샘플의 SoT 역할을 하는 선택적 요구사항이다 — 있으면 우선 사용하고, 없으면 아래 폴백을 따른다.
  - **설치**: 저장소 루트의 `./install.sh`가 심볼릭 링크 설치와 함께 `npm install`,
    `npm run init`까지 자동 실행한다. 수동으로 하려면:
    ```bash
    cd mcp-server
    npm install
    npm run init   # init/init.sql로 data/echo.db에 스키마+dimension 골격을 시드한다
    ```
    `init/init.sql`은 `CREATE ... IF NOT EXISTS`/`INSERT OR IGNORE`라 이미 데이터가 있는
    DB에 다시 실행해도 기존 개인 데이터를 건드리지 않는다(멱등). Claude Code MCP 설정에
    stdio 서버로 등록:
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
  - **설치돼 있으면**: 위 장들 그대로 `mcp__ai-echo__*` 툴을 사용한다.
  - **설치돼 있지 않으면**: 스킬 위치의 `PROFILE.md`를 직접 읽고/쓰는 방식으로 degrade한다.
    강제하지 않는다 — MCP 설치 시 세션 간 프로파일이 자동으로 이어진다고 짧게 제안할 수 있다.
    설치 여부는 세션에 `mcp__ai-echo__*` 도구가 노출돼 있는지로 판단한다.
  - DB 내부적으로는 프로파일이 루트/1차 노드/서브그래프 3테이블 그래프로 저장되지만, 이건
    MCP 내부 구현일 뿐 외부 계약이 아니다 — degrade 모드의 `PROFILE.md`는 항상 사람이 읽는
    통짜 문서 형태를 유지한다.
  - **git으로 공유되는 것과 안 되는 것**: `mcp-server/init/init.sql`(+ 생성 스크립트
    `scripts/generate-init-sql.js`)은 스키마 DDL과 dimension 골격만 담은 범용 기본 데이터라
    git에 커밋된다. 반면 `data/echo.db`와 `PROFILE.md`는 실제 온보딩으로 채워진 개인 데이터라
    `.gitignore`로 제외된다. 새 dimension을 추가할 때는 `generate-init-sql.js`의
    `DIMENSIONS` 배열을 고친 뒤 재생성한다(손으로 `init.sql`을 직접 편집하지 않는다).
