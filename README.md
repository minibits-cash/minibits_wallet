![feature_sharp](https://github.com/minibits-cash/minibits_wallet/assets/138401554/2c615363-fbf6-4a9e-ac89-9228ae159cda)


# Disclaimer

⚠️ If you are using this app, please take the following into consideration:
- This wallet should be used for research purposes only.
- The wallet is a beta version with incomplete functionality and both known and unknown bugs.
- Do not use it with large amounts of ecash.
- The ecash stored in the wallet is issued by the mint. You trust the mint to back it with bitcoin until you transfer your holdings to another bitcoin lightning wallet.
- The Cashu protocol that the wallet implements has not yet received extensive review or testing.


# Minibits Wallet

Minibits is an ecash and lightning wallet with a focus on ease of use and security. Ecash is issued by mints and backed by Bitcoin via the [Cashu](https://cashu.space) protocol and Lightning Network. Ecash is cash-like yet digital token with cheap and instant transfers and high privacy guarantees.

## Roadmap

Platform support
- [x] Android app
- [ ] iOS app
- [x] Light and dark mode
- [x] i18n support
- [ ] Other then EN languange support

Mints
- [x] Multiple currency units issued by mints
- [x] Add multiple mints
- [x] Remove mints
- [x] Block receiving from mint
- [x] Show mint balances grouped by currency units
- [x] Handle mint keys rotation (not tested)
- [x] Mint status and information screen

Receive ecash
- [x] Scan QR code of a ecash token
- [x] Animated QR codes support for large tokens [✨ New!]
- [x] Paste ecash token from the clipboard
- [x] Receive Nostr zaps or Lightning payments to minibits.cash address
- [x] Receive ecash from another wallet over NOSTR message sent to minibits.cash address
- [x] Receive ecash in person while being offline, redeem later (MVP version)
- [x] Realtime and encrypted push notifications on receive to minibits.cash lightning address [✨ New!]

Send ecash
- [x] Share ecash token to send through another app
- [x] Show ecash token as a QR code
- [x] Show large ecash token as an animated QR code [✨ New!]
- [x] Send ecash to contact (minibits.cash or another NOSTR address)
- [ ] Lock ecash sent offline to the receiver wallet key

Top up wallet
- [x] Show QR code with bitcoin Lightning invoice to pay
- [x] Share encoded bitcoin Lightning invoice to pay
- [x] Share payment request with a contact over NOSTR message
- [x] Top up balance with LNURL Withdraw

Pay / Cash out from wallet
- [x] One click ZAPS - tip users of NOSTR social network
- [x] Pay bitcoin Lightning invoice with your ecash
- [x] Pay payment request received from another contact
- [x] Pay to LNURL Pay static links / codes
- [x] Pay to Lightning address
- [ ] Transfer (swap) ecash to another mint

Transaction history
- [x] Unified transaction history for all kinds of transactions
- [x] Audit trail of transaction events
- [x] Filter pending transactions
- [x] Retry after recoverable transaction errors
- [x] Revert pending transaction in 1 click (get back tokens not claimed by receiver) [✨ New!]
- [ ] Tags and related filtering of transactions
- [x] Delete incomplete and failed transactions from history

Contacts
- [x] Private contacts address book for payments
- [x] Public contacts (followed users on NOSTR social network) for tipping and donations
- [x] Load public contacts from custom NOSTR relay
- [x] Wallet addresses as random public NOSTR addresses (random123@minibits.cash)
- [x] Custom wallet names (myname@minibits.cash)
- [x] Wallet addresses usable as Lightning addresses to receive payments from many Lightning wallets
- [x] Private contacts with other than minibits.cash NOSTR adresses and relays

Backup and recovery
- [x] Local append-only backup of all ecash in a database separate from wallet storage
- [x] Export wallet backup with ecash, mints, contacts and recent transactions [✨ New!]
- [x] Recovery of ecash using 12 words menmonic phrase in case of lost device
- [x] Recovery by importing wallet backup [✨ New!]
- [x] Move wallet address from another device using the seed phrase
- [x] Recover wallet in case spent ecash remains in the wallet
- [x] Retry transaction after recoverable errors
- [x] Auto-recover funds if wallet failed to receive ecash issued by mint due to network or device failure


Interoperability
- [x] Nostr Wallet Connect - lets you initiate payments from another app, such as Nostr client [✨ New!]
- [x] Deeplinks - app reacts to lightning: and cashu: URIs


Security and Privacy
- [x] Use device biometry to login
- [ ] Connect to the mints on .onion Tor addresses using own Tor daemon [discontinued from v0.1.7]
- [x] Connect to the mints on .onion Tor addresses using Orbot

Self-funding
- [X] Donation for custom wallet name

DevOps
- [x] OTA updates (opt in)
- [ ] Automated tests
- [ ] Automated release pipelines for both OTA updates and native releases


## Architecture

The wallet's design has been crafted to prioritize the following primary quality properties:
- Support both Android and iOS mobile platforms
- Achieve fast UX and startup time (despite using React Native)
- Minimize the risk of data/ecash loss
- Bring ecash UX on par with the current standard of traditional finance (tradfi) mobile apps

As a result, the following architectural constraints are in place:
- Wherever available, use libraries with a fast JSI (JavaScript Interface) to native modules.
- Avoid Expo modules.
- Use fastest available storage for most wallet operations and separate local database storage to store data that incrementally grows.
- Leverage local database as an append-only ecash backup independent from fast storage.

<img src="https://www.minibits.cash/img/minibits_architecture_v2.png">

Open architectural concepts that were still open for discussion when the wallet had been released
- [x] Contacts management - identities, sharing contacts, send ecash with the UX of tradfi instant payment while keeping privacy towards mints - Implemented as NOSTR keypairs and NIP05 public sharable names that ecash can be sent to
- [x] Off-device backup strategy - Implemented using @gandlafbtc concept of deterministic secrets
- [ ] UX and naming conventions - ecash is not always intuitive. UX for new users heavily depends on using the right abstractions or terms to describe what is going on. This wallet wants to serve as a means to test what could work. One of the first ideas is to avoid terms such as token or proof and propose the term --coin ++ecash instead.
- [ ] Suitable Tor daemon available to replace not maintained react-native-tor. From v0.1.8-beta.33 connection through Orbot in VPN mode is possible.


## Download and test

Minibits wallet is in early beta and available as of now only for Android devices. You have the following options to try it out:
- [x] Download it from Google Play
- [x] Join testing program on Google Play to get early releases to test (Submit your email to get an invite on [Minibits.cash](https://www.minibits.cash))
- [x] Download .apk file from Releases page and install it on your phone


# Development

Minibits is a bare React Native app written in Typescript. The project structure and code itself are intentionally verbose to support readability. Critical wallet code is reasonably documented. However, there is vast space for existing code improvements, refactoring, and bug fixing. This is an early beta software and the author does not code for a living.

The code is derived from Ignite template, however with many libraries, notably Expo, stripped down to achieve fast startup times. Performance bottleneck on some Android devices is react-native-keychain. To overcome this, it has been patched not to warm-up on startup, caching for wallet operations is in place and its use to encrypt storage is opt-in.

Wallet state is managed by mobx-state-tree and persisted in fast MMKV storage. Only the basic mobx concepts are in place, whole model could be improved. All critical wallet code is in services/walletService.ts and all ecash state changes are in models/ProofsStore.ts. Wallet communication with the mints is in model/Wallet.ts and uses [cashu-ts](https://github.com/cashubtc/cashu-ts) library.

Crypto operations are handled by react-native-quick-crypto, that is fast and does not require awful javascript shims. Transaction history and ecash backup is stored in sqlite, with fast react-native-quick-sqlite driver that enables to run lighter queries synchronously.

Wallet included own Tor daemon using react-native-tor library to connect to the mints over Tor network. However this seems not to be long term approach as this library is
not properly maintained and future updates of React native will likely break it. Help with replacement would be appreciated.

In case of breaking state and data model changes, versioning and code is ready to run necessary migrations on wallet startup.

# Running in development mode

To run Minibits wallet in dev mode, set up the React Native development environment and the Yarn package manager. Then clone this repository, navigate to the minibits_wallet directory, and run the following:

```bash
yarn install
```

There are post-install patches to some of the libraries that should run automatically and are necessary for a successful run. See the patches directory for more info.
After the dependecies are installed, continue to create the following .env file in the root folder:

```bash
APP_ENV='DEV'
MINIBITS_SERVER_API_KEY='mockkey'
MINIBITS_SERVER_API_HOST='http://localhost/api' 
MINIBITS_NIP05_DOMAIN='@localhost'
MINIBITS_RELAY_URL='ws://localhost/relay'
MINIBITS_MINT_URL='http://localhost/mint' 
```
Local NOSTR address and Lighnting brigde server are not necessary to run the wallet.
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
