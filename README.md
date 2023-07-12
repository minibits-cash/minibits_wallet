<img src="https://minibits.cash/img/minibits_preview.png">

# Disclaimer

⚠️ If you are using this app, please take the following into consideration:
- This wallet should be used for research purposes only.
- The wallet is an alpha version with incomplete functionality and both known and unknown bugs.
- Do not use it with large amounts of coins.
- The e-cash stored in the wallet is issued by the mint. You trust the mint to back it with bitcoin until you transfer your holdings to another bitcoin Lightning wallet.
- The Cashu protocol that the wallet implements has not yet received extensive review or testing so far.


# Minibits Wallet

Minibits is an e-cash wallet with a focus on performance and usability. Cash is issued by mints and backed by Bitcoin via the [Cashu](https://cashu.space) protocol and Lightning Network.

## Roadmap

Platform support
- [x] Android app
- [ ] iOS app
- [x] Light and dark mode

Mints
- [x] Add multiple mints
- [x] Remove mint with zero balance
- [x] Block receiving from mint
- [x] Show mint balances grouped by hostname
- [x] Handle mint keys rotation (not tested)
- [ ] Mint status and information screen
- [ ] Change mint's short name and color

Receive coins
- [x] Scan QR code of a coin token
- [x] Paste coin token from clipboard
- [x] Receive tokens with coins from multiple mints (untested)
- [ ] Share payment request to receive

Send coins
- [x] Share coin token to send through another app
- [x] Show coin token as a QR code
- [x] Track receive of pending coins by the payee
- [ ] Send to contact

Top up wallet
- [x] Show QR code with bitcoin lightning invoice to pay
- [x] Share encoded bitcoin lightning invoice to pay
- [ ] Share invoice with contact

Transfer / Cash out from wallet
- [x] Paste and settle bitcoin lightning invoice with your coins
- [x] Scan and settle bitcoin lightning invoice with your coins
- [ ] Transfer (swap) coins to another mint

Transaction history
- [x] Unified transaction history for all kinds of transactions
- [x] Audit trail of transaction events
- [x] Filter pending transactions
- [ ] Revert pending transaction in 1 click (get back tokens not claimed by receiver)
- [ ] Tags and related filtering of transactions
- [ ] Delete incomplete and failed transactions from history

Contacts
- [ ] Contacts management

Backup and recovery
- [x] Local append-only backup of all coins in a database separate from wallet storage
- [ ] Recovery tool to recover coins from local backup
- [x] Recover wallet in case spent coins remain in the wallet due to an exception during a transaction
- [ ] Off-device backup
- [ ] Smooth migration to another device

Security
- [x] Optional AES encryption of wallet storage using a key stored in the device secure keychain
- [x] Device passcode or biometry to login (if storage encryption is on)

DevOps
- [ ] OTA updates
- [ ] Automated tests
- [ ] Release pipelines


## Architecture

The wallet's design has been crafted to prioritize the following primary quality properties:
- Support both Android and iOS mobile platforms
- Achieve fast startup time and UX (despite using React Native)
- Minimize the risk of data/coins loss
- Bring e-cash UX on par with the current standard of traditional finance (tradfi) mobile apps

As a result, the following architectural constraints are in place:
- Wherever available, use libraries with a fast JSI (JavaScript Interface) to native modules.
- Avoid Expo modules.
- Use fast storage for most wallet operations and separate local database storage to store data that incrementally grows.
- Leverage local database as an append-only coins backup independent from fast storage.

<img src="https://minibits.cash/img/minibits_architecture.png">

Open architectural concepts worth wider discussion
- [ ] Contacts management - identities, sharing contacts, send coins with the UX of tradfi instant payment while keeping privacy towards mints
- [ ] Off-device backup strategy - many options exist with or without mint interaction
- [ ] UX and naming conventions - e-cash is not always intuitive. UX for new users heavily depends on using the right abstractions or terms to describe what is going on. This wallet wants to serve as a means to test what could work. One of the first ideas is to avoid terms such as token or proof and propose the term coin instead.


## Download and test

Minibits wallet is in alpha and available as of now only for Android devices. You have the following options to try it out:
- [x] Join testing program on Google Play (Closed testing ongoing, submit your email to get an invite on [Minibits.cash](https://minibits.cash))
- [X] Download .apk file from Releases page and install it on your phone


# Development

Minibits is a bare React Native app written in Typescript. The project structure and code itself are intentionally verbose to support readability. Critical wallet code is reasonably documented. However, there is vast space for existing code improvements, refactoring, and bug fixing. This is an alpha software and the author does not code for a living.

The code is derived from Ignite template, however with many libraries, notably Expo, stripped down to achieve fast startup times. Performance bottleneck on some Android devices is react-native-keychain. To overcome this, it has been patched not to warm-up on startup and its use to encrypt storage is opt-in.

Wallet state is managed by mobx-state-tree and persisted in fast MMKV storage. Only the basic mobx concepts are in place, whole model could be improved. All critical wallet code is in services/walletService.ts and all coins state changes are in models/ProofsStore.ts. Wallet communication with the mints is in services/cashuMintClient.ts and uses [cashu-ts](https://github.com/cashubtc/cashu-ts) library.

Crypto operations are handled by react-native-quick-crypto, that is fast and does not require awful javascript shims. Transaction history and coins backup is stored in sqlite, with fast react-native-quick-sqlite driver that enables to run lighter queries synchronously.

In case of breaking state and data model changes, versioning and code is ready to run necessary migrations on wallet startup.

# Running in development mode

To run Minibits wallet in dev mode, set up the React Native development environment and the Yarn package manager. Then clone this repository, navigate to the minibits_wallet directory, and run the following:

```bash
yarn install
```

There are post-install patches to some of the libraries that should run automatically and are necessary for a successful run. See the patches directory for more info.
After the dependecies are installed, continue to create the following .env file in the root folder:

```bash
APP_ENV = 'DEV'
LOG_LEVEL = 'TRACE'
SENTRY_ACTIVE = 'FALSE'
```

Then make sure you have the Android device connected by running:

```bash
yarn adb
```

Finally run this and pray:

```bash
yarn start
```

In case of issues, repo includes commits history from the out of the box react native app up until the complete wallet. You can see build.gradle and other changes one by one and hopefully figure out what's wrong.

# Building

Create debug .apk:

```bash
yarn android:dev
```

# Automated testing

The app has the scaffolding for automated tests; they are yet to be implemented. For functional bugs or suggestions please raise an issue.

# Contributing

Contributions are welcome, just start and we will figure out what's next.
