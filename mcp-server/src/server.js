'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { djinn, makeId } = require('./db');

const COLLECTION = 'echo';

function json(text) {
  return { content: [{ type: 'text', text: JSON.stringify(text, null, 2) }] };
}

function makeSampleKey(suffix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return suffix != null ? `${Date.now()}-${suffix}-${rand}` : `${Date.now()}-${rand}`;
}

function profileCompleteness(profile) {
  const fields = ['tone', 'register', 'situational', 'emoji', 'signoffs', 'notes'];
  const present = fields.filter((f) => profile && profile[f] != null);
  return { present, missing: fields.filter((f) => !present.includes(f)) };
}

function topEmojis(profile, limit) {
  const emoji = profile && profile.emoji;
  if (!emoji) return [];
  // emoji는 배열([{char, count}]) 또는 {char: count} 맵 두 형태를 모두 허용한다.
  let entries;
  if (Array.isArray(emoji)) {
    entries = emoji.map((e) => (typeof e === 'string' ? [e, 0] : [e.char ?? e.emoji, e.count ?? 0]));
  } else if (typeof emoji === 'object') {
    entries = Object.entries(emoji);
  } else {
    return [];
  }
  return entries
    .filter(([char]) => char != null)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, limit)
    .map(([char, count]) => ({ char, count }));
}

