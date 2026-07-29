const fs = require('fs');
let code = fs.readFileSync('.opencode/skills/literouter-playbook/SKILL.md', 'utf8');

// Update Rotate Floor
code = code.replace(
    /\| \*\*Rotate Floor\*\* \| Hard minimum gap between key attempts\. \| \*\*2s\*\* \(\`MIN_ROTATE_DELAY_MS=2000\`\); longer if upstream \`Retry-After\`\/\`quotaResetDelay\` exceeds it \|/g,
    '| **Rotate Floor** | Gap between key attempts on sequential errors (e.g., 429/500). | Controlled by `LITEROUTER_ROTATE_DELAY_MS` (def 10s) or `{PROV}_MIN_DELAY_MS`. Hard minimum floor of **2s** (`MIN_ROTATE_DELAY_MS=2000`); longer if upstream `Retry-After`/`quotaResetDelay` exceeds it |\\n| **Max Attempts Reached** | When a request fails `LITEROUTER_MAX_ATTEMPTS` times without exhausting all available keys. | Request fails instantly with HTTP 429 ("Max attempts exhausted"), aborting the outer round backoff to prevent infinite downstream spam. |'
);

fs.writeFileSync('.opencode/skills/literouter-playbook/SKILL.md', code);
