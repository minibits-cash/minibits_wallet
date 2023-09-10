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
      intro: "Minibits is an eCash and Lightning wallet with a focus on performance and usability. eCash is a bearer token issued by custodians known as mints.",
      bullet1: "Minibits follows the Cashu protocol, where mints back eCash with Bitcoin.",
      bullet2: "eCash is issued or exchanged back to Bitcoin instantly through Lightning payments.",
      bullet3: "eCash tokens are stored on-device; mints do not keep ledger or wallet balances.",
      final: "No Watson, there is no blockchain."
    },
    page2: {
      heading: "Why Minibits?",
      intro: "Minibits' aim is to research how Lightning and eCash can be integrated into a seamless and instant experience that can work at scale and still provide good privacy.",
      bullet1: "Minibits provides sharable identifiers using NOSTR addresses. Like account numbers, just better.",
      bullet2: "Try in-person sends while devices are offline - eCash settles when back online (Proof of concept).",
      bullet3: "You can opt-in for storage encryption and biometric authentication.",
      final: "Minibits is free and open-source software; find us on Github for roadmap and contributions."
    },
    page3: {
      heading: "Do not forget",
      intro: "Both the Cashu protocol and the Minibits wallet are still experimental, and by using them, you accept known and unknown risks.",
      bullet1: "Mints are, by design, custodial services. Run your own or use them only for research and testing purposes.",
      bullet2: "eCash is stored on your device, so the loss of the device means the loss of coins. Remote backup protocol is still under research.",
      bullet3: "Minibits provides its own mint that you can use for testing purposes with small amounts. It is operated on a best-effort basis and without any guarantees.",
      final: "Now, let's move some eCash!",
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
    paste: "Paste coin",
    receive: "Receive",
    receiveOffline: "Receive offline",    
    newMintsAdded: {
      one: "{{count}} mint has been added to your wallet",
      other: "{{count}} mints have been added to your wallet",
    },
    toReceive: "Amount to receive",
    received: "Amount received:",
    sharePaymentRequest: "Share payment request",
    sharePaymentRequestDescription: "Share the amount and contact information as a link or QR code, so that the payer can pay you the requested amount.",
    scanQRCodeToReceive: "Scan QR code to receive",
    scanQRCodeToReceiveDescription: "If you see the coins in QR code format on another device, scan it to receive.",
    pasteFromClipboard: "Paste from clipboard",
    pasteFromClipboardDescription: "If you've received your coins through any other app, paste them here to receive."    
  },
  transferScreen: {
    pasteLightningInvoice: "Paste lightning invoice",
    pasteLightningInvoiceDescription: "Paste the Bitcoin lightning invoice you want to pay. The mint will pay this invoice on your behalf in exchange for the coins from your wallet.",
    scanLightningInvoice: "Scan lightning invoice",
    scanLightningInvoiceDescription: "Scan the Bitcoin lightning invoice in QR code format. You can use your coins to pay any service supporting lightning payments."
  },
  topupScreen: {
    sendInvoiceToContact: "Send invoice to contact",
    sendInvoiceToContactDescription: "Send a lightning invoice to one of your contacts so they can top up your balance by paying it.",
    showInvoiceQRCode: "Show invoice QR code",
    showInvoiceQRCodeDescription: "Present the lightning invoice as a QR code so that you can pay it from the wallet on another device.",
    shareInvoiceAsText: "Share invoice as text",
    shareInvoiceAsTextDescription: "Copy and share the invoice with anybody through a secure app of your choice."
  },
  sendScreen: {
    sendToContact: "Send to contact",
    sendToContactDescription: "Send your coins to one of your contacts stored in your contact list.",
    showAsQRCode: "Show as QR code",
    showAsQRCodeDescription: "Present the coins as a QR code so that the recipient can scan it to receive them.",
    shareAsText: "Share as text",
    shareAsTextDescription: "Copy and send the coins to anybody through a secure app of your choice."
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
    changeWalletname: "Change wallet name",
    changeWalletnameSubtext: "Change unique wallet name. Your wallet name can be shared with other people. Like an account number, just better.",
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
    mintBlocked: "The mint has been blocked. The app will not receive coins from this mint.",
    mintUnblocked: "The mint has been unblocked. You can now receive coins from this mint."
  },
  backupScreen: {
    localBackup: "Local backup",
    localBackupDescription: "Local backup stores a copy of all your coins in the local database. Coins are never deleted unless you switch off the backup. Please note that this backup is not encrypted.",
    recoveryTool: "Recovery tool",
    recoveryToolDescription: "Show coins backed up in the local database and attempt to recover unspent ones into the wallet in case the wallet storage gets corrupted or a transaction fails due to an unexpected error.",
    removeSpentCoins: "Remove spent coins",
    removeSpentCoinsDescription: "In case of a SEND or TRANSFER transaction error, spent coins may remain in your wallet. This blocks further transactions with the mint, making the wallet unusable. This tool removes spent coins from the wallet."
  },
  securityScreen: {
    encryptStorage: "Encrypt storage",
    encryptStorageDescription: "Encrypt the storage that stores your coins with the secret key generated on your device and stored in secure keys storage. On some Android devices, this may cause a slightly longer startup of the application.",
    biometry: "Biometric authentication",
    biometryAvailable: "Your device supports biometric authentication. If you activate encrypted storage, it will be required for Minibits to start.",
    biometryNone: "You have not setup biometric authentication or your device does not support it."
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
    info: "About Minibits wallet"
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
