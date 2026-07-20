-- ai-echo mcp-server 초기화 SQL (자동 생성 — scripts/generate-init-sql.js로 재생성).
-- 손으로 직접 고치지 말고 generate-init-sql.js의 DIMENSIONS를 고친 뒤 재생성할 것.
--
-- 이 파일은 두 가지를 한다:
--   1. 테이블/인덱스 DDL — djinn.define()이 서버 시작 시마다 하는 것과 동일(멱등).
--      다만 djinn이 collection을 내부 상태에 등록해야 get/find/put이 동작하므로,
--      이 SQL만 실행해서는 부족하다 — mcp-server/src/db.js가 실제 진입점이다.
--      이 파일은 문서/외부 도구(sqlite3 CLI 등)용 참조 스키마다.
--   2. 스킬의 "기본 골격" 시드 — echo_profile(root, isOnboard:false)과 echo_dimension
--      (echo_key + child_schema)만 심는다. echo_dimension_childs(실제 개인 데이터)는
--      여기 없다 — 그건 사용자별 온보딩으로 채워지는 개인 데이터라 git에 공유하지 않는다.

CREATE TABLE IF NOT EXISTS echo (
  id  TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_echo__owner       ON echo(json_extract(doc, '$.owner'));
CREATE INDEX IF NOT EXISTS idx_echo__type        ON echo(json_extract(doc, '$.type'));
CREATE INDEX IF NOT EXISTS idx_echo__key         ON echo(json_extract(doc, '$.key'));
CREATE INDEX IF NOT EXISTS idx_echo__modified_at ON echo(json_extract(doc, '$.modified_at'));

CREATE TABLE IF NOT EXISTS echo_profile (
  id  TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_echo_profile__modified_at ON echo_profile(json_extract(doc, '$.modified_at'));

CREATE TABLE IF NOT EXISTS echo_dimension (
  id  TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_echo_dimension__echo_key    ON echo_dimension(json_extract(doc, '$.echo_key'));
CREATE INDEX IF NOT EXISTS idx_echo_dimension__modified_at ON echo_dimension(json_extract(doc, '$.modified_at'));

CREATE TABLE IF NOT EXISTS echo_dimension_childs (
  id  TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_echo_dimension_childs__parent_key  ON echo_dimension_childs(json_extract(doc, '$.parent_key'));
CREATE INDEX IF NOT EXISTS idx_echo_dimension_childs__child_key   ON echo_dimension_childs(json_extract(doc, '$.child_key'));
CREATE INDEX IF NOT EXISTS idx_echo_dimension_childs__modified_at ON echo_dimension_childs(json_extract(doc, '$.modified_at'));

-- root 프로파일 시드 (isOnboard:false — 실제 온보딩 전까지는 계속 false로 유지된다)
INSERT OR IGNORE INTO echo_profile (id, doc) VALUES ('root', '{"schems":{"identity":"이름/역할 등 기본 신원 정보","tone":"말투 기본 톤 — 존댓말/반말 기준, 버블 분할, 오타 패턴, 어미, 물음표/느낌표 사용 등","emoji":"이모지·이모티콘(그래픽/텍스트) 사용 빈도와 맥락","signoffs":"대화 마무리 인사/종료 패턴","notes":"샘플 출처 및 프로파일 메타 노트","register":"채널·상대별 톤 레지스터 (축: 채널:상대)","situational":"상황별 정형 반응 패턴 (축: 상황명)","writing_genre":"글쓰기 문체 — 장르별(수필/블로그/개발문서 등) 톤·구조 (축: 장르명)","editorial":"글쓰기 시 참고할 타인/외부 문체 레퍼런스 라이브러리 (축: 레퍼런스명). writing_genre(사용자 본인 문체)와 달리 명시적으로 호출했을 때만 사용한다.","lexicon":"자주 쓰는 구체적 표현/캐치프레이즈 저장고 (축: 표현 자체). tone의 카테고리별 압축 요약과 달리, 개별 단어/문구를 하나씩 독립적으로 담아둔다.","rhetoric":"의도적으로 가끔 꺼내 쓰는 수사 장치 — 기본 톤이 아니라 상황에 선택 적용. draft가 자동 적용하지 않고 명시 호출 시에만 쓴다. (축: 장치명)"},"isOnboard":false,"onboarded_at":null,"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');

-- dimension 골격 시드 (child_schema만 — 실제 child 콘텐츠는 온보딩으로 채운다)
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('identity', '{"echo_key":"identity","child_schema":{"name":"이름","role":"역할/소속 설명"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('tone', '{"echo_key":"tone","child_schema":{"base":"기본 톤(존댓말/반말)","message_shape":"문장을 버블로 쪼개는 패턴","typos":"자주 나는 오타 패턴","playful_endings":"장난스러운 어미 변형","acknowledgment":"수긍 표현 변형","exclamations":"감탄사 사용 패턴","questions":"물음표 사용 패턴","laughter":"웃음 표현(ㅋㅋ/ㅎㅎ 등) 사용","tilde":"물결표 사용 맥락"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('emoji', '{"echo_key":"emoji","child_schema":{"graphic_emoji":"그래픽 이모지 사용 여부/맥락","text_emoticons":"텍스트 이모티콘별 사용 빈도 맵"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('signoffs', '{"echo_key":"signoffs","child_schema":{"kakao":"카톡 마무리 인사 패턴"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('notes', '{"echo_key":"notes","child_schema":{"value":"자유 텍스트 메모(문자열)"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('register', '{"echo_key":"register","child_schema":{"tone":"그 상대에게 쓰는 톤 설명","avoid":"피해야 할 표현(선택)","situational_notes":"상황별 추가 메모(선택)"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('situational', '{"echo_key":"situational","child_schema":{"value":"그 상황에서의 정형 반응 표현(문자열)"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('writing_genre', '{"echo_key":"writing_genre","child_schema":{"voice":"문체의 기본 어조/시점 (1인칭 사색형, 설명형 등)","structure":"글의 구조/전개 패턴 (도입-전개-결론, 훅-본문-요약 등)","rhythm":"문장 길이·리듬 (짧은 문장 위주 vs 만연체)","rhetorical_devices":"자주 쓰는 수사(비유, 반복, 질문형 등)","vocabulary":"어휘 선택 경향(전문용어/구어체/한자어 비중 등)","opening_closing":"글을 여닫는 방식(훅으로 시작, 요약으로 마무리 등)"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('editorial', '{"echo_key":"editorial","child_schema":{"voice":"그 레퍼런스의 기본 어조/시점","structure":"전개 패턴","rhythm":"문장 길이·리듬","rhetorical_devices":"자주 쓰는 수사","vocabulary":"어휘 선택 경향","source":"출처(저자/매체/링크 등 — 저작권 확인용)","notes":"이 레퍼런스를 언제/어떤 목적으로 참고할지에 대한 메모"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('lexicon', '{"echo_key":"lexicon","child_schema":{"meaning":"이 표현의 의미/뉘앙스","context":"언제/어떤 상황에서 쓰는지","register":"주로 쓰는 관계·채널(예: 친구, 전체)","frequency":"체감 사용 빈도","example":"실제 사용 예문"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
INSERT OR IGNORE INTO echo_dimension (id, doc) VALUES ('rhetoric', '{"echo_key":"rhetoric","child_schema":{"device":"장치의 정의 — 무엇을 하는 수사인가","structure":"형태/공식 — 어떻게 구성되는가","use_when":"발동 조건 — 언제 꺼내 쓰는가","frequency":"사용 빈도 지침 (기본 톤 아님)","caution":"역효과·금지 맥락 주의","example":"예시 문장"},"created_at":"1970-01-01T00:00:00.000Z","modified_at":"1970-01-01T00:00:00.000Z"}');
