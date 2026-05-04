#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'apps/frontend-app/src');

function walkDir(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !item.startsWith('.')) {
      files.push(...walkDir(fullPath));
    } else if (item.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;
  
  // Check if file uses fetch
  if (!content.includes('fetch(')) {
    return false;
  }
  
  // Check if file already imports fetchWithAuth
  if (!content.includes('fetchWithAuth')) {
    // Find if it imports authHeaders
    const authHeadersMatch = content.match(/from ["'].*?authHeaders["']/);
    if (authHeadersMatch) {
      // Update the import
      content = content.replace(
        /import\s*{\s*authHeaders\s*}\s*from\s*["']([^"']*authHeaders["'])/,
        'import { authHeaders, fetchWithAuth } from "$1'
      );
    } else {
      // Check for other imports from shared/api
      const sharedApiMatch = content.match(/from ["'].*?\/shared\/api\/[^"']*["']/);
      if (sharedApiMatch) {
        // Add fetchWithAuth import
        const firstImport = content.match(/^import\s+{[^}]+}\s+from/m);
        if (firstImport) {
          content = content.replace(
            firstImport[0],
            firstImport[0] + '\nimport { fetchWithAuth } from "../../shared/api/authHeaders";'
          );
        }
      }
    }
  }
  
  // Replace fetch( with fetchWithAuth(
  content = content.replace(/\bfetch\(/g, 'fetchWithAuth(');
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }
  
  return false;
}

const files = walkDir(srcDir);
let updated = 0;

for (const file of files) {
  if (updateFile(file)) {
    console.log(`Updated: ${path.relative(process.cwd(), file)}`);
    updated++;
  }
}

console.log(`\nTotal files updated: ${updated}`);
