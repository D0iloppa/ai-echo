#!/usr/bin/env node
'use strict';

// data/echo.db를 init/init.sql로 초기화한다. 테이블/인덱스는 CREATE ... IF NOT EXISTS,
// 시드 row(root profile, dimension 골격)는 INSERT OR IGNORE라 이미 데이터가 있는 DB에
// 다시 실행해도 안전하다(멱등) — 기존 개인 데이터를 덮어쓰지 않는다.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'echo.db');
const SQL_PATH = path.join(__dirname, '..', 'init', 'init.sql');

function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(SQL_PATH, 'utf8'));
  db.close();
  console.log(`[ok] initialized ${DB_PATH} from ${SQL_PATH}`);
}

main();
