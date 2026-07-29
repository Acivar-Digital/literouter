const fs = require('fs');
let code = fs.readFileSync('src/index.ts', 'utf8');

function fixFunction(providerArg, code) {
    // 1. Add wait before `continue;` at the end of `resp.status >= 400`
    // Look for:
    // if (reqId) recordTrace(...);
    // continue;
    let traceRegex = new RegExp(\`(if \\(reqId\\) recordTrace\\(.*?"upstream".*?\\);\\n)(\\s*)(continue;)\`, 'g');
    code = code.replace(traceRegex, \`$1$2if (attempt < maxAttempts - 1) {\\n$2  await new Promise((r) => setTimeout(r, getProviderDelayMs(\${providerArg})));\\n$2}\\n$2$3\`);

    // 2. Add wait at the end of the catch block, before the `attempt` loop ends
    // Look for:
    //         if (round === backoffLadder.length)
    //           return new Response(
    //             JSON.stringify({ error: "Upstream failed", details: e.message }),
    //             { status: 502 },
    //           );
    //       }
    //     }
    let catchEndRegex = new RegExp(\`(if \\(round === backoffLadder\\.length\\)\\n\\s*return new Response\\(\\n\\s*JSON\\.stringify\\(\\{ error: "Upstream failed".*?\\n\\s*\\{ status: 502 \\},\\n\\s*\\);\\n)(\\s*)(\\})\`, 'g');
    
    code = code.replace(catchEndRegex, \`$1$2  if (attempt < maxAttempts - 1) {\\n$2    await new Promise((r) => setTimeout(r, getProviderDelayMs(\${providerArg})));\\n$2  }\\n$2$3\`);
    
    return code;
}

// We need to apply this carefully. Wait, the providerArg for executeOpenAICompat is `provider`.
// For executeGoogleNative, it is `"google"`.
// Actually, it's safer to just do string replacements.
