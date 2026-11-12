# Existing owner signer setup

The existing owner signer is now verified. The user privately added the exact login Keychain item, and a fresh NEP-413 signature verified under the required public key with no transaction or nonce change during verification. The public proof is in owner-signer-status.json. The following format and private setup instructions are retained as a runbook. Original metadata-only inspection confirmed the case signer existed while the owner entry was absent. Finalized Testnet block 277371336 lists one owner FullAccess key:

`ed25519:BntboZwnJtLVnBBh4XffXUDwbaygCsQiMmhWXD3xCi6`

The account is `needmore_1_near.testnet`. Its nonce is 276359394000016. No transaction or on-chain key change was performed during this inspection.

## Lookup and storage format

The project executor invokes installed `near-cli-rs 0.31.1` at `/opt/homebrew/bin/near` with `sign-with-keychain`. Its initial availability check requests only generic-password attributes. The CLI itself obtains the credential inside its signing implementation. The assistant must not request or display the Keychain password value.

Expected generic-password attributes in the local login keychain:

- Service / Keychain Item Name: `near-testnet-needmore_1_near.testnet`
- Account: `needmore_1_near.testnet:ed25519:BntboZwnJtLVnBBh4XffXUDwbaygCsQiMmhWXD3xCi6`
- Password value: a JSON object containing the strings `public_key` and `private_key`. The latter is the existing NEAR raw private-key string, not a seed phrase or the macOS password.

This is a software credential store. A public-key label or a reference to Meteor does not supply signing capability. The existing case entry confirms the same naming convention without inspecting its secret.

## Choose the least-exposing route

If this exact key already belongs to a supported hardware signer, retain it on that signer. The installed CLI has a Ledger signing backend; its derived public key and account permissions must be verified before adapting the deployment transport. Do not generate a new device key or import another owner's key as a substitute.

If an existing raw private-key backup is already under your control, a local Keychain Access import avoids retrieving anything from Meteor. If Meteor holds the only copy, there is no reviewed public-key-only link to this project's Keychain signer. A software import requires you to make an additional copy privately. The assistant will not open Meteor's recovery/private-key screens, obtain the key, or perform that transfer.

Creating another software copy increases exposure. Keychain encrypts the stored credential and controls application access, but an authorized signing application can use the FullAccess key. It is not a nonextractable hardware credential. If you do not accept that trade-off, leave deployment blocked and keep the existing wallet unchanged.

## Private local import, only if you choose that route

Perform all sensitive steps yourself, outside screen sharing or assistant computer use. Keep the existing wallet and backup intact.

1. Open Apple's **Keychain Access** through Spotlight. Select the local **login** keychain and unlock it yourself if needed.
2. Choose **File > New Password Item**, or press **Command-N**. Create a password item, not a certificate/key-file import or a website password in the Passwords app.
3. Set the Keychain Item Name and Account to the exact public values above.
4. In that item's Password field only, privately construct the credential JSON with the fixed public key and your existing raw private key. The following is a data-format template containing no secret, not a terminal command:

   ```json
   {"public_key":"ed25519:BntboZwnJtLVnBBh4XffXUDwbaygCsQiMmhWXD3xCi6","private_key":"REPLACE_PRIVATELY_INSIDE_KEYCHAIN_ACCESS"}
   ```

   Replace the placeholder only inside Keychain Access. Do not put the completed object in chat, a terminal command, Notes, a script, a plaintext credential file or a screenshot. Do not enter a seed phrase into `private_key`.
5. Save the item in **login**. For application access, retain confirmation prompts. Do not enable access for all applications. During the later verification, approve the installed `near` executable for that access only if you recognize it; Allow Once preserves a prompt for later use.
6. Close the item's detail window without exposing its password, then report **Ready**. Do not send the completed JSON or any screenshot of sensitive entry.

If the key is available only in Meteor or its origin is uncertain, answer the key-location question before handling a secret. These instructions do not authorize the assistant to export it.

## Import paths deliberately excluded

The audited CLI web-wallet import generates a fresh keypair and opens wallet authorization for it. It cannot preserve the required existing key under a no-new-on-chain-keys rule.

The CLI private-key argument is represented by its secret-bearing Display implementation. The main command path constructs and prints a rerun command and saves that command to a temporary log; quiet mode does not disable the save call. The Keychain save action can also fall back to legacy credential files if Keychain storage fails. Consequently, neither the CLI private-key/seed import nor a secret-bearing shell command is recommended for this setup. No actual credential log was opened during this audit.

## Required verification after private setup

The assistant must first inspect only the exact item's service/account attributes, then confirm the required full public key and FullAccess permission through finalized Testnet RPC. A matching label alone is insufficient.

Proof of the configured signer should use the installed CLI's **NEP-413 message signer**, with a fresh random nonce, a fixed local-verification message, recipient `iroh-keychain-verification.invalid`, and no callback URL. The CLI uses Keychain internally and returns only public signing output. The assistant must independently verify the signature against the required public key and exact payload. No credential is returned to the assistant. This message is not a transaction and is not sent to an authentication service.

Confirm the returned account/public key match exactly, the signature verifies, and the owner transaction nonce remains unchanged. Mark setup verified only after that succeeds. Do not submit deployment transactions during setup verification. Deployment continuation also requires fresh manifest, code, budget, key and state checks.

The executor now uses checked offline signing, exact signed-wire validation, independent public-signature verification and one fixed Testnet RPC submission. See offline-signing-review.md. The completed first approved creation supplied a real finalized wire fixture for the guard tests; no extra test transaction was introduced.

## Primary references inspected

- [NEAR CLI v0.31.1 Keychain service/account construction and fallback](https://github.com/near/near-cli-rs/blob/v0.31.1/src/common.rs)
- [Credential JSON fields](https://github.com/near/near-cli-rs/blob/v0.31.1/src/commands/account/import_account/key_store_prop.rs)
- [Web-wallet import generates a new keypair](https://github.com/near/near-cli-rs/blob/v0.31.1/src/commands/account/import_account/using_web_wallet/mod.rs)
- [CLI rerun-command handling](https://github.com/near/near-cli-rs/blob/v0.31.1/src/main.rs) and [secret-key Display](https://github.com/near/near-cli-rs/blob/v0.31.1/src/types/secret_key.rs)
- [NEP-413 Keychain signer](https://github.com/near/near-cli-rs/blob/v0.31.1/src/commands/message/sign_nep413/signature_options/sign_with_keychain.rs) and [payload/signing format](https://github.com/near/near-cli-rs/blob/v0.31.1/src/commands/message/sign_nep413/mod.rs)
- [Apple's Keychain Access shortcuts](https://support.apple.com/en-ca/guide/keychain-access/kyca699a9058/mac) and [application access controls](https://support.apple.com/en-gb/guide/mac-help/kychn002/26/mac/26)