function exportMarkdown(owner, profileDoc, addressingRows, sampleRows, guardrailRows, templateRows) {
  const lines = [];
  lines.push(`# PROFILE (${owner})`);
  lines.push('');
  if (profileDoc) {
    lines.push(`- created_at: ${profileDoc.created_at}`);
    lines.push(`- modified_at: ${profileDoc.modified_at}`);
  } else {
    lines.push('(아직 프로파일이 없습니다.)');
  }
  lines.push('');
  lines.push('## 말투 프로파일');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(profileDoc?.profile ?? {}, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## 전역 호칭');
  lines.push('');
  if (!addressingRows.length) {
    lines.push('(등록된 호칭 없음)');
  } else {
    lines.push('| key | name | honorific | relationship | notes |');
    lines.push('|---|---|---|---|---|');
    for (const a of addressingRows) {
      lines.push(
        `| ${a.key} | ${a.name ?? ''} | ${a.honorific ?? ''} | ${a.relationship ?? ''} | ${a.notes ?? ''} |`
      );
    }
  }
  lines.push('');
  lines.push('## 샘플 요약');
  lines.push('');
  if (!sampleRows.length) {
    lines.push('(수집된 샘플 없음)');
  } else {
    const byChannel = {};
    for (const s of sampleRows) byChannel[s.channel] = (byChannel[s.channel] ?? 0) + 1;
    for (const [channel, count] of Object.entries(byChannel)) {
      lines.push(`- ${channel}: ${count}건`);
    }
    lines.push('');
    lines.push(`총 ${sampleRows.length}건 (최신순 상위 5개 미리보기)`);
    lines.push('');
    const preview = [...sampleRows]
      .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
      .slice(0, 5);
    for (const s of preview) {
      lines.push(`### [${s.channel}] ${s.situation ?? ''} (${s.created_at})`);
      lines.push('');
      lines.push('```');
      lines.push(s.text ?? '');
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('## 가드레일');
  lines.push('');
  if (!guardrailRows || !guardrailRows.length) {
    lines.push('(등록된 가드레일 없음)');
  } else {
    const byScope = {};
    for (const g of guardrailRows) {
      (byScope[g.scope] ??= []).push(g);
    }
    for (const [scope, rows] of Object.entries(byScope)) {
      lines.push(`### ${scope}`);
      lines.push('');
      for (const g of rows) {
        lines.push(`- [${g.kind}] ${g.rule}${g.target ? ` (대상: ${g.target})` : ''}`);
      }
      lines.push('');
    }
  }
  lines.push('## 상황 템플릿');
  lines.push('');
  if (!templateRows || !templateRows.length) {
    lines.push('(등록된 템플릿 없음)');
  } else {
    for (const t of templateRows) {
      lines.push(`### ${t.situation}${t.channel ? ` (${t.channel})` : ''}`);
      lines.push('');
      lines.push('```');
      lines.push(t.body ?? '');
      lines.push('```');
      lines.push('');
    }
  }
  return lines.join('\n');
}

function createServer() {
  const server = new McpServer({ name: 'ai-echo', version: '0.1.0' });

  server.tool(
    'echo_profile_get',
    '소유자(owner)의 말투 프로파일 싱글턴을 조회한다. 없으면 null.',
    {
      owner: z.string().optional().default('default'),
    },
    async ({ owner }) => {
      const doc = djinn.get(COLLECTION, makeId(owner, 'profile'));
      return json(doc ?? null);
    }
  );

  server.tool(
    'echo_profile_put',
    '소유자의 말투 프로파일을 upsert 한다(merge-friendly). profile은 tone/register/situational/emoji/signoffs/notes 등 자유 형식 JSON.',
    {
      owner: z.string().optional().default('default'),
      profile: z.record(z.any()).describe('말투/상황별 반응/이모지 등 자유 형식 프로파일 JSON'),
    },
    async ({ owner, profile }) => {
      const id = makeId(owner, 'profile');
      const existing = djinn.get(COLLECTION, id);
      const now = new Date().toISOString();
      const doc = {
        owner,
        type: 'profile',
        key: null,
        profile,
        created_at: existing?.created_at ?? now,
        modified_at: now,
      };
      if (existing) {
        const snapshotKey = existing.modified_at ?? now;
        const snapshotId = makeId(owner, 'snapshot', snapshotKey);
        djinn.put(COLLECTION, snapshotId, {
          owner,
          type: 'snapshot',
          key: snapshotKey,
          profile: existing.profile,
          note: 'auto-snapshot on profile_put',
          created_at: now,
        });
      }
      djinn.put(COLLECTION, id, doc);
      return json({ ok: true, id });
    }
  );

  server.tool(
    'echo_profile_history',
    '소유자의 프로파일 변경 이력(auto-snapshot) 목록을 최신순으로 조회한다. 드리프트 서사는 호출자(LLM)가 구성한다.',
    {
      owner: z.string().optional().default('default'),
      limit: z.number().int().positive().optional().default(20),
    },
    async ({ owner, limit }) => {
      const rows = djinn.find(
        COLLECTION,
        { owner, type: 'snapshot' },
        { orderBy: 'created_at', orderDir: 'desc', limit }
      );
      return json(rows);
    }
  );

  server.tool(
    'echo_addressing_put',
    '특정 인물에 대한 전역(항상 그렇게 부르는) 호칭을 upsert 한다. 대화 맥락에서만 쓰는 휘발성 호칭은 여기 저장하지 않는다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string().describe('인물을 가리키는 slug'),
      name: z.string().optional().describe('실제 이름'),
      honorific: z.string().optional().describe('호칭(예: 형, 팀장님, OO씨)'),
      relationship: z.string().optional().describe('관계(예: 직장 상사, 친구)'),
      notes: z.string().optional(),
    },
    async ({ owner, key, name, honorific, relationship, notes }) => {
      const id = makeId(owner, 'addressing', key);
      const existing = djinn.get(COLLECTION, id);
      const now = new Date().toISOString();
      const doc = {
        owner,
        type: 'addressing',
        key,
        name: name ?? existing?.name ?? '',
        honorific: honorific ?? existing?.honorific ?? '',
        relationship: relationship ?? existing?.relationship ?? '',
        notes: notes ?? existing?.notes ?? '',
        created_at: existing?.created_at ?? now,
        modified_at: now,
      };
      djinn.put(COLLECTION, id, doc);
      return json({ ok: true, id });
    }
  );

  server.tool(
    'echo_addressing_get',
    '특정 인물의 전역 호칭 정보를 조회한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string(),
    },
    async ({ owner, key }) => {
      const doc = djinn.get(COLLECTION, makeId(owner, 'addressing', key));
      return json(doc ?? null);
    }
  );

  server.tool(
    'echo_addressing_list',
    '소유자의 전역 호칭 전체 목록을 조회한다.',
    {
      owner: z.string().optional().default('default'),
    },
    async ({ owner }) => {
      const rows = djinn.find(
        COLLECTION,
        { owner, type: 'addressing' },
        { orderBy: 'created_at', orderDir: 'asc' }
      );
      return json(rows);
    }
  );

  server.tool(
    'echo_addressing_del',
    '특정 인물의 전역 호칭을 삭제한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string(),
    },
    async ({ owner, key }) => {
      djinn.del(COLLECTION, makeId(owner, 'addressing', key));
      return json({ ok: true });
    }
  );

  server.tool(
    'echo_sample_add',
    '이메일/카톡 등 과거 메시지 원문을 이디올렉트 학습용 샘플로 추가한다. key는 서버에서 자동 생성한다.',
    {
      owner: z.string().optional().default('default'),
      channel: z.enum(['email', 'kakao', 'sns', 'etc']),
      text: z.string().describe('원문 텍스트'),
      situation: z.string().optional().describe('상황 설명(예: 상사에게 지각 보고)'),
      origin: z
        .enum(['onboarding', 'accepted-draft', 'imported', 'manual'])
        .optional()
        .default('manual')
        .describe('샘플 출처'),
    },
    async ({ owner, channel, text, situation, origin }) => {
      const key = makeSampleKey();
      const id = makeId(owner, 'sample', key);
      const now = new Date().toISOString();
      const doc = {
        owner,
        type: 'sample',
        key,
        channel,
        text,
        situation: situation ?? '',
        origin: origin ?? 'manual',
        created_at: now,
      };
      djinn.put(COLLECTION, id, doc);
      return json({ ok: true, id, key });
    }
  );

  server.tool(
    'echo_sample_add_bulk',
    'KakaoTalk .txt / email .mbox 등에서 호출자가 미리 파싱한 items 배열을 한 번에 트랜잭션으로 추가한다.',
    {
      owner: z.string().optional().default('default'),
      channel: z.enum(['email', 'kakao', 'sns', 'etc']),
      origin: z
        .enum(['onboarding', 'accepted-draft', 'imported', 'manual'])
        .optional()
        .default('manual')
        .describe('샘플 출처'),
      items: z
        .array(
          z.object({
            text: z.string(),
            situation: z.string().optional(),
          })
        )
        .describe('파싱된 원문 항목 배열'),
    },
    async ({ owner, channel, origin, items }) => {
      const now = new Date().toISOString();
      const result = djinn.transaction(() => {
        const ids = [];
        items.forEach((item, i) => {
          const key = makeSampleKey(i);
          const id = makeId(owner, 'sample', key);
          const doc = {
            owner,
            type: 'sample',
            key,
            channel,
            text: item.text,
            situation: item.situation ?? '',
            origin: origin ?? 'manual',
            created_at: now,
          };
          djinn.put(COLLECTION, id, doc);
          ids.push(id);
        });
        return ids;
      });
      return json({ ok: true, added: result.length, ids: result });
    }
  );

  server.tool(
    'echo_sample_list',
    '소유자의 샘플 목록을 조회한다. channel을 지정하면 해당 채널만 필터링.',
    {
      owner: z.string().optional().default('default'),
      channel: z.enum(['email', 'kakao', 'sns', 'etc']).optional(),
    },
    async ({ owner, channel }) => {
      const filter = channel ? { owner, type: 'sample', channel } : { owner, type: 'sample' };
      const rows = djinn.find(COLLECTION, filter, { orderBy: 'created_at', orderDir: 'desc' });
      return json(rows);
    }
  );

  server.tool(
    'echo_sample_del',
    '샘플 하나를 삭제한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string(),
    },
    async ({ owner, key }) => {
      djinn.del(COLLECTION, makeId(owner, 'sample', key));
      return json({ ok: true });
    }
  );

  server.tool(
    'echo_guardrail_put',
    '스타일 가드레일(금지/선호 규칙)을 upsert 한다. scope는 global/channel/person, kind는 avoid/prefer.',
    {
      owner: z.string().optional().default('default'),
      key: z.string().describe('가드레일을 가리키는 slug'),
      scope: z.enum(['global', 'channel', 'person']),
      target: z.string().optional().describe('scope가 channel/person일 때의 대상(채널명 또는 인물 key)'),
      kind: z.enum(['avoid', 'prefer']),
      rule: z.string().describe('규칙 텍스트(예: 상사에게 ㅋㅋ 금지)'),
      note: z.string().optional(),
    },
    async ({ owner, key, scope, target, kind, rule, note }) => {
      const id = makeId(owner, 'guardrail', key);
      const existing = djinn.get(COLLECTION, id);
      const now = new Date().toISOString();
      const doc = {
        owner,
        type: 'guardrail',
        key,
        scope,
        target: target ?? null,
        kind,
        rule,
        note: note ?? existing?.note ?? '',
        created_at: existing?.created_at ?? now,
        modified_at: now,
      };
      djinn.put(COLLECTION, id, doc);
      return json({ ok: true, id });
    }
  );

  server.tool(
    'echo_guardrail_get',
    '가드레일 하나를 조회한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string(),
    },
    async ({ owner, key }) => {
      const doc = djinn.get(COLLECTION, makeId(owner, 'guardrail', key));
      return json(doc ?? null);
    }
  );

  server.tool(
    'echo_guardrail_list',
    '가드레일 목록을 조회한다. scope/target으로 선택 필터링 가능.',
    {
      owner: z.string().optional().default('default'),
      scope: z.enum(['global', 'channel', 'person']).optional(),
      target: z.string().optional(),
    },
    async ({ owner, scope, target }) => {
      const filter = { owner, type: 'guardrail' };
      if (scope) filter.scope = scope;
      if (target) filter.target = target;
      const rows = djinn.find(COLLECTION, filter, { orderBy: 'created_at', orderDir: 'asc' });
      return json(rows);
    }
  );

  server.tool(
    'echo_guardrail_del',
    '가드레일 하나를 삭제한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string(),
    },
    async ({ owner, key }) => {
      djinn.del(COLLECTION, makeId(owner, 'guardrail', key));
      return json({ ok: true });
    }
  );

  server.tool(
    'echo_template_put',
    '상황별 톤 템플릿(거절/사과/독촉/축하/일정조율 등)을 upsert 한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string().describe('템플릿을 가리키는 slug(상황)'),
      situation: z.string().describe('상황명(예: 거절, 사과, 독촉, 축하, 일정조율)'),
      channel: z.string().optional().describe('특정 채널 전용이면 채널명'),
      body: z.string().describe('템플릿 본문'),
      note: z.string().optional(),
    },
    async ({ owner, key, situation, channel, body, note }) => {
      const id = makeId(owner, 'template', key);
      const existing = djinn.get(COLLECTION, id);
      const now = new Date().toISOString();
      const doc = {
        owner,
        type: 'template',
        key,
        situation,
        channel: channel ?? existing?.channel ?? null,
        body,
        note: note ?? existing?.note ?? '',
        created_at: existing?.created_at ?? now,
        modified_at: now,
      };
      djinn.put(COLLECTION, id, doc);
      return json({ ok: true, id });
    }
  );

  server.tool(
    'echo_template_get',
    '상황별 템플릿 하나를 조회한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string(),
    },
    async ({ owner, key }) => {
      const doc = djinn.get(COLLECTION, makeId(owner, 'template', key));
      return json(doc ?? null);
    }
  );

  server.tool(
    'echo_template_list',
    '상황별 템플릿 목록을 조회한다. channel로 선택 필터링 가능.',
    {
      owner: z.string().optional().default('default'),
      channel: z.string().optional(),
    },
    async ({ owner, channel }) => {
      const filter = channel ? { owner, type: 'template', channel } : { owner, type: 'template' };
      const rows = djinn.find(COLLECTION, filter, { orderBy: 'situation', orderDir: 'asc' });
      return json(rows);
    }
  );

  server.tool(
    'echo_template_del',
    '상황별 템플릿 하나를 삭제한다.',
    {
      owner: z.string().optional().default('default'),
      key: z.string(),
    },
    async ({ owner, key }) => {
      djinn.del(COLLECTION, makeId(owner, 'template', key));
      return json({ ok: true });
    }
  );

  server.tool(
    'echo_owner_list',
    '컬렉션에 존재하는 모든 owner 값을 중복 제거해 조회한다(페르소나/프로필 전환용).',
    {},
    async () => {
      const rows = djinn.find(COLLECTION, {});
      const owners = [...new Set(rows.map((r) => r.owner))];
      return json({ owners });
    }
  );

  server.tool(
    'echo_export_md',
    '프로파일+전역호칭+샘플 요약을 PROFILE.md 형식 마크다운 문자열로 합성해 반환한다(파일 저장은 호출자가 Write 툴로 수행).',
    {
      owner: z.string().optional().default('default'),
    },
    async ({ owner }) => {
      const profileDoc = djinn.get(COLLECTION, makeId(owner, 'profile'));
      const addressingRows = djinn.find(
        COLLECTION,
        { owner, type: 'addressing' },
        { orderBy: 'created_at', orderDir: 'asc' }
      );
      const sampleRows = djinn.find(COLLECTION, { owner, type: 'sample' });
      const guardrailRows = djinn.find(
        COLLECTION,
        { owner, type: 'guardrail' },
        { orderBy: 'created_at', orderDir: 'asc' }
      );
      const templateRows = djinn.find(
        COLLECTION,
        { owner, type: 'template' },
        { orderBy: 'situation', orderDir: 'asc' }
      );
      const markdown = exportMarkdown(
        owner,
        profileDoc,
        addressingRows,
        sampleRows,
        guardrailRows,
        templateRows
      );
      return { content: [{ type: 'text', text: markdown }] };
    }
  );

  server.tool(
    'echo_report',
    '프로파일 완성도, 채널별 샘플 개수, 호칭 등록 수, 상위 이모지 등 현황 통계를 반환한다(변경 없음).',
    {
      owner: z.string().optional().default('default'),
    },
    async ({ owner }) => {
      const profileDoc = djinn.get(COLLECTION, makeId(owner, 'profile'));
      const addressingRows = djinn.find(COLLECTION, { owner, type: 'addressing' });
      const sampleRows = djinn.find(COLLECTION, { owner, type: 'sample' });
      const templateRows = djinn.find(COLLECTION, { owner, type: 'template' });
      const guardrailRows = djinn.find(COLLECTION, { owner, type: 'guardrail' });
      const snapshotRows = djinn.find(COLLECTION, { owner, type: 'snapshot' });
      const byChannel = {};
      for (const s of sampleRows) byChannel[s.channel] = (byChannel[s.channel] ?? 0) + 1;
      const completeness = profileCompleteness(profileDoc?.profile);
      return json({
        owner,
        has_profile: !!profileDoc,
        profile_fields_present: completeness.present,
        profile_fields_missing: completeness.missing,
        sample_count_total: sampleRows.length,
        sample_count_by_channel: byChannel,
        addressing_count: addressingRows.length,
        template_count: templateRows.length,
        guardrail_count: guardrailRows.length,
        profile_snapshot_count: snapshotRows.length,
        top_emojis: topEmojis(profileDoc?.profile, 10),
      });
    }
  );

  server.tool(
    'echo_migrate_export',
    '소유자의 전체 row(profile/addressing/sample/guardrail/template/snapshot 등 전 타입)를 다른 설치로 옮길 수 있는 이관용 JSON 번들로 덤프한다.',
    {
      owner: z.string().optional().default('default'),
    },
    async ({ owner }) => {
      // type을 나열하지 않고 owner 전체 row를 한 번에 조회한 뒤 타입별로 묶는다(신규 타입 추가 시 자동 포함).
      const rows = djinn.find(COLLECTION, { owner });
      const profileDoc = rows.find((r) => r.type === 'profile') ?? null;
      const byType = (type) => rows.filter((r) => r.type === type);
      return json({
        owner,
        exported_at: new Date().toISOString(),
        profile: profileDoc,
        addressing: byType('addressing'),
        samples: byType('sample'),
        guardrails: byType('guardrail'),
        templates: byType('template'),
        snapshots: byType('snapshot'),
      });
    }
  );

  server.tool(
    'echo_migrate_import',
    "echo_migrate_export가 만든 번들을 가져온다. mode='merge'(기본, upsert) 또는 'replace'(기존 owner 데이터를 트랜잭션으로 삭제 후 삽입).",
    {
      owner: z.string().optional().default('default'),
      bundle: z.record(z.any()).describe('echo_migrate_export의 반환 JSON'),
      mode: z.enum(['merge', 'replace']).optional().default('merge'),
    },
    async ({ owner, bundle, mode }) => {
      const doImport = () => {
        const counts = {
          profiles: 0,
          addressing: 0,
          samples: 0,
          guardrails: 0,
          templates: 0,
          snapshots: 0,
        };

        if (bundle.profile) {
          djinn.put(COLLECTION, makeId(owner, 'profile'), { ...bundle.profile, owner });
          counts.profiles = 1;
        }
        for (const row of bundle.addressing ?? []) {
          djinn.put(COLLECTION, makeId(owner, 'addressing', row.key), { ...row, owner });
          counts.addressing += 1;
        }
        for (const row of bundle.samples ?? []) {
          djinn.put(COLLECTION, makeId(owner, 'sample', row.key), { ...row, owner });
          counts.samples += 1;
        }
        for (const row of bundle.guardrails ?? []) {
          djinn.put(COLLECTION, makeId(owner, 'guardrail', row.key), { ...row, owner });
          counts.guardrails += 1;
        }
        for (const row of bundle.templates ?? []) {
          djinn.put(COLLECTION, makeId(owner, 'template', row.key), { ...row, owner });
          counts.templates += 1;
        }
        for (const row of bundle.snapshots ?? []) {
          djinn.put(COLLECTION, makeId(owner, 'snapshot', row.key), { ...row, owner });
          counts.snapshots += 1;
        }
        return counts;
      };

      if (mode === 'replace') {
        // 타입을 나열하지 않고 owner의 모든 row를 삭제한다(신규 타입도 자동 포함).
        const existingRows = djinn.find(COLLECTION, { owner });
        const result = djinn.transaction(() => {
          for (const row of existingRows) djinn.del(COLLECTION, row.id);
          return doImport();
        });
        return json({ ok: true, mode, deleted: existingRows.length, imported: result });
      }

      const result = doImport();
      return json({ ok: true, mode, imported: result });
    }
  );

  return server;
}

async function serve() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

module.exports = { createServer, serve };
