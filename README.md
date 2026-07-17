# ai-echo

개인 말투(idiolect)를 프로파일링해 이메일·카톡 답장 **초안**을 사용자 본인의 톤으로
생성하는 Claude Code 스킬. **AI 대행이 아니다** — 항상 초안을 제시하고, 최종 검토·발송은
사용자가 한다. 자세한 절차는 [`SKILL.md`](./SKILL.md) 참고.

## 설치

```bash
./install.sh                 # 기본: $CLAUDE_CONFIG_DIR(없으면 ~/.claude) 에 스킬 심볼릭 링크
./install.sh --all-profiles  # ~ 아래 모든 Claude 프로필에 설치
```

MCP(선택, 권장):

```bash
cd mcp-server
npm install
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

`mcp-server/data/echo.db` (gitignored) — 프로파일/호칭/샘플의 실물 저장소. `owner` 필드로
사용자/프로필 간 데이터를 구분한다(기본값 `"default"`).

## 스키마

dJinn 컬렉션 `echo`, 고정 `{id, doc}` 위에 `doc`을 다음 타입으로 사용한다:

```
id = "<owner>|profile"                 // 프로파일 싱글턴
id = "<owner>|addressing|<key>"        // 인물별 전역 호칭
id = "<owner>|sample|<key>"            // 원문 샘플
id = "<owner>|snapshot|<key>"          // 프로파일 변경 이력(auto-snapshot), key = 직전 modified_at
id = "<owner>|guardrail|<key>"         // 스타일 가드레일(금지/선호 규칙)
id = "<owner>|template|<key>"          // 상황별 톤 템플릿

doc(profile)    = { owner, type:'profile', profile:{tone, register, situational, emoji, signoffs, notes, ...}, created_at, modified_at }
doc(addressing) = { owner, type:'addressing', key, name, honorific, relationship, notes, created_at, modified_at }
doc(sample)     = { owner, type:'sample', key, channel:'email'|'kakao'|'sns'|'etc', text, situation, origin:'onboarding'|'accepted-draft'|'imported'|'manual', created_at }
doc(snapshot)   = { owner, type:'snapshot', key, profile:<이전 profile 값>, note, created_at }
doc(guardrail)  = { owner, type:'guardrail', key, scope:'global'|'channel'|'person', target, kind:'avoid'|'prefer', rule, note, created_at, modified_at }
doc(template)   = { owner, type:'template', key, situation, channel, body, note, created_at, modified_at }
```

`echo_profile_put`은 기존 프로파일을 덮어쓰기 전에 이전 값을 `snapshot`으로 자동 저장해 드리프트 이력을 남긴다(최초 put에는 스냅샷 없음).

인덱스: `owner`, `type`, `key`, `modified_at`.

## 툴

| 툴 | 용도 |
|---|---|
| `echo_profile_get` | 프로파일 싱글턴 조회 |
| `echo_profile_put` | 프로파일 upsert(merge-friendly), 덮어쓰기 전 이전 값을 snapshot으로 자동 저장 |
| `echo_profile_history` | 프로파일 변경 이력(snapshot) 목록 조회(최신순, 드리프트 서사는 호출자가 구성) |
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
| `echo_owner_list` | 컬렉션에 존재하는 모든 owner 값 중복 제거 조회(페르소나/프로필 전환용) |
| `echo_export_md` | 프로파일+호칭+샘플+가드레일+템플릿 요약을 `PROFILE.md` 형식 마크다운으로 합성(파일 쓰기는 호출자 몫) |
| `echo_report` | 프로파일 완성도·샘플/호칭/템플릿/가드레일/스냅샷 통계 조회(변경 없음) |
| `echo_migrate_export` | owner 전체 데이터(전 타입, type-agnostic)를 이관용 JSON 번들로 덤프 |
| `echo_migrate_import` | 번들을 가져오기(`mode: 'merge'` 기본 또는 `'replace'`, replace는 owner의 모든 타입 row를 삭제 후 삽입) |

자세한 사용 규칙(온보딩, 전역/휘발성 호칭 판단, 초안 생성 워크플로우)은
[`SKILL.md`](./SKILL.md) 참고.
