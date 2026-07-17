#!/usr/bin/env node
'use strict';

// 일회성 마이그레이션: 'echo' 컬렉션의 통짜 profile(index)+profile_sect(블록) row들을
// echo_profile(root) / echo_dimension(1차 노드) / echo_dimension_childs(서브그래프) 3테이블로 옮긴다.
// register:*는 하나의 'register' dimension 아래 여러 child로, situational(단일 객체)은
// 'situational' dimension 아래 상황명별 child로 쪼갠다. 나머지(identity/tone/emoji/signoffs/notes)는
// 축 없는 단일값 dimension이라 child_key === echo_key 컨벤션을 따른다.

const { djinn, PROFILE_ID, makeChildId } = require('../src/db');

const COLLECTION = 'echo';
const OWNER = 'default';
// 옛 db.js의 makeId는 'profile' 타입을 `${owner}|profile`로 특별 취급했다(key 없음).
// 새 makeId는 그 분기가 없어져서(더 이상 'echo' 컬렉션에 profile을 안 두므로) 재사용하면 안 되고,
// 레거시 id는 여기서 리터럴로 만든다.
const legacyProfileId = (owner) => `${owner}|profile`;
const legacySectId = (owner, key) => `${owner}|profile_sect|${key}`;

const SCHEMS = {
  identity: '이름/역할 등 기본 신원 정보',
  tone: '말투 기본 톤 — 존댓말/반말 기준, 버블 분할, 오타 패턴, 어미, 물음표/느낌표 사용 등',
  emoji: '이모지·이모티콘(그래픽/텍스트) 사용 빈도와 맥락',
  signoffs: '대화 마무리 인사/종료 패턴',
  notes: '샘플 출처 및 프로파일 메타 노트',
  register: '채널·상대별 톤 레지스터 (축: 채널:상대)',
  situational: '상황별 정형 반응 패턴 (축: 상황명)',
};

const CHILD_SCHEMAS = {
  identity: { name: '이름', role: '역할/소속 설명' },
  tone: {
    base: '기본 톤(존댓말/반말)',
    message_shape: '문장을 버블로 쪼개는 패턴',
    typos: '자주 나는 오타 패턴',
    playful_endings: '장난스러운 어미 변형',
    acknowledgment: '수긍 표현 변형',
    exclamations: '감탄사 사용 패턴',
    questions: '물음표 사용 패턴',
    laughter: '웃음 표현(ㅋㅋ/ㅎㅎ 등) 사용',
    tilde: '물결표 사용 맥락',
  },
  emoji: {
    graphic_emoji: '그래픽 이모지 사용 여부/맥락',
    text_emoticons: '텍스트 이모티콘별 사용 빈도 맵',
  },
  signoffs: { kakao: '카톡 마무리 인사 패턴' },
  notes: { value: '자유 텍스트 메모(문자열)' },
  register: {
    tone: '그 상대에게 쓰는 톤 설명',
    avoid: '피해야 할 표현(선택)',
    situational_notes: '상황별 추가 메모(선택)',
  },
  situational: { value: '그 상황에서의 정형 반응 표현(문자열)' },
};

function putDimension(echoKey, description, childSchema) {
  const now = new Date().toISOString();
  const existing = djinn.get('echo_dimension', echoKey);
  djinn.put('echo_dimension', echoKey, {
    echo_key: echoKey,
    child_schema: childSchema,
    created_at: existing?.created_at ?? now,
    modified_at: now,
  });
  return description;
}

function putChild(parentKey, childKey, echoData) {
  const now = new Date().toISOString();
  const id = makeChildId(parentKey, childKey);
  const existing = djinn.get('echo_dimension_childs', id);
  djinn.put('echo_dimension_childs', id, {
    parent_key: parentKey,
    child_key: childKey,
    echo_data: echoData,
    created_at: existing?.created_at ?? now,
    modified_at: now,
  });
}

function main() {
  const indexDoc = djinn.get(COLLECTION, legacyProfileId(OWNER));
  if (!indexDoc || !indexDoc.profile || !indexDoc.profile.blocks) {
    console.log('[skip] no legacy block-index profile found — nothing to migrate.');
    return;
  }

  const blockKeys = Object.keys(indexDoc.profile.blocks);
  const getBlockValue = (key) => djinn.get(COLLECTION, legacySectId(OWNER, key))?.value;

  djinn.transaction(() => {
    const schems = {};
    let isOnboard = false;
    let onboardedAt = null;

    for (const key of blockKeys) {
      if (key === 'onboarded') {
        isOnboard = !!getBlockValue(key);
        continue;
      }
      if (key === 'onboarded_at') {
        onboardedAt = getBlockValue(key) ?? null;
        continue;
      }
      if (key.startsWith('register:')) {
        const childKey = key.slice('register:'.length);
        schems.register = putDimension('register', SCHEMS.register, CHILD_SCHEMAS.register);
        putChild('register', childKey, getBlockValue(key));
        continue;
      }
      if (key === 'situational') {
        schems.situational = putDimension('situational', SCHEMS.situational, CHILD_SCHEMAS.situational);
        const situational = getBlockValue(key) || {};
        for (const [situationName, text] of Object.entries(situational)) {
          putChild('situational', situationName, text);
        }
        continue;
      }
      // 축 없는 단일값 dimension: identity/tone/emoji/signoffs/notes
      if (SCHEMS[key]) {
        schems[key] = putDimension(key, SCHEMS[key], CHILD_SCHEMAS[key] ?? {});
        putChild(key, key, getBlockValue(key));
        continue;
      }
      console.warn(`[warn] unmapped legacy block key: ${key} — skipped`);
    }

    const now = new Date().toISOString();
    const existingRoot = djinn.get('echo_profile', PROFILE_ID);
    djinn.put('echo_profile', PROFILE_ID, {
      schems,
      isOnboard,
      onboarded_at: onboardedAt,
      created_at: existingRoot?.created_at ?? indexDoc.created_at ?? now,
      modified_at: now,
    });

    // 옛 스킴 정리 (profile index, profile_sect 블록들, 그 이전 스냅샷)
    const legacyRows = djinn.find(COLLECTION, { owner: OWNER, type: 'profile' })
      .concat(djinn.find(COLLECTION, { owner: OWNER, type: 'profile_sect' }))
      .concat(djinn.find(COLLECTION, { owner: OWNER, type: 'snapshot' }));
    for (const row of legacyRows) djinn.del(COLLECTION, row.id);

    console.log(`[ok] migrated dimensions: ${Object.keys(schems).join(', ')}`);
    console.log(`[ok] isOnboard=${isOnboard}, onboarded_at=${onboardedAt}`);
    console.log(`[ok] cleaned up ${legacyRows.length} legacy rows`);
  });
}

main();
