#!/usr/bin/env node
'use strict';

// 일회성 마이그레이션: 통짜 profile JSON(owner|profile)을 인덱스(profile) +
// 블록별 profile_sect row로 분해한다. register는 하위 key별로 쪼개고,
// identity/tone/emoji/signoffs/notes/situational은 필드 그대로 블록화한다.

const { djinn, makeId } = require('../src/db');

const COLLECTION = 'echo';
const OWNER = process.argv[2] || 'default';

const DESCRIPTIONS = {
  identity: '이름/역할 등 기본 신원 정보',
  tone: '말투 기본 톤 — 존댓말/반말 기준, 버블 분할, 오타 패턴, 어미, 물음표/느낌표 사용 등',
  emoji: '이모지·이모티콘(그래픽/텍스트) 사용 빈도와 맥락',
  signoffs: '대화 마무리 인사/종료 패턴',
  notes: '샘플 출처 및 프로파일 메타 노트',
  situational: '상황별(지시수용/질책/이해못함/기술설명/감탄/거절/걱정/감사/자기낮춤/보고/채근) 정형 반응 패턴',
  'register:kakao:상사(대표님)': '카톡 - 직장 상사(이재훈 대표) 상대 톤',
  'register:kakao:외부협력자(선생님)': '카톡 - 외부 협력자(히엔 선생님) 상대 톤',
  'register:kakao:단톡방(업무보고)': '카톡 - 단톡방 업무보고 톤',
  'register:kakao:친구': '카톡 - 친구(BBC) 상대 톤, 완전 반말',
};

function main() {
  const id = makeId(OWNER, 'profile');
  const existing = djinn.get(COLLECTION, id);
  if (!existing || !existing.profile || existing.profile.blocks) {
    console.log(`[skip] ${id}: no legacy blob profile to migrate (already migrated or empty).`);
    return;
  }

  const legacy = existing.profile;
  const now = new Date().toISOString();
  const blocks = {};

  djinn.transaction(() => {
    for (const [field, value] of Object.entries(legacy)) {
      if (field === 'register' && value && typeof value === 'object') {
        for (const [subKey, subValue] of Object.entries(value)) {
          const key = `register:${subKey}`;
          blocks[key] = DESCRIPTIONS[key] ?? key;
          djinn.put(COLLECTION, makeId(OWNER, 'profile_sect', key), {
            owner: OWNER,
            type: 'profile_sect',
            key,
            value: subValue,
            created_at: existing.created_at ?? now,
            modified_at: existing.modified_at ?? now,
          });
        }
        continue;
      }
      blocks[field] = DESCRIPTIONS[field] ?? field;
      djinn.put(COLLECTION, makeId(OWNER, 'profile_sect', field), {
        owner: OWNER,
        type: 'profile_sect',
        key: field,
        value,
        created_at: existing.created_at ?? now,
        modified_at: existing.modified_at ?? now,
      });
    }

    djinn.put(COLLECTION, id, {
      owner: OWNER,
      type: 'profile',
      key: null,
      profile: { blocks },
      created_at: existing.created_at ?? now,
      modified_at: now,
    });
  });

  console.log(`[ok] migrated ${Object.keys(blocks).length} blocks for owner=${OWNER}:`);
  for (const k of Object.keys(blocks)) console.log(`  - ${k}`);
}

main();
