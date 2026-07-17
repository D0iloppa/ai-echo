'use strict';

const path = require('path');
const { DJinn } = require('@d0iloppa/djinn');

const DB_PATH = path.join(__dirname, '..', 'data', 'echo.db');

const djinn = new DJinn(DB_PATH);

djinn.define('echo', {
  indexes: ['owner', 'type', 'key', 'modified_at'],
});

// profile: 소유자당 1건, key 없이 owner만으로 식별.
// addressing/sample: 같은 owner 안에서 type + key로 구분.
function makeId(owner, type, key) {
  return type === 'profile' ? `${owner}|profile` : `${owner}|${type}|${key}`;
}

module.exports = { djinn, makeId, DB_PATH };
