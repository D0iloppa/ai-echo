#!/usr/bin/env node
'use strict';

const { serve } = require('./server');

serve().catch((err) => {
  console.error('ai-echo-mcp failed to start:', err);
  process.exit(1);
});
