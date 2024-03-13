const en = {
  common: {
    ok: "OK",    
    cancel: "Cancel",
    close: "Close",
    back: "Back",
    paste: "Paste",
    scan: "Scan",
    copy: "Copy",
    confirm: "Confirm",
    save: "Save",
    add: "Add",
    offline: "Offline",
  },
  welcomeScreen: {
    page1: {
      heading: "Welcome",
      intro: "Minibits is an ecash and Lightning wallet with a focus on performance and usability. Ecash is a bearer token issued by custodians known as mints.",
      bullet1: "Minibits follows the Cashu protocol, where mints back ecash with Bitcoin.",
      bullet2: "Ecash is issued or exchanged back to Bitcoin instantly through Lightning payments.",
      bullet3: "Ecash tokens are stored on-device; mints do not keep ledger or wallet balances.",
      final: "No Watson, there is no blockchain."
    },
    page2: {
      heading: "Why Minibits?",
      intro: "Minibits' aim is to research how Lightning and ecash can be integrated into a seamless and instant experience that can work at scale and still provide good privacy.",
      bullet1: "Minibits provides sharable wallet identifiers using NOSTR addresses. Like account numbers, just better.",
      bullet2: "Try in-person sends while devices are offline - ecash settles when back online (Proof of concept).",
      bullet3: "You can opt-in for storage encryption and biometric authentication.",
      final: "Minibits is free and open-source software; find us on Github for the roadmap and contributions."
    },
    page3: {
      heading: "Do not forget",
      intro: "Both the Cashu protocol and the Minibits wallet are still experimental, and by using them, you accept known and unknown risks.",
      bullet1: "Mints are, by design, custodial services. Run your own or use them only for research and testing purposes.",
      bullet2: "Ecash is stored on your device, so the loss of the device means the loss of ecash. Remote backup protocol is still under research.",
      bullet3: "Minibits provides its own mint that you can use for testing purposes with small amounts. It is operated on a best-effort basis and without any guarantees.",
      final: "Now, let's move some ecash!",
      go: "Let's go!"
    }  
  },
  walletScreen: {
    fund: "Fund wallet",
    withdraw: "Withdraw",
    send: "Send",
    receive: "Receive",
    topUpWallet: "Top up wallet",
    topUpWalletSubText: "Top up your balance by paying Bitcoin lightning invoice from another wallet",
    transferFromWallet: "Transfer from wallet",
    transferFromWalletSubText: "Debit your balance by paying Bitcoin lightning invoice from this wallet",
  },
  receiveScreen: {
    title: "Receive", 
    paste: "Paste ecash",
    receive: "Receive",
    receiveOffline: "Receive offline",    
    newMintsAdded: {
      one: "{{count}} mint has been added to your wallet",
      other: "{{count}} mints have been added to your wallet",
    },
    toReceive: "Amount to receive",
    received: "Amount received",
    sharePaymentRequest: "Send payment request",
    sharePaymentRequestDescription: "Send payment request to one of your contacts, so that the payer can pay you exact amount.",
    scanToReceive: "Scan or paste to receive",
    scanToReceiveDescription: "Scan or paste ecash token or lnurl withdraw link to receive into your wallet.",
    pasteToReceive: "Paste",
    pasteoReceiveDescription: "Paste ecash token to receive it into your wallet.",
    showOrShareInvoice: "Share lightning invoice",
    showOrShareInvoiceDescription: "Present or share lightning invoice for an amount you want to receive." ,
    scanWithdrawalLink: "Scan withdrawal link"   
  },
  transferScreen: {
    
  },
  topupScreen: {
    
  },
  sendScreen: {
    title: "Send",
    sendToContact: "Send to contact",
    sendToContactDescription: "Send your ecash to one of your contacts stored in your contact list.",
    scanToSend: "Scan or paste to send",
    scanToSendDescription: "Scan or paste invoice, lnurl pay code or lightning address to pay from your wallet.",
    pasteToSend: "Paste",
    pasteToSendDescription: "Paste lightning invoice from clipboard to pay it from your wallet.",
    showOrShareToken: "Share ecash",
    showOrShareTokenDescription: "Present or share ecash token for an amount you want to send.",
  },
  tranDetailScreen: {
    amount: "Amount (in satoshis)",
    lightningFee: "Lightning network fee",
    memoFromSender: "Memo from sender",
    sentFrom: "Sent from",
    sentTo: "Sent to",
    type: "Type",
    status: "Status",
    balanceAfter: "Balance after this transaction",
    createdAt: "Created at",
    id: "ID",    
    memoToReceiver: "Memo to receiver",
    revert: "Revert",
    claim: "Claim",
    memoFromInvoice: "Memo from invoice",
    paidFrom: "Paid from",
    receivedTo: "Received to",
    topupTo: "Topup to",
    invoice: "Lightning invoice to pay",
    receiveOfflineComplete: "Redeem to wallet",
    isOffline: "Redeem online"
  },
  contactsScreen: {    
    new: "New",
    scan: "Scan",
    newTitle: "Add new contact",    
  },
  profileScreen: {    
    changeAvatar: "Change picture",
    changeAvatarSubtext: "Select one from randomly generated pictures.",
    changeWalletaddress: "Change wallet address",
    changeWalletaddressSubtext: "Change unique wallet address. Select one of randomly generated or choose your own.",
  },
  settingsScreen: {
    title: "Settings", 
    manageMints: "Manage mints",
    mintsCount: {
      one: "{{count}} mint",
      other: "{{count}} mints",
    },
    go: "Let's go!",
    backupRecovery: "Backup and recovery",
    security: "Security",
    privacy: "Privacy",
    devOptions: "Developer options", 
    update: "Update manager"
  },
  mintsScreen: {
    addMintUrl: "Add mint URL",    
    mintUrl: "Mint URL",
    mintUrlHint: "Provide the URL of a trusted mint",
    invalidUrl: "This is not a valid URL",
    mintExists: "This mint already exists",
    addMint: "Add mint",
    mintAdded: "The mint has been added",
    mintInfo: "Mint information page",
    rename: "Rename mint",
    setColor: "Change the mint's icon color",
    copy: "Copy mint URL",
    removeMint: "Remove mint",
    blockMint: "Block receiving from this mint",
    unblockMint: "Unblock receiving from this mint",
    mintRemoved: "The mint has been removed",
    mintBlocked: "The mint has been blocked. The app will not receive ecash from this mint.",
    mintUnblocked: "The mint has been unblocked. You can now receive ecash from this mint."
  },
  backupScreen: {
    localBackup: "Local backup",
    localBackupDescription: "Local backup stores a copy of all your ecash in the local database. Ecash is never deleted unless you switch off the backup. Please note that this backup is not encrypted.",
    remoteBackup: "Off-device backup",
    remoteBackupDescription: "Seed phrase allows you to recover your ecash balance in case of device loss.",
    recoveryTool: "Recovery tool",
    recoveryToolDescription: "Show ecash backed up in the local database and attempt to recover unspent ones into the wallet in case the wallet storage gets corrupted or a transaction fails due to an unexpected error.",
    removeSpentCoins: "Remove spent ecash",
    removeSpentCoinsDescription: "In case of a SEND or TRANSFER transaction error, spent ecash may remain in your wallet. This blocks further transactions with the mint, making the wallet unusable. This tool removes spent ecash from the wallet."
  },
  securityScreen: {
    encryptStorage: "Encrypt storage",
    encryptStorageDescription: "Encrypt the storage that stores your ecash with the secret key generated on your device and stored in secure keys storage. Experimental, not recommended for every day use.",
    biometry: "Biometric authentication",
    biometryAvailable: "Your device supports biometric authentication. If you activate encrypted storage, it will be required for Minibits to start.",
    biometryNone: "You have not setup biometric authentication or your device does not support it.",
  },
  privacyScreen: {    
    torDaemon: "Use Tor network",
    torDaemonDescription: "Allow connections with mints through Tor .onion addresses.",
    torStatus: "Tor status",
    logger: "Enable logging",
    loggerDescription: "Log anonymous error information in order to identify and fix wallet bugs during beta testing. Switch off for best privacy.",
  },
  updateScreen: {
    updateAvailable: "Update is available",
    nativeUpdateAvailableDesc: "There is a new version of Minibits Wallet in the Google Play Store.",
    gotoPlayStore: 'Visit Play Store',
    updateNow: 'Update and restart',
    updateAvailableDesc: "There is a new Over-the-Air update of Minibits Wallet ready to download and install.",
    updateNew: "What's new?",
    updateSize: "Download size",
    updateNotAvailable: 'Nothing to update',
    updateNotAvailableDesc: 'Good, you are running the latest version of the app.'
  },
  developerScreen: {
    title: "Developer options", 
    transactions: "Sync recent transactions",
    transactionsDescription: "There are {{count}} recent transactions cached in the app's fast storage. Resetting will reload them from the app's database. Do only during development or testing.",
    reset: "Factory reset",
    resetDescription: "This will wipe out all local data from storage and from the local database. Do only during development or testing.",
    go: "Let's go!",
    devOptions: "Developer options", 
    info: "About Minibits wallet",
    logLevel: "Log level"
  },
  errorScreen: {
    title: "Something went wrong!",
    friendlySubtitle:
      "Unfortunately, the Minibits app encountered an unexpected error. Please contact us at support@minibits.cash or raise an issue on Github.",
    reset: "RESET APP",
  },
  tabNavigator: {
    walletLabel: "Wallet",      
    contactsLabel: "Contacts",
    settingsLabel: "Settings",
  },
};

export default en;
export type Translations = typeof en;
