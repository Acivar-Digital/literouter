const fs = require('fs');
let code = fs.readFileSync('src/index.ts', 'utf8');

// Fix in executeOpenAICompat
code = code.replace(
`        if (e.message.includes("All keys")) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, getProviderDelayMs(provider)));
            continue;
          }
          if (fromFusion) {`,
`        if (e.message.includes("All keys")) {
          if (fromFusion) {`
);

// Fix in executeGoogleNative
code = code.replace(
`        if (e.message.includes("All keys")) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
            continue;
          }
          if (fromFusion) {`,
`        if (e.message.includes("All keys")) {
          if (fromFusion) {`
);

fs.writeFileSync('src/index.ts', code);
