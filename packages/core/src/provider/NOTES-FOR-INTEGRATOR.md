# Notes for the integrator (providers-core)

* Remove "[login]" from PENDING_TAGS in packages/core/src/contract.test.ts. The [login] contract cases pass against the real core (checked locally with it removed).
* Pasted ChatGPT URLs are checked against http://127.0.0.1:1455/auth/callback only. pi builds its redirect URI from 127.0.0.1 always (PI_OAUTH_CALLBACK_HOST only changes the bind address), so no env host is needed.
* The device id lives in <dirname(credentialsFile)>/device-id (the data home root); no change in create-core.ts is needed.
