# ai-echo

> 언어의 한계가 세상의 한계다 — 비트겐슈타인

나라는 사람을 무엇으로 규정할 수 있을까요. 평소 즐겨 쓰는 단어들이야말로 내 생각의
파편입니다. 한때는 개그맨을 대표하는 것이 '유행어'라 해도 과언이 아니었던 것처럼, 우리
각자도 자주 쓰는 말버릇으로 규정됩니다.

**ai-echo**는 그 말버릇을 배워, 가장 나다운 목소리로 초안을 되돌려주는 메아리입니다.

개인 말투(idiolect)를 프로파일링해 이메일·카톡 답장 **초안**을 사용자 본인의 톤으로
생성하는 Claude Code 스킬. **AI 대행이 아니다** — 항상 초안을 제시하고, 최종 검토·발송은
사용자가 한다. 자세한 절차는 [`SKILL.md`](./SKILL.md) 참고.

## 설치

```bash
./install.sh                 # 스킬 심볼릭 링크 + mcp-server npm install + DB 초기화까지 한 번에
./install.sh --all-profiles  # ~ 아래 모든 Claude 프로필에 설치
```

MCP는 선택이지만 권장이다(없으면 SKILL.md의 degrade 절차로 대체). 수동으로 하려면:

```bash
cd mcp-server
npm install
npm run init   # init/init.sql로 스키마+dimension 골격을 시드(멱등, 기존 개인 데이터 안전)
```

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

## 데이터

`mcp-server/data/echo.db` (gitignored) — 프로파일/호칭/샘플의 실물 저장소. 실제 온보딩으로
채워진 개인 데이터라 git에 올리지 않는다. 공유되는 건 스키마+빈 골격뿐 — [스키마](#스키마)
참고.

## 스키마

프로파일은 owner 없는 전역 싱글턴 그래프로 저장된다(이 스킬은 "한 사람의 말투를 배우는
도구"라는 전제). 나머지(addressing/sample/guardrail/template)는 `echo` 컬렉션에서 여전히
`owner`로 구분된다(기본값 `"default"`, [`persona`](./SKILL.md#7-페르소나owner-전환-persona) 전환용).

```
echo_profile         // root, 1-row(id='root'). { schems:{echo_key: description}, isOnboard, onboarded_at, created_at, modified_at }
echo_dimension       // 1차 노드, echo_key가 PK. { echo_key, child_schema:{field: description}, created_at, modified_at }
echo_dimension_childs // 서브그래프(실데이터). id="<parent_key>::<child_key>". { parent_key, child_key, echo_data, created_at, modified_at }

echo                             // addressing/sample/guardrail/template 전용, owner 스코프
id = "<owner>|addressing|<key>"  // 인물별 전역 호칭
id = "<owner>|sample|<key>"      // 원문 샘플
id = "<owner>|guardrail|<key>"   // 스타일 가드레일(금지/선호 규칙)
id = "<owner>|template|<key>"    // 상황별 톤 템플릿
```

현재 등록된 dimension: `identity`/`tone`/`emoji`/`signoffs`/`notes`(축 없음, 단일값) ·
`register`(축: 채널:상대) · `situational`(축: 상황명) · `writing_genre`(축: 장르명, 사용자
본인 글쓰기 문체) · `editorial`(축: 레퍼런스명, 명시적 호출 시에만 쓰는 타인 문체 참고) ·
`lexicon`(축: 표현 자체, 자주 쓰는 구체적 캐치프레이즈 — `tone`의 카테고리 요약과 달리 개별
단어/문구를 하나씩 담는다). 자세한 컨벤션은 [`SKILL.md`](./SKILL.md#3-최초-온보딩-onboarding) 참고.

인덱스: `echo`(owner/type/key/modified_at), `echo_dimension`(echo_key/modified_at),
`echo_dimension_childs`(parent_key/child_key/modified_at).

## 툴

| 툴 | 용도 |
|---|---|
| `echo_profile_get` | 루트 프로파일 조회(`schems`, `isOnboard`) |
| `echo_profile_put` | 루트 상태 필드(`isOnboard`/`onboarded_at`) 갱신 |
| `echo_dimension_get` | 1차 노드(dimension) 조회(`child_schema`) |
| `echo_dimension_put` | dimension upsert — description은 루트 `schems`에, `child_schema`는 이 row에 |
| `echo_dimension_child_get` | 서브그래프 child 하나를 point-lookup |
| `echo_dimension_child_list` | 특정 dimension 밑 child_key 목록만 가볍게 조회(내용 제외) |
| `echo_dimension_child_put` | child 하나 upsert(merge-friendly, 부모 dimension 없으면 자동 생성) |
| `echo_dimension_child_del` | child 하나 삭제 |
| `echo_addressing_put` | 인물별 전역 호칭 upsert |
| `echo_addressing_get` | 특정 인물 호칭 조회 |
| `echo_addressing_list` | 전역 호칭 전체 목록 |
| `echo_addressing_del` | 호칭 삭제 |
| `echo_sample_add` | 원문 샘플 추가(key 자동 생성, origin 지정 가능) |
| `echo_sample_add_bulk` | 파싱된 items 배열을 트랜잭션으로 일괄 추가(카톡 .txt/이메일 .mbox 이관용) |
| `echo_sample_list` | 샘플 목록(채널 필터 가능) |
| `echo_sample_del` | 샘플 삭제 |
| `echo_guardrail_put` | 스타일 가드레일(금지/선호 규칙) upsert |
| `echo_guardrail_get` | 가드레일 하나 조회 |
| `echo_guardrail_list` | 가드레일 목록(scope/target 필터 가능) |
| `echo_guardrail_del` | 가드레일 삭제 |
| `echo_template_put` | 상황별 톤 템플릿 upsert |
| `echo_template_get` | 템플릿 하나 조회 |
| `echo_template_list` | 템플릿 목록(channel 필터 가능) |
| `echo_template_del` | 템플릿 삭제 |
| `echo_owner_list` | addressing/sample/guardrail/template에 존재하는 owner 값 중복 제거 조회(persona 전환용) |
| `echo_export_md` | 프로파일(전체)+호칭+샘플+가드레일+템플릿 요약을 `PROFILE.md` 형식 마크다운으로 합성 |
| `echo_report` | 프로파일 완성도·샘플/호칭/템플릿/가드레일 통계 조회(변경 없음) |
| `echo_migrate_export` | 프로파일(owner 무관, 전체)+지정 owner의 addressing/sample/guardrail/template을 이관용 JSON 번들로 덤프 |
| `echo_migrate_import` | 번들을 가져오기(`mode: 'merge'` 기본 또는 `'replace'`) |

자세한 사용 규칙(온보딩, 전역/휘발성 호칭 판단, 초안 생성 워크플로우)은
[`SKILL.md`](./SKILL.md) 참고.
