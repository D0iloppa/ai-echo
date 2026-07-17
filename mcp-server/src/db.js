'use strict';

const path = require('path');
const { DJinn } = require('@d0iloppa/djinn');

const DB_PATH = path.join(__dirname, '..', 'data', 'echo.db');

const djinn = new DJinn(DB_PATH);

// echo: addressing/sample/guardrail/template/dimension 변경이력 등 자유형식 컬렉션.
// 이 타입들은 owner 스코프(persona)를 유지한다 — 프로파일과 달리 여러 owner를 둘 이유가 있다.
djinn.define('echo', {
  indexes: ['owner', 'type', 'key', 'modified_at'],
});

// echo_profile: root, 진짜 1-row(id 고정). 스킬은 단일 owner(로컬 사용자)를 전제하므로 owner 없음.
djinn.define('echo_profile', { indexes: ['modified_at'] });
const PROFILE_ID = 'root';

// echo_dimension: 1차 노드(register/tone/situational 등). echo_key가 사실상 PK.
djinn.define('echo_dimension', { indexes: ['echo_key', 'modified_at'] });

// echo_dimension_childs: 서브그래프(실데이터). (parent_key, child_key) 복합 PK를 id로 인코딩.
djinn.define('echo_dimension_childs', { indexes: ['parent_key', 'child_key', 'modified_at'] });

function makeChildId(parentKey, childKey) {
  return `${parentKey}::${childKey}`;
}

// addressing/sample/guardrail/template 전용 id 빌더 (owner 스코프 유지)
function makeId(owner, type, key) {
  return `${owner}|${type}|${key}`;
}

module.exports = { djinn, makeId, DB_PATH, PROFILE_ID, makeChildId };
