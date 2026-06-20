---
name: right-way-test
description: The mandatory testing protocol for validating code changes by rotating API keys, verifying logs, and checking integration with OpenCode.
---

# Right-Way Test Skill

This skill documents the mandatory verification protocol for code changes made to LiteRouter.

## 🚨 CRITICAL DEPLOYMENT WARNING 🚨
**Always verify WHICH LiteRouter instance OpenCode is actually talking to.** Do not assume OpenCode is hitting `localhost:7766`. Check `~/.config/opencode/opencode.json` (specifically the `baseURL` under `provider.literouter.options`) to see if it is routing to a VPS (e.g., `10.32.34.243:7766`). If it is, ask the user if they intended to use the remote VPS or their local service before making changes, and check the VPS logs, not just your local machine.

## Test Protocol

1. **Verify Target Environment**: Check `~/.config/opencode/opencode.json` to confirm if OpenCode is hitting the local daemon or a remote VPS. Apply all `.env` changes to the active target.
2. **API Key Health Check**: Check all the API keys are healthy for rotation on the active target using `doctor.py`.
3. **Curl Rotation Test**: Run a python script to do a curl test against the active target's IP. 
   - If there are $N$ keys configured, you must send "hi" to the model $N + 1$ times.
   - For example, if there are 5 keys, you must say "hi" to the model 6 times, and log down if the rotation happened.
4. **Verify Rotation Logs**: Check the LiteRouter logs on the active target to confirm that rotation actually took place among the keys.
5. **Configuration Check**: Insert the configuration into OpenCode if necessary.
6. **OpenCode CLI Verification**: Test the OpenCode CLI model using the same setup in Step 3, but this time run the requests via OpenCode CLI.
7. **Double Check Logs**: Repeat Step 4 (verify rotation logs) for the OpenCode CLI run.

Consider the test passed only if all of the above steps pass successfully.
