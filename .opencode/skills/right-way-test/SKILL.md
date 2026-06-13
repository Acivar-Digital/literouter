---
name: right-way-test
description: The mandatory testing protocol for validating code changes by rotating API keys, verifying logs, and checking integration with OpenCode.
---

# Right-Way Test Skill

This skill documents the mandatory verification protocol for code changes made to LiteRouter.

## Test Protocol

1. **API Key Health Check**: Check all the API keys are healthy for rotation.
2. **Curl Rotation Test**: Run a python script to do a curl test. 
   - If there are $N$ keys configured, you must send "hi" to the model $N + 1$ times.
   - For example, if there are 5 keys, you must say "hi" to the model 6 times, and log down if the rotation happened.
3. **Verify Rotation Logs**: Check the LiteRouter logs to confirm that rotation actually took place among the keys.
4. **Configuration Check**: Insert the configuration into OpenCode if necessary.
5. **OpenCode CLI Verification**: Test the OpenCode CLI model using the same setup in Step 2, but this time run the requests via OpenCode.
6. **Double Check Logs**: Repeat Step 3 (verify rotation logs) for the OpenCode CLI run.

Consider the test passed only if all of the above steps pass successfully.
