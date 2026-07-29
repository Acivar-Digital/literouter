const fs = require('fs');
let code = fs.readFileSync('src/index.ts', 'utf8');

function fixFunction(funcName, code) {
    // 1. Add `let allKeysExhausted = false;` right after `for (let round...`
    let regex = new RegExp(\`(for \\(let round = 0; round <= backoffLadder.length; round\\+\\+\\) \\{\\n)(\\s*)(for \\(let attempt = 0; attempt < maxAttempts; attempt\\+\\+\\) \\{)\`);
    code = code.replace(regex, \`$1$2let allKeysExhausted = false;\\n$2$3\`);
    
    // 2. Add `allKeysExhausted = true;` inside `if (e.message.includes("All keys")) {`
    // We already removed `if (attempt < maxAttempts) { continue; }` so it looks like:
    // if (e.message.includes("All keys")) {
    //   if (fromFusion) {
    code = code.replace(
        /if \(e\.message\.includes\("All keys"\)\) \{\n\s*if \(fromFusion\) \{/g,
        \`if (e.message.includes("All keys")) {
          allKeysExhausted = true;
          if (fromFusion) {\`
    );
    
    // 3. Add `if (!allKeysExhausted) break;` after `if (fromFusion) { ... }`
    //    if (fromFusion) {
    //      return new Response(JSON.stringify({ error: "Max attempts exhausted" }), { status: 429 });
    //    }
    //  } // end of round loop
    code = code.replace(
        /if \(fromFusion\) \{\n\s*return new Response\(JSON\.stringify\(\{ error: "Max attempts exhausted" \}\), \{ status: 429 \}\);\n\s*\}\n\s*\}/g,
        \`if (fromFusion) {
      return new Response(JSON.stringify({ error: "Max attempts exhausted" }), { status: 429 });
    }
    if (!allKeysExhausted) {
      break;
    }
  }\`
    );
    return code;
}

code = fixFunction('executeOpenAICompat', code);
fs.writeFileSync('src/index.ts', code);
